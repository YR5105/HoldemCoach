import type { Card, GameState } from '../engine/types';

/**
 * Worker protocol per spec §5, with one addition: instead of pre-expanded
 * `villainRanges`, the caller may send the serialized `state` + `villainSeats`
 * and let the worker reconstruct each bot's node range itself. Spec §4
 * requires the reconstruction to run in the worker ("the equity worker
 * reconstructs this the same way — same code path"), and it keeps the
 * ~35ms/villain/street of range filtering off the UI thread.
 */
export interface EquityRequest {
  type: 'EQUITY_REQ';
  id: number;
  heroCards: [Card, Card];
  board: Card[];
  /** Pre-expanded combo lists, one per live villain (direct/test use). */
  villainRanges?: [Card, Card][][];
  /** Alternative input: worker reconstructs node ranges for these seats. */
  state?: GameState;
  villainSeats?: number[];
  /** Seat -> bot personality; reconstruction defaults any missing seat to TAG. */
  personalities?: Record<number, import('../coach/personalities').Personality>;
  deadCards: Card[];
  seed: string;
}

export interface EquityResponse {
  type: 'EQUITY_RES';
  id: number;
  equity: number;
  ci95: number;
}

export interface EquityError {
  type: 'EQUITY_ERR';
  id: number;
  message: string;
}

/** Grade one hero decision (spec §6). Grading runs in the worker only. */
export interface GradeRequest {
  type: 'GRADE_REQ';
  id: number;
  /** Game state as it was BEFORE the hero acted. */
  preActionState: GameState;
  heroSeat: number;
  chosenAction: { seat: number; type: string; amount?: number };
  /** Severity thresholds from settings (spec §6.4 `grading.thresholds`). */
  thresholds?: import('../coach/graderTypes').GradingThresholds;
  /** Seat -> bot personality for villain range reconstruction and FE params. */
  personalities?: Record<number, import('../coach/personalities').Personality>;
}

export interface GradeResponse {
  type: 'GRADE_RES';
  id: number;
  grade: import('../coach/graderTypes').GradeResult;
}

export type EquityWorkerRequest = EquityRequest | GradeRequest;
export type EquityWorkerMessage = EquityResponse | EquityError | GradeResponse;
