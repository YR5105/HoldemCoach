import { describe, expect, it } from 'vitest';
import type { GuessDoc, HandDoc } from '../handHistory';
import { computeStats } from '../stats';

function handDoc(overrides: { evLosses?: { category: string; severity: string; evLoss: number }[] }): HandDoc {
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    seed: 's',
    config: { players: 6, blinds: [1, 2], heroSeat: 0, bots: [], buttonSeat: 0, startingStack: 200 },
    holeCards: {},
    board: [],
    actions: (overrides.evLosses ?? []).map((g) => ({
      seat: 0,
      street: 'PREFLOP',
      action: 'call',
      amount: 2,
      hero: true,
      coach: {
        equity: 0.5,
        best: 'fold',
        evLoss: g.evLoss,
        severity: g.severity,
        reasonKey: 'pot_odds',
        message: `msg-${g.category}`,
        category: g.category,
      },
    })),
    result: { winners: [0], potAwarded: [], showdown: false },
  };
}

describe('computeStats', () => {
  it('handles an empty history', () => {
    const stats = computeStats([], []);
    expect(stats.handsPlayed).toBe(0);
    expect(stats.evLossPer100).toBe(0);
    expect(stats.topLeaks).toEqual([]);
    expect(stats.guessMeanErrorPct).toBeNull();
  });

  it('aggregates EV loss per 100 hands and per category', () => {
    const docs = [
      handDoc({ evLosses: [{ category: 'preflop', severity: 'MISTAKE', evLoss: 1 }] }),
      handDoc({ evLosses: [{ category: 'facing_bet', severity: 'BLUNDER', evLoss: 3 }] }),
      handDoc({ evLosses: [{ category: 'preflop', severity: 'OK', evLoss: 0 }] }),
    ];
    const stats = computeStats(docs, []);
    expect(stats.handsPlayed).toBe(3);
    expect(stats.decisions).toBe(3);
    expect(stats.totalEvLoss).toBe(4);
    expect(stats.evLossPer100).toBeCloseTo((4 / 3) * 100);

    const preflop = stats.categories.find((c) => c.category === 'preflop')!;
    expect(preflop.decisions).toBe(2);
    expect(preflop.mistakes).toBe(1); // the OK decision doesn't count as a mistake

    // Top leak is the biggest EV drain: facing_bet (3bb) over preflop (1bb).
    expect(stats.topLeaks[0]!.category).toBe('facing_bet');
    expect(stats.topLeaks[0]!.exampleMessage).toBe('msg-facing_bet');
  });

  it('windows hands into 250-hand chunks', () => {
    const docs = Array.from({ length: 300 }, () =>
      handDoc({ evLosses: [{ category: 'preflop', severity: 'MISTAKE', evLoss: 0.5 }] }),
    );
    const stats = computeStats(docs, []);
    expect(stats.windows).toHaveLength(2);
    expect(stats.windows[0]!.hands).toBe(250);
    expect(stats.windows[1]!.hands).toBe(50);
    expect(stats.windows[0]!.evLossPer100).toBeCloseTo(50); // 0.5bb/hand = 50bb/100
  });

  it('computes mean guess error in percentage points', () => {
    const guesses: GuessDoc[] = [
      { id: '1', ts: 1, guess: 0.5, actual: 0.6, error: 0.1 },
      { id: '2', ts: 2, guess: 0.3, actual: 0.6, error: 0.3 },
    ];
    const stats = computeStats([], guesses);
    expect(stats.guessCount).toBe(2);
    expect(stats.guessMeanErrorPct).toBeCloseTo(20);
  });
});
