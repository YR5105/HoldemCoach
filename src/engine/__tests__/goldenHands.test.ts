import { describe, expect, it } from 'vitest';
import { applyAction } from '../actions';
import { createInitialState, startHand } from '../state';
import type { Action, GameState, Pot, PotShare } from '../types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';

const evaluator = new PokersolverEvaluator();

/**
 * Golden-master pack: five seeds + scripted action lists whose full outcomes are
 * frozen inline below. The engine is deterministic (same seed + actions => same
 * result), so any future change that alters one of these hands fails loudly with
 * a reviewable diff. Expected values were captured from the current engine.
 */
function play(
  players: number,
  seed: string,
  actions: (Omit<Action, 'seat'> & { seat: number })[],
  seatStacks?: number[],
): GameState {
  let s = startHand(createInitialState({ players, blinds: [1, 2], startingStack: 200 }, seed, 0, seatStacks));
  for (const a of actions) s = applyAction(s, a, evaluator);
  return s;
}

interface Golden {
  street: string;
  board: string[];
  stacks: number[];
  winners: PotShare[];
  pots: Pot[];
}

function snapshot(s: GameState): Golden {
  return {
    street: s.street,
    board: [...s.board],
    stacks: s.seats.map((seat) => seat.stack),
    winners: s.payout!.winners,
    pots: s.payout!.pots,
  };
}

describe('golden hands (determinism regression pack)', () => {
  it('A — hand ends preflop: folds around to the big blind, who wins uncontested', () => {
    // 6-max, everyone folds to the BB (seat 2). No board is dealt; the BB takes
    // the blinds. Locks in the "no showdown, ends preflop" path.
    const s = play(6, 'gold-preflop', [
      { seat: 3, type: 'fold' },
      { seat: 4, type: 'fold' },
      { seat: 5, type: 'fold' },
      { seat: 0, type: 'fold' },
      { seat: 1, type: 'fold' },
    ]);
    expect(snapshot(s)).toEqual({
      street: 'PAYOUT',
      board: [],
      stacks: [200, 199, 201, 200, 200, 200],
      winners: [{ seat: 2, amount: 3 }],
      pots: [
        { amount: 2, eligibleSeats: [2] },
        { amount: 1, eligibleSeats: [2] },
      ],
    });
  });

  it('B — heads-up hand checked down to a river showdown', () => {
    // 2 players, SB calls, then both check every street to showdown on the
    // river. Locks in the heads-up blind/act order and a full board run-out.
    const s = play(2, 'gold-hu', [
      { seat: 0, type: 'call' },
      { seat: 1, type: 'check' },
      { seat: 1, type: 'check' },
      { seat: 0, type: 'check' },
      { seat: 1, type: 'check' },
      { seat: 0, type: 'check' },
      { seat: 1, type: 'check' },
      { seat: 0, type: 'check' },
    ]);
    expect(snapshot(s)).toEqual({
      street: 'PAYOUT',
      board: ['3s', '5c', '5s', 'Qs', '2c'],
      stacks: [202, 198],
      winners: [{ seat: 0, amount: 4 }],
      pots: [{ amount: 4, eligibleSeats: [0, 1] }],
    });
  });

  it('C — 6-max hand reaching showdown on the river', () => {
    // Folds down to the button and the big blind, who check the whole board
    // out. Locks in a multi-street showdown with a folded seat's dead blind
    // layered into the pot.
    const s = play(6, 'gold-river', [
      { seat: 3, type: 'fold' },
      { seat: 4, type: 'fold' },
      { seat: 5, type: 'fold' },
      { seat: 0, type: 'call' },
      { seat: 1, type: 'fold' },
      { seat: 2, type: 'check' },
      { seat: 2, type: 'check' },
      { seat: 0, type: 'check' },
      { seat: 2, type: 'check' },
      { seat: 0, type: 'check' },
      { seat: 2, type: 'check' },
      { seat: 0, type: 'check' },
    ]);
    expect(snapshot(s)).toEqual({
      street: 'PAYOUT',
      board: ['3s', 'As', '5c', '2s', '6c'],
      stacks: [203, 199, 198, 200, 200, 200],
      winners: [{ seat: 0, amount: 5 }],
      pots: [
        { amount: 3, eligibleSeats: [0, 2] },
        { amount: 2, eligibleSeats: [0, 2] },
      ],
    });
  });

  it('D — split pot: both players play the board and chop', () => {
    // Heads-up check-down where the five-card board (A-2-3-4-5 wheel) is the
    // best hand for both players. Locks in even-split payout with no odd chip.
    const s = play(2, 'gold-split-45', [
      { seat: 0, type: 'call' },
      { seat: 1, type: 'check' },
      { seat: 1, type: 'check' },
      { seat: 0, type: 'check' },
      { seat: 1, type: 'check' },
      { seat: 0, type: 'check' },
      { seat: 1, type: 'check' },
      { seat: 0, type: 'check' },
    ]);
    expect(snapshot(s)).toEqual({
      street: 'PAYOUT',
      board: ['Ac', '5c', '2h', '4d', '3d'],
      stacks: [200, 200],
      winners: [
        { seat: 0, amount: 2 },
        { seat: 1, amount: 2 },
      ],
      pots: [{ amount: 4, eligibleSeats: [0, 1] }],
    });
  });

  it('E — side pot with three all-in players of different stacks', () => {
    // 3-handed with stacks 200/100/40, all three all-in preflop. Produces three
    // layered pots: a main pot all three can win, a side pot for the two deeper
    // stacks, and the uncalled top layer returned to the deepest stack.
    const s = play(
      3,
      'gold-sidepot',
      [
        { seat: 0, type: 'raise', amount: 200 },
        { seat: 1, type: 'call' },
        { seat: 2, type: 'call' },
      ],
      [200, 100, 40],
    );
    expect(snapshot(s)).toEqual({
      street: 'PAYOUT',
      board: ['3c', 'Tc', '3d', 'Kh', '6h'],
      stacks: [220, 120, 0],
      winners: [
        { seat: 0, amount: 220 },
        { seat: 1, amount: 120 },
      ],
      pots: [
        { amount: 120, eligibleSeats: [0, 1, 2] },
        { amount: 120, eligibleSeats: [0, 1] },
        { amount: 100, eligibleSeats: [0] },
      ],
    });
  });
});
