import type { DecisionCategory } from '../coach/graderTypes';
import type { GuessDoc, HandDoc } from './handHistory';

export const CATEGORIES: DecisionCategory[] = ['preflop', 'cbet', 'facing_bet', 'bluff', 'sizing'];

export interface CategoryStat {
  category: DecisionCategory;
  decisions: number;
  mistakes: number; // severity worse than OK
  evLoss: number; // total bb lost
}

export interface LeakSummary extends CategoryStat {
  /** Most common non-OK reason message in this category, for the top-3 leak list. */
  exampleMessage: string;
}

export interface WindowPoint {
  /** First hand index (0-based) of this window. */
  startHand: number;
  hands: number;
  evLossPer100: number;
}

/**
 * Behavioral pattern metrics (spec §6 R7). All derived only from annotations
 * that carry `heroBucket`; older records without it are skipped.
 */
export interface PatternStats {
  /** Facing a bet while on a flush/straight draw. */
  chaseSpots: number;
  /** …of those, how many were non-OK (paid a bad price). */
  chaseLeaks: number;
  /** chaseLeaks / chaseSpots (0 when no spots). */
  chaseRate: number;
  /** Decisions holding a strong made hand (MONSTER/STRONG). */
  madeSpots: number;
  /** …fraction where hero bet or raised. */
  aggMadeRate: number;
  /** Decisions holding a draw. */
  drawSpots: number;
  /** …fraction where hero bet or raised. */
  aggDrawRate: number;
  /** aggMadeRate − aggDrawRate: how differently hero plays made hands vs draws. */
  readabilityGap: number;
}

export interface Stats {
  handsPlayed: number;
  decisions: number;
  totalEvLoss: number;
  evLossPer100: number;
  categories: CategoryStat[];
  topLeaks: LeakSummary[];
  windows: WindowPoint[];
  guessCount: number;
  /** Mean absolute guess error in equity points (0-100 scale). */
  guessMeanErrorPct: number | null;
  patterns: PatternStats;
}

const WINDOW_SIZE = 250;

interface GradedAction {
  category: DecisionCategory;
  severity: string;
  evLoss: number;
  message: string;
  /** Hero's actual action type (for readability/aggression). */
  action: string;
  /** Hand-strength bucket, or undefined on pre-R7 records (must be skipped). */
  heroBucket?: string;
}

function gradedActions(doc: HandDoc): GradedAction[] {
  return doc.actions
    .filter((a) => a.hero && a.coach)
    .map((a) => ({
      category: (a.coach!.category as DecisionCategory) ?? 'preflop',
      severity: a.coach!.severity,
      evLoss: a.coach!.evLoss,
      message: a.coach!.message,
      action: a.action,
      heroBucket: a.coach!.heroBucket,
    }));
}

/**
 * Draw-chasing and readability patterns (spec §6 R7). Only annotations that
 * carry `heroBucket` contribute — pre-R7 records are silently skipped.
 */
function computePatterns(actions: GradedAction[]): PatternStats {
  const isAggressive = (a: GradedAction) => a.action === 'bet' || a.action === 'raise';

  const chase = actions.filter((a) => a.heroBucket === 'DRAW' && a.category === 'facing_bet');
  const chaseSpots = chase.length;
  const chaseLeaks = chase.filter((a) => a.severity !== 'OK').length;

  const made = actions.filter((a) => a.heroBucket === 'MONSTER' || a.heroBucket === 'STRONG');
  const draws = actions.filter((a) => a.heroBucket === 'DRAW');
  const aggMadeRate = made.length > 0 ? made.filter(isAggressive).length / made.length : 0;
  const aggDrawRate = draws.length > 0 ? draws.filter(isAggressive).length / draws.length : 0;

  return {
    chaseSpots,
    chaseLeaks,
    chaseRate: chaseSpots > 0 ? chaseLeaks / chaseSpots : 0,
    madeSpots: made.length,
    aggMadeRate,
    drawSpots: draws.length,
    aggDrawRate,
    readabilityGap: aggMadeRate - aggDrawRate,
  };
}

/** Aggregates dashboard stats from hand history docs (oldest-first order expected). */
export function computeStats(docs: HandDoc[], guesses: GuessDoc[]): Stats {
  const byCategory = new Map<DecisionCategory, CategoryStat & { messages: Map<string, number> }>(
    CATEGORIES.map((c) => [c, { category: c, decisions: 0, mistakes: 0, evLoss: 0, messages: new Map() }]),
  );

  let decisions = 0;
  let totalEvLoss = 0;
  const perHandLoss: number[] = [];
  const allActions: GradedAction[] = [];

  for (const doc of docs) {
    let handLoss = 0;
    const acts = gradedActions(doc);
    allActions.push(...acts);
    for (const action of acts) {
      decisions++;
      totalEvLoss += action.evLoss;
      handLoss += action.evLoss;
      const cat = byCategory.get(action.category) ?? byCategory.get('preflop')!;
      cat.decisions++;
      if (action.severity !== 'OK') {
        cat.mistakes++;
        cat.evLoss += action.evLoss;
        cat.messages.set(action.message, (cat.messages.get(action.message) ?? 0) + 1);
      }
    }
    perHandLoss.push(handLoss);
  }

  const windows: WindowPoint[] = [];
  for (let start = 0; start < perHandLoss.length; start += WINDOW_SIZE) {
    const slice = perHandLoss.slice(start, start + WINDOW_SIZE);
    const loss = slice.reduce((sum, x) => sum + x, 0);
    windows.push({
      startHand: start,
      hands: slice.length,
      evLossPer100: slice.length > 0 ? (loss / slice.length) * 100 : 0,
    });
  }

  const categories: CategoryStat[] = [...byCategory.values()].map(({ messages: _m, ...stat }) => stat);

  const topLeaks: LeakSummary[] = [...byCategory.values()]
    .filter((c) => c.mistakes > 0)
    .sort((a, b) => b.evLoss - a.evLoss)
    .slice(0, 3)
    .map((c) => {
      const [exampleMessage] = [...c.messages.entries()].sort((a, b) => b[1] - a[1])[0] ?? [''];
      const { messages: _m, ...stat } = c;
      return { ...stat, exampleMessage };
    });

  const guessMeanErrorPct =
    guesses.length > 0
      ? (guesses.reduce((sum, g) => sum + g.error, 0) / guesses.length) * 100
      : null;

  return {
    handsPlayed: docs.length,
    decisions,
    totalEvLoss,
    evLossPer100: docs.length > 0 ? (totalEvLoss / docs.length) * 100 : 0,
    categories,
    topLeaks,
    windows,
    guessCount: guesses.length,
    guessMeanErrorPct,
    patterns: computePatterns(allActions),
  };
}
