import { rankValue } from '../engine/cardUtils';

const RANK_CHARS = '23456789TJQKA';

function highCardPoints(value: number): number {
  if (value === 14) return 10;
  if (value === 13) return 8;
  if (value === 12) return 7;
  if (value === 11) return 6;
  if (value === 10) return 5;
  return value / 2; // 2..9 -> 1..4.5
}

/**
 * Chen Formula starting-hand score. A simple, deterministic, well-known
 * heuristic — used only as the "precomputed hand-strength ordering table"
 * spec §3.2/§4 call for (e.g. BB defense's "top 55%" cutoff, and later the
 * LAG/Nit range widen/tighten transform). Not a substitute for real equity.
 */
function chenScore(hand: string): number {
  if (hand.length === 2) {
    // Pair, e.g. "88".
    const v = rankValue(hand[0]!);
    return Math.max(highCardPoints(v) * 2, 5);
  }
  const r1 = rankValue(hand[0]!);
  const r2 = rankValue(hand[1]!);
  const suited = hand[2] === 's';
  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);

  let score = highCardPoints(hi);
  if (suited) score += 2;

  const gap = hi - lo - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;

  if (gap === 0 && hi < 12) score += 1; // connector bonus below Q

  return Math.ceil(score * 2) / 2;
}

function allCanonicalHands(): string[] {
  const hands: string[] = [];
  for (let i = 0; i < RANK_CHARS.length; i++) {
    for (let j = i; j < RANK_CHARS.length; j++) {
      const hi = RANK_CHARS[j]!;
      const lo = RANK_CHARS[i]!;
      if (i === j) {
        hands.push(`${hi}${hi}`);
      } else {
        hands.push(`${hi}${lo}s`, `${hi}${lo}o`);
      }
    }
  }
  return hands;
}

/** All 169 canonical hands ordered strongest-first by Chen score. */
export const HAND_STRENGTH_ORDER: readonly string[] = allCanonicalHands().sort(
  (a, b) => chenScore(b) - chenScore(a),
);

const RANK_INDEX = new Map(HAND_STRENGTH_ORDER.map((hand, i) => [hand, i]));

/** 0 = strongest hand (AA), 168 = weakest. */
export function handStrengthRank(hand: string): number {
  const rank = RANK_INDEX.get(hand);
  if (rank === undefined) throw new Error(`unknown hand "${hand}"`);
  return rank;
}

/** True if `hand` falls within the strongest `percent`% of all starting hands. */
export function isInTopPercent(hand: string, percent: number): boolean {
  const cutoff = Math.ceil((percent / 100) * HAND_STRENGTH_ORDER.length);
  return handStrengthRank(hand) < cutoff;
}
