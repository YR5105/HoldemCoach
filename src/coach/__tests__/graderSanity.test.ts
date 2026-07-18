import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions, type LegalActions } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Action, ActionType, Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { decideBotAction } from '../../bots/botPolicy';
import { gradeDecision, isGradableDecision } from '../grader';
import type { Severity } from '../graderTypes';

const evaluator = new PokersolverEvaluator();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// With the button on seat 0 at a 6-max table the preflop acting order — and
// therefore the position of each seat — is fixed (see state.ts / position.ts).
const POS_SEAT: Record<'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB', number> = {
  UTG: 3,
  HJ: 4,
  CO: 5,
  BTN: 0,
  SB: 1,
  BB: 2,
};
const PREFLOP_ORDER = [3, 4, 5, 0, 1, 2]; // UTG, HJ, CO, BTN, SB, BB

/**
 * Builds an unopened preflop spot where `position` is first to act: everyone
 * before them folds and hero's hole cards are forced. Mirrors the
 * structuredClone-and-overwrite approach used in grader.test.ts.
 */
function firstInState(
  seed: string,
  position: keyof typeof POS_SEAT,
  holeCards: [Card, Card],
): { state: GameState; heroSeat: number } {
  const heroSeat = POS_SEAT[position];
  let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
  s = structuredClone(s);
  s.seats[heroSeat]!.holeCards = holeCards;
  for (const seat of PREFLOP_ORDER) {
    if (seat === heroSeat) break;
    s = applyAction(s, { seat, type: 'fold' }, evaluator);
  }
  return { state: s, heroSeat };
}

function isActionLegal(legal: LegalActions, action: ActionType): boolean {
  switch (action) {
    case 'fold':
      return legal.canFold;
    case 'check':
      return legal.canCheck;
    case 'call':
      return legal.canCall;
    case 'bet':
      return legal.canBet;
    case 'raise':
      return legal.canRaise;
    default:
      return false;
  }
}

/** Every legal action for hero as a concrete Action (min legal size for bet/raise). */
function legalChosenActions(state: GameState, heroSeat: number): Action[] {
  const legal = getLegalActions(state, heroSeat);
  const acts: Action[] = [];
  if (legal.canFold) acts.push({ seat: heroSeat, type: 'fold' });
  if (legal.canCheck) acts.push({ seat: heroSeat, type: 'check' });
  if (legal.canCall) acts.push({ seat: heroSeat, type: 'call' });
  if (legal.canBet) acts.push({ seat: heroSeat, type: 'bet', amount: legal.minTo });
  if (legal.canRaise) acts.push({ seat: heroSeat, type: 'raise', amount: legal.minTo });
  return acts;
}

const SEVERITY_RANK: Record<Severity, number> = { OK: 0, INACCURACY: 1, MISTAKE: 2, BLUNDER: 3 };

/**
 * Plays seeded bot-vs-bot hands and snapshots every gradable hero decision
 * point, bucketed by street. Each snapshot is a stable pre-action state
 * (applyAction never mutates its input), so it can be graded independently.
 */
function collectDecisionStates(
  seeds: string[],
  players = 6,
): Record<string, { state: GameState; heroSeat: number }[]> {
  const byStreet: Record<string, { state: GameState; heroSeat: number }[]> = {
    PREFLOP: [],
    FLOP: [],
    TURN: [],
    RIVER: [],
  };
  for (const seed of seeds) {
    let s = startHand(createInitialState({ players, blinds: [1, 2], startingStack: 200 }, seed, 0));
    let guard = 0;
    while (s.payout === null && s.actionOn >= 0 && guard++ < 400) {
      const seat = s.actionOn;
      if (isGradableDecision(s, seat) && byStreet[s.street]) {
        byStreet[s.street]!.push({ state: s, heroSeat: seat });
      }
      s = applyAction(s, decideBotAction(s, seat, 'TAG', evaluator), evaluator);
    }
  }
  return byStreet;
}

// ---------------------------------------------------------------------------
// 1. Premium hands are never told to fold preflop
// ---------------------------------------------------------------------------

describe('premium hands are never folded preflop', () => {
  const premiums: [string, [Card, Card]][] = [
    ['AA', ['As', 'Ad']],
    ['KK', ['Ks', 'Kd']],
    ['AKs', ['As', 'Ks']],
  ];
  const positions: (keyof typeof POS_SEAT)[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];

  for (const [name, cards] of premiums) {
    for (const pos of positions) {
      it(`${name} from ${pos}: raising is OK, folding is not`, () => {
        const { state, heroSeat } = firstInState(`prem-${name}-${pos}`, pos, cards);

        const raise = gradeDecision(state, heroSeat, { seat: heroSeat, type: 'raise', amount: 6 }, evaluator);
        expect(raise.severity, `${name} ${pos} raise`).toBe('OK');

        const fold = gradeDecision(state, heroSeat, { seat: heroSeat, type: 'fold' }, evaluator);
        expect(fold.severity, `${name} ${pos} fold`).not.toBe('OK');
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Trash is never told to attack
// ---------------------------------------------------------------------------

describe('trash is never told to attack from early/middle position', () => {
  const trash: [string, [Card, Card]][] = [
    ['72o', ['7h', '2d']],
    ['83o', ['8h', '3d']],
  ];
  const positions: (keyof typeof POS_SEAT)[] = ['UTG', 'HJ', 'CO'];

  for (const [name, cards] of trash) {
    for (const pos of positions) {
      it(`${name} from ${pos}: raising is flagged, folding is OK`, () => {
        const { state, heroSeat } = firstInState(`trash-${name}-${pos}`, pos, cards);

        const raise = gradeDecision(state, heroSeat, { seat: heroSeat, type: 'raise', amount: 6 }, evaluator);
        expect(raise.severity, `${name} ${pos} raise`).not.toBe('OK');

        const fold = gradeDecision(state, heroSeat, { seat: heroSeat, type: 'fold' }, evaluator);
        expect(fold.severity, `${name} ${pos} fold`).toBe('OK');
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Priced-in calls are never graded as blunders
// ---------------------------------------------------------------------------

/**
 * River spot: dry board Ks 7h 2c 5d 9s, hero holds top pair (KQ). Villain
 * bet 2 chips (1bb) into a 10-chip (5bb) pot, so hero needs only
 * toCall/(pot+toCall) = 1/(5+1) ≈ 17% equity — well below top pair's share
 * against a river-betting range. Calling must never be a MISTAKE/BLUNDER.
 */
function pricedInRiverState(): GameState {
  return {
    seed: 'grader-priced-in',
    config: { players: 2, blinds: [1, 2], startingStack: 200 },
    street: 'RIVER',
    seats: [
      buildRiverSeat(0, ['Kd', 'Qc'], 4, 0, 196),
      buildRiverSeat(1, ['Jc', 'Jd'], 6, 2, 194, true),
    ],
    board: ['Ks', '7h', '2c', '5d', '9s'],
    deck: [],
    currentBet: 2,
    minRaise: 2,
    actionOn: 0,
    lastAggressor: 1,
    buttonSeat: 0,
    actionLog: [{ seat: 1, street: 'RIVER', action: 'bet', amount: 2 }],
    payout: null,
    rngCounter: 0,
  };
}

function buildRiverSeat(
  seatIndex: number,
  holeCards: [Card, Card],
  committedTotal: number,
  committedThisStreet: number,
  stack: number,
  hasActed = false,
) {
  return {
    seatIndex,
    stack,
    folded: false,
    allIn: false,
    committedThisStreet,
    committedTotal,
    hasActed,
    raiseCapped: false,
    sittingOut: false,
    holeCards: holeCards as Card[],
  };
}

describe('priced-in calls are never blunders', () => {
  it('top pair calling a tiny river bet is not a MISTAKE or BLUNDER', () => {
    const state = pricedInRiverState();
    const grade = gradeDecision(state, 0, { seat: 0, type: 'call' }, evaluator);

    // Required equity to call is well under 25%; hero clearly beats it.
    const requiredPct = Math.round((2 / (10 + 2)) * 100);
    expect(requiredPct).toBeLessThan(25);
    expect(grade.equity * 100).toBeGreaterThan(requiredPct);

    expect(grade.severity).not.toBe('MISTAKE');
    expect(grade.severity).not.toBe('BLUNDER');
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. Recommended action is always legal; grading is well-formed
// ---------------------------------------------------------------------------

describe('grading invariants across many seeded spots', () => {
  // A spread of seeds produces decision points on every street. Capped per
  // street to keep total Monte Carlo work well under the runtime budget.
  const seeds = Array.from({ length: 24 }, (_, i) => `sanity-seed-${i}`);
  const collected = collectDecisionStates(seeds);
  const caps: Record<string, number> = { PREFLOP: 6, FLOP: 6, TURN: 6, RIVER: 6 };
  const spots = Object.entries(collected).flatMap(([street, list]) => list.slice(0, caps[street] ?? 0));

  it('gathered gradable spots across all four streets', () => {
    expect(spots.length).toBeGreaterThanOrEqual(16);
    for (const street of ['PREFLOP', 'FLOP', 'TURN', 'RIVER']) {
      expect(collected[street]!.length, `some ${street} spots`).toBeGreaterThan(0);
    }
  });

  it('the recommended action is always legal, EV loss is never negative, and severity is monotone', () => {
    for (const { state, heroSeat } of spots) {
      const legal = getLegalActions(state, heroSeat);
      const actions = legalChosenActions(state, heroSeat);
      const graded = actions.map((a) => gradeDecision(state, heroSeat, a, evaluator));

      for (const g of graded) {
        // 4. recommended (best) action is legal for this state.
        expect(isActionLegal(legal, g.best.action), `best ${g.best.action} illegal @ ${state.street}`).toBe(true);
        // 5a. EV loss is never negative.
        expect(g.evLossBb, `negative evLoss @ ${state.street}`).toBeGreaterThanOrEqual(0);
      }

      // 5b. Within this one spot, more EV loss never earns a milder severity.
      const sorted = [...graded].sort((a, b) => a.evLossBb - b.evLossBb);
      for (let i = 1; i < sorted.length; i++) {
        const lo = sorted[i - 1]!;
        const hi = sorted[i]!;
        expect(
          SEVERITY_RANK[hi.severity],
          `non-monotone @ ${state.street}: evLoss ${hi.evLossBb.toFixed(3)} (${hi.severity}) milder than ${lo.evLossBb.toFixed(3)} (${lo.severity})`,
        ).toBeGreaterThanOrEqual(SEVERITY_RANK[lo.severity]);
      }
    }
  }, 30000);
});
