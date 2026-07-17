import { useState } from 'react';
import { PERSONALITIES, type Personality } from '../coach/personalities';
import { useSettingsStore, type FeedbackMode } from '../store/settingsStore';
import { useGameStore } from '../store/gameStore';
import { PERSONALITY_BADGE } from './Seat';

export function SettingsScreen() {
  const settings = useSettingsStore();
  const newHand = useGameStore((s) => s.newHand);
  const players = useGameStore((s) => s.state.config.players);
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <Section title="Coach feedback">
        <div className="flex gap-2">
          {(['instant', 'subtle', 'review'] as FeedbackMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => settings.setFeedbackMode(mode)}
              className={`rounded-lg px-3 py-1.5 text-sm capitalize ${
                settings.feedbackMode === mode
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Instant pops a card after each graded decision · Subtle shows a small dot · Review waits
          until the hand ends.
        </p>
      </Section>

      <Section title="Win probability display">
        <Toggle
          checked={settings.winProbabilityVisible}
          onChange={settings.setWinProbabilityVisible}
          label="Show live win % and pot odds"
        />
        <p className="mt-1 text-xs text-slate-500">
          Turn off for "training wheels off" sessions. Guess-first prompts still appear either way.
        </p>
      </Section>

      <Section title="Table">
        <label className="flex items-center gap-3 text-sm text-slate-300">
          Players
          <select
            value={settings.tableSize}
            onChange={(e) => settings.setTableSize(Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200"
          >
            {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {n === 2 ? 'Heads-up' : `${n}-max`}
              </option>
            ))}
          </select>
        </label>
        {settings.tableSize !== players && (
          <button
            type="button"
            onClick={newHand}
            className="mt-2 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400"
          >
            Apply with next hand
          </button>
        )}
      </Section>

      <Section title="Bot lineup">
        <p className="mb-2 text-xs text-slate-500">
          Personality per seat (clockwise from you). Changes apply from the next hand.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: settings.tableSize - 1 }, (_, slot) => (
            <label key={slot} className="flex items-center justify-between gap-2 text-sm text-slate-300">
              <span>
                {PERSONALITY_BADGE[settings.botLineup[slot] ?? 'TAG'].icon} Seat {slot + 1}
              </span>
              <select
                value={settings.botLineup[slot] ?? 'TAG'}
                onChange={(e) => settings.setBotSeat(slot, e.target.value as Personality)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200"
              >
                {PERSONALITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          🎯 TAG tight-aggressive · 🔥 LAG loose-aggressive · 📞 Station calls everything · 🪨 Nit
          ultra-tight · ⚖️ Balanced near-GTO
        </p>
      </Section>

      <Section title="Beginner mode">
        <Toggle
          checked={settings.beginnerHints}
          onChange={settings.setBeginnerHints}
          label="Explain terms inline (pot odds, c-bet, …)"
        />
      </Section>

      <Section title="Advanced">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-sm text-slate-400 underline decoration-dotted hover:text-slate-200"
        >
          {showAdvanced ? 'Hide' : 'Show'} grading thresholds
        </button>
        {showAdvanced && (
          <div className="mt-2 flex flex-col gap-2">
            <ThresholdInput
              label="OK below (bb)"
              value={settings.thresholds.ok}
              onChange={(ok) => settings.setThresholds({ ...settings.thresholds, ok })}
            />
            <ThresholdInput
              label="Inaccuracy up to (bb)"
              value={settings.thresholds.inaccuracy}
              onChange={(inaccuracy) => settings.setThresholds({ ...settings.thresholds, inaccuracy })}
            />
            <ThresholdInput
              label="Mistake up to (bb)"
              value={settings.thresholds.mistake}
              onChange={(mistake) => settings.setThresholds({ ...settings.thresholds, mistake })}
            />
            <p className="text-xs text-slate-500">Anything above the mistake threshold is a blunder.</p>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
      {label}
    </label>
  );
}

function ThresholdInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
      {label}
      <input
        type="number"
        step="0.1"
        min="0"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-right text-slate-200"
      />
    </label>
  );
}
