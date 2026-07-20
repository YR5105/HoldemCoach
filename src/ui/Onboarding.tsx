import { useState } from 'react';
import { useSettingsStore, type ExperienceLevel } from '../store/settingsStore';

const LEVELS: { id: ExperienceLevel; label: string; blurb: string }[] = [
  { id: 'beginner', label: 'Total beginner', blurb: "I'm still learning the rules." },
  { id: 'casual', label: 'Casual player', blurb: 'I play home games; never studied.' },
  { id: 'studied', label: 'Student of the game', blurb: 'I study — I want honest reps.' },
];

/** First-launch flow (spec §9): experience level → coach explainer → deal in. */
export function Onboarding() {
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState<ExperienceLevel | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 p-4">
      <div className="animate-pop-in w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-4 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-emerald-500' : 'bg-slate-700'}`}
            />
          ))}
        </div>

        {step === 0 && (
          <>
            <h1 className="mb-1 text-lg font-bold text-slate-100">Welcome to HoldemCoach</h1>
            <p className="mb-4 text-sm text-slate-400">
              A poker game that coaches you while you play. First — how much poker have you played?
            </p>
            <div className="flex flex-col gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    setLevel(l.id);
                    setStep(1);
                  }}
                  className={`rounded-xl border px-4 py-3 text-left hover:border-emerald-500 ${
                    level === l.id ? 'border-emerald-500 bg-slate-800' : 'border-slate-700'
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-100">{l.label}</div>
                  <div className="text-xs text-slate-400">{l.blurb}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="mb-1 text-lg font-bold text-slate-100">How the coach works</h1>
            <p className="mb-3 text-sm text-slate-300">
              We grade every decision by <span className="font-semibold text-emerald-400">what it costs</span>,
              not right or wrong.
            </p>
            <ul className="mb-4 flex flex-col gap-2 text-sm text-slate-400">
              <li>
                · A decision that forfeits less than 0.1bb is <span className="text-slate-200">OK</span> —
                even if it's not the most common play.
              </li>
              <li>
                · Bigger EV losses grade as <span className="text-yellow-400">Inaccuracy</span>,{' '}
                <span className="text-orange-400">Mistake</span>, or{' '}
                <span className="text-red-400">Blunder</span>, with the better action and the cost in
                big blinds.
              </li>
              <li>· Your live win % and pot odds are on screen, so calls and folds become intuitive.</li>
            </ul>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 font-semibold text-white hover:bg-emerald-500"
            >
              Got it
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="mb-1 text-lg font-bold text-slate-100">Let's deal you in</h1>
            <p className="mb-4 text-sm text-slate-400">
              Your first hand plays with instant feedback so you can see the coach in action. You can
              switch to a subtler mode any time in Settings.
            </p>
            <button
              type="button"
              onClick={() => completeOnboarding(level ?? 'casual')}
              className="w-full rounded-xl bg-amber-500 px-4 py-2.5 font-semibold text-slate-900 hover:bg-amber-400"
            >
              Deal me in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
