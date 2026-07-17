import { describe, expect, it } from 'vitest';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { resolveShowdown } from '../pots';
import { buildSeat } from './testHelpers';

const evaluator = new PokersolverEvaluator();

describe('3-way side pots', () => {
  // Board has no pairs so each seat's hand is exactly their pocket pair.
  const board = ['2c', '7d', '9h', '4c', 'Jd'] as const;

  // A commits 50 total (shortest all-in), B commits 100, C covers at 150.
  // B has the best hand (66) but is only eligible for the pots funded up to
  // their own commitment; C, despite the weakest hand, uniquely wins the
  // top layer because only C funded it.
  const seats = [
    buildSeat(0, { holeCards: ['3h', '3d'], committedTotal: 50, stack: 0 }),
    buildSeat(1, { holeCards: ['6h', '6d'], committedTotal: 100, stack: 0 }),
    buildSeat(2, { holeCards: ['5h', '5d'], committedTotal: 150, stack: 0 }),
  ];

  it('layers pots by commitment level with correct eligibility', () => {
    const payout = resolveShowdown(seats, [...board], 0, evaluator);
    expect(payout.pots).toEqual([
      { amount: 150, eligibleSeats: [0, 1, 2] },
      { amount: 100, eligibleSeats: [1, 2] },
      { amount: 50, eligibleSeats: [2] },
    ]);
  });

  it('awards each pot to the best eligible hand in that pot', () => {
    const payout = resolveShowdown(seats, [...board], 0, evaluator);
    const winnersBySeat = new Map(payout.winners.map((w) => [w.seat, w.amount]));
    // B (seat 1) wins pot1 (150) and pot2 (100) = 250.
    expect(winnersBySeat.get(1)).toBe(250);
    // C (seat 2) wins pot3 (50) uncontested even with the weaker hand.
    expect(winnersBySeat.get(2)).toBe(50);
    // A (seat 0) never has the best hand in any pot they're eligible for.
    expect(winnersBySeat.has(0)).toBe(false);
    const total = payout.winners.reduce((sum, w) => sum + w.amount, 0);
    expect(total).toBe(300);
  });

  it('a folded seat still funds pots but is never eligible', () => {
    const foldedSeats = [
      buildSeat(0, { holeCards: ['3h', '3d'], committedTotal: 50, folded: true, stack: 0 }),
      buildSeat(1, { holeCards: ['6h', '6d'], committedTotal: 100, stack: 0 }),
      buildSeat(2, { holeCards: ['5h', '5d'], committedTotal: 150, stack: 0 }),
    ];
    const payout = resolveShowdown(foldedSeats, [...board], 0, evaluator);
    for (const pot of payout.pots) {
      expect(pot.eligibleSeats).not.toContain(0);
    }
    const total = payout.winners.reduce((sum, w) => sum + w.amount, 0);
    expect(total).toBe(300);
  });
});
