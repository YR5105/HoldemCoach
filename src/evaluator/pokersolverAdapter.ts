import pokersolver, { type PokersolverHand } from 'pokersolver';
const { Hand } = pokersolver;
import type { Card, Rank, Suit } from '../engine/types';
import type { Evaluator, HandResult } from './Evaluator';

/**
 * pokersolver renders the low ace in a wheel straight as value "1" (and tens as
 * "10") when stringifying cards, so we normalize back to our Card format instead
 * of trusting toString() on the solved hand's cards.
 */
function normalizeCard(value: string, suit: string): Card {
  const rank: Rank = value === '1' ? 'A' : (value as Rank);
  return `${rank}${suit as Suit}`;
}

interface AdapterHandResult extends HandResult {
  raw: PokersolverHand;
}

function isAdapterResult(result: HandResult): result is AdapterHandResult {
  return 'raw' in result;
}

export class PokersolverEvaluator implements Evaluator {
  evaluate(cards: Card[]): HandResult {
    if (cards.length < 5 || cards.length > 7) {
      throw new Error(`Evaluator.evaluate expects 5-7 cards, got ${cards.length}`);
    }
    const raw = Hand.solve(cards);
    const result: AdapterHandResult = {
      descr: raw.descr,
      name: raw.name,
      rank: raw.rank,
      cards: raw.cards.map((c) => normalizeCard(c.value, c.suit)),
      raw,
    };
    return result;
  }

  winners(results: HandResult[]): HandResult[] {
    const rawHands = results.map((result) => {
      if (!isAdapterResult(result)) {
        throw new Error('winners() requires HandResult values produced by PokersolverEvaluator.evaluate()');
      }
      return result.raw;
    });
    const winningRaw = new Set(Hand.winners(rawHands));
    return results.filter((_, i) => winningRaw.has(rawHands[i]!));
  }
}
