import { rankFromValue as rankChar, rankValue } from '../engine/cardUtils';
import type { Card } from '../engine/types';

interface ParsedHand {
  r1: number; // higher (or equal) rank
  r2: number; // lower (or equal) rank
  suited: boolean | null; // null = pair
}

function canonicalOf({ r1, r2, suited }: ParsedHand): string {
  if (suited === null) return `${rankChar(r1)}${rankChar(r1)}`;
  return `${rankChar(r1)}${rankChar(r2)}${suited ? 's' : 'o'}`;
}

const PAIR_RE = /^([2-9TJQKA])\1$/;
const SUITED_RE = /^([2-9TJQKA])([2-9TJQKA])([so])$/;

function parseHand(token: string): ParsedHand {
  const pairMatch = PAIR_RE.exec(token);
  if (pairMatch) {
    return { r1: rankValue(pairMatch[1]!), r2: rankValue(pairMatch[1]!), suited: null };
  }
  const match = SUITED_RE.exec(token);
  if (!match) throw new Error(`unrecognized hand token "${token}"`);
  const a = rankValue(match[1]!);
  const b = rankValue(match[2]!);
  if (a === b) throw new Error(`"${token}" repeats a rank without being a pair`);
  return { r1: Math.max(a, b), r2: Math.min(a, b), suited: match[3] === 's' };
}

function expandPlus(hand: ParsedHand): ParsedHand[] {
  if (hand.suited === null) {
    const hands: ParsedHand[] = [];
    for (let v = hand.r1; v <= 14; v++) hands.push({ r1: v, r2: v, suited: null });
    return hands;
  }
  // Fixed top card; the kicker rises from the given low card up to one below the top card.
  const hands: ParsedHand[] = [];
  for (let v = hand.r2; v < hand.r1; v++) {
    hands.push({ r1: hand.r1, r2: v, suited: hand.suited });
  }
  return hands;
}

function expandRun(fromToken: string, toToken: string): ParsedHand[] {
  const a = parseHand(fromToken);
  const b = parseHand(toToken);

  if (a.suited === null || b.suited === null) {
    if (a.suited !== b.suited) {
      throw new Error(`range run "${fromToken}-${toToken}" cannot mix a pair with a non-pair`);
    }
    // Both pairs, e.g. "22-JJ".
    const lo = Math.min(a.r1, b.r1);
    const hi = Math.max(a.r1, b.r1);
    const hands: ParsedHand[] = [];
    for (let v = lo; v <= hi; v++) hands.push({ r1: v, r2: v, suited: null });
    return hands;
  }
  if (a.suited !== b.suited) {
    throw new Error(`range run "${fromToken}-${toToken}" must share suitedness`);
  }

  if (a.r1 === b.r1) {
    // Same top card: vary the kicker between the two endpoints.
    const lo = Math.min(a.r2, b.r2);
    const hi = Math.max(a.r2, b.r2);
    const hands: ParsedHand[] = [];
    for (let v = lo; v <= hi; v++) hands.push({ r1: a.r1, r2: v, suited: a.suited });
    return hands;
  }

  const gapA = a.r1 - a.r2;
  const gapB = b.r1 - b.r2;
  if (gapA !== gapB) {
    throw new Error(`range run "${fromToken}-${toToken}" has no consistent step pattern`);
  }
  const lo = Math.min(a.r2, b.r2);
  const hi = Math.max(a.r2, b.r2);
  const hands: ParsedHand[] = [];
  for (let v = lo; v <= hi; v++) hands.push({ r1: v + gapA, r2: v, suited: a.suited });
  return hands;
}

/**
 * Parses the range grammar from HoldemCoach_Build_Spec.md §3 into a set of
 * canonical hand codes (e.g. "AKs", "72o", "88"). Supported forms:
 *   22+          pairs 22 and up
 *   A2s+ / KTo+  fixed top card, kicker rises to one below the top card
 *   T9s          an exact hand
 *   54s-76s      a run between two hands sharing suitedness (same top card,
 *                or a constant-gap connector run)
 */
export function parseRange(rangeStr: string): Set<string> {
  const hands = new Set<string>();
  const tokens = rangeStr
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (token.includes('-')) {
      const [from, to] = token.split('-').map((t) => t.trim());
      for (const hand of expandRun(from!, to!)) hands.add(canonicalOf(hand));
    } else if (token.endsWith('+')) {
      const base = parseHand(token.slice(0, -1));
      for (const hand of expandPlus(base)) hands.add(canonicalOf(hand));
    } else {
      hands.add(canonicalOf(parseHand(token)));
    }
  }

  return hands;
}

/** Converts two hole cards into their canonical grid notation, e.g. "AKs", "72o", "88". */
export function canonicalHand([a, b]: [Card, Card]): string {
  const ra = rankValue(a[0]!);
  const rb = rankValue(b[0]!);
  if (ra === rb) return `${rankChar(ra)}${rankChar(ra)}`;
  const suited = a[1] === b[1];
  const [hi, lo] = ra > rb ? [ra, rb] : [rb, ra];
  return `${rankChar(hi)}${rankChar(lo)}${suited ? 's' : 'o'}`;
}
