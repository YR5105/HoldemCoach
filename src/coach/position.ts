export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

// Earliest-to-latest preflop acting order for a full 6-max table. Also the
// domain both bots and the (future) equity engine/grader must agree on —
// this is the "one range model" shared code path (hard invariant #1).
const SIX_MAX_ORDER: readonly Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

function positionOrder(n: number): Position[] {
  if (n >= 6) {
    // Tables beyond 6-max don't get their own charts; extra early seats
    // are simply treated as UTG (the tightest, safest default).
    return [...(Array(n - 6).fill('UTG') as Position[]), ...SIX_MAX_ORDER];
  }
  return SIX_MAX_ORDER.slice(6 - n);
}

/**
 * Maps a seat to its position label given the button seat and table size.
 * Matches the engine's own blind/first-to-act math (state.ts / actions.ts)
 * so bot chart lookups always line up with whose turn it actually is.
 */
export function positionForSeat(buttonSeat: number, seatIndex: number, n: number): Position {
  if (n === 2) return seatIndex === buttonSeat ? 'SB' : 'BB';
  const order = positionOrder(n);
  const offset = (seatIndex - buttonSeat + n) % n;
  const i = (offset - 3 + n) % n;
  return order[i]!;
}
