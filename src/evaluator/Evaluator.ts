import type { Card } from '../engine/types';

export interface HandResult {
  /** Human-readable description, e.g. "Two Pair, A's & K's". */
  descr: string;
  /** Hand class name, e.g. "Straight Flush", "Two Pair". */
  name: string;
  /** Higher is better. Comparable only across results produced by the same Evaluator. */
  rank: number;
  /** The best 5 cards making up this hand, chosen from the input cards. */
  cards: Card[];
}

export interface Evaluator {
  /** Evaluates 5-7 cards and returns the best 5-card hand. */
  evaluate(cards: Card[]): HandResult;
  /** Splits `results` into the subset that wins (ties included). */
  winners(results: HandResult[]): HandResult[];
}
