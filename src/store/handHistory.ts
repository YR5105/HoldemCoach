import { openDB, type IDBPDatabase } from 'idb';
import type { GradeResult } from '../coach/graderTypes';
import type { Card, GameState } from '../engine/types';

/** Coach annotation stored on a graded hero action (spec §8 schema). */
export interface CoachAnnotation {
  equity: number;
  best: string;
  bestSize?: number;
  evLoss: number;
  severity: string;
  reasonKey: string;
  message: string;
  category: string;
}

export interface HandDoc {
  id: string;
  ts: number;
  seed: string;
  config: {
    players: number;
    blinds: [number, number];
    heroSeat: number;
    bots: string[];
    /** Needed (with seed) to reconstruct the hand for the replayer. */
    buttonSeat: number;
    startingStack: number;
    /** Per-seat chips at the start of THIS hand (continuous-match reconstruction). */
    startingStacks?: number[];
  };
  holeCards: Record<number, Card[]>;
  board: Card[];
  actions: {
    seat: number;
    street: string;
    action: string;
    amount: number;
    hero: boolean;
    coach?: CoachAnnotation;
  }[];
  result: {
    winners: number[];
    potAwarded: { seat: number; amount: number }[];
    showdown: boolean;
  };
}

const DB_NAME = 'holdemcoach';
const STORE = 'hands';
const GUESS_STORE = 'guesses';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('ts', 'ts');
      }
      if (oldVersion < 2) {
        const guesses = database.createObjectStore(GUESS_STORE, { keyPath: 'id' });
        guesses.createIndex('ts', 'ts');
      }
    },
  });
  return dbPromise;
}

/** One "guess first" equity estimate (spec §7 Q2): user's guess vs the real number. */
export interface GuessDoc {
  id: string;
  ts: number;
  guess: number;
  actual: number;
  /** |guess − actual|, in equity points (0-1). */
  error: number;
}

export async function saveGuess(guess: number, actual: number): Promise<void> {
  const doc: GuessDoc = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    guess,
    actual,
    error: Math.abs(guess - actual),
  };
  await (await db()).put(GUESS_STORE, doc);
}

export async function listGuesses(): Promise<GuessDoc[]> {
  return (await (await db()).getAllFromIndex(GUESS_STORE, 'ts')) as GuessDoc[];
}

export function toCoachAnnotation(grade: GradeResult): CoachAnnotation {
  return {
    equity: grade.equity,
    best: grade.best.action,
    bestSize: grade.best.amount,
    evLoss: grade.evLossBb,
    severity: grade.severity,
    reasonKey: grade.reasonKey,
    message: grade.message,
    category: grade.category,
  };
}

/**
 * Builds the §8 hand document from a finished hand. `gradesByActionIndex`
 * maps actionLog indices of hero decisions to their coach annotations.
 */
export function buildHandDoc(
  state: GameState,
  heroSeat: number,
  gradesByActionIndex: Map<number, CoachAnnotation>,
  personalities: Record<number, string> = {},
  startingStacks?: number[],
): HandDoc {
  const showdown = (state.payout?.showdownHands ?? undefined) !== undefined;
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    seed: state.seed,
    config: {
      players: state.config.players,
      blinds: state.config.blinds,
      heroSeat,
      bots: state.seats
        .filter((s) => s.seatIndex !== heroSeat)
        .map((s) => personalities[s.seatIndex] ?? 'TAG'),
      buttonSeat: state.buttonSeat,
      startingStack: state.config.startingStack,
      startingStacks,
    },
    holeCards: Object.fromEntries(
      state.seats.filter((s) => s.holeCards).map((s) => [s.seatIndex, s.holeCards!]),
    ),
    board: [...state.board],
    actions: state.actionLog.map((entry, i) => ({
      seat: entry.seat,
      street: entry.street,
      action: entry.action,
      amount: entry.amount,
      hero: entry.seat === heroSeat,
      ...(gradesByActionIndex.has(i) ? { coach: gradesByActionIndex.get(i)! } : {}),
    })),
    result: {
      winners: state.payout?.winners.map((w) => w.seat) ?? [],
      potAwarded: state.payout?.winners.map((w) => ({ seat: w.seat, amount: w.amount })) ?? [],
      showdown,
    },
  };
}

export async function saveHand(doc: HandDoc): Promise<void> {
  await (await db()).put(STORE, doc);
}

export async function listHands(limit = 100): Promise<HandDoc[]> {
  const database = await db();
  const all = await database.getAllFromIndex(STORE, 'ts');
  return all.reverse().slice(0, limit) as HandDoc[];
}
