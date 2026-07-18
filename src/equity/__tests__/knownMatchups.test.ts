import { describe, expect, it } from 'vitest';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import type { Card } from '../../engine/types';
import { expandRange } from '../combos';
import { simulateEquity } from '../monteCarlo';

const evaluator = new PokersolverEvaluator();

function equity(hero: [Card, Card], villains: [Card, Card][][], board: Card[], seed: string, iterations = 20000) {
  return simulateEquity({ heroCards: hero, board, villainCombos: villains, iterations, seed }, evaluator).equity;
}

// ---------------------------------------------------------------------------
// Known preflop matchups vs published exact numbers, ±2 percentage points.
// The named hand is always the hero, so the assertion reads off the table
// directly. Villain ranges are the full combo set for the rank (the matchup
// number is the average over suits).
// ---------------------------------------------------------------------------

function expectWithin(actual: number, target: number, tol: number, label: string) {
  expect(actual, `${label}: ${(actual * 100).toFixed(1)}% not within ±${tol * 100}pts of ${target * 100}%`).toBeGreaterThan(
    target - tol,
  );
  expect(actual, `${label}: ${(actual * 100).toFixed(1)}% not within ±${tol * 100}pts of ${target * 100}%`).toBeLessThan(
    target + tol,
  );
}

describe('equity vs known preflop matchups (±2pts)', () => {
  const AA: [Card, Card] = ['Ah', 'Ad'];

  it('AA vs KK ≈ 81.9%', () => {
    expectWithin(equity(AA, [expandRange(['KK'], AA)], [], 'known-aakk'), 0.819, 0.02, 'AA vs KK');
  });

  it('AKs vs QQ: QQ ≈ 54%', () => {
    const QQ: [Card, Card] = ['Qh', 'Qd'];
    expectWithin(equity(QQ, [expandRange(['AKs'], QQ)], [], 'known-qqaks'), 0.54, 0.02, 'QQ vs AKs');
  });

  it('AKo vs 22: 22 ≈ 52.7%', () => {
    const TT: [Card, Card] = ['2h', '2d'];
    expectWithin(equity(TT, [expandRange(['AKo'], TT)], [], 'known-22ako'), 0.527, 0.02, '22 vs AKo');
  });

  it('AA vs A2o (dominated) ≈ 92%', () => {
    expectWithin(equity(AA, [expandRange(['A2o'], AA)], [], 'known-aaa2o'), 0.92, 0.02, 'AA vs A2o');
  });

  it('T9s vs AA: AA ≈ 77%', () => {
    expectWithin(equity(AA, [expandRange(['T9s'], AA)], [], 'known-aat9s'), 0.77, 0.02, 'AA vs T9s');
  });

  it('3-way AA vs KK vs QQ: AA ≈ 66.6%', () => {
    expectWithin(equity(AA, [expandRange(['KK'], AA), expandRange(['QQ'], AA)], [], 'known-3way'), 0.666, 0.02, 'AA 3-way');
  });
});

// ---------------------------------------------------------------------------
// Postflop draw equities.
// ---------------------------------------------------------------------------

describe('postflop draw equities', () => {
  it('a flopped flush draw vs top pair ≈ 35% with two cards to come', () => {
    // Hero Jh6h: a pure 9-out flush draw (no straight uses both cards, neither
    // pairs above top pair) vs AsKc top pair on Ah 8h 3c.
    const e = equity(['Jh', '6h'], [[['As', 'Kc']]], ['Ah', '8h', '3c'], 'known-fd');
    expect(e).toBeGreaterThan(0.35 - 0.03);
    expect(e).toBeLessThan(0.35 + 0.03);
  });

  it('an open-ended straight draw on the turn ≈ 18% with one card to come', () => {
    // Hero 9h8c on 7d 6s 2c Kh: 8 outs (any 5 or T) / 44 unseen ≈ 18.2% vs
    // KdQc top pair, one card to come.
    const e = equity(['9h', '8c'], [[['Kd', 'Qc']]], ['7d', '6s', '2c', 'Kh'], 'known-oesd');
    expect(e).toBeGreaterThan(0.18 - 0.03);
    expect(e).toBeLessThan(0.18 + 0.03);
  });
});

// ---------------------------------------------------------------------------
// WinDial ± band honesty.
//
// The equity worker runs 1000 iterations (src/workers/equity.worker.ts) and
// WinDial renders ±round(ci95 * 100)%. For a near-coinflip that display is
// ±3%. We run the same simulation 30 times with varied seeds at 1000
// iterations and check the empirical spread matches the formula's half-width
// (and hence the displayed band). If they diverged we'd report the true band
// rather than silently trusting the dial.
// ---------------------------------------------------------------------------

describe('WinDial ± band is honest', () => {
  const WORKER_ITERATIONS = 1000;
  const villain = () => expandRange(['AKo'], ['2h', '2d'] as [Card, Card]);

  it('the displayed ±3% band matches the empirical run-to-run spread', () => {
    const runs: number[] = [];
    for (let i = 0; i < 30; i++) {
      runs.push(equity(['2h', '2d'], [villain()], [], `band-${i}`, WORKER_ITERATIONS));
    }
    const mean = runs.reduce((a, b) => a + b, 0) / runs.length;
    const sd = Math.sqrt(runs.reduce((a, b) => a + (b - mean) ** 2, 0) / (runs.length - 1));
    const empiricalHalfWidth = 1.96 * sd;

    const single = simulateEquity(
      { heroCards: ['2h', '2d'], board: [], villainCombos: [villain()], iterations: WORKER_ITERATIONS, seed: 'band-single' },
      evaluator,
    );
    const displayedBandPct = Math.round(single.ci95 * 100);

    console.info(
      `[WinDial band] mean=${(mean * 100).toFixed(1)}% empirical ±${(empiricalHalfWidth * 100).toFixed(1)}% ` +
        `formula ±${(single.ci95 * 100).toFixed(1)}% displayed ±${displayedBandPct}%`,
    );

    // The dial shows ±3% for this near-coinflip.
    expect(displayedBandPct).toBe(3);
    // The formula's 95% half-width matches the observed spread within ~1.5pts.
    expect(Math.abs(empiricalHalfWidth - single.ci95)).toBeLessThan(0.015);
  });
});
