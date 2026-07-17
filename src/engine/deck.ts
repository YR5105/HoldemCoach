import seedrandom from 'seedrandom';
import type { Card, Rank, Suit } from './types';

const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS: Suit[] = ['c', 'd', 'h', 's'];

export function orderedDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/**
 * Deterministic Fisher-Yates shuffle seeded by `seed`. The same seed always
 * produces the same deck order, which is what makes {seed, config, actionLog}
 * sufficient to replay a hand exactly.
 */
export function shuffledDeck(seed: string): Card[] {
  const rng = seedrandom(seed);
  const deck = orderedDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}
