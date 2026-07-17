import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

/**
 * "Guess first" mode (spec §7 Q2): every 25th decision the win % is hidden
 * until the user slides an estimate; the error is logged for the dashboard.
 */
export function GuessPrompt() {
  const submitGuess = useGameStore((s) => s.submitGuess);
  const equity = useGameStore((s) => s.equity);
  const [guess, setGuess] = useState(50);

  return (
    <div className="flex w-56 flex-col gap-1.5 rounded-xl border border-indigo-500/40 bg-slate-900 p-3">
      <div className="text-xs font-semibold text-indigo-300">Guess first!</div>
      <div className="text-xs text-slate-400">What's your win probability right now?</div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={100}
          value={guess}
          onChange={(e) => setGuess(Number(e.target.value))}
          className="flex-1 accent-indigo-400"
        />
        <span className="w-10 text-right text-sm font-bold text-slate-100">{guess}%</span>
      </div>
      <button
        type="button"
        disabled={!equity}
        onClick={() => submitGuess(guess)}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        {equity ? 'Reveal' : 'Computing…'}
      </button>
    </div>
  );
}

export function GuessReveal() {
  const lastGuess = useGameStore((s) => s.lastGuess);
  if (!lastGuess) return null;
  const error = Math.abs(lastGuess.guessPct - lastGuess.actualPct);
  return (
    <div className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-slate-300">
      You guessed {Math.round(lastGuess.guessPct)}% · actual {Math.round(lastGuess.actualPct)}% ·{' '}
      <span className={error <= 10 ? 'text-emerald-400' : 'text-amber-400'}>
        {error <= 10 ? 'nice read!' : `off by ${Math.round(error)}%`}
      </span>
    </div>
  );
}
