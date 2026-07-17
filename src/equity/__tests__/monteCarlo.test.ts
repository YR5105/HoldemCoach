import { describe, expect, it } from 'vitest';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import type { Card } from '../../engine/types';
import { allCombos, combosForHand, expandRange } from '../combos';
import { simulateEquity } from '../monteCarlo';

const evaluator = new PokersolverEvaluator();

describe('combo expansion', () => {
  it('pairs have 6 combos, suited 4, offsuit 12', () => {
    expect(combosForHand('88')).toHaveLength(6);
    expect(combosForHand('AKs')).toHaveLength(4);
    expect(combosForHand('AKo')).toHaveLength(12);
  });

  it('expandRange drops combos containing dead cards', () => {
    const combos = expandRange(['AA'], ['Ah']);
    expect(combos).toHaveLength(3); // 6 minus the 3 combos using Ah
    for (const [a, b] of combos) {
      expect(a).not.toBe('Ah');
      expect(b).not.toBe('Ah');
    }
  });

  it('allCombos is 1326 with no dead cards', () => {
    expect(allCombos([])).toHaveLength(1326);
  });
});

describe('equity anchors (spec §10)', () => {
  it('AA vs KK preflop ≈ 0.815 ± 0.02', () => {
    const hero: [Card, Card] = ['Ah', 'Ad'];
    const villain = expandRange(['KK'], hero);
    const { equity } = simulateEquity(
      { heroCards: hero, board: [], villainCombos: [villain], iterations: 5000, seed: 'anchor-aakk' },
      evaluator,
    );
    expect(equity).toBeGreaterThan(0.815 - 0.02);
    expect(equity).toBeLessThan(0.815 + 0.02);
  });

  it('AKs vs QQ preflop ≈ 0.46 ± 0.02', () => {
    const hero: [Card, Card] = ['Ah', 'Kh'];
    const villain = expandRange(['QQ'], hero);
    const { equity } = simulateEquity(
      { heroCards: hero, board: [], villainCombos: [villain], iterations: 5000, seed: 'anchor-akqq' },
      evaluator,
    );
    expect(equity).toBeGreaterThan(0.46 - 0.02);
    expect(equity).toBeLessThan(0.46 + 0.02);
  });

  it('flush draw on flop vs top pair ≈ 0.35 ± 0.03', () => {
    // Hero Jh6h — a pure 9-out flush draw (no straight can use both J and 6,
    // and neither pairs to beat top pair) — vs AsKc top pair on Ah 8h 3c.
    const hero: [Card, Card] = ['Jh', '6h'];
    const board: Card[] = ['Ah', '8h', '3c'];
    const villain: [Card, Card][] = [['As', 'Kc']];
    const { equity } = simulateEquity(
      { heroCards: hero, board, villainCombos: [villain], iterations: 5000, seed: 'anchor-fd' },
      evaluator,
    );
    expect(equity).toBeGreaterThan(0.35 - 0.03);
    expect(equity).toBeLessThan(0.35 + 0.03);
  });
});

describe('simulation mechanics', () => {
  it('is deterministic for a fixed seed', () => {
    const hero: [Card, Card] = ['Ah', 'Ad'];
    const villain = expandRange(['KK', 'QQ', 'AKs'], hero);
    const run = () =>
      simulateEquity(
        { heroCards: hero, board: [], villainCombos: [villain], iterations: 500, seed: 'det' },
        evaluator,
      );
    expect(run()).toEqual(run());
  });

  it('caps iterations at 5000', () => {
    const hero: [Card, Card] = ['Ah', 'Ad'];
    const villain = expandRange(['KK'], hero);
    const { iterations } = simulateEquity(
      { heroCards: hero, board: [], villainCombos: [villain], iterations: 50000, seed: 'cap' },
      evaluator,
    );
    expect(iterations).toBeLessThanOrEqual(5000);
  });

  it('handles multiway (two villains) and ties', () => {
    // Hero AA vs two villains both on underpairs — equity must be well above 1/3.
    const hero: [Card, Card] = ['Ah', 'Ad'];
    const v1 = expandRange(['KK'], hero);
    const v2 = expandRange(['QQ'], hero);
    const { equity } = simulateEquity(
      { heroCards: hero, board: [], villainCombos: [v1, v2], iterations: 2000, seed: 'multi' },
      evaluator,
    );
    expect(equity).toBeGreaterThan(0.6);
    expect(equity).toBeLessThan(0.8);
  });

  it('river evaluation (no cards to come) is exact per sample', () => {
    // Hero holds the nuts on a locked board: equity must be 1 regardless of villain range.
    const hero: [Card, Card] = ['Ah', 'Kh'];
    const board: Card[] = ['Qh', 'Jh', 'Th', '2c', '3d'];
    const villain = allCombos([...hero, ...board]).slice(0, 200);
    const { equity } = simulateEquity(
      { heroCards: hero, board, villainCombos: [villain], iterations: 500, seed: 'nuts' },
      evaluator,
    );
    expect(equity).toBe(1);
  });

  it('rejects an empty villain range', () => {
    expect(() =>
      simulateEquity(
        { heroCards: ['Ah', 'Ad'], board: [], villainCombos: [[]], seed: 'x' },
        evaluator,
      ),
    ).toThrow();
  });
});
