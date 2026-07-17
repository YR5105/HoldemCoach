import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '../actions';
import type { GameState } from '../types';
import { buildSeat } from './testHelpers';

function threeHandedFlopState(): GameState {
  return {
    seed: 'test-seed',
    config: { players: 3, blinds: [1, 2], startingStack: 1000 },
    street: 'FLOP',
    seats: [
      buildSeat(0, { holeCards: ['2h', '2d'], committedTotal: 0, stack: 1000 }),
      buildSeat(1, { holeCards: ['3h', '3d'], committedTotal: 0, stack: 1000 }),
      buildSeat(2, { holeCards: ['4h', '4d'], committedTotal: 0, stack: 14 }),
    ],
    board: ['9h', '8c', '2c'],
    deck: ['6c', '6d', '7c', '7h', 'Tc', 'Td', 'Jc', 'Jh', 'Qc', 'Qd'],
    currentBet: 0,
    minRaise: 2,
    actionOn: 0,
    lastAggressor: null,
    buttonSeat: 0,
    actionLog: [],
    payout: null,
    rngCounter: 0,
  };
}

function fourHandedFlopState(): GameState {
  return {
    seed: 'test-seed',
    config: { players: 4, blinds: [1, 2], startingStack: 1000 },
    street: 'FLOP',
    seats: [
      buildSeat(0, { holeCards: ['2h', '2d'], committedTotal: 0, stack: 1000 }),
      buildSeat(1, { holeCards: ['3h', '3d'], committedTotal: 0, stack: 1000 }),
      buildSeat(2, { holeCards: ['4h', '4d'], committedTotal: 0, stack: 14 }),
      buildSeat(3, { holeCards: ['5h', '5d'], committedTotal: 0, stack: 1000 }),
    ],
    board: ['9h', '8c', '2c'],
    deck: ['6c', '6d', '7c', '7h', 'Tc', 'Td', 'Jc', 'Jh', 'Qc', 'Qd'],
    currentBet: 0,
    minRaise: 2,
    actionOn: 0,
    lastAggressor: null,
    buttonSeat: 0,
    actionLog: [],
    payout: null,
    rngCounter: 0,
  };
}

describe('min-raise bounds', () => {
  it('an opening bet must be at least minRaise, or all-in', () => {
    const legal = getLegalActions(threeHandedFlopState(), 0);
    expect(legal.canBet).toBe(true);
    expect(legal.minTo).toBe(2);
    expect(legal.maxTo).toBe(1000);
  });

  it('after a full bet, the next raise minimum is currentBet + that increment', () => {
    let s = threeHandedFlopState();
    s = applyAction(s, { seat: 0, type: 'bet', amount: 10 });
    const legal = getLegalActions(s, 1);
    expect(legal.canRaise).toBe(true);
    expect(legal.minTo).toBe(20); // 10 (currentBet) + 10 (increment)
    expect(legal.maxTo).toBe(1000);
  });

  it('rejects a raise below the minimum that is not all-in', () => {
    let s = threeHandedFlopState();
    s = applyAction(s, { seat: 0, type: 'bet', amount: 10 });
    expect(() => applyAction(s, { seat: 1, type: 'raise', amount: 15 })).toThrow();
  });
});

describe('all-in for less than a full raise does not reopen the action', () => {
  it('capped seats may only call or fold after a short all-in raise', () => {
    let s = threeHandedFlopState();
    // seat0 bets 10 (full raise: minRaise becomes 10).
    s = applyAction(s, { seat: 0, type: 'bet', amount: 10 });
    // seat1 calls.
    s = applyAction(s, { seat: 1, type: 'call' });
    // seat2 (14 chips) shoves all-in to 14: only a 4-chip increment over the
    // current bet of 10, well under the 10-chip minRaise, so it does not
    // reopen the action for seat0/seat1, who already acted this round.
    s = applyAction(s, { seat: 2, type: 'raise', amount: 14 });

    expect(s.currentBet).toBe(14);
    expect(s.minRaise).toBe(10); // unchanged by the incomplete raise

    const legalSeat0 = getLegalActions(s, 0);
    expect(legalSeat0.canRaise).toBe(false);
    expect(legalSeat0.canCall).toBe(true);
    expect(legalSeat0.callAmount).toBe(4);
    expect(() => applyAction(s, { seat: 0, type: 'raise', amount: 24 })).toThrow();

    s = applyAction(s, { seat: 0, type: 'call' });

    const legalSeat1 = getLegalActions(s, 1);
    expect(legalSeat1.canRaise).toBe(false);
    expect(legalSeat1.callAmount).toBe(4);

    s = applyAction(s, { seat: 1, type: 'call' });

    // Everyone has matched 14 and acted — the betting round (and street,
    // since seat2 is now all-in with only one other actable seat... no,
    // seat0 and seat1 both still have chips) closes and advances to TURN.
    expect(s.street).toBe('TURN');
  });

  it('a subsequent full raise reopens the action for previously-capped seats', () => {
    let s = fourHandedFlopState();
    // seat0 bets 10 (full raise, minRaise -> 10); seat1 calls (both "acted").
    s = applyAction(s, { seat: 0, type: 'bet', amount: 10 });
    s = applyAction(s, { seat: 1, type: 'call' });
    // seat2 (14 chips) shoves for only +4 over the bet — incomplete raise.
    // seat0 and seat1 already acted, so they get capped to call/fold.
    s = applyAction(s, { seat: 2, type: 'raise', amount: 14 });
    expect(s.seats[0]!.raiseCapped).toBe(true);

    // seat3 never acted this street, so the incomplete raise didn't cap
    // them — they still have full options and make a genuine full raise
    // (currentBet 14 -> 30 is a +16 increment, above the 10 minRaise).
    s = applyAction(s, { seat: 3, type: 'raise', amount: 30 });
    expect(s.minRaise).toBe(16);
    expect(s.currentBet).toBe(30);

    // seat0's raising rights are restored by seat3's full raise.
    const legalSeat0 = getLegalActions(s, 0);
    expect(legalSeat0.canRaise).toBe(true);
  });
});
