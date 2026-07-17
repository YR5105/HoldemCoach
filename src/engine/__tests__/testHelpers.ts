import type { Card, Seat } from '../types';

export function buildSeat(
  seatIndex: number,
  overrides: Partial<Seat> & { committedTotal: number; holeCards: Card[] | null },
): Seat {
  return {
    seatIndex,
    stack: 0,
    folded: false,
    allIn: false,
    committedThisStreet: 0,
    hasActed: false,
    raiseCapped: false,
    sittingOut: false,
    ...overrides,
  };
}
