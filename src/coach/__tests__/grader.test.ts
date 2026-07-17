import { describe, expect, it } from 'vitest';
import { buildSeat } from '../../engine/__tests__/testHelpers';
import { applyAction } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { gradeDecision, isGradableDecision } from '../grader';
import { severityForEvLoss } from '../graderTypes';

const evaluator = new PokersolverEvaluator();

describe('severity thresholds (spec §6.4)', () => {
  it('maps EV loss to the four tiers', () => {
    expect(severityForEvLoss(0.05)).toBe('OK');
    expect(severityForEvLoss(0.3)).toBe('INACCURACY');
    expect(severityForEvLoss(1.5)).toBe('MISTAKE');
    expect(severityForEvLoss(4)).toBe('BLUNDER');
  });
});

/**
 * River fixture, hand-computed: hero holds 2h3d on As Ks Qd Jc 4h — the board
 * plays and nearly any villain hand outkicks it (E ≈ 0). Villain bet 10
 * (5bb) into pot 20 (10bb of prior action -> pot now 15bb, toCall 5bb).
 *   EV(fold) = 0
 *   EV(call) = E·1·(15+5) − 5 ≈ −5bb
 * Best action must be fold; calling is a ~5bb Blunder.
 */
function riverPotOddsState(): GameState {
  return {
    seed: 'grader-river-fold',
    config: { players: 2, blinds: [1, 2], startingStack: 200 },
    street: 'RIVER',
    seats: [
      buildSeat(0, { holeCards: ['2h', '3d'] as Card[], committedTotal: 10, committedThisStreet: 0, stack: 190 }),
      buildSeat(1, { holeCards: ['9c', '9d'] as Card[], committedTotal: 20, committedThisStreet: 10, stack: 180, hasActed: true }),
    ],
    board: ['As', 'Ks', 'Qd', 'Jc', '4h'],
    deck: [],
    currentBet: 10,
    minRaise: 10,
    actionOn: 0,
    lastAggressor: 1,
    buttonSeat: 0,
    actionLog: [
      { seat: 1, street: 'RIVER', action: 'bet', amount: 10 },
    ],
    payout: null,
    rngCounter: 0,
  };
}

describe('river pot-odds fixture (hand-computed EVs)', () => {
  it('folding is best; calling loses ~5bb and is a Blunder', () => {
    const state = riverPotOddsState();
    const grade = gradeDecision(state, 0, { seat: 0, type: 'call' }, evaluator);

    expect(grade.equity).toBeLessThan(0.05);
    expect(grade.best.action).toBe('fold');
    expect(grade.best.evBb).toBe(0);

    const call = grade.candidates.find((c) => c.action === 'call')!;
    // EV(call) = E·(15+5) − 5; with E≈0 this is ≈ −5bb.
    expect(call.evBb).toBeLessThan(-4.4);
    expect(call.evBb).toBeGreaterThan(-5.01);

    expect(grade.evLossBb).toBeGreaterThan(4.4);
    expect(grade.severity).toBe('BLUNDER');
    expect(grade.reasonKey).toBe('pot_odds');
    expect(grade.message).toContain('Fold was better');
    expect(grade.message.length).toBeLessThanOrEqual(140);
  });

  it('folding the same spot grades OK with zero EV loss', () => {
    const state = riverPotOddsState();
    const grade = gradeDecision(state, 0, { seat: 0, type: 'fold' }, evaluator);
    expect(grade.evLossBb).toBe(0);
    expect(grade.severity).toBe('OK');
  });
});

/**
 * River value-bet fixture: hero holds the royal flush (AhKh on Qh Jh Th 2c 2d),
 * E = 1 exactly. Checked to hero, pot = 40 chips = 20bb.
 *   EV(check) = 1·1·20 = 20bb exactly
 *   EV(bet b) = FE·20 + (1−FE)·(20 + b) > 20 for any b > 0
 * Best action must be a bet; checking back is missed value.
 */
function riverValueBetState(): GameState {
  return {
    seed: 'grader-river-value',
    config: { players: 2, blinds: [1, 2], startingStack: 200 },
    street: 'RIVER',
    seats: [
      buildSeat(0, { holeCards: ['Ah', 'Kh'] as Card[], committedTotal: 20, committedThisStreet: 0, stack: 180 }),
      buildSeat(1, { holeCards: ['9c', '9d'] as Card[], committedTotal: 20, committedThisStreet: 0, stack: 180, hasActed: true }),
    ],
    board: ['Qh', 'Jh', 'Th', '2c', '2d'],
    deck: [],
    currentBet: 0,
    minRaise: 2,
    actionOn: 0,
    lastAggressor: null,
    buttonSeat: 0,
    actionLog: [
      { seat: 1, street: 'RIVER', action: 'check', amount: 0 },
    ],
    payout: null,
    rngCounter: 0,
  };
}

describe('river value-bet fixture (hand-computed EVs)', () => {
  it('betting is best; checking the nuts is missed value', () => {
    const state = riverValueBetState();
    const grade = gradeDecision(state, 0, { seat: 0, type: 'check' }, evaluator);

    expect(grade.equity).toBe(1);
    expect(grade.heroBucket).toBe('MONSTER');

    const check = grade.candidates.find((c) => c.action === 'check')!;
    expect(check.evBb).toBeCloseTo(20, 5); // E·R·pot = 1·1·20, exact

    expect(grade.best.action).toBe('bet');
    expect(grade.best.evBb).toBeGreaterThan(20);
    expect(grade.evLossBb).toBeGreaterThan(0.5);
    expect(['MISTAKE', 'BLUNDER']).toContain(grade.severity);
    expect(grade.reasonKey).toBe('missed_value');
  });

  it('betting the nuts grades OK', () => {
    const state = riverValueBetState();
    // Bet the largest candidate size (125% pot = 50).
    const grade = gradeDecision(state, 0, { seat: 0, type: 'bet', amount: 50 }, evaluator);
    expect(grade.severity).toBe('OK');
  });
});

describe('preflop chart grading (spec §3 tolerance)', () => {
  function utgState(seed: string, holeCards: [Card, Card]): GameState {
    let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
    s = structuredClone(s);
    s.seats[3]!.holeCards = holeCards; // seat 3 = UTG with button at 0
    return s;
  }

  it('raising a chart hand (AJo UTG) is OK', () => {
    const s = utgState('pf-ok', ['Ah', 'Jd']);
    const grade = gradeDecision(s, 3, { seat: 3, type: 'raise', amount: 5 }, evaluator);
    expect(grade.severity).toBe('OK');
    expect(grade.evLossBb).toBe(0);
  });

  it('folding a chart trash hand (72o UTG) is OK', () => {
    const s = utgState('pf-trash', ['7h', '2d']);
    const grade = gradeDecision(s, 3, { seat: 3, type: 'fold' }, evaluator);
    expect(grade.severity).toBe('OK');
  });

  it('opening one step off the boundary (A8s UTG, chart has A9s+) is at most an Inaccuracy', () => {
    const s = utgState('pf-boundary', ['Ah', '8h']);
    const grade = gradeDecision(s, 3, { seat: 3, type: 'raise', amount: 5 }, evaluator);
    expect(['OK', 'INACCURACY']).toContain(grade.severity);
  });

  it('open-folding AA cannot grade OK', () => {
    const s = utgState('pf-aa-fold', ['Ah', 'Ad']);
    const grade = gradeDecision(s, 3, { seat: 3, type: 'fold' }, evaluator);
    expect(grade.severity).not.toBe('OK');
    expect(grade.reasonKey).toBe('preflop_chart');
  });

  it('folding a non-premium hand to a 3-bet grades OK (chart: fold)', () => {
    // Hero opens KJo on the BTN, BB 3-bets; KJo is far outside the QQ+/AK
    // continue range, so folding must never be flagged — regardless of what
    // the one-street EV model thinks of a re-raise.
    let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, 'pf-3bet-fold', 0));
    s = structuredClone(s);
    s.seats[0]!.holeCards = ['Kd', 'Jc'];
    s.seats[2]!.holeCards = ['Ah', 'Ad']; // BB 3-bettor
    s = applyAction(s, { seat: 3, type: 'fold' });
    s = applyAction(s, { seat: 4, type: 'fold' });
    s = applyAction(s, { seat: 5, type: 'fold' });
    s = applyAction(s, { seat: 0, type: 'raise', amount: 5 }); // hero opens
    s = applyAction(s, { seat: 1, type: 'fold' });
    s = applyAction(s, { seat: 2, type: 'raise', amount: 20 }); // BB 3-bets
    expect(s.actionOn).toBe(0);

    const grade = gradeDecision(s, 0, { seat: 0, type: 'fold' }, evaluator);
    expect(grade.severity).toBe('OK');
    expect(grade.evLossBb).toBe(0);
  });

  it('folding QQ to a 3-bet is flagged (chart: continue)', () => {
    let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, 'pf-3bet-qq', 0));
    s = structuredClone(s);
    s.seats[0]!.holeCards = ['Qh', 'Qd'];
    s.seats[2]!.holeCards = ['Ah', 'Kd'];
    s = applyAction(s, { seat: 3, type: 'fold' });
    s = applyAction(s, { seat: 4, type: 'fold' });
    s = applyAction(s, { seat: 5, type: 'fold' });
    s = applyAction(s, { seat: 0, type: 'raise', amount: 5 });
    s = applyAction(s, { seat: 1, type: 'fold' });
    s = applyAction(s, { seat: 2, type: 'raise', amount: 20 });

    const grade = gradeDecision(s, 0, { seat: 0, type: 'fold' }, evaluator);
    expect(grade.severity).not.toBe('OK');
    expect(grade.best.action).toBe('call');
  });

  it('when the chart says fold, the message recommends folding — not the EV-model best', () => {
    // K5o on the BTN facing an HJ open: outside both the 3-bet and call
    // charts. The crude one-street EV model may score raising highest, but
    // the coaching must name the chart action.
    let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, 'pf-chart-fold', 0));
    s = structuredClone(s);
    s.seats[4]!.holeCards = ['Ah', 'Kh']; // HJ opener
    s.seats[0]!.holeCards = ['Ks', '5c']; // hero: K5o, a chart fold
    s = applyAction(s, { seat: 3, type: 'fold' });
    s = applyAction(s, { seat: 4, type: 'raise', amount: 5 });
    s = applyAction(s, { seat: 5, type: 'fold' });
    expect(s.actionOn).toBe(0); // hero on the BTN

    const grade = gradeDecision(s, 0, { seat: 0, type: 'call' }, evaluator);
    expect(grade.best.action).toBe('fold');
    expect(grade.message).toContain('Fold was better');
    expect(grade.severity).not.toBe('OK');
  });
});

describe('isGradableDecision', () => {
  it('is true for a live hero turn and false otherwise', () => {
    const s = riverPotOddsState();
    expect(isGradableDecision(s, 0)).toBe(true);
    expect(isGradableDecision(s, 1)).toBe(false); // not their turn
    const folded = structuredClone(s);
    folded.seats[1]!.folded = true;
    expect(isGradableDecision(folded, 0)).toBe(false); // no live villain
  });
});
