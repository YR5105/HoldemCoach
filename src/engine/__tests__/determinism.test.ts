import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '../actions';
import { createInitialState, startHand } from '../state';
import type { Action, ActionLogEntry, GameConfig, GameState } from '../types';

/** A trivial "bot": call/check whenever possible, otherwise fold. Deterministic. */
function autoPlayToPayout(state: GameState): GameState {
  let s = state;
  while (s.street !== 'PAYOUT') {
    const legal = getLegalActions(s, s.actionOn);
    const action: Action = legal.canCheck
      ? { seat: s.actionOn, type: 'check' }
      : legal.canCall
        ? { seat: s.actionOn, type: 'call' }
        : { seat: s.actionOn, type: 'fold' };
    s = applyAction(s, action);
  }
  return s;
}

function replayFromLog(config: GameConfig, seed: string, log: ActionLogEntry[]): GameState {
  let s = startHand(createInitialState(config, seed, 0));
  for (const entry of log) {
    if (entry.action === 'post-sb' || entry.action === 'post-bb') continue;
    const action: Action = {
      seat: entry.seat,
      type: entry.action,
      amount: entry.action === 'bet' || entry.action === 'raise' ? entry.amount : undefined,
    };
    s = applyAction(s, action);
  }
  return s;
}

describe('determinism', () => {
  it('replaying {seed, config, actionLog} reproduces an identical final state', () => {
    const config: GameConfig = { players: 4, blinds: [1, 2], startingStack: 200 };
    const seed = 'replay-seed-42';

    const original = autoPlayToPayout(startHand(createInitialState(config, seed, 0)));
    expect(original.street).toBe('PAYOUT');

    const replayed = replayFromLog(config, seed, original.actionLog);

    expect(replayed).toEqual(original);
  });

  it('the same seed deals the same hole cards and board every time', () => {
    const config: GameConfig = { players: 6, blinds: [1, 2], startingStack: 200 };
    const a = startHand(createInitialState(config, 'stable-seed', 0));
    const b = startHand(createInitialState(config, 'stable-seed', 0));
    expect(a.seats.map((s) => s.holeCards)).toEqual(b.seats.map((s) => s.holeCards));
    expect(a.deck).toEqual(b.deck);
  });
});
