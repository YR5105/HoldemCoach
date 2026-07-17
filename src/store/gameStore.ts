import { create } from 'zustand';
import { decideBotAction, type Personality } from '../bots/botPolicy';
import { isGradableDecision } from '../coach/grader';
import type { GradeResult } from '../coach/graderTypes';
import { applyAction, createInitialState, startHand } from '../engine';
import type { Action, GameConfig, GameState } from '../engine/types';
import { EquityClient, type EquitySnapshot } from '../equity/equityClient';
import { buildHandDoc, saveGuess, saveHand, toCoachAnnotation, type CoachAnnotation } from './handHistory';
import { useSettingsStore } from './settingsStore';

export const HERO_SEAT = 0;
const BOT_DELAY_MS = 500;
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

function freshHandState(handNumber: number): GameState {
  const config = currentConfig();
  const buttonSeat = handNumber % config.players;
  const seed = `hand-${handNumber}-${crypto.randomUUID()}`;
  return startHand(createInitialState(config, seed, buttonSeat));
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

interface GameStore {
  state: GameState;
  heroSeat: number;
  handNumber: number;
  /** Seat -> bot personality for the current hand (fixed at deal time). */
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
  newHand: () => void;
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
    void saveHand(buildHandDoc(state, heroSeat, handAnnotations, personalities)).catch((err) =>
      console.error('failed to save hand history:', err),
    );
  }

  function requestEquity() {
    const { state, heroSeat, personalities } = get();
    set({ equity: null });
    if (!equityClient) return;
    const hero = state.seats[heroSeat]!;
    if (hero.folded || !hero.holeCards || state.street === 'PAYOUT') return;
    const villainSeats = state.seats
      .filter((s) => s.seatIndex !== heroSeat && !s.folded)
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

  const initialState = freshHandState(0);

  return {
    state: initialState,
    heroSeat: HERO_SEAT,
    handNumber: 0,
    personalities: currentPersonalities(initialState.seats.length),
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
    newHand: () => {
      const handNumber = get().handNumber + 1;
      handAnnotations = new Map();
      pendingGrades = 0;
      handSaved = false;
      gradeIndexByRequest.clear();
      const state = freshHandState(handNumber);
      set({
        state,
        handNumber,
        personalities: currentPersonalities(state.seats.length),
        feedback: [],
        openFeedbackIndex: null,
        lastGuess: null,
        guessSatisfiedAt: null,
      });
      requestEquity();
      scheduleBotIfNeeded();
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
