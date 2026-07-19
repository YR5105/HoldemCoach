import { create } from 'zustand';
import { decideBotAction, type Personality } from '../bots/botPolicy';
import { isGradableDecision } from '../coach/grader';
import type { GradeResult } from '../coach/graderTypes';
import { applyAction, createInitialState, nextButtonSeat, startHand } from '../engine';
import type { Action, GameConfig, GameState } from '../engine/types';
import { EquityClient, type EquitySnapshot } from '../equity/equityClient';
import { buildHandDoc, saveGuess, saveHand, toCoachAnnotation, type CoachAnnotation } from './handHistory';
import { useSettingsStore } from './settingsStore';

export const HERO_SEAT = 0;
// Pacing between bot actions. The `?fastbots` URL flag collapses it for
// end-to-end tests so a full match plays out in seconds; normal play is 500ms.
const BOT_DELAY_MS =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fastbots')
    ? 20
    : 500;
/** Every Nth hero decision becomes a "guess first" prompt (spec §7 Q2). */
export const GUESS_EVERY = 25;
const DECISION_COUNT_KEY = 'holdemcoach-decision-count';

function currentConfig(): GameConfig {
  const players =
    typeof localStorage !== 'undefined' ? useSettingsStore.getState().tableSize : 6;
  return { players, blinds: [1, 2], startingStack: 200 };
}

/** Seat -> personality for every non-hero seat, from the settings lineup. */
function currentPersonalities(players: number): Record<number, Personality> {
  const lineup =
    typeof localStorage !== 'undefined' ? useSettingsStore.getState().botLineup : [];
  const map: Record<number, Personality> = {};
  for (let seat = 1; seat < players; seat++) {
    map[seat] = lineup[seat - 1] ?? 'TAG';
  }
  return map;
}

/**
 * Identifies a match's table shape (size + lineup). When the user changes
 * either mid-match, the running match ends and a fresh one begins.
 */
function matchSignature(): string {
  if (typeof localStorage === 'undefined') return '6';
  const { tableSize, botLineup } = useSettingsStore.getState();
  return `${tableSize}:${botLineup.slice(0, tableSize - 1).join(',')}`;
}

function loadDecisionCount(): number {
  if (typeof localStorage === 'undefined') return 0;
  return Number(localStorage.getItem(DECISION_COUNT_KEY) ?? '0') || 0;
}

export interface PotOdds {
  toCall: number;
  pot: number;
  /** Break-even equity: toCall / (pot + toCall). */
  required: number;
}

export function computePotOdds(state: GameState, heroSeat: number): PotOdds {
  const hero = state.seats[heroSeat]!;
  const toCall = Math.max(0, Math.min(state.currentBet - hero.committedThisStreet, hero.stack));
  const pot = state.seats.reduce((sum, s) => sum + s.committedTotal, 0);
  const required = toCall > 0 ? toCall / (pot + toCall) : 0;
  return { toCall, pot, required };
}

/** One graded hero decision within the current hand. */
export interface FeedbackItem {
  grade: GradeResult;
  actionIndex: number;
  /** Set when the user has opened/acknowledged this item. */
  seen: boolean;
}

export interface MatchOutcome {
  /** True once the match has been decided (only meaningful at PAYOUT). */
  over: boolean;
  won: boolean;
  heroStack: number;
  /** Players still holding chips. */
  survivors: number;
}

/**
 * Whether the current match is decided. The match ends when hero busts (loss)
 * or hero is the last player with chips (win). Only conclusive at PAYOUT.
 */
export function matchOutcome(state: GameState, heroSeat: number): MatchOutcome {
  const heroStack = state.seats[heroSeat]?.stack ?? 0;
  const survivors = state.seats.filter((s) => s.stack > 0).length;
  const over = state.street === 'PAYOUT' && (heroStack === 0 || survivors <= 1);
  return { over, won: survivors <= 1 && heroStack > 0, heroStack, survivors };
}

interface GameStore {
  state: GameState;
  heroSeat: number;
  handNumber: number;
  /** Seat -> bot personality, frozen for the whole match. */
  personalities: Record<number, Personality>;
  equity: EquitySnapshot | null;
  /** Graded decisions for the current hand, in order. */
  feedback: FeedbackItem[];
  /** Index into `feedback` of the card currently open (instant/subtle click), or null. */
  openFeedbackIndex: number | null;
  /** Lifetime count of graded hero decisions (drives the every-25th guess prompt). */
  decisionCount: number;
  /** Result of the last submitted guess, shown after reveal. */
  lastGuess: { guessPct: number; actualPct: number } | null;
  /** actionLog length at which the current guess prompt was satisfied. */
  guessSatisfiedAt: number | null;
  init: () => void;
  /** Deal the next hand of the current match (or end it / start fresh as needed). */
  newHand: () => void;
  /** Abandon the current match and start a brand-new table with full stacks. */
  startNewGame: () => void;
  heroAction: (action: Omit<Action, 'seat'>) => void;
  openFeedback: (index: number | null) => void;
  submitGuess: (guessPct: number) => void;
}

export const useGameStore = create<GameStore>((set, get) => {
  const equityClient = typeof Worker !== 'undefined' ? new EquityClient() : null;
  equityClient?.onResult((snapshot) => set({ equity: snapshot }));

  // Grade-request id -> actionLog index of the graded hero action.
  const gradeIndexByRequest = new Map<number, number>();
  // Persisted annotations for the current hand, keyed by actionLog index.
  let handAnnotations = new Map<number, CoachAnnotation>();
  let pendingGrades = 0;
  let handSaved = false;
  // Chips each seat started the current hand with (for replay reconstruction).
  let handStartStacks: number[] = [];
  // Table shape of the running match; a change means "start a fresh match".
  let matchSig = matchSignature();

  equityClient?.onGrade((grade, requestId) => {
    const actionIndex = gradeIndexByRequest.get(requestId);
    gradeIndexByRequest.delete(requestId);
    pendingGrades--;
    if (actionIndex === undefined) return;
    handAnnotations.set(actionIndex, toCoachAnnotation(grade));
    set((prev) => ({ feedback: [...prev.feedback, { grade, actionIndex, seen: false }] }));
    maybePersistHand();
  });

  function maybePersistHand() {
    const { state, heroSeat, personalities } = get();
    if (state.street !== 'PAYOUT' || pendingGrades > 0 || handSaved) return;
    handSaved = true;
    void saveHand(buildHandDoc(state, heroSeat, handAnnotations, personalities, handStartStacks)).catch(
      (err) => console.error('failed to save hand history:', err),
    );
  }

  function requestEquity() {
    const { state, heroSeat, personalities } = get();
    set({ equity: null });
    if (!equityClient) return;
    const hero = state.seats[heroSeat]!;
    if (hero.folded || !hero.holeCards || state.street === 'PAYOUT') return;
    // Only seats actually dealt into this hand are villains (excludes
    // eliminated seats sitting out).
    const villainSeats = state.seats
      .filter((s) => s.seatIndex !== heroSeat && !s.folded && s.holeCards)
      .map((s) => s.seatIndex);
    if (villainSeats.length === 0) return;
    equityClient.requestForState(state, heroSeat, villainSeats, personalities);
  }

  function applyAndRefresh(state: GameState, action: Action) {
    set({ state: applyAction(state, action) });
    requestEquity();
    maybePersistHand();
  }

  function scheduleBotIfNeeded() {
    const { state, heroSeat } = get();
    if (state.street === 'PAYOUT' || state.actionOn === heroSeat || state.actionOn === -1) return;
    setTimeout(() => {
      const { state: current, heroSeat: hs, personalities } = get();
      if (current.street === 'PAYOUT' || current.actionOn === hs || current.actionOn === -1) return;
      const action = decideBotAction(current, current.actionOn, personalities[current.actionOn] ?? 'TAG');
      applyAndRefresh(current, action);
      scheduleBotIfNeeded();
    }, BOT_DELAY_MS);
  }

  /** Resets per-hand bookkeeping and commits a freshly dealt hand to the store. */
  function commitHand(
    state: GameState,
    handNumber: number,
    startStacks: number[],
    extra: Partial<GameStore> = {},
  ) {
    handAnnotations = new Map();
    pendingGrades = 0;
    handSaved = false;
    gradeIndexByRequest.clear();
    handStartStacks = startStacks;
    set({
      state,
      handNumber,
      feedback: [],
      openFeedbackIndex: null,
      lastGuess: null,
      guessSatisfiedAt: null,
      ...extra,
    });
    requestEquity();
    scheduleBotIfNeeded();
  }

  /** Deal hand 0 of a brand-new match: full stacks, fresh personalities. */
  function dealFreshGame() {
    const config = currentConfig();
    const startStacks = Array<number>(config.players).fill(config.startingStack);
    const seed = `game-${crypto.randomUUID()}-h0`;
    const state = startHand(createInitialState(config, seed, 0, startStacks));
    matchSig = matchSignature();
    commitHand(state, 0, startStacks, {
      personalities: currentPersonalities(config.players),
      handNumber: 0,
    });
  }

  return {
    ...(() => {
      // Build the initial hand eagerly so `state` is never null.
      const config = currentConfig();
      const startStacks = Array<number>(config.players).fill(config.startingStack);
      const state = startHand(createInitialState(config, `game-${crypto.randomUUID()}-h0`, 0, startStacks));
      handStartStacks = startStacks;
      return {
        state,
        handNumber: 0,
        personalities: currentPersonalities(config.players),
      };
    })(),
    heroSeat: HERO_SEAT,
    equity: null,
    feedback: [],
    openFeedbackIndex: null,
    decisionCount: loadDecisionCount(),
    lastGuess: null,
    guessSatisfiedAt: null,

    init: () => {
      requestEquity();
      scheduleBotIfNeeded();
    },

    startNewGame: () => dealFreshGame(),

    newHand: () => {
      const { state: prev, heroSeat, handNumber } = get();

      // A table-shape change (size or lineup) starts a completely fresh match.
      if (matchSig !== matchSignature()) {
        dealFreshGame();
        return;
      }

      // No-op if the match is already decided (the UI shows New Game instead).
      if (matchOutcome(prev, heroSeat).over) return;

      // Continue the match: carry stacks over and move the button.
      const startStacks = prev.seats.map((s) => s.stack);
      const button = nextButtonSeat(prev);
      const seed = `game-${crypto.randomUUID()}-h${handNumber + 1}`;
      const state = startHand(createInitialState(prev.config, seed, button, startStacks));
      commitHand(state, handNumber + 1, startStacks);
    },

    heroAction: (action) => {
      const { state, heroSeat, decisionCount } = get();
      if (state.actionOn !== heroSeat) return;
      const fullAction: Action = { seat: heroSeat, ...action };

      // Grade against the state as it was before the action (worker-side).
      if (equityClient && isGradableDecision(state, heroSeat)) {
        const actionIndex = state.actionLog.length;
        const thresholds = useSettingsStore.getState().thresholds;
        const requestId = equityClient.requestGrade(
          state,
          heroSeat,
          fullAction,
          thresholds,
          get().personalities,
        );
        gradeIndexByRequest.set(requestId, actionIndex);
        pendingGrades++;
        const next = decisionCount + 1;
        localStorage.setItem(DECISION_COUNT_KEY, String(next));
        set({ decisionCount: next, lastGuess: null });
      }

      applyAndRefresh(state, fullAction);
      scheduleBotIfNeeded();
    },

    openFeedback: (index) => {
      set((prev) => ({
        openFeedbackIndex: index,
        feedback:
          index === null
            ? prev.feedback
            : prev.feedback.map((f, i) => (i === index ? { ...f, seen: true } : f)),
      }));
    },

    submitGuess: (guessPct) => {
      const { equity, state } = get();
      if (!equity) return;
      const actualPct = equity.equity * 100;
      void saveGuess(guessPct / 100, equity.equity).catch((err) =>
        console.error('failed to save guess:', err),
      );
      set({
        lastGuess: { guessPct, actualPct },
        guessSatisfiedAt: state.actionLog.length,
      });
    },
  };
});

/** True when the upcoming hero decision should be a "guess first" prompt. */
export function isGuessDue(decisionCount: number): boolean {
  return (decisionCount + 1) % GUESS_EVERY === 0;
}
