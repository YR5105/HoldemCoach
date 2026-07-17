import { describe, expect, it } from 'vitest';
import { orderedDeck, shuffledDeck } from '../deck';

describe('deck', () => {
  it('orderedDeck has 52 unique cards', () => {
    const deck = orderedDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it('shuffledDeck is a permutation of the ordered deck', () => {
    const deck = shuffledDeck('seed-1');
    expect(deck).toHaveLength(52);
    expect(new Set(deck)).toEqual(new Set(orderedDeck()));
  });

  it('same seed produces the same order', () => {
    expect(shuffledDeck('abc123')).toEqual(shuffledDeck('abc123'));
  });

  it('different seeds produce different orders', () => {
    expect(shuffledDeck('seed-a')).not.toEqual(shuffledDeck('seed-b'));
  });
});
