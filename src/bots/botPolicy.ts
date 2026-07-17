import seedrandom from 'seedrandom';
import botsData from '../data/bots.json';
import { canonicalHand } from '../coach/rangeParser';
import {
  personalityCallRange,
  personalityOpenRange,
  personalityParams,
  personalityThreeBetRange,
  personalityVsSbOpenCallRange,
  type Personality,
} from '../coach/personalities';
import {
  classifyOpener,
  getFacingFourBetContinueRange,
  getOpenRaiseSizeBb,
  getThreeBetSizeMultiplier,
  type OpenRaisePosition,
} from '../coach/ranges';
import { positionForSeat } from '../coach/position';
import { PokersolverEvaluator } from '../evaluator/pokersolverAdapter';
import type { Evaluator } from '../evaluator/Evaluator';
import { getLegalActions } from '../engine/actions';
import { rankValue } from '../engine/cardUtils';
import type { Action, ActionType, Card, GameState } from '../engine/types';

export type { Personality };

const defaultEvaluator: Evaluator = new PokersolverEvaluator();

export type HandBucket = 'STRONG' | 'MEDIUM' | 'WEAK';

/**
 * Derives a deterministic [0,1) draw for one bot decision from the hand
 * seed and how many actions have happened so far — never Math.random().
 */
function botRandom(state: GameState): number {
  return seedrandom(`${state.seed}:bot:${state.actionLog.length}`)();
}

/**
 * Buckets a made hand for the postflop policy. Exported so the coach's
 * node-range reconstruction runs the exact same classification the bots
 * decide with (hard invariant #1: one range model, same code path).
 */
export function bucketMadeHand(holeCards: [Card, Card], board: readonly Card[], evaluator: Evaluator): HandBucket {
  if (board.length === 0) return 'WEAK'; // no bucket policy preflop; handled separately
  const result = evaluator.evaluate([...holeCards, ...board]);
  switch (result.name) {
    case 'Straight Flush':
    case 'Four of a Kind':
    case 'Full House':
    case 'Flush':
    case 'Straight':
    case 'Three of a Kind':
      return 'STRONG';
    case 'Two Pair':
      return 'MEDIUM';
    case 'Pair': {
      const holeRanks = holeCards.map((c) => rankValue(c[0]!));
      const isPocketPair = holeRanks[0] === holeRanks[1];
      const pairRank = isPocketPair ? holeRanks[0]! : Math.max(...holeRanks);
      const highestBoardRank = Math.max(...board.map((c) => rankValue(c[0]!)));
      return pairRank >= highestBoardRank ? 'MEDIUM' : 'WEAK';
    }
    default:
      return 'WEAK';
  }
}

/** Station's "never folds pairs" rule: any made pair or better refuses to fold. */
function hasPairOrBetter(holeCards: [Card, Card], board: readonly Card[], evaluator: Evaluator): boolean {
  if (board.length === 0) return false;
  return evaluator.evaluate([...holeCards, ...board]).name !== 'High Card';
}

function roundToInt(n: number): number {
  return Math.round(n);
}

/** Decides one preflop action for `seatIndex` using this personality's transformed chart ranges. */
function decidePreflop(state: GameState, seatIndex: number, personality: Personality): Action {
  const n = state.seats.length;
  const seat = state.seats[seatIndex]!;
  const position = positionForSeat(state.buttonSeat, seatIndex, n);
  const hand = canonicalHand(seat.holeCards as [Card, Card]);
  const legal = getLegalActions(state, seatIndex);
  const bigBlind = state.config.blinds[1];

  // Blinds are posted as 'post-sb'/'post-bb', never 'bet'/'raise', so this
  // only counts voluntary raises — robust regardless of who posted blinds.
  const raises = state.actionLog.filter(
    (e) => e.street === 'PREFLOP' && (e.action === 'bet' || e.action === 'raise'),
  );

  if (raises.length === 0) {
    // Raise-first-in spot (or the walk-through-limpers case, treated the same: bots don't limp).
    if (position === 'BB') {
      // Nothing to open into; just take the free check.
      return legal.canCheck ? { seat: seatIndex, type: 'check' } : { seat: seatIndex, type: 'fold' };
    }
    const openPos = position as OpenRaisePosition;
    const range = personalityOpenRange(personality, openPos);
    if (range.has(hand) && legal.canRaise) {
      const sizeBb = getOpenRaiseSizeBb(openPos);
      return { seat: seatIndex, type: 'raise', amount: roundToInt(sizeBb * bigBlind) };
    }
    return legal.canCheck ? { seat: seatIndex, type: 'check' } : { seat: seatIndex, type: 'fold' };
  }

  if (raises.length >= 2) {
    // Facing a 3-bet or deeper — spec only defines a "facing 4-bet continue"
    // chart, which we reuse here as the tight-continue approximation.
    const cont = getFacingFourBetContinueRange();
    if (cont.has(hand) && legal.canCall) return { seat: seatIndex, type: 'call' };
    return legal.canCheck ? { seat: seatIndex, type: 'check' } : { seat: seatIndex, type: 'fold' };
  }

  // Facing exactly one open.
  const opener = raises[0]!.seat;
  const openerPosition = positionForSeat(state.buttonSeat, opener, n) as OpenRaisePosition;
  const openerClass = classifyOpener(openerPosition);
  const fromBlinds = position === 'SB' || position === 'BB';
  const threeBetRange = personalityThreeBetRange(personality, openerClass, fromBlinds);

  if (threeBetRange.has(hand) && legal.canRaise) {
    const inPosition = position === 'CO' || position === 'BTN';
    const multiplier = getThreeBetSizeMultiplier(inPosition);
    const target = Math.min(roundToInt(multiplier * state.currentBet), legal.maxTo);
    return { seat: seatIndex, type: 'raise', amount: Math.max(target, legal.minTo) };
  }

  const callRange =
    openerClass === 'SB'
      ? personalityVsSbOpenCallRange(personality)
      : personalityCallRange(personality, openerClass, position);

  if (callRange?.has(hand) && legal.canCall) {
    return { seat: seatIndex, type: 'call' };
  }

  return legal.canCheck ? { seat: seatIndex, type: 'check' } : { seat: seatIndex, type: 'fold' };
}

/** Decides one postflop action from the made-hand bucket + personality frequencies (spec §4). */
function decidePostflop(
  state: GameState,
  seatIndex: number,
  personality: Personality,
  evaluator: Evaluator,
): Action {
  const seat = state.seats[seatIndex]!;
  const legal = getLegalActions(state, seatIndex);
  const params = personalityParams(personality);
  const holeCards = seat.holeCards as [Card, Card];
  const bucket = bucketMadeHand(holeCards, state.board, evaluator);
  const draw = botRandom(state);

  const facingBet = state.currentBet > 0;
  const potGuess = state.seats.reduce((sum, s) => sum + s.committedTotal, 0) + state.currentBet;

  if (!facingBet) {
    const shouldBet =
      bucket === 'STRONG' || bucket === 'MEDIUM' ? draw < params.cbet : draw < params.bluffRatio;
    if (shouldBet && legal.canBet) {
      const target = Math.min(roundToInt(potGuess * 0.66), legal.maxTo);
      return { seat: seatIndex, type: 'bet', amount: Math.max(target, legal.minTo) };
    }
    return { seat: seatIndex, type: 'check' };
  }

  if (bucket === 'STRONG') {
    if (draw < params.raiseStrong && legal.canRaise) {
      const target = Math.min(roundToInt(state.currentBet + potGuess * 0.66), legal.maxTo);
      return { seat: seatIndex, type: 'raise', amount: Math.max(target, legal.minTo) };
    }
    return legal.canCall ? { seat: seatIndex, type: 'call' } : { seat: seatIndex, type: 'fold' };
  }

  if (bucket === 'MEDIUM') {
    return legal.canCall ? { seat: seatIndex, type: 'call' } : { seat: seatIndex, type: 'fold' };
  }

  // WEAK: fold at the personality's frequency — except a Station holding any
  // made pair, which never folds it (spec §4 callsWithAnyPairOrDraw).
  const refusesToFold = params.callsWithAnyPairOrDraw && hasPairOrBetter(holeCards, state.board, evaluator);
  if (!refusesToFold && draw < params.foldToCbet) {
    return { seat: seatIndex, type: 'fold' };
  }
  return legal.canCall ? { seat: seatIndex, type: 'call' } : { seat: seatIndex, type: 'fold' };
}

export function decideBotAction(
  state: GameState,
  seatIndex: number,
  personality: Personality = 'TAG',
  evaluator: Evaluator = defaultEvaluator,
): Action {
  return state.street === 'PREFLOP'
    ? decidePreflop(state, seatIndex, personality)
    : decidePostflop(state, seatIndex, personality, evaluator);
}

/**
 * The set of postflop actions decidePostflop can produce with probability > 0
 * for a specific combo. This is the inverse view of the policy above, used by
 * the coach's node-range reconstruction to filter villain combos by observed
 * actions — the two functions must stay in lockstep (same code path). It is
 * combo-level (not just bucket-level) because Station's never-fold-a-pair
 * rule depends on the actual cards.
 */
export function plausiblePostflopActionsForCombo(
  holeCards: [Card, Card],
  board: readonly Card[],
  facingBet: boolean,
  personality: Personality,
  evaluator: Evaluator,
): Set<ActionType> {
  const params = personalityParams(personality);
  const bucket = bucketMadeHand(holeCards, board, evaluator);

  if (!facingBet) {
    const canEverBet = bucket === 'WEAK' ? params.bluffRatio > 0 : params.cbet > 0;
    return canEverBet ? new Set(['bet', 'check']) : new Set(['check']);
  }
  switch (bucket) {
    case 'STRONG':
      return params.raiseStrong > 0 ? new Set(['raise', 'call']) : new Set(['call']);
    case 'MEDIUM':
      return new Set(['call', 'fold']); // fold only in the can't-call edge case
    case 'WEAK': {
      const refusesToFold =
        params.callsWithAnyPairOrDraw && hasPairOrBetter(holeCards, board, evaluator);
      if (refusesToFold || params.foldToCbet === 0) return new Set(['call']);
      return new Set(['fold', 'call']);
    }
  }
}

export { personalityParams };
export type { PersonalityParams } from '../coach/personalities';

/** Kept for compatibility with existing personality data checks. */
export const BOT_DATA = botsData;
