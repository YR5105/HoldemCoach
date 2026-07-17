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
}

const WINDOW_SIZE = 250;

interface GradedAction {
  category: DecisionCategory;
  severity: string;
  evLoss: number;
  message: string;
}

function gradedActions(doc: HandDoc): GradedAction[] {
  return doc.actions
    .filter((a) => a.hero && a.coach)
    .map((a) => ({
      category: (a.coach!.category as DecisionCategory) ?? 'preflop',
      severity: a.coach!.severity,
      evLoss: a.coach!.evLoss,
      message: a.coach!.message,
    }));
}

/** Aggregates dashboard stats from hand history docs (oldest-first order expected). */
export function computeStats(docs: HandDoc[], guesses: GuessDoc[]): Stats {
  const byCategory = new Map<DecisionCategory, CategoryStat & { messages: Map<string, number> }>(
    CATEGORIES.map((c) => [c, { category: c, decisions: 0, mistakes: 0, evLoss: 0, messages: new Map() }]),
  );

  let decisions = 0;
  let totalEvLoss = 0;
  const perHandLoss: number[] = [];

  for (const doc of docs) {
    let handLoss = 0;
    for (const action of gradedActions(doc)) {
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
  };
}
