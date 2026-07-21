import { rankValue } from '../engine/cardUtils';
import type { Card } from '../engine/types';

export type BoardTexture = 'DRY' | 'WET';

/**
 * Coarse board-texture classifier, used for feedback *wording* only (never the
 * EV math). Mirrors the standard coaching heuristic (Upswing / PokerCoaching):
 * "wet" boards are suited and connected — they enable flush and straight draws,
 * so bets should be bigger and more selective; "dry" boards are rainbow and
 * disconnected — small bets pressure the whole continuing range cheaply.
 *
 * Scoring:
 *  - 3+ of one suit: +2, exactly 2 of one suit: +1 (flush draws possible)
 *  - each pair of board ranks 1–2 apart: +1 (straight draws possible)
 *  - paired board: −1 (pairs block many draw combinations)
 * WET when score ≥ 2, else DRY. Returns null preflop (no board to classify).
 */
export function classifyBoardTexture(board: readonly Card[]): BoardTexture | null {
  if (board.length < 3) return null;

  let score = 0;

  const suitCounts = new Map<string, number>();
  for (const card of board) suitCounts.set(card[1]!, (suitCounts.get(card[1]!) ?? 0) + 1);
  const maxSuit = Math.max(...suitCounts.values());
  if (maxSuit >= 3) score += 2;
  else if (maxSuit === 2) score += 1;

  const ranks = board.map((card) => rankValue(card[0]!));
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 1; j < ranks.length; j++) {
      const gap = Math.abs(ranks[i]! - ranks[j]!);
      if (gap >= 1 && gap <= 2) score += 1;
    }
  }

  if (new Set(ranks).size < board.length) score -= 1;

  return score >= 2 ? 'WET' : 'DRY';
}
