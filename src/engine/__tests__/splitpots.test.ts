import { describe, expect, it } from 'vitest';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { resolveShowdown } from '../pots';
import type { Card } from '../types';
import { buildSeat } from './testHelpers';

const evaluator = new PokersolverEvaluator();

describe('split pots with an odd chip', () => {
  const board: Card[] = ['2c', '7d', '9h', '4c', 'Jd'];

  // Seats 0 and 2 both hold a pair of sixes (identical hand strength given
  // the shared board) and split the pot; seat 1 holds a worse pair and loses.
  const seats = [
    buildSeat(0, { holeCards: ['6h', '6d'], committedTotal: 25, stack: 0 }),
    buildSeat(1, { holeCards: ['3h', '3d'], committedTotal: 25, stack: 0 }),
    buildSeat(2, { holeCards: ['6c', '6s'], committedTotal: 25, stack: 0 }),
  ];

  it('splits a 75-chip pot 38/37 with the odd chip to the first winner left of the button', () => {
    // buttonSeat = 0 -> left-of-button order is [1, 2, 0]; seat 1 isn't a
    // winner, so seat 2 is first among winners and takes the extra chip.
    const payout = resolveShowdown(seats, board, 0, evaluator);
    expect(payout.pots).toEqual([{ amount: 75, eligibleSeats: [0, 1, 2] }]);

    const winnersBySeat = new Map(payout.winners.map((w) => [w.seat, w.amount]));
    expect(winnersBySeat.get(2)).toBe(38);
    expect(winnersBySeat.get(0)).toBe(37);
    expect(winnersBySeat.has(1)).toBe(false);
  });

  it('moving the button changes who gets the odd chip', () => {
    // buttonSeat = 2 -> left-of-button order is [0, 1, 2]; seat 0 is the
    // first winner in that order now.
    const payout = resolveShowdown(seats, board, 2, evaluator);
    const winnersBySeat = new Map(payout.winners.map((w) => [w.seat, w.amount]));
    expect(winnersBySeat.get(0)).toBe(38);
    expect(winnersBySeat.get(2)).toBe(37);
  });
});
