import seedrandom from 'seedrandom';
import type { Evaluator } from '../evaluator/Evaluator';
import { orderedDeck } from '../engine/deck';
import type { Card } from '../engine/types';

export interface EquityRequestInput {
  heroCards: [Card, Card];
  board: Card[];
  /** One combo list per live villain (already dead-card-filtered vs hero/board). */
  villainCombos: [Card, Card][][];
  deadCards?: Card[];
  /** Spec §5: 1,000 run-outs (±2%). Never exceed 5,000. */
  iterations?: number;
  seed?: string;
}

export interface EquityResult {
  /** Hero's pot share: wins + tie fractions, over successful iterations. */
  equity: number;
  /** Half-width of the 95% confidence interval. */
  ci95: number;
  iterations: number;
}

const MAX_ITERATIONS = 5000;
const MAX_SAMPLE_RETRIES = 30;

/**
 * Monte Carlo equity: sample each villain a combo from their range, deal the
 * remaining board, evaluate everyone with the Evaluator, tally hero's share.
 * Deterministic for a given seed. Pure — safe to run in the worker (and only
 * ever called from the worker or tests; the UI thread never simulates).
 */
export function simulateEquity(input: EquityRequestInput, evaluator: Evaluator): EquityResult {
  const iterations = Math.min(input.iterations ?? 1000, MAX_ITERATIONS);
  const rng = seedrandom(input.seed ?? 'equity');
  const { heroCards, board, villainCombos } = input;

  if (board.length > 5) throw new Error(`board has ${board.length} cards`);
  if (villainCombos.length === 0) throw new Error('need at least one villain range');
  if (villainCombos.some((combos) => combos.length === 0)) {
    throw new Error('a villain range is empty after dead-card filtering');
  }

  const knownDead = new Set<Card>([...heroCards, ...board, ...(input.deadCards ?? [])]);
  const stub = orderedDeck().filter((c) => !knownDead.has(c));
  const cardsToCome = 5 - board.length;

  let heroShare = 0;
  let completed = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Sample one combo per villain without card collisions (rejection sampling).
    const taken = new Set<Card>();
    const sampled: [Card, Card][] = [];
    let failed = false;
    for (const combos of villainCombos) {
      let choice: [Card, Card] | null = null;
      for (let attempt = 0; attempt < MAX_SAMPLE_RETRIES; attempt++) {
        const candidate = combos[Math.floor(rng() * combos.length)]!;
        if (!taken.has(candidate[0]) && !taken.has(candidate[1])) {
          choice = candidate;
          break;
        }
      }
      if (!choice) {
        failed = true;
        break;
      }
      taken.add(choice[0]);
      taken.add(choice[1]);
      sampled.push(choice);
    }
    if (failed) continue;

    // Deal the remaining streets from the stub, skipping sampled villain cards.
    const runout: Card[] = [];
    if (cardsToCome > 0) {
      const available = stub.filter((c) => !taken.has(c));
      // Partial Fisher-Yates: draw `cardsToCome` distinct cards.
      for (let k = 0; k < cardsToCome; k++) {
        const idx = k + Math.floor(rng() * (available.length - k));
        const tmp = available[k]!;
        available[k] = available[idx]!;
        available[idx] = tmp;
        runout.push(available[k]!);
      }
    }

    const fullBoard = [...board, ...runout];
    const heroResult = evaluator.evaluate([...heroCards, ...fullBoard]);
    const villainResults = sampled.map((combo) => evaluator.evaluate([...combo, ...fullBoard]));
    const winners = evaluator.winners([heroResult, ...villainResults]);

    if (winners.includes(heroResult)) {
      heroShare += 1 / winners.length;
    }
    completed++;
  }

  const equity = completed > 0 ? heroShare / completed : 0;
  const ci95 = completed > 0 ? 1.96 * Math.sqrt((equity * (1 - equity)) / completed) : 1;

  return { equity, ci95, iterations: completed };
}
