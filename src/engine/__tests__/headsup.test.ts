import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '../actions';
import { createInitialState, startHand } from '../state';

describe('heads-up blind order', () => {
  it('the button posts the small blind and acts first preflop', () => {
    const s = startHand(createInitialState({ players: 2, blinds: [1, 2], startingStack: 100 }, 'hu-seed', 0));
    expect(s.seats[0]!.committedThisStreet).toBe(1); // button/SB
    expect(s.seats[1]!.committedThisStreet).toBe(2); // BB
    expect(s.actionOn).toBe(0);
    expect(s.actionLog).toEqual([
      { seat: 0, street: 'PREFLOP', action: 'post-sb', amount: 1 },
      { seat: 1, street: 'PREFLOP', action: 'post-bb', amount: 2 },
    ]);
  });

  it('the non-button (BB) acts first postflop', () => {
    let s = startHand(createInitialState({ players: 2, blinds: [1, 2], startingStack: 100 }, 'hu-seed', 0));
    // seat0 (button/SB) calls to complete preflop.
    s = applyAction(s, { seat: 0, type: 'call' });
    // seat1 (BB) has the option; checks to close the street.
    const legalBB = getLegalActions(s, 1);
    expect(legalBB.canCheck).toBe(true);
    s = applyAction(s, { seat: 1, type: 'check' });

    expect(s.street).toBe('FLOP');
    expect(s.actionOn).toBe(1);
  });

  it('gives each seat exactly 2 hole cards after dealing', () => {
    const s = startHand(createInitialState({ players: 2, blinds: [1, 2], startingStack: 100 }, 'hu-seed', 0));
    for (const seat of s.seats) {
      expect(seat.holeCards).toHaveLength(2);
    }
    const allCards = s.seats.flatMap((seat) => seat.holeCards ?? []);
    expect(new Set(allCards).size).toBe(4);
  });
});
