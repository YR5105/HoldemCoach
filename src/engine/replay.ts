import { applyAction } from './actions';
import { createInitialState, startHand } from './state';
import type { Action, ActionLogEntry, GameConfig, GameState } from './types';

export interface ReplayStep {
  /** State AFTER this entry's action was applied (step 0 = hand start, entry null). */
  state: GameState;
  entry: ActionLogEntry | null;
  /** Index of this entry in the original actionLog (-1 for the start step). */
  actionIndex: number;
}

/**
 * Rebuilds every intermediate state of a hand from {seed, config, actionLog}
 * (the determinism invariant makes this exact). `seatStacks` supplies the
 * per-seat chips the hand started with — required to reproduce continuous-match
 * hands where stacks carried over and some seats were eliminated. Blind posts
 * are part of startHand and don't get their own steps.
 */
export function buildReplay(
  config: GameConfig,
  seed: string,
  buttonSeat: number,
  actionLog: ActionLogEntry[],
  seatStacks?: number[],
): ReplayStep[] {
  let state = startHand(createInitialState(config, seed, buttonSeat, seatStacks));
  const steps: ReplayStep[] = [{ state, entry: null, actionIndex: -1 }];

  for (let i = 0; i < actionLog.length; i++) {
    const entry = actionLog[i]!;
    if (entry.action === 'post-sb' || entry.action === 'post-bb') continue;
    const action: Action = {
      seat: entry.seat,
      type: entry.action,
      amount: entry.action === 'bet' || entry.action === 'raise' ? entry.amount : undefined,
    };
    state = applyAction(state, action);
    steps.push({ state, entry, actionIndex: i });
  }

  return steps;
}
