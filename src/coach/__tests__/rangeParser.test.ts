import { describe, expect, it } from 'vitest';
import { canonicalHand, parseRange } from '../rangeParser';

describe('parseRange grammar', () => {
  it('22+ expands to every pair 22 through AA', () => {
    const hands = parseRange('22+');
    expect(hands.size).toBe(13);
    expect(hands).toEqual(
      new Set(['22', '33', '44', '55', '66', '77', '88', '99', 'TT', 'JJ', 'QQ', 'KK', 'AA']),
    );
  });

  it('A2s+ expands suited aces from A2s up to AKs', () => {
    const hands = parseRange('A2s+');
    expect(hands.size).toBe(12); // A2s..AKs
    expect(hands.has('A2s')).toBe(true);
    expect(hands.has('AKs')).toBe(true);
    expect(hands.has('AQs')).toBe(true);
    expect(hands.has('AA')).toBe(false);
    expect(hands.has('A2o')).toBe(false);
  });

  it('KTo+ expands offsuit kings from KTo up to KQo', () => {
    const hands = parseRange('KTo+');
    expect(hands).toEqual(new Set(['KTo', 'KJo', 'KQo']));
  });

  it('T9s is an exact single hand', () => {
    expect(parseRange('T9s')).toEqual(new Set(['T9s']));
  });

  it('54s-76s expands a constant-gap connector run', () => {
    expect(parseRange('54s-76s')).toEqual(new Set(['54s', '65s', '76s']));
  });

  it('A5s-A4s expands a same-top-card kicker run', () => {
    expect(parseRange('A5s-A4s')).toEqual(new Set(['A5s', 'A4s']));
  });

  it('22-JJ expands a run of pairs', () => {
    expect(parseRange('22-JJ')).toEqual(
      new Set(['22', '33', '44', '55', '66', '77', '88', '99', 'TT', 'JJ']),
    );
  });

  it('combines comma-separated tokens into one set', () => {
    const hands = parseRange('22+, A9s+, ATo+, KQo');
    expect(hands.has('22')).toBe(true);
    expect(hands.has('AA')).toBe(true);
    expect(hands.has('A9s')).toBe(true);
    expect(hands.has('ATo')).toBe(true);
    expect(hands.has('AQo')).toBe(true);
    expect(hands.has('KQo')).toBe(true);
    expect(hands.has('A8s')).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(() => parseRange('XYs')).toThrow();
  });

  it('rejects a run with inconsistent step and mismatched suitedness', () => {
    expect(() => parseRange('54s-86s')).toThrow(); // gap mismatch (1 vs 2)
    expect(() => parseRange('54s-76o')).toThrow(); // suited vs offsuit
  });
});

describe('canonicalHand', () => {
  it('orders pairs, suited, and offsuit hands correctly regardless of input order', () => {
    expect(canonicalHand(['Ah', 'Kh'])).toBe('AKs');
    expect(canonicalHand(['Kh', 'Ah'])).toBe('AKs');
    expect(canonicalHand(['Ah', 'Kd'])).toBe('AKo');
    expect(canonicalHand(['7c', '2d'])).toBe('72o');
    expect(canonicalHand(['8h', '8d'])).toBe('88');
  });

  it('every canonical hand it produces is a member of the range that should contain it', () => {
    const rfiRange = parseRange('22+, A2s+, K9s+, ATo+, KJo+');
    expect(rfiRange.has(canonicalHand(['Ah', '9h']))).toBe(true); // A9s
    expect(rfiRange.has(canonicalHand(['7h', '2d']))).toBe(false); // 72o
  });
});
