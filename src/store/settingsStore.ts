import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GRADING_THRESHOLDS, type GradingThresholds } from '../coach/graderTypes';
import type { Personality } from '../coach/personalities';

export type FeedbackMode = 'instant' | 'subtle' | 'review';
export type ExperienceLevel = 'beginner' | 'casual' | 'studied';

export type { GradingThresholds };

/** Bot personality per non-hero seat slot (slot i = seat i+1 when seated). */
const DEFAULT_LINEUP: Personality[] = ['TAG', 'LAG', 'Station', 'Nit', 'Balanced', 'TAG', 'TAG', 'TAG'];

interface SettingsStore {
  feedbackMode: FeedbackMode;
  winProbabilityVisible: boolean;
  tableSize: number;
  beginnerHints: boolean;
  thresholds: GradingThresholds;
  experienceLevel: ExperienceLevel | null;
  onboardingComplete: boolean;
  botLineup: Personality[];
  setFeedbackMode: (mode: FeedbackMode) => void;
  setWinProbabilityVisible: (visible: boolean) => void;
  setTableSize: (size: number) => void;
  setBeginnerHints: (on: boolean) => void;
  setThresholds: (t: GradingThresholds) => void;
  setBotSeat: (slot: number, personality: Personality) => void;
  completeOnboarding: (level: ExperienceLevel) => void;
}

/** User preferences. Default feedback mode after onboarding is `subtle` (spec §9). */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      feedbackMode: 'subtle',
      winProbabilityVisible: true,
      tableSize: 6,
      beginnerHints: false,
      thresholds: { ...GRADING_THRESHOLDS },
      experienceLevel: null,
      onboardingComplete: false,
      botLineup: DEFAULT_LINEUP,
      setFeedbackMode: (feedbackMode) => set({ feedbackMode }),
      setWinProbabilityVisible: (winProbabilityVisible) => set({ winProbabilityVisible }),
      setTableSize: (tableSize) => set({ tableSize: Math.min(9, Math.max(2, tableSize)) }),
      setBeginnerHints: (beginnerHints) => set({ beginnerHints }),
      setThresholds: (thresholds) => set({ thresholds }),
      setBotSeat: (slot, personality) =>
        set((s) => ({
          botLineup: s.botLineup.map((p, i) => (i === slot ? personality : p)),
        })),
      completeOnboarding: (level) =>
        set({
          onboardingComplete: true,
          experienceLevel: level,
          beginnerHints: level === 'beginner',
          // First hand plays in instant mode per spec §9 onboarding; the user
          // can switch to the subtle default any time.
          feedbackMode: 'instant',
        }),
    }),
    { name: 'holdemcoach-settings' },
  ),
);
