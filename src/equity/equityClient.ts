import type { GradeResult, GradingThresholds } from '../coach/graderTypes';
import type { Personality } from '../coach/personalities';
import type { Action, Card, GameState } from '../engine/types';
import type { EquityRequest, EquityWorkerMessage, GradeRequest } from '../workers/equityProtocol';

export interface EquitySnapshot {
  equity: number;
  ci95: number;
}

type Listener = (snapshot: EquitySnapshot) => void;
type GradeListener = (grade: GradeResult, requestId: number) => void;

/**
 * Thin wrapper around the equity worker: fires requests with increasing ids
 * and only ever delivers equity responses for the *latest* request, so stale
 * results from superseded game states are dropped. Grade responses are all
 * delivered (each grades a distinct past decision). All coach computation
 * (range reconstruction, Monte Carlo, grading) happens inside the worker;
 * this file only passes messages (hard invariant #5).
 */
export class EquityClient {
  private worker: Worker;
  private nextId = 1;
  private latestEquityId = 0;
  private listener: Listener | null = null;
  private gradeListener: GradeListener | null = null;

  constructor() {
    this.worker = new Worker(new URL('../workers/equity.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<EquityWorkerMessage>) => {
      const msg = event.data;
      if (msg.type === 'EQUITY_RES') {
        if (msg.id !== this.latestEquityId) return; // stale
        this.listener?.({ equity: msg.equity, ci95: msg.ci95 });
      } else if (msg.type === 'GRADE_RES') {
        this.gradeListener?.(msg.grade, msg.id);
      } else if (msg.type === 'EQUITY_ERR') {
        console.error('equity worker error:', msg.message);
      }
    };
  }

  onResult(listener: Listener) {
    this.listener = listener;
  }

  onGrade(listener: GradeListener) {
    this.gradeListener = listener;
  }

  /** Asks the worker to grade a hero decision; returns the request id for correlation. */
  requestGrade(
    preActionState: GameState,
    heroSeat: number,
    chosenAction: Action,
    thresholds?: GradingThresholds,
    personalities?: Record<number, Personality>,
  ): number {
    const id = this.nextId++;
    const req: GradeRequest = {
      type: 'GRADE_REQ',
      id,
      preActionState,
      heroSeat,
      chosenAction,
      thresholds,
      personalities,
    };
    this.worker.postMessage(req);
    return id;
  }

  /** Requests hero equity vs the given bot seats' reconstructed node ranges. */
  requestForState(
    state: GameState,
    heroSeat: number,
    villainSeats: number[],
    personalities?: Record<number, Personality>,
  ) {
    const heroCards = state.seats[heroSeat]!.holeCards as [Card, Card];
    const id = this.nextId++;
    this.latestEquityId = id;
    const req: EquityRequest = {
      type: 'EQUITY_REQ',
      id,
      heroCards,
      board: [...state.board],
      state,
      villainSeats,
      personalities,
      deadCards: [],
      seed: `${state.seed}:eq:${state.actionLog.length}`,
    };
    this.worker.postMessage(req);
  }

  dispose() {
    this.worker.terminate();
  }
}
