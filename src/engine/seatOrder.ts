import type { GameState, Seat } from './types';

export function canAct(seat: Seat): boolean {
  return !seat.folded && !seat.allIn && !seat.sittingOut;
}

/** Seats still able to voluntarily act (not folded, not all-in, not sitting out). */
export function actableSeats(state: GameState): Seat[] {
  return state.seats.filter(canAct);
}

/**
 * Finds the next seat, starting at `startInclusive` and wrapping around the
 * table, that is still able to act. Returns null if no seat can act.
 */
export function nextToActFrom(state: GameState, startInclusive: number): number | null {
  const n = state.seats.length;
  for (let i = 0; i < n; i++) {
    const idx = (startInclusive + i) % n;
    const seat = state.seats[idx]!;
    if (canAct(seat)) return idx;
  }
  return null;
}
