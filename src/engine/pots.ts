import type { Evaluator } from '../evaluator/Evaluator';
import type { Card, PayoutResult, Pot, PotShare, Seat } from './types';

/**
 * Layers the pot by each distinct committed-chip level. Every seat that
 * committed at least a layer's ceiling funds that layer's full increment;
 * only non-folded seats among them are eligible to win it. This handles
 * side pots and the "everyone else folded" case uniformly — a lone
 * remaining seat is eligible for every layer their opponents funded.
 */
export function computeSidePots(seats: Seat[]): Pot[] {
  const levels = Array.from(
    new Set(seats.filter((s) => s.committedTotal > 0).map((s) => s.committedTotal)),
  ).sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prevLevel = 0;
  for (const level of levels) {
    const increment = level - prevLevel;
    const fundingSeats = seats.filter((s) => s.committedTotal >= level);
    const amount = increment * fundingSeats.length;
    const eligibleSeats = fundingSeats.filter((s) => !s.folded).map((s) => s.seatIndex);
    if (amount > 0 && eligibleSeats.length > 0) {
      pots.push({ amount, eligibleSeats });
    }
    prevLevel = level;
  }
  return pots;
}

/** Order seats clockwise starting from the first seat left of the button. */
function oddChipOrder(buttonSeat: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => (buttonSeat + 1 + i) % n);
}

export function resolveShowdown(
  seats: Seat[],
  board: Card[],
  buttonSeat: number,
  evaluator: Evaluator,
): PayoutResult {
  const pots = computeSidePots(seats);
  const winningsBySeat = new Map<number, number>();
  const showdownHands: Record<number, { descr: string; cards: Card[] }> = {};
  const order = oddChipOrder(buttonSeat, seats.length);

  for (const pot of pots) {
    let winnerSeats: number[];

    if (pot.eligibleSeats.length === 1) {
      winnerSeats = pot.eligibleSeats;
    } else {
      const results = pot.eligibleSeats.map((seatIdx) => {
        const seat = seats[seatIdx]!;
        const result = evaluator.evaluate([...(seat.holeCards ?? []), ...board]);
        showdownHands[seatIdx] = { descr: result.descr, cards: result.cards };
        return { seatIdx, result };
      });
      const winning = evaluator.winners(results.map((r) => r.result));
      winnerSeats = results.filter((r) => winning.includes(r.result)).map((r) => r.seatIdx);
    }

    const baseShare = Math.floor(pot.amount / winnerSeats.length);
    let remainder = pot.amount - baseShare * winnerSeats.length;

    for (const seatIdx of order) {
      if (!winnerSeats.includes(seatIdx)) continue;
      let share = baseShare;
      if (remainder > 0) {
        share += 1;
        remainder -= 1;
      }
      winningsBySeat.set(seatIdx, (winningsBySeat.get(seatIdx) ?? 0) + share);
    }
  }

  const winners: PotShare[] = Array.from(winningsBySeat.entries())
    .map(([seat, amount]) => ({ seat, amount }))
    .sort((a, b) => a.seat - b.seat);

  return {
    pots,
    winners,
    showdownHands: Object.keys(showdownHands).length > 0 ? showdownHands : undefined,
  };
}
