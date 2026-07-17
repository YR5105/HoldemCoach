import seedrandom from 'seedrandom';
import { describe, expect, it } from 'vitest';
import botsData from '../../data/bots.json';
import { getOpenRaiseRange } from '../../coach/ranges';
import { applyAction, getLegalActions } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Action, Card, GameState } from '../../engine/types';
import { decideBotAction } from '../botPolicy';

function botDraw(state: GameState): number {
  return seedrandom(`${state.seed}:bot:${state.actionLog.length}`)();
}

describe('preflop decisions follow the shared coach/ranges charts', () => {
  it('raises AA from UTG (in the RFI chart)', () => {
    // 6-max, buttonSeat 0 -> UTG is seat 3.
    let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, 'bot-seed-1', 0));
    s = { ...structuredClone(s), seats: s.seats.map((seat, i) => (i === 3 ? { ...seat, holeCards: ['Ah', 'Ad'] } : seat)) };
    const action = decideBotAction(s, 3);
    expect(action.type).toBe('raise');
    expect(action.amount).toBe(5); // 2.5bb open, rounded
  });

  it('folds trash from UTG', () => {
    let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, 'bot-seed-2', 0));
    s = { ...structuredClone(s), seats: s.seats.map((seat, i) => (i === 3 ? { ...seat, holeCards: ['7h', '2d'] } : seat)) };
    const action = decideBotAction(s, 3);
    expect(action.type).toBe('fold');
  });

  it('every hand in the UTG range actually gets raised', () => {
    const range = getOpenRaiseRange('UTG');
    let raised = 0;
    for (const hand of range) {
      let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, `probe-${hand}`, 0));
      const cards: Card[] =
        hand.length === 2
          ? [`${hand[0]}h` as Card, `${hand[0]}d` as Card]
          : [`${hand[0]}h` as Card, `${hand[1]}${hand[2] === 's' ? 'h' : 'd'}` as Card];
      s = { ...structuredClone(s), seats: s.seats.map((seat, i) => (i === 3 ? { ...seat, holeCards: cards } : seat)) };
      const action = decideBotAction(s, 3);
      if (action.type === 'raise') raised++;
    }
    expect(raised).toBe(range.size);
  });

  it('3-bets a premium hand facing an EP/MP open', () => {
    let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, 'bot-seed-3', 0));
    s = applyAction(s, decideBotActionForced(s, 3, ['Ah', 'Kd'])); // UTG opens AKo
    // seat4 (HJ) holds QQ -> should 3-bet.
    s = { ...structuredClone(s), seats: s.seats.map((seat, i) => (i === 4 ? { ...seat, holeCards: ['Qh', 'Qd'] } : seat)) };
    const action = decideBotAction(s, 4);
    expect(action.type).toBe('raise');
  });
});

function decideBotActionForced(state: GameState, seat: number, holeCards: [string, string]): Action {
  const s = { ...structuredClone(state), seats: state.seats.map((st, i) => (i === seat ? { ...st, holeCards } : st)) };
  return decideBotAction(s as GameState, seat);
}

describe('postflop decisions use the made-hand bucket deterministically', () => {
  function flopState(): GameState {
    return {
      seed: 'postflop-seed',
      config: { players: 2, blinds: [1, 2], startingStack: 200 },
      street: 'FLOP',
      seats: [
        {
          seatIndex: 0,
          stack: 190,
          holeCards: ['9h', '9d'], // sits with a set on this board
          folded: false,
          allIn: false,
          committedThisStreet: 0,
          committedTotal: 10,
          hasActed: false,
          raiseCapped: false,
          sittingOut: false,
        },
        {
          seatIndex: 1,
          stack: 190,
          holeCards: ['2h', '3d'],
          folded: false,
          allIn: false,
          committedThisStreet: 0,
          committedTotal: 10,
          hasActed: false,
          raiseCapped: false,
          sittingOut: false,
        },
      ],
      board: ['9c', '4d', '2c'],
      deck: ['5c', '6c', '7c', '8c', 'Tc'],
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

  it('bets a set (STRONG) exactly when the deterministic draw is below the TAG cbet frequency', () => {
    const s = flopState();
    const draw = botDraw(s);
    const action = decideBotAction(s, 0, 'TAG');
    if (draw < botsData.TAG.cbet) {
      expect(action.type).toBe('bet');
    } else {
      expect(action.type).toBe('check');
    }
  });

  it('the same state and seed always produce the same decision', () => {
    const s = flopState();
    const a1 = decideBotAction(s, 0, 'TAG');
    const a2 = decideBotAction(s, 0, 'TAG');
    expect(a1).toEqual(a2);
  });
});

describe('a full hand of all-bot TAG players reaches PAYOUT without error', () => {
  it('plays several seeds end to end', () => {
    for (const seed of ['fuzz-1', 'fuzz-2', 'fuzz-3', 'fuzz-4', 'fuzz-5']) {
      let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
      let guard = 0;
      while (s.street !== 'PAYOUT') {
        if (guard++ > 200) throw new Error(`hand did not terminate for seed ${seed}`);
        const legal = getLegalActions(s, s.actionOn);
        let action = decideBotAction(s, s.actionOn);
        // Bots only choose among currently-legal action types; guard against
        // any mismatch (e.g. deciding 'bet' when only 'raise' is legal).
        if (action.type === 'bet' && !legal.canBet) action = { seat: s.actionOn, type: 'check' };
        if (action.type === 'raise' && !legal.canRaise) {
          action = legal.canCall ? { seat: s.actionOn, type: 'call' } : { seat: s.actionOn, type: 'fold' };
        }
        s = applyAction(s, action);
      }
      expect(s.street).toBe('PAYOUT');
      const totalStacks = s.seats.reduce((sum, seat) => sum + seat.stack, 0);
      expect(totalStacks).toBe(6 * 200); // chip-conservation sanity check
    }
  });
});
