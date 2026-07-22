import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Action, Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { decideBotAction } from '../../bots/botPolicy';
import { gradeDecision, isGradableDecision } from '../grader';
import type { GradeResult } from '../graderTypes';

// ---------------------------------------------------------------------------
// UI jargon audit (grep of src/ui/*.tsx for user-visible "equity" / "EV" / "bb").
// Listed here as candidates for the same plain-English treatment the coach card
// already received. This task does NOT change UI files — the list is a pointer.
//
//   DashboardScreen.tsx:50   label="EV loss / 100 hands"
//   DashboardScreen.tsx:51   value=`${stats.evLossPer100.toFixed(1)}bb`
//   DashboardScreen.tsx:62   <h2>EV loss per 100 hands</h2>
//   DashboardScreen.tsx:74   <h2>EV lost by category</h2>
//   DashboardScreen.tsx:89   `${leak.evLoss.toFixed(1)}bb lost · ${leak.mistakes} mistake(s)`
//   DashboardScreen.tsx:135  aria-label="EV loss per 100 hands across 250-hand windows"
//   DashboardScreen.tsx:171  `${...evLossPer100.toFixed(1)}bb / 100`
//   DashboardScreen.tsx:190  title=`${c.evLoss.toFixed(1)}bb lost across ${c.mistakes} mistakes`
//   DashboardScreen.tsx:194  `${c.evLoss.toFixed(1)}bb`
//   SettingsScreen.tsx:124   label="OK below (bb)"
//   SettingsScreen.tsx:129   label="Inaccuracy up to (bb)"
//   SettingsScreen.tsx:134   label="Mistake up to (bb)"
//   Onboarding.tsx:68        "Bigger EV losses grade as Inaccuracy, ..."
//   ReviewScreen.tsx:227     "Good decision — no EV lost."
//   ReviewScreen.tsx:230     `equity ${Math.round(coach.equity * 100)}% · best: ${coach.best}`
// (FeedbackCard "wins ~X% of the time" and WinDial "need X% · have Y%" are already plain.)
// ---------------------------------------------------------------------------

const evaluator = new PokersolverEvaluator();

// Jargon patterns the coach's message text must never contain. Case matters:
// the position abbreviations and EV/GTO are upper-case tokens, so a lower-case
// word like "continue" (containing "co") can never trip them.
const JARGON: RegExp[] = [
  /\bbb\b/,
  /\bEV\b/,
  /\bequity\b/,
  /\bGTO\b/,
  /\brange\b/,
  /\bc-?bet\b/,
  /\bUTG\b/,
  /\bHJ\b/,
  /\bCO\b/,
  /\bBTN\b/,
  /\bSB\b/,
  /\bBB\b/,
  /\b[2-9TJQKA][2-9TJQKA][os]\b/, // hand codes like "K5o" / "T9s"
  /\+\d+(\.\d+)?bb/,
];

function assertPlainEnglish(grade: GradeResult, label: string) {
  const msg = grade.message;
  for (const pattern of JARGON) {
    expect(pattern.test(msg), `jargon ${pattern} in "${msg}" (${label})`).toBe(false);
  }
  expect(msg.endsWith('.'), `no trailing period: "${msg}" (${label})`).toBe(true);
  expect(msg.length, `over 260 chars: "${msg}" (${label})`).toBeLessThanOrEqual(260);
  // Every graded mistake states a cost, and a cost is always in big blinds.
  if (/cost/i.test(msg)) {
    expect(/big blind/i.test(msg), `cost without "big blind": "${msg}" (${label})`).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Preflop state builders (structuredClone + overwrite, per grader.test.ts).
// ---------------------------------------------------------------------------

const POS_SEAT = { UTG: 3, HJ: 4, CO: 5, BTN: 0, SB: 1, BB: 2 } as const;
const PREFLOP_ORDER = [3, 4, 5, 0, 1, 2];

function firstInState(seed: string, position: keyof typeof POS_SEAT, cards: [Card, Card]) {
  const heroSeat = POS_SEAT[position];
  let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
  s = structuredClone(s);
  s.seats[heroSeat]!.holeCards = cards;
  for (const seat of PREFLOP_ORDER) {
    if (seat === heroSeat) break;
    s = applyAction(s, { seat, type: 'fold' }, evaluator);
  }
  return { state: s, heroSeat };
}

/** UTG opens to 5; folds to the BTN hero, who now faces one raise. */
function facingOpenState(seed: string, cards: [Card, Card]) {
  let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
  s = structuredClone(s);
  s.seats[0]!.holeCards = cards; // hero on the button
  s = applyAction(s, { seat: 3, type: 'raise', amount: 5 }, evaluator); // UTG opens
  s = applyAction(s, { seat: 4, type: 'fold' }, evaluator);
  s = applyAction(s, { seat: 5, type: 'fold' }, evaluator);
  return { state: s, heroSeat: 0 };
}

/** Hero opens on the button, the BB 3-bets: hero now faces a re-raise. */
function facingThreeBetState(seed: string, cards: [Card, Card]) {
  let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
  s = structuredClone(s);
  s.seats[0]!.holeCards = cards;
  s.seats[2]!.holeCards = ['Ah', 'Ad']; // BB 3-bettor
  s = applyAction(s, { seat: 3, type: 'fold' }, evaluator);
  s = applyAction(s, { seat: 4, type: 'fold' }, evaluator);
  s = applyAction(s, { seat: 5, type: 'fold' }, evaluator);
  s = applyAction(s, { seat: 0, type: 'raise', amount: 5 }, evaluator);
  s = applyAction(s, { seat: 1, type: 'fold' }, evaluator);
  s = applyAction(s, { seat: 2, type: 'raise', amount: 20 }, evaluator);
  return { state: s, heroSeat: 0 };
}

function legalActions(state: GameState, seat: number): Action[] {
  const legal = getLegalActions(state, seat);
  const acts: Action[] = [];
  if (legal.canFold) acts.push({ seat, type: 'fold' });
  if (legal.canCheck) acts.push({ seat, type: 'check' });
  if (legal.canCall) acts.push({ seat, type: 'call' });
  if (legal.canBet) acts.push({ seat, type: 'bet', amount: legal.minTo });
  if (legal.canRaise) acts.push({ seat, type: 'raise', amount: legal.minTo });
  return acts;
}

/**
 * Snapshots gradable hero decision points (all streets) from seeded bot
 * playouts. Uses a small table so grading stays cheap (fewer villains ⇒ fewer
 * Monte Carlo hands) while still reaching every street.
 */
function playoutSpots(seeds: string[], cap: number, players = 3) {
  const spots: { state: GameState; heroSeat: number }[] = [];
  for (const seed of seeds) {
    let s = startHand(createInitialState({ players, blinds: [1, 2], startingStack: 200 }, seed, 0));
    let guard = 0;
    while (s.payout === null && s.actionOn >= 0 && guard++ < 400) {
      if (isGradableDecision(s, s.actionOn)) {
        spots.push({ state: s, heroSeat: s.actionOn });
        if (spots.length >= cap) return spots;
      }
      s = applyAction(s, decideBotAction(s, s.actionOn, 'TAG', evaluator), evaluator);
    }
  }
  return spots;
}

// ---------------------------------------------------------------------------
// Build a large, varied pool of graded decisions.
// ---------------------------------------------------------------------------

const PREMIUMS: [Card, Card][] = [['As', 'Ad'], ['Ks', 'Kd'], ['As', 'Ks'], ['Ah', 'Kc']];
const TRASH: [Card, Card][] = [['7h', '2d'], ['8h', '3d'], ['9h', '4d']];

interface Sample {
  grade: GradeResult;
  facingRaise: boolean; // preflop context faced >= 1 raise
  label: string;
}

function buildPool(): Sample[] {
  const pool: Sample[] = [];

  // First-in (unopened): folding premiums and raising trash both deviate.
  for (const pos of ['UTG', 'BTN'] as const) {
    for (const cards of PREMIUMS) {
      const { state, heroSeat } = firstInState(`pe-fi-${pos}-${cards.join('')}`, pos, cards);
      pool.push({
        grade: gradeDecision(state, heroSeat, { seat: heroSeat, type: 'fold' }, evaluator),
        facingRaise: false,
        label: `first-in ${pos} fold ${cards.join('')}`,
      });
    }
    for (const cards of TRASH) {
      const { state, heroSeat } = firstInState(`pe-ft-${pos}-${cards.join('')}`, pos, cards);
      pool.push({
        grade: gradeDecision(state, heroSeat, { seat: heroSeat, type: 'raise', amount: 6 }, evaluator),
        facingRaise: false,
        label: `first-in ${pos} raise ${cards.join('')}`,
      });
    }
  }

  // Facing an open (priorRaises === 1): message must mention the raise.
  for (const cards of [...PREMIUMS, ...TRASH]) {
    const { state, heroSeat } = facingOpenState(`pe-fo-${cards.join('')}`, cards);
    for (const act of legalActions(state, heroSeat)) {
      pool.push({
        grade: gradeDecision(state, heroSeat, act, evaluator),
        facingRaise: true,
        label: `facing-open ${act.type} ${cards.join('')}`,
      });
    }
  }

  // Facing a 3-bet (priorRaises === 2): message must mention the raise.
  for (const cards of [['Qh', 'Qd'], ['Ks', 'Kd'], ['Ah', 'Ks'], ['Ah', 'Kc']] as [Card, Card][]) {
    const { state, heroSeat } = facingThreeBetState(`pe-3b-${cards.join('')}`, cards);
    pool.push({
      grade: gradeDecision(state, heroSeat, { seat: heroSeat, type: 'fold' }, evaluator),
      facingRaise: true,
      label: `facing-3bet fold ${cards.join('')}`,
    });
  }

  // Bot-playout spots across every street: grade each legal action. The
  // facingRaise flag tracks preflop spots that already faced a raise.
  const spots = playoutSpots(Array.from({ length: 30 }, (_, i) => `pe-post-${i}`), 30);
  for (const { state, heroSeat } of spots) {
    const priorRaises = state.actionLog.filter(
      (e) => e.street === 'PREFLOP' && (e.action === 'raise' || e.action === 'bet'),
    ).length;
    for (const act of legalActions(state, heroSeat)) {
      pool.push({
        grade: gradeDecision(state, heroSeat, act, evaluator),
        facingRaise: state.street === 'PREFLOP' && priorRaises >= 1,
        label: `playout ${state.street} ${act.type}`,
      });
    }
  }

  return pool;
}

describe('plain-English guard — no jargon in coach messages', () => {
  const pool = buildPool();
  const nonOk = pool.filter((s) => s.grade.severity !== 'OK');

  it('generated a large, varied pool of non-OK grades', () => {
    expect(pool.length).toBeGreaterThanOrEqual(100);
    expect(nonOk.length).toBeGreaterThanOrEqual(45);
  }, 30000);

  it('every non-OK message is plain English, punctuated, and bounded', () => {
    for (const { grade, label } of nonOk) {
      assertPlainEnglish(grade, label);
    }
  }, 30000);

  it('preflop feedback facing a raise names the raise', () => {
    const facing = nonOk.filter((s) => s.facingRaise);
    expect(facing.length).toBeGreaterThan(0);
    for (const { grade, label } of facing) {
      expect(grade.message.toLowerCase(), `no "raise" mentioned (${label})`).toContain('raise');
    }
  }, 30000);
});
