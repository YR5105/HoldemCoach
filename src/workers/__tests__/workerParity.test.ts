import { beforeAll, describe, expect, it } from 'vitest';
import { applyAction } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Action, Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { decideBotAction } from '../../bots/botPolicy';
import { gradeDecision, isGradableDecision } from '../../coach/grader';
import { simulateEquity } from '../../equity/monteCarlo';
import { expandRange } from '../../equity/combos';
import type { EquityRequest, EquityWorkerMessage, GradeRequest } from '../equityProtocol';

const evaluator = new PokersolverEvaluator();

// The worker module assigns self.onmessage at import and calls self.postMessage
// when handling a message. Provide a mock self, then import the worker and
// drive its real dispatch logic directly (no real Worker).
let posted: EquityWorkerMessage[] = [];
let dispatch: (data: unknown) => EquityWorkerMessage[];

beforeAll(async () => {
  (globalThis as { self?: unknown }).self = {
    postMessage: (m: EquityWorkerMessage) => posted.push(m),
    onmessage: null as unknown,
  };
  await import('../equity.worker');
  const onmessage = (globalThis as unknown as { self: { onmessage: (e: { data: unknown }) => void } }).self
    .onmessage;
  dispatch = (data: unknown) => {
    posted = [];
    onmessage({ data });
    return posted;
  };
});

// ---------------------------------------------------------------------------
// Scenario builders.
// ---------------------------------------------------------------------------

function equityScenarios(): EquityRequest[] {
  const specs: { hero: [Card, Card]; ranges: string[][]; board: Card[] }[] = [
    { hero: ['Ah', 'Ad'], ranges: [['KK']], board: [] },
    { hero: ['Qh', 'Qd'], ranges: [['AKs', 'AKo']], board: [] },
    { hero: ['Ah', 'Kh'], ranges: [['QQ'], ['JJ']], board: [] },
    { hero: ['Jh', '6h'], ranges: [['AK', 'KQ']], board: ['Ah', '8h', '3c'] },
    { hero: ['9h', '8c'], ranges: [['KK', 'AA']], board: ['7d', '6s', '2c', 'Kh'] },
  ];
  return specs.map((s, i) => ({
    type: 'EQUITY_REQ',
    id: i + 1,
    heroCards: s.hero,
    board: s.board,
    villainRanges: s.ranges.map((r) => expandRange(r, [...s.hero, ...s.board])),
    deadCards: [],
    seed: `parity-eq-${i}`,
  }));
}

/** Collect gradable hero decisions from seeded bot playouts (varied streets). */
function gradeScenarios(count: number): GradeRequest[] {
  const reqs: GradeRequest[] = [];
  let seedN = 0;
  while (reqs.length < count) {
    let s = startHand(createInitialState({ players: 3, blinds: [1, 2], startingStack: 200 }, `parity-${seedN++}`, 0));
    let guard = 0;
    while (s.payout === null && s.actionOn >= 0 && guard++ < 200) {
      const seat = s.actionOn;
      const action = decideBotAction(s, seat, 'TAG', evaluator);
      if (isGradableDecision(s, seat) && reqs.length < count) {
        reqs.push({
          type: 'GRADE_REQ',
          id: 1000 + reqs.length,
          preActionState: structuredClone(s),
          heroSeat: seat,
          chosenAction: { seat, type: action.type, amount: action.amount },
        });
      }
      s = applyAction(s, action, evaluator);
    }
    if (seedN > 60) break;
  }
  return reqs;
}

// ---------------------------------------------------------------------------
// 1. Worker path == direct call, for the same seeded inputs.
// ---------------------------------------------------------------------------

describe('worker parity — identical numbers in, identical results out', () => {
  it('EQUITY_REQ matches simulateEquity directly', () => {
    for (const req of equityScenarios()) {
      const [res] = dispatch(req);
      expect(res!.type).toBe('EQUITY_RES');

      const direct = simulateEquity(
        {
          heroCards: req.heroCards,
          board: req.board,
          villainCombos: req.villainRanges!,
          deadCards: req.deadCards,
          iterations: 1000,
          seed: req.seed,
        },
        evaluator,
      );
      expect(res).toEqual({ type: 'EQUITY_RES', id: req.id, equity: direct.equity, ci95: direct.ci95 });
    }
  });

  it('GRADE_REQ matches gradeDecision directly (full GradeResult)', () => {
    const scenarios = gradeScenarios(10);
    expect(scenarios.length).toBe(10);
    for (const req of scenarios) {
      const [res] = dispatch(req);
      expect(res!.type).toBe('GRADE_RES');

      const direct = gradeDecision(
        req.preActionState,
        req.heroSeat,
        req.chosenAction as Action,
        evaluator,
      );
      expect((res as { grade: unknown }).grade).toEqual(direct);
    }
  }, 20000);
});

// ---------------------------------------------------------------------------
// 2. Malformed / unhandled messages never throw.
// ---------------------------------------------------------------------------

describe('worker robustness — malformed messages are ignored or rejected', () => {
  it('ignores an unknown message type (no response, no throw)', () => {
    expect(() => {
      const out = dispatch({ type: 'NONSENSE', id: 7 });
      expect(out).toEqual([]); // nothing posted
    }).not.toThrow();
  });

  it('rejects a malformed EQUITY_REQ with EQUITY_ERR instead of throwing', () => {
    // Missing both villainRanges and state+villainSeats.
    const out = dispatch({ type: 'EQUITY_REQ', id: 9, heroCards: ['Ah', 'Ad'], board: [], deadCards: [], seed: 'x' });
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('EQUITY_ERR');
    expect((out[0] as { id: number }).id).toBe(9);
  });

  it('does not throw on null/garbage payloads', () => {
    expect(() => dispatch(undefined)).not.toThrow();
    expect(() => dispatch(null)).not.toThrow();
    expect(() => dispatch(42)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Worst-case grade latency baseline.
// ---------------------------------------------------------------------------

describe('worker latency baseline', () => {
  it('a worst-case multiway river grade stays under 2 seconds', () => {
    const state = worstCaseRiverState();
    const req: GradeRequest = {
      type: 'GRADE_REQ',
      id: 5000,
      preActionState: state,
      heroSeat: 0,
      chosenAction: { seat: 0, type: 'bet', amount: 20 },
    };

    const t0 = performance.now();
    const [res] = dispatch(req);
    const ms = performance.now() - t0;
    console.info(`[worker latency] worst-case multiway river grade: ${ms.toFixed(0)}ms`);

    expect(res!.type).toBe('GRADE_RES');
    expect(ms).toBeLessThan(2000);
  }, 10000);
});

/** River, 4-handed, three live villains, hero first to act and able to bet. */
function worstCaseRiverState(): GameState {
  const seat = (seatIndex: number, holeCards: Card[], hasActed: boolean) => ({
    seatIndex,
    stack: 160,
    folded: false,
    allIn: false,
    committedThisStreet: 0,
    committedTotal: 40,
    hasActed,
    raiseCapped: false,
    sittingOut: false,
    holeCards,
  });
  return {
    seed: 'parity-worstcase',
    config: { players: 4, blinds: [1, 2], startingStack: 200 },
    street: 'RIVER',
    seats: [
      seat(0, ['Ah', 'Kd'], false),
      seat(1, ['Qc', 'Jd'], true),
      seat(2, ['Ts', '9s'], true),
      seat(3, ['7h', '6h'], true),
    ],
    board: ['Ac', 'Kh', '5d', '2c', '9h'],
    deck: [],
    currentBet: 0,
    minRaise: 2,
    actionOn: 0,
    lastAggressor: null,
    buttonSeat: 3,
    actionLog: [{ seat: 3, street: 'RIVER', action: 'check', amount: 0 }],
    payout: null,
    rngCounter: 0,
  };
}
