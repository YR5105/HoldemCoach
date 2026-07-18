import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '../actions';
import { buildReplay } from '../replay';
import { createInitialState, startHand } from '../state';
import type { Action, GameConfig, GameState } from '../types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';

const evaluator = new PokersolverEvaluator();

// ---------------------------------------------------------------------------
// Tiny self-contained seeded RNG (mulberry32) — no new dependencies.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Chip-accounting helpers.
//
// The engine credits winnings into stacks at settlement but leaves
// committedTotal populated, so the conserved quantity is:
//   - in progress (payout === null): Σstack + ΣcommittedTotal
//   - settled (payout !== null): Σstack (the pot has been paid back out)
// ---------------------------------------------------------------------------

function totalChips(state: GameState): number {
  const stacks = state.seats.reduce((sum, s) => sum + s.stack, 0);
  if (state.payout === null) {
    return stacks + state.seats.reduce((sum, s) => sum + s.committedTotal, 0);
  }
  return stacks;
}

function winningsBySeat(state: GameState): Map<number, number> {
  const map = new Map<number, number>();
  for (const w of state.payout?.winners ?? []) {
    map.set(w.seat, (map.get(w.seat) ?? 0) + w.amount);
  }
  return map;
}

/** A uniformly random legal action; raise/bet sizes are uniform in [minTo, maxTo]. */
function randomLegalAction(state: GameState, seat: number, rng: () => number): Action {
  const legal = getLegalActions(state, seat);
  const types: Action['type'][] = [];
  if (legal.canFold) types.push('fold');
  if (legal.canCheck) types.push('check');
  if (legal.canCall) types.push('call');
  if (legal.canBet) types.push('bet');
  if (legal.canRaise) types.push('raise');

  const type = types[Math.floor(rng() * types.length)]!;
  if (type === 'bet' || type === 'raise') {
    const span = legal.maxTo - legal.minTo;
    const amount = legal.minTo + Math.floor(rng() * (span + 1));
    return { seat, type, amount };
  }
  return { seat, type };
}

describe('engine fuzz — chips are conserved and replay is exact', () => {
  it('200 seeded random hands hold every accounting invariant', () => {
    for (let hand = 0; hand < 200; hand++) {
      const players = 2 + (hand % 5); // cycles 2,3,4,5,6
      const config: GameConfig = { players, blinds: [1, 2], startingStack: 200 };
      const seed = `fuzz-${hand}`;
      const startTotal = config.startingStack * players;
      const rng = mulberry32(hashSeed(seed));

      let s = startHand(createInitialState(config, seed, 0));
      const played: Action[] = [];

      // The pre-action state's total is the reference; conservation is exact.
      const ctx = () => `seed=${seed} players=${players}\nactions=${JSON.stringify(played)}`;

      let guard = 0;
      while (s.payout === null) {
        expect(s.actionOn, `no live actor mid-hand — ${ctx()}`).toBeGreaterThanOrEqual(0);
        if (guard++ > 500) throw new Error(`hand did not terminate — ${ctx()}`);

        const action = randomLegalAction(s, s.actionOn, rng);
        played.push(action);
        s = applyAction(s, action, evaluator);

        // (a) chip conservation, exactly.
        expect(totalChips(s), `chip conservation broken — ${ctx()}`).toBe(startTotal);
        // (b) no negative stacks.
        for (const seat of s.seats) {
          expect(seat.stack, `negative stack seat ${seat.seatIndex} — ${ctx()}`).toBeGreaterThanOrEqual(0);
        }
      }

      // (c) hand over: pot fully awarded, and exactly the winners' stacks grew.
      const winnings = winningsBySeat(s);
      const potAwarded = [...winnings.values()].reduce((sum, a) => sum + a, 0);
      const totalCommitted = s.seats.reduce((sum, seat) => sum + seat.committedTotal, 0);
      expect(potAwarded, `pot not fully awarded — ${ctx()}`).toBe(totalCommitted);

      for (const seat of s.seats) {
        const expected = config.startingStack - seat.committedTotal + (winnings.get(seat.seatIndex) ?? 0);
        expect(seat.stack, `seat ${seat.seatIndex} stack mismatch — ${ctx()}`).toBe(expected);
        // Non-winners never gained chips.
        if (!winnings.has(seat.seatIndex)) {
          expect(seat.stack, `non-winner seat ${seat.seatIndex} gained — ${ctx()}`).toBeLessThanOrEqual(
            config.startingStack,
          );
        }
      }

      // (d) replay parity: same seed + action log rebuilds the identical state.
      const replay = buildReplay(config, seed, 0, s.actionLog);
      const replayFinal = replay[replay.length - 1]!.state;
      expect(replayFinal, `replay diverged — ${ctx()}`).toEqual(s);
    }
  });
});
