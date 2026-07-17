import { describe, expect, it } from 'vitest';
import { HAND_STRENGTH_ORDER, handStrengthRank, isInTopPercent } from '../handStrength';

describe('hand strength ordering', () => {
  it('contains all 169 canonical starting hands exactly once', () => {
    expect(HAND_STRENGTH_ORDER).toHaveLength(169);
    expect(new Set(HAND_STRENGTH_ORDER).size).toBe(169);
  });

  it('ranks AA as the strongest hand', () => {
    expect(handStrengthRank('AA')).toBe(0);
  });

  it('ranks premium hands well ahead of weak offsuit trash', () => {
    expect(handStrengthRank('AKs')).toBeLessThan(handStrengthRank('72o'));
    expect(handStrengthRank('KK')).toBeLessThan(handStrengthRank('J4o'));
    expect(handStrengthRank('72o')).toBe(HAND_STRENGTH_ORDER.length - 1);
  });

  it('isInTopPercent respects the cutoff', () => {
    expect(isInTopPercent('AA', 1)).toBe(true);
    expect(isInTopPercent('72o', 1)).toBe(false);
    expect(isInTopPercent('72o', 100)).toBe(true);
  });
});
