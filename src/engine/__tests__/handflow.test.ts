import { describe, expect, it } from 'vitest';
import { applyAction } from '../actions';
import { createInitialState, startHand } from '../state';
import { nextToActFrom } from '../seatOrder';
import { buildSeat } from './testHelpers';
import type { GameState } from '../types';

describe('hand ends immediately when everyone else folds', () => {
  it('awards the whole pot to the sole remaining seat without a showdown', () => {
    let s = startHand(createInitialState({ players: 3, blinds: [1, 2], startingStack: 100 }, 'fold-seed', 0));
    // UTG (seat0) raises, seat1 folds, seat2 (BB) folds -> seat0 wins uncontested.
    s = applyAction(s, { seat: 0, type: 'raise', amount: 6 });
    s = applyAction(s, { seat: 1, type: 'fold' });
    s = applyAction(s, { seat: 2, type: 'fold' });

    expect(s.street).toBe('PAYOUT');
    expect(s.payout).not.toBeNull();
    expect(s.payout!.winners).toEqual([{ seat: 0, amount: 9 }]); // 6 + 1(SB) + 2(BB)
    expect(s.payout!.showdownHands).toBeUndefined();
    expect(s.seats[0]!.stack).toBe(100 - 6 + 9);
  });
});

describe('all-in before the river runs the board out automatically', () => {
  it('deals straight through to showdown with no further actions needed', () => {
    let s = startHand(
      createInitialState({ players: 2, blinds: [1, 2], startingStack: 20 }, 'allin-seed', 0),
    );
    // Heads-up: seat0 (button/SB) shoves, seat1 (BB) calls all-in preflop.
    s = applyAction(s, { seat: 0, type: 'raise', amount: 20 });
    s = applyAction(s, { seat: 1, type: 'call' });

    expect(s.street).toBe('PAYOUT');
    expect(s.board).toHaveLength(5);
    expect(s.actionOn).toBe(-1);
    const total = s.payout!.winners.reduce((sum, w) => sum + w.amount, 0);
    expect(total).toBe(40);
  });
});

describe('createInitialState validation', () => {
  it('rejects an invalid player count', () => {
    expect(() =>
      createInitialState({ players: 1, blinds: [1, 2], startingStack: 100 }, 'seed'),
    ).toThrow();
    expect(() =>
      createInitialState({ players: 10, blinds: [1, 2], startingStack: 100 }, 'seed'),
    ).toThrow();
  });
});

describe('nextToActFrom', () => {
  it('returns null when no seat can act', () => {
    const state: GameState = {
      seed: 's',
      config: { players: 2, blinds: [1, 2], startingStack: 100 },
      street: 'FLOP',
      seats: [
        buildSeat(0, { holeCards: ['2h', '2d'], committedTotal: 10, folded: true, stack: 0 }),
        buildSeat(1, { holeCards: ['3h', '3d'], committedTotal: 10, allIn: true, stack: 0 }),
      ],
      board: [],
      deck: [],
      currentBet: 10,
      minRaise: 2,
      actionOn: -1,
      lastAggressor: null,
      buttonSeat: 0,
      actionLog: [],
      payout: null,
      rngCounter: 0,
    };
    expect(nextToActFrom(state, 0)).toBeNull();
  });
});
