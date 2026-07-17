import { bucketMadeHand, plausiblePostflopActionsForCombo } from '../bots/botPolicy';
import { personalityParams, type Personality } from './personalities';
import { getLegalActions } from '../engine/actions';
import { orderedDeck } from '../engine/deck';
import type { Action, ActionType, Card, GameState } from '../engine/types';
import { simulateEquity } from '../equity/monteCarlo';
import type { Evaluator } from '../evaluator/Evaluator';
import { canAct } from '../engine/seatOrder';
import { canonicalHand } from './rangeParser';
import { positionForSeat } from './position';
import { villainNodeCombos } from './nodeRange';
import {
  classifyOpener,
  getCallRange,
  getFacingFourBetContinueRange,
  getFourBetBluffRange,
  getFourBetValueRange,
  getOpenRaiseRange,
  getThreeBetRange,
  getVsSbOpenCallRange,
  type OpenRaisePosition,
} from './ranges';
import {
  GRADING_THRESHOLDS,
  severityForEvLoss,
  type ActionEV,
  type DecisionCategory,
  type GradeResult,
  type GradingThresholds,
  type HeroBucket,
  type ReasonKey,
  type Severity,
} from './graderTypes';

const MC_ITERATIONS = 1000;

interface GraderContext {
  state: GameState;
  heroSeat: number;
  evaluator: Evaluator;
  villainCombosList: [Card, Card][][];
  /** Personality per entry of villainCombosList (same order). */
  villainPersonalities: Personality[];
  heroCards: [Card, Card];
  potBb: number;
  bigBlind: number;
}

// ---------------------------------------------------------------------------
// Realization factor R (spec §6.3)
// ---------------------------------------------------------------------------

/** Hero is in position if no live opponent acts after them postflop. */
function heroInPosition(state: GameState, heroSeat: number): boolean {
  const n = state.seats.length;
  // Walk from the button backwards: the last actable seat in order acts last.
  for (let i = 0; i < n; i++) {
    const idx = (state.buttonSeat - i + n) % n;
    const seat = state.seats[idx]!;
    if (!seat.folded && !seat.sittingOut) return idx === heroSeat;
  }
  return false;
}

function realizationFactor(state: GameState, heroSeat: number): number {
  const ip = heroInPosition(state, heroSeat);
  switch (state.street) {
    case 'RIVER':
      return 1.0;
    case 'TURN':
      return ip ? 0.95 : 0.85;
    case 'FLOP':
      return ip ? 0.9 : 0.8;
    default:
      // Preflop EV fallback path (charts are the primary preflop grader);
      // reuse the flop factors as the nearest defined values.
      return ip ? 0.9 : 0.8;
  }
}

// ---------------------------------------------------------------------------
// Hero hand bucket (spec §6.2), incl. clean-out counting for DRAW
// ---------------------------------------------------------------------------

/** Counts unseen cards that upgrade hero to a straight or better ("clean outs"). */
function countCleanOuts(heroCards: [Card, Card], board: Card[], evaluator: Evaluator): number {
  if (board.length < 3 || board.length >= 5) return 0;
  const seen = new Set<Card>([...heroCards, ...board]);
  const currentRank = evaluator.evaluate([...heroCards, ...board]).rank;
  const strongClasses = new Set(['Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush']);
  let outs = 0;
  for (const card of orderedDeck()) {
    if (seen.has(card)) continue;
    const result = evaluator.evaluate([...heroCards, ...board, card]);
    if (result.rank > currentRank && strongClasses.has(result.name)) outs++;
  }
  return outs;
}

export function heroBucketOf(
  equity: number,
  heroCards: [Card, Card],
  board: Card[],
  evaluator: Evaluator,
): HeroBucket {
  if (equity >= 0.8) return 'MONSTER';
  if (equity >= 0.65) return 'STRONG';
  if (equity >= 0.45) return 'MARGINAL';
  const outs = countCleanOuts(heroCards, board, evaluator);
  if (outs >= 8) return 'DRAW';
  if (equity >= 0.25 && outs >= 4) return 'DRAW';
  return 'AIR';
}

// ---------------------------------------------------------------------------
// EV formulas (spec §6.3)
// ---------------------------------------------------------------------------

function equityVs(ctx: GraderContext, villainCombosList: [Card, Card][][], seedSuffix: string): number {
  const { equity } = simulateEquity(
    {
      heroCards: ctx.heroCards,
      board: [...ctx.state.board],
      villainCombos: villainCombosList,
      iterations: MC_ITERATIONS,
      seed: `${ctx.state.seed}:grade:${ctx.state.actionLog.length}:${seedSuffix}`,
    },
    ctx.evaluator,
  );
  return equity;
}

/**
 * FE: share of villain's node range in fold-candidate buckets (WEAK made
 * hands ≈ spec's "{AIR, weak MARGINAL}"), scaled by the personality's
 * foldToCbet and by bet size relative to pot (66% pot = 1×). One-street
 * approximation per spec §6.3's documented limitation.
 */
function foldEquityAndContinueRange(
  ctx: GraderContext,
  betBb: number,
): { fe: number; continueCombos: [Card, Card][][] } {
  const { state, evaluator } = ctx;
  const sizeScale = Math.min(1.25, Math.max(0.33, betBb / Math.max(ctx.potBb, 0.01))) / 0.66;

  let feProduct = 1;
  const continueCombos: [Card, Card][][] = [];

  for (let v = 0; v < ctx.villainCombosList.length; v++) {
    const combos = ctx.villainCombosList[v]!;
    const personality = ctx.villainPersonalities[v] ?? 'TAG';
    const params = personalityParams(personality);
    // Fold candidates are WEAK-bucket combos the policy can actually fold —
    // Station's made pairs never do (same code path as the bot's decision).
    const foldable = combos.filter(
      (c) =>
        bucketMadeHand(c, state.board, evaluator) === 'WEAK' &&
        plausiblePostflopActionsForCombo(c, state.board, true, personality, evaluator).has('fold'),
    );
    const foldableShare = combos.length > 0 ? foldable.length / combos.length : 0;
    const villainFolds = Math.min(0.95, foldableShare * params.foldToCbet * sizeScale);
    feProduct *= villainFolds;

    const continuing = combos.filter((c) => bucketMadeHand(c, state.board, evaluator) !== 'WEAK');
    continueCombos.push(continuing.length > 0 ? continuing : combos);
  }

  // FE = everyone folds. With one villain this is just their fold frequency.
  return { fe: feProduct, continueCombos };
}

function evCheck(ctx: GraderContext, equity: number, r: number): number {
  return equity * r * ctx.potBb;
}

function evCall(ctx: GraderContext, equity: number, r: number, toCallBb: number): number {
  return equity * r * (ctx.potBb + toCallBb) - toCallBb;
}

function evBet(ctx: GraderContext, betBb: number, r: number): number {
  const { fe, continueCombos } = foldEquityAndContinueRange(ctx, betBb);
  const ePrime = equityVs(ctx, continueCombos, `bet${betBb.toFixed(2)}`);
  return fe * ctx.potBb + (1 - fe) * (ePrime * r * (ctx.potBb + 2 * betBb) - betBb);
}

// ---------------------------------------------------------------------------
// Candidate generation (spec §6.1)
// ---------------------------------------------------------------------------

function candidateActions(state: GameState, heroSeat: number): { action: ActionType; amount?: number }[] {
  const legal = getLegalActions(state, heroSeat);
  const hero = state.seats[heroSeat]!;
  const pot = state.seats.reduce((sum, s) => sum + s.committedTotal, 0);
  const out: { action: ActionType; amount?: number }[] = [];

  if (legal.canCall) out.push({ action: 'fold' }, { action: 'call' });
  else out.push({ action: 'check' });

  const amounts = new Set<number>();
  if (legal.canBet) {
    for (const frac of [0.33, 0.66, 1.25]) {
      const target = Math.max(legal.minTo, Math.min(Math.round(pot * frac), legal.maxTo));
      amounts.add(target);
    }
  } else if (legal.canRaise) {
    const effectiveStack = hero.stack + hero.committedThisStreet;
    const spr = pot > 0 ? effectiveStack / pot : Infinity;
    if (spr < 1.5) {
      amounts.add(legal.maxTo); // jam
    } else {
      for (const mult of [2.5, 3.5]) {
        const target = Math.max(legal.minTo, Math.min(Math.round(state.currentBet * mult), legal.maxTo));
        amounts.add(target);
      }
    }
  }
  for (const amount of amounts) {
    out.push({ action: legal.canBet ? 'bet' : 'raise', amount });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preflop chart grading (spec §3 tolerance)
// ---------------------------------------------------------------------------

/** Neighbors one "step" away: kicker ±1, top card ±1, or pair ±1. */
function oneStepNeighbors(hand: string): string[] {
  const ranks = '23456789TJQKA';
  const step = (ch: string, d: number) => ranks[ranks.indexOf(ch) + d];
  const neighbors: string[] = [];
  if (hand.length === 2) {
    for (const d of [-1, 1]) {
      const r = step(hand[0]!, d);
      if (r) neighbors.push(`${r}${r}`);
    }
    return neighbors;
  }
  const [hi, lo, s] = [hand[0]!, hand[1]!, hand[2]!];
  for (const d of [-1, 1]) {
    const lo2 = step(lo, d);
    if (lo2 && lo2 !== hi) neighbors.push(`${hi}${lo2}${s}`);
    const hi2 = step(hi, d);
    if (hi2 && hi2 !== lo) neighbors.push(`${hi2}${lo}${s}`);
  }
  return neighbors;
}

function isOneStepFromRange(hand: string, range: Set<string>): boolean {
  return oneStepNeighbors(hand).some((n) => range.has(n));
}

interface PreflopChartVerdict {
  chartAction: 'raise' | 'call' | 'fold';
  nearBoundary: boolean;
}

/** What the baseline chart says hero should do here, mirroring decidePreflop's branches. */
function preflopChartVerdict(state: GameState, heroSeat: number): PreflopChartVerdict | null {
  const n = state.seats.length;
  const hand = canonicalHand(state.seats[heroSeat]!.holeCards as [Card, Card]);
  const position = positionForSeat(state.buttonSeat, heroSeat, n);
  const raises = state.actionLog.filter(
    (e) => e.street === 'PREFLOP' && (e.action === 'raise' || e.action === 'bet'),
  );

  if (raises.length === 0) {
    if (position === 'BB') return null; // free check; nothing to grade against
    const range = getOpenRaiseRange(position as OpenRaisePosition);
    return { chartAction: range.has(hand) ? 'raise' : 'fold', nearBoundary: isOneStepFromRange(hand, range) };
  }

  if (raises.length === 1 && raises[0]!.seat !== heroSeat) {
    const openerPosition = positionForSeat(state.buttonSeat, raises[0]!.seat, n) as OpenRaisePosition;
    const openerClass = classifyOpener(openerPosition);
    const fromBlinds = position === 'SB' || position === 'BB';
    const threeBet = getThreeBetRange(openerClass, fromBlinds);
    const call = openerClass === 'SB' ? getVsSbOpenCallRange() : getCallRange(openerClass, position);
    if (threeBet.has(hand)) return { chartAction: 'raise', nearBoundary: false };
    if (call?.has(hand)) return { chartAction: 'call', nearBoundary: false };
    const nearBoundary = isOneStepFromRange(hand, threeBet) || (call ? isOneStepFromRange(hand, call) : false);
    return { chartAction: 'fold', nearBoundary };
  }

  // Facing a 3-bet or deeper (spec §3.3): 4-bet the value+bluff range,
  // continue with the premium range, fold everything else. Without this
  // branch the crude one-street EV model would grade these spots alone —
  // and it wildly overvalues re-raising thin.
  const fourBet = new Set([...getFourBetValueRange(), ...getFourBetBluffRange()]);
  const cont = getFacingFourBetContinueRange();
  if (fourBet.has(hand)) return { chartAction: 'raise', nearBoundary: false };
  if (cont.has(hand)) return { chartAction: 'call', nearBoundary: false };
  return { chartAction: 'fold', nearBoundary: isOneStepFromRange(hand, cont) };
}

// ---------------------------------------------------------------------------
// Reasons & messages (spec §6.4)
// ---------------------------------------------------------------------------

/** Plain-English seat names so messages never lean on position jargon. */
const POSITION_NAMES: Record<string, string> = {
  UTG: 'the first seat to act',
  HJ: 'the hijack seat (two seats before the dealer)',
  CO: 'the cutoff seat (just before the dealer)',
  BTN: 'the dealer button (the best seat — you act last)',
  SB: 'the small blind',
  BB: 'the big blind',
};

const REASONS: Record<ReasonKey, { text: (ctx: ReasonCtx) => string; glossary: string }> = {
  pot_odds: {
    text: ({ requiredPct, equityPct }) =>
      equityPct >= requiredPct
        ? `The pot was offering a good price: you only needed to win about ${requiredPct}% of the time, and your hand wins about ${equityPct}%.`
        : `The price was too high: you would need to win about ${requiredPct}% of the time to break even, but your hand only wins about ${equityPct}%.`,
    glossary: 'pot odds',
  },
  missed_value: {
    text: () => 'Your hand is very strong — betting gets more chips into the pot while you are ahead.',
    glossary: 'value bet',
  },
  missed_bluff: {
    text: () => 'Your opponent is unlikely to have a strong hand here — a bet would often win the pot right away.',
    glossary: 'fold equity',
  },
  oop_discipline: {
    text: () => 'You act before your opponent on every betting round, which is a disadvantage — stick to stronger hands in spots like this.',
    glossary: 'position',
  },
  preflop_chart: {
    text: ({ position, chartSaysPlay, facing }) => {
      const seat = POSITION_NAMES[position] ?? position;
      if (facing === 'open') {
        return chartSaysPlay
          ? `This hand is strong enough to raise from ${seat} — solid players get involved here.`
          : `This hand is too weak to play from ${seat} — solid players fold it here.`;
      }
      if (facing === 'raise') {
        return chartSaysPlay
          ? `This hand is strong enough to continue even against the raise in front of you.`
          : `An opponent had already raised, and it takes a much stronger hand to call or re-raise than to make the first raise — solid players fold this hand here.`;
      }
      return chartSaysPlay
        ? `This hand is strong enough to continue even against a raise and a re-raise.`
        : `There was already a raise and a re-raise in front of you — that usually means very strong hands, so almost everything should fold here.`;
    },
    glossary: 'opening range',
  },
};

interface ReasonCtx {
  requiredPct: number;
  equityPct: number;
  position: string;
  /** True when the chart wanted hero to enter the pot and hero passed. */
  chartSaysPlay: boolean;
  /** Preflop context: unopened pot, facing one raise, or facing a re-raise. */
  facing: 'open' | 'raise' | 'reraise';
}

function pickReason(
  street: string,
  best: ActionEV,
  chosen: ActionEV,
  heroBucket: HeroBucket,
  inPosition: boolean,
): ReasonKey {
  if (street === 'PREFLOP') return 'preflop_chart';
  if (best.action === 'fold') return 'pot_odds';
  if (best.action === 'bet' || best.action === 'raise') {
    // Covers both "should have bet/raised instead" and "right action, wrong
    // size" — the dominant factor either way is the value (or fold equity)
    // the chosen line leaves behind (spec §6.4 reason library).
    const sizeDiffers =
      chosen.action === best.action &&
      best.amount !== undefined &&
      chosen.amount !== undefined &&
      best.amount !== chosen.amount;
    if (chosen.action !== best.action || sizeDiffers) {
      if (heroBucket === 'MONSTER' || heroBucket === 'STRONG') return 'missed_value';
      return 'missed_bluff';
    }
  }
  if (!inPosition && (heroBucket === 'MARGINAL' || heroBucket === 'AIR')) return 'oop_discipline';
  return 'pot_odds';
}

/**
 * Buckets a decision into a leak category (spec §8): preflop; facing_bet
 * when there's a live bet; cbet when hero was the last aggressor of the
 * previous street and can stab; sizing when the action type was right but
 * the size wasn't; bluff for unforced aggression-or-not spots with weak hands.
 */
function classifyDecision(
  state: GameState,
  heroSeat: number,
  best: ActionEV,
  chosen: ActionEV,
  heroBucket: HeroBucket,
): DecisionCategory {
  if (state.street === 'PREFLOP') return 'preflop';
  if (
    (best.action === 'bet' || best.action === 'raise') &&
    best.action === chosen.action &&
    best.amount !== undefined &&
    chosen.amount !== undefined &&
    Math.abs(best.amount - chosen.amount) / state.config.blinds[1] >= 1
  ) {
    return 'sizing';
  }
  const facingBet = state.currentBet > 0;
  if (facingBet) return 'facing_bet';

  const streets = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];
  const prevStreet = streets[streets.indexOf(state.street) - 1];
  const prevAggressor = [...state.actionLog]
    .reverse()
    .find((e) => e.street === prevStreet && (e.action === 'bet' || e.action === 'raise'));
  if (prevAggressor?.seat === heroSeat) return 'cbet';

  return heroBucket === 'AIR' || heroBucket === 'DRAW' ? 'bluff' : 'sizing';
}

function actionLabel(a: ActionEV, bigBlind: number): string {
  if (a.action === 'bet' || a.action === 'raise') {
    const bb = a.amount !== undefined ? ` ${(a.amount / bigBlind).toFixed(1)} big blinds` : '';
    return a.action === 'bet' ? `Betting${bb}` : `Raising to${bb}`;
  }
  const labels: Partial<Record<ActionType, string>> = { fold: 'Folding', call: 'Calling', check: 'Checking' };
  return labels[a.action] ?? a.action[0]!.toUpperCase() + a.action.slice(1);
}

function buildMessage(
  best: ActionEV,
  evLossBb: number,
  reasonKey: ReasonKey,
  reasonCtx: ReasonCtx,
  bigBlind: number,
): { message: string; glossary: string } {
  const reason = REASONS[reasonKey];
  const message =
    `${actionLabel(best, bigBlind)} was the better play. ${reason.text(reasonCtx)}` +
    ` That cost you about ${evLossBb.toFixed(1)} big blinds.`;
  return { message: message.slice(0, 260), glossary: reason.glossary };
}

// ---------------------------------------------------------------------------
// Main entry: Grader.evaluate(node) → ActionEV[] (+ grade of the chosen action)
// ---------------------------------------------------------------------------

/**
 * Grades one hero decision: evaluates every candidate action's EV (spec §6.3
 * one-street approximation), grades the chosen action by EV loss (§6.4), and
 * builds the feedback message. Preflop uses chart grading (§3) with the EV
 * path as fallback for unlisted spots. Runs inside the equity worker only.
 */
export function gradeDecision(
  preActionState: GameState,
  heroSeat: number,
  chosenAction: Action,
  evaluator: Evaluator,
  thresholds: GradingThresholds = GRADING_THRESHOLDS,
  personalities: Record<number, Personality> = {},
): GradeResult {
  const state = preActionState;
  const bigBlind = state.config.blinds[1];
  const heroCards = state.seats[heroSeat]!.holeCards as [Card, Card];
  const villainSeats = state.seats.filter((s) => s.seatIndex !== heroSeat && !s.folded && s.holeCards);

  const villainPersonalities = villainSeats.map((s) => personalities[s.seatIndex] ?? 'TAG');
  const villainCombosList = villainSeats.map((s, i) =>
    villainNodeCombos(state, s.seatIndex, heroCards, evaluator, villainPersonalities[i]),
  );

  const potChips = state.seats.reduce((sum, s) => sum + s.committedTotal, 0);
  const ctx: GraderContext = {
    state,
    heroSeat,
    evaluator,
    villainCombosList,
    villainPersonalities,
    heroCards,
    potBb: potChips / bigBlind,
    bigBlind,
  };

  const legal = getLegalActions(state, heroSeat);
  const toCallBb = legal.callAmount / bigBlind;
  const r = realizationFactor(state, heroSeat);
  const equity = equityVs(ctx, villainCombosList, 'base');
  const heroBucket = heroBucketOf(equity, heroCards, [...state.board], evaluator);
  const inPosition = heroInPosition(state, heroSeat);

  // EV per candidate.
  const candidates: ActionEV[] = candidateActions(state, heroSeat).map((cand) => {
    if (cand.action === 'fold') return { ...cand, evBb: 0 };
    if (cand.action === 'check') return { ...cand, evBb: evCheck(ctx, equity, r) };
    if (cand.action === 'call') return { ...cand, evBb: evCall(ctx, equity, r, toCallBb) };
    const hero = state.seats[heroSeat]!;
    const addedBb = (cand.amount! - hero.committedThisStreet) / bigBlind;
    return { ...cand, evBb: evBet(ctx, addedBb, r) };
  });
  candidates.sort((a, b) => b.evBb - a.evBb);
  const best = candidates[0]!;

  const chosen =
    candidates.find(
      (c) =>
        c.action === chosenAction.type &&
        (c.amount === undefined || chosenAction.amount === undefined
          ? true
          : Math.abs(c.amount - chosenAction.amount) / bigBlind < 1),
    ) ??
    // Chosen size wasn't one of the three candidates: score it directly.
    (() => {
      if (chosenAction.type === 'bet' || chosenAction.type === 'raise') {
        const hero = state.seats[heroSeat]!;
        const addedBb = ((chosenAction.amount ?? 0) - hero.committedThisStreet) / bigBlind;
        return { action: chosenAction.type, amount: chosenAction.amount, evBb: evBet(ctx, addedBb, r) };
      }
      return { action: chosenAction.type, evBb: 0 };
    })();

  let evLossBb = Math.max(0, best.evBb - chosen.evBb);
  let severity: Severity = severityForEvLoss(evLossBb, thresholds);
  let displayBest = best;

  // Preflop chart grading overrides the EV numbers where the chart speaks
  // (spec §3): a chart-matching action is OK; one step off a boundary is at
  // most an Inaccuracy; otherwise EV loss is measured against the CHART's
  // action (the one-street EV model is too crude preflop to outrank the
  // solver-derived charts, so the coaching message must name the chart play).
  if (state.street === 'PREFLOP') {
    const verdict = preflopChartVerdict(state, heroSeat);
    if (verdict) {
      const chosenMatches =
        (verdict.chartAction === 'raise' && (chosenAction.type === 'raise' || chosenAction.type === 'bet')) ||
        (verdict.chartAction === 'call' && chosenAction.type === 'call') ||
        (verdict.chartAction === 'fold' &&
          (chosenAction.type === 'fold' || chosenAction.type === 'check'));
      if (chosenMatches) {
        evLossBb = 0;
        severity = 'OK';
      } else {
        const chartCandidate =
          verdict.chartAction === 'raise'
            ? candidates.find((c) => c.action === 'raise' || c.action === 'bet')
            : candidates.find((c) => c.action === verdict.chartAction);
        if (chartCandidate) {
          displayBest = chartCandidate;
          evLossBb = Math.max(0, chartCandidate.evBb - chosen.evBb);
          severity = severityForEvLoss(evLossBb, thresholds);
        }
        if (verdict.nearBoundary && severity !== 'OK') {
          evLossBb = Math.min(evLossBb, 0.3);
          severity = 'INACCURACY';
        } else if (severity === 'OK' && evLossBb === 0 && chartCandidate) {
          // The EV model sees no loss but the chart disagrees with the line:
          // still surface it as a light Inaccuracy so chart deviations are
          // never silently endorsed.
          evLossBb = 0.1;
          severity = 'INACCURACY';
        }
      }
    }
  }

  // Mixed-strategy rule (§6.4): candidates within 0.1bb of best are all OK.
  if (evLossBb < 0.1) severity = 'OK';

  const reasonKey = pickReason(state.street, displayBest, chosen, heroBucket, inPosition);
  const requiredPct = Math.round((toCallBb / (ctx.potBb + toCallBb) || 0) * 100);
  // How contested the pot already was when hero acted (preflop messages only).
  // Counts all prior preflop raises, mirroring preflopChartVerdict's branches.
  const priorRaises = state.actionLog.filter(
    (e) => e.street === 'PREFLOP' && (e.action === 'raise' || e.action === 'bet'),
  ).length;
  const { message, glossary } = buildMessage(
    displayBest,
    evLossBb,
    reasonKey,
    {
      requiredPct,
      equityPct: Math.round(equity * 100),
      position: positionForSeat(state.buttonSeat, heroSeat, state.seats.length),
      facing: priorRaises === 0 ? 'open' : priorRaises === 1 ? 'raise' : 'reraise',
      chartSaysPlay:
        (displayBest.action === 'raise' || displayBest.action === 'bet' || displayBest.action === 'call') &&
        (chosenAction.type === 'fold' || chosenAction.type === 'check'),
    },
    bigBlind,
  );

  return {
    candidates,
    chosen,
    best: displayBest,
    evLossBb,
    severity,
    reasonKey,
    message,
    glossary,
    equity,
    heroBucket,
    street: state.street,
    category: classifyDecision(state, heroSeat, displayBest, chosen, heroBucket),
  };
}

/** Whether this decision is gradable at all (hero can act, has a live opponent). */
export function isGradableDecision(state: GameState, heroSeat: number): boolean {
  const hero = state.seats[heroSeat];
  if (!hero || !canAct(hero) || state.actionOn !== heroSeat) return false;
  return state.seats.some((s) => s.seatIndex !== heroSeat && !s.folded);
}
