import { describe, expect, it, vi } from 'vitest';
import type { GuessDoc, HandDoc } from '../handHistory';
import { computeStats } from '../stats';
import { severityForEvLoss } from '../../coach/graderTypes';

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

// ---------------------------------------------------------------------------
// Exact aggregation: totals, per-category counts, and OK-never-a-mistake.
// ---------------------------------------------------------------------------

describe('computeStats — exact aggregation', () => {
  it('sums EV loss exactly and counts mistakes per category, ignoring OK', () => {
    const docs = [
      handDoc({
        evLosses: [
          { category: 'preflop', severity: 'INACCURACY', evLoss: 0.3 },
          { category: 'preflop', severity: 'OK', evLoss: 0.05 },
        ],
      }),
      handDoc({
        evLosses: [
          { category: 'cbet', severity: 'MISTAKE', evLoss: 1.25 },
          { category: 'cbet', severity: 'BLUNDER', evLoss: 4 },
        ],
      }),
      handDoc({ evLosses: [{ category: 'facing_bet', severity: 'OK', evLoss: 0 }] }),
    ];
    const stats = computeStats(docs, []);

    // Total EV loss is the exact sum of every graded action (OK included).
    expect(stats.totalEvLoss).toBeCloseTo(0.3 + 0.05 + 1.25 + 4 + 0, 10);
    expect(stats.decisions).toBe(5);

    const preflop = stats.categories.find((c) => c.category === 'preflop')!;
    expect(preflop.decisions).toBe(2);
    expect(preflop.mistakes).toBe(1); // the OK decision is not a mistake
    expect(preflop.evLoss).toBeCloseTo(0.3, 10); // OK's 0.05 excluded from category loss

    const cbet = stats.categories.find((c) => c.category === 'cbet')!;
    expect(cbet.decisions).toBe(2);
    expect(cbet.mistakes).toBe(2);
    expect(cbet.evLoss).toBeCloseTo(5.25, 10);

    const facing = stats.categories.find((c) => c.category === 'facing_bet')!;
    expect(facing.decisions).toBe(1);
    expect(facing.mistakes).toBe(0); // pure-OK category has no mistakes and no leak
    expect(stats.topLeaks.some((l) => l.category === 'facing_bet')).toBe(false);
  });

  it('OK decisions never count as mistakes anywhere in the aggregation', () => {
    const docs = Array.from({ length: 5 }, () =>
      handDoc({ evLosses: [{ category: 'bluff', severity: 'OK', evLoss: 0.09 }] }),
    );
    const stats = computeStats(docs, []);
    for (const c of stats.categories) expect(c.mistakes).toBe(0);
    expect(stats.topLeaks).toEqual([]);
    expect(stats.decisions).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Per-250-hand window normalization, for windows smaller and larger than 250.
// evLossPer100 = (window EV loss / window hands) * 100.
// ---------------------------------------------------------------------------

describe('computeStats — window normalization', () => {
  const oneMistake = (evLoss: number) =>
    handDoc({ evLosses: [{ category: 'preflop', severity: 'MISTAKE', evLoss }] });

  it('a single partial window (< 250 hands) normalizes correctly', () => {
    const docs = Array.from({ length: 100 }, () => oneMistake(0.2));
    const stats = computeStats(docs, []);
    expect(stats.windows).toHaveLength(1);
    expect(stats.windows[0]!.hands).toBe(100);
    // 0.2bb/hand -> 20bb/100 hands.
    expect(stats.windows[0]!.evLossPer100).toBeCloseTo(20, 10);
  });

  it('more than 250 hands splits into a full and a partial window', () => {
    const docs = Array.from({ length: 260 }, (_, i) => oneMistake(i < 250 ? 1 : 0));
    const stats = computeStats(docs, []);
    expect(stats.windows).toHaveLength(2);
    expect(stats.windows[0]!.hands).toBe(250);
    expect(stats.windows[0]!.startHand).toBe(0);
    expect(stats.windows[0]!.evLossPer100).toBeCloseTo(100, 10); // 1bb/hand
    expect(stats.windows[1]!.hands).toBe(10);
    expect(stats.windows[1]!.startHand).toBe(250);
    expect(stats.windows[1]!.evLossPer100).toBeCloseTo(0, 10); // last 10 lost nothing
  });
});

// ---------------------------------------------------------------------------
// Severity boundary values land in the documented buckets (no off-by-one).
// severityForEvLoss: <0.1 OK, <=0.5 INACCURACY, <=2 MISTAKE, else BLUNDER.
// ---------------------------------------------------------------------------

describe('severityForEvLoss boundaries', () => {
  it('classifies the exact threshold values', () => {
    expect(severityForEvLoss(0.1)).toBe('INACCURACY'); // 0.1 is NOT OK (OK is strictly < 0.1)
    expect(severityForEvLoss(0.5)).toBe('INACCURACY'); // <= 0.5 stays Inaccuracy
    expect(severityForEvLoss(2.0)).toBe('MISTAKE'); //    <= 2 stays Mistake
  });

  it('is correct just inside and just outside each boundary', () => {
    expect(severityForEvLoss(0.099)).toBe('OK');
    expect(severityForEvLoss(0.100001)).toBe('INACCURACY');
    expect(severityForEvLoss(0.500001)).toBe('MISTAKE');
    expect(severityForEvLoss(2.000001)).toBe('BLUNDER');
  });
});

// ---------------------------------------------------------------------------
// Settings persistence across a simulated app restart (localStorage-backed
// zustand store). The grading thresholds live here and feed grading -> stats.
// ---------------------------------------------------------------------------

describe('settings persist across restart (localStorage)', () => {
  class LocalStorageMock {
    private store = new Map<string, string>();
    get length() {
      return this.store.size;
    }
    clear() {
      this.store.clear();
    }
    getItem(k: string) {
      return this.store.has(k) ? this.store.get(k)! : null;
    }
    setItem(k: string, v: string) {
      this.store.set(k, String(v));
    }
    removeItem(k: string) {
      this.store.delete(k);
    }
    key(i: number) {
      return [...this.store.keys()][i] ?? null;
    }
  }

  it('re-reads identical thresholds and table size after re-initializing', async () => {
    // zustand's persist defaults to window.localStorage; provide both so the
    // store rehydrates from our in-memory mock in the Node test environment.
    const mock = new LocalStorageMock() as unknown as Storage;
    (globalThis as { localStorage?: Storage }).localStorage = mock;
    (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: mock };

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    vi.resetModules();
    const first = await import('../settingsStore');
    await tick(); // let the initial (empty) rehydration settle
    const custom = { ok: 0.2, inaccuracy: 0.7, mistake: 3 };
    first.useSettingsStore.getState().setThresholds(custom);
    first.useSettingsStore.getState().setTableSize(4);

    // Simulate a restart: a fresh module instance rehydrates from localStorage.
    // zustand's persist rehydrates asynchronously, so wait a tick before reading.
    vi.resetModules();
    const second = await import('../settingsStore');
    await tick();
    expect(second.useSettingsStore.getState().thresholds).toEqual(custom);
    expect(second.useSettingsStore.getState().tableSize).toBe(4);
  });
});
