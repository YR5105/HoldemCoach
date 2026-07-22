import { describe, expect, it } from 'vitest';
import { applyAction } from '../actions';
import { activePlayers, createInitialState, nextButtonSeat, startHand } from '../state';
import type { GameConfig } from '../types';

const CONFIG: GameConfig = { players: 6, blinds: [1, 2], startingStack: 200 };

describe('carry-over stacks and elimination', () => {
  it('seats with 0 chips are eliminated: sitting out, folded, no cards dealt', () => {
    // Seats 1 and 4 are busted (0 chips) coming into this hand.
    const stacks = [200, 0, 200, 200, 0, 200];
    const s = startHand(createInitialState(CONFIG, 'sess-1', 2, stacks));

    expect(activePlayers(s)).toBe(4);
    for (const seat of [1, 4]) {
      expect(s.seats[seat]!.sittingOut).toBe(true);
      expect(s.seats[seat]!.folded).toBe(true);
      expect(s.seats[seat]!.holeCards).toBeNull();
      expect(s.seats[seat]!.committedTotal).toBe(0);
    }
    for (const seat of [0, 2, 3, 5]) {
      expect(s.seats[seat]!.holeCards).toHaveLength(2);
    }
  });

  it('never deals action to an eliminated seat', () => {
    const stacks = [200, 0, 200, 0, 0, 200];
    let s = startHand(createInitialState(CONFIG, 'sess-2', 0, stacks));
    let guard = 0;
    while (s.street !== 'PAYOUT') {
      if (guard++ > 200) throw new Error('non-terminating');
      const seat = s.seats[s.actionOn]!;
      expect(seat.sittingOut).toBe(false);
      expect(seat.stack > 0 || seat.allIn).toBe(true);
      // Everyone just checks/calls or folds to reach a showdown.
      s = applyAction(s, { seat: s.actionOn, type: s.currentBet > seat.committedThisStreet ? 'call' : 'check' });
    }
    // Chips are conserved across the whole hand.
    const total = s.seats.reduce((sum, x) => sum + x.stack, 0);
    expect(total).toBe(600);
  });

  it('nextButtonSeat skips eliminated seats', () => {
    const stacks = [200, 0, 0, 200, 200, 0];
    const s = createInitialState(CONFIG, 'sess-3', 0, stacks);
    // Button on seat 0 -> next seat with chips is seat 3.
    expect(nextButtonSeat(s)).toBe(3);
    // Button on seat 4 -> wraps to seat 0.
    expect(nextButtonSeat({ ...s, buttonSeat: 4 })).toBe(0);
  });
});

describe('heads-up down from a full table', () => {
  it('applies heads-up blinds between the two survivors even in non-adjacent seats', () => {
    // Only seats 2 and 5 have chips; button on seat 2.
    const stacks = [0, 0, 200, 0, 0, 200];
    const s = startHand(createInitialState(CONFIG, 'sess-hu', 2, stacks));

    expect(activePlayers(s)).toBe(2);
    // Heads-up: button (seat 2) posts the small blind, the other survivor the big.
    expect(s.seats[2]!.committedThisStreet).toBe(1);
    expect(s.seats[5]!.committedThisStreet).toBe(2);
    // Button/SB acts first preflop heads-up.
    expect(s.actionOn).toBe(2);
  });

  it('the button/SB acts first preflop, the big blind first postflop', () => {
    const stacks = [0, 0, 200, 0, 0, 200];
    let s = startHand(createInitialState(CONFIG, 'sess-hu2', 2, stacks));
    s = applyAction(s, { seat: 2, type: 'call' }); // SB completes
    s = applyAction(s, { seat: 5, type: 'check' }); // BB checks -> flop
    expect(s.street).toBe('FLOP');
    expect(s.actionOn).toBe(5); // BB acts first postflop
  });
});

describe('createInitialState with explicit stacks', () => {
  it('reproduces the same hand given the same seed, button, and stacks', () => {
    const stacks = [150, 0, 300, 200, 50, 100];
    const a = startHand(createInitialState(CONFIG, 'repro', 0, stacks));
    const b = startHand(createInitialState(CONFIG, 'repro', 0, stacks));
    expect(a.seats.map((x) => x.holeCards)).toEqual(b.seats.map((x) => x.holeCards));
    expect(a.deck).toEqual(b.deck);
  });
});
