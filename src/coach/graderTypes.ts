import type { ActionType } from '../engine/types';

export type Severity = 'OK' | 'INACCURACY' | 'MISTAKE' | 'BLUNDER';

export type ReasonKey =
  | 'pot_odds'
  | 'missed_value'
  | 'missed_bluff'
  | 'semi_bluff'
  | 'pot_control'
  | 'bet_sizing'
  | 'exploit_station'
  | 'exploit_nit'
  | 'oop_discipline'
  | 'preflop_chart';

export type HeroBucket = 'MONSTER' | 'STRONG' | 'MARGINAL' | 'DRAW' | 'AIR';

/** Leak categories for stats aggregation (spec §8). */
export type DecisionCategory = 'preflop' | 'cbet' | 'facing_bet' | 'bluff' | 'sizing';

export interface ActionEV {
  action: ActionType;
  /** To-amount for bet/raise candidates (chips committed this street after acting). */
  amount?: number;
  /** EV in big blinds relative to folding now (EV(fold) = 0). */
  evBb: number;
}

export interface GradeResult {
  /** All candidates evaluated, sorted best-first. */
  candidates: ActionEV[];
  chosen: ActionEV;
  best: ActionEV;
  /** EV(best) − EV(chosen), in bb. Never negative. */
  evLossBb: number;
  severity: Severity;
  reasonKey: ReasonKey;
  /**
   * "{BetterAction} was the better play. {Reason} That cost you about {Δ} big
   * blinds." — plain English (no poker slang or abbreviations), ≤260 chars.
   */
  message: string;
  /** Glossary term the reason links to. */
  glossary: string;
  /** Hero equity vs villain node ranges at this decision. */
  equity: number;
  heroBucket: HeroBucket;
  street: string;
  /** Leak category this decision counts toward on the dashboard. */
  category: DecisionCategory;
}

export interface GradingThresholds {
  ok: number;
  inaccuracy: number;
  mistake: number;
}

/** Default severity thresholds in bb (spec §6.4, config `grading.thresholds`). */
export const GRADING_THRESHOLDS: GradingThresholds = {
  ok: 0.1,
  inaccuracy: 0.5,
  mistake: 2,
};

export function severityForEvLoss(
  evLossBb: number,
  thresholds: GradingThresholds = GRADING_THRESHOLDS,
): Severity {
  if (evLossBb < thresholds.ok) return 'OK';
  if (evLossBb <= thresholds.inaccuracy) return 'INACCURACY';
  if (evLossBb <= thresholds.mistake) return 'MISTAKE';
  return 'BLUNDER';
}
