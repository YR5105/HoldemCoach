import { describe, expect, it } from 'vitest';
import { buildSeat } from '../../engine/__tests__/testHelpers';
import type { Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { gradeDecision, noiseMarginBb } from '../grader';
import { severityForEvLoss } from '../graderTypes';

const evaluator = new PokersolverEvaluator();

describe('noiseMarginBb (spec §6 R6a)', () => {
  it('grows with pot and shrinks with iterations', () => {
    // Bigger pot -> more bb of noise (same iterations).
    expect(noiseMarginBb(30, 1000)).toBeGreaterThan(noiseMarginBb(15, 1000));
    // More iterations -> less noise (same pot).
    expect(noiseMarginBb(15, 4000)).toBeLessThan(noiseMarginBb(15, 1000));
  });

  it('is below 1bb in a 15bb pot, so small-pot grading is untouched', () => {
    // 1000 iterations is the floor, which every <=50bb pot uses.
    expect(noiseMarginBb(15, 1000)).toBeLessThan(1);
    expect(noiseMarginBb(20, 1000)).toBeLessThan(1);
  });
});

/**
 * 200bb pot (committed 200 each at bb=2 = 400 chips), river, checked to hero.
 * Hero holds 4h3d — total air with ~1.5% showdown equity — and folds instead of
 * checking it down. Checking is worth ~3bb of that sliver of equity in a pot
 * this size, so the naive EV loss reads as a Blunder. But 3bb is inside the
 * Monte Carlo noise band for a 200bb pot, so the noise-aware severity must not
 * punish it as one.
 */
function bigCheckedPotState(): GameState {
  return {
    seed: 'r6-phantom-blunder',
    config: { players: 2, blinds: [1, 2], startingStack: 400 },
    street: 'RIVER',
    seats: [
      buildSeat(0, { holeCards: ['4h', '3d'] as Card[], committedTotal: 200, committedThisStreet: 0, stack: 200 }),
      buildSeat(1, { holeCards: ['Ac', 'Kd'] as Card[], committedTotal: 200, committedThisStreet: 0, stack: 200, hasActed: true }),
    ],
    board: ['Th', '9c', '6s', '2d', '2h'],
    deck: [],
    currentBet: 0,
    minRaise: 2,
    actionOn: 0,
    lastAggressor: null,
    buttonSeat: 0,
    actionLog: [{ seat: 1, street: 'RIVER', action: 'check', amount: 0 }],
    payout: null,
    rngCounter: 0,
  };
}

describe('big-pot noise-aware severity (spec §6 R6a)', () => {
  it('does not manufacture a phantom Blunder from Monte Carlo noise', () => {
    const grade = gradeDecision(bigCheckedPotState(), 0, { seat: 0, type: 'fold' }, evaluator);

    // The two candidates (check vs fold) differ by less than the noise margin.
    const potBb = 200;
    const iterations = Math.min(4000, Math.max(1000, Math.round(potBb * 20)));
    expect(grade.evLossBb).toBeLessThan(noiseMarginBb(potBb, iterations));

    // The DISPLAYED cost is still a large raw number that would map to Blunder…
    expect(grade.evLossBb).toBeGreaterThan(2);
    expect(severityForEvLoss(grade.evLossBb)).toBe('BLUNDER');

    // …but the noise-discounted severity never reaches Blunder in this big pot.
    expect(['OK', 'INACCURACY']).toContain(grade.severity);
    expect(grade.severity).not.toBe('BLUNDER');
  });
});
