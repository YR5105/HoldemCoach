import { rankValue } from '../engine/cardUtils';
import type { Card, Suit } from '../engine/types';

const SUITS: Suit[] = ['c', 'd', 'h', 's'];

/** Expands one canonical hand code ("AKs", "72o", "88") into its specific card combos. */
export function combosForHand(hand: string): [Card, Card][] {
  const combos: [Card, Card][] = [];
  if (hand.length === 2) {
    // Pair: 6 combos.
    const r = hand[0]!;
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        combos.push([`${r}${SUITS[i]}` as Card, `${r}${SUITS[j]}` as Card]);
      }
    }
    return combos;
  }
  const hi = hand[0]!;
  const lo = hand[1]!;
  if (hand[2] === 's') {
    // Suited: 4 combos.
    for (const s of SUITS) {
      combos.push([`${hi}${s}` as Card, `${lo}${s}` as Card]);
    }
  } else {
    // Offsuit: 12 combos.
    for (const s1 of SUITS) {
      for (const s2 of SUITS) {
        if (s1 === s2) continue;
        combos.push([`${hi}${s1}` as Card, `${lo}${s2}` as Card]);
      }
    }
  }
  return combos;
}

/**
 * Expands a canonical range into card combos, dropping any combo that uses a
 * dead card (hero cards, board, other villains' known cards).
 */
export function expandRange(range: Iterable<string>, deadCards: Iterable<Card>): [Card, Card][] {
  const dead = new Set(deadCards);
  const combos: [Card, Card][] = [];
  for (const hand of range) {
    for (const combo of combosForHand(hand)) {
      if (!dead.has(combo[0]) && !dead.has(combo[1])) combos.push(combo);
    }
  }
  return combos;
}

/** All 1326 two-card combos minus dead cards — the "no information" fallback range. */
export function allCombos(deadCards: Iterable<Card>): [Card, Card][] {
  const dead = new Set(deadCards);
  const ranks = '23456789TJQKA';
  const cards: Card[] = [];
  for (const r of ranks) {
    for (const s of SUITS) {
      const card = `${r}${s}` as Card;
      if (!dead.has(card)) cards.push(card);
    }
  }
  const combos: [Card, Card][] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      combos.push([cards[i]!, cards[j]!]);
    }
  }
  return combos;
}

/** Sorts a two-card combo high-rank-first so equality checks are stable. */
export function normalizeCombo([a, b]: [Card, Card]): [Card, Card] {
  return rankValue(a[0]!) >= rankValue(b[0]!) ? [a, b] : [b, a];
}
