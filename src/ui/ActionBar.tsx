import { useEffect, useState } from 'react';
import { getLegalActions } from '../engine/actions';
import type { GameState } from '../engine/types';
import { useGameStore } from '../store/gameStore';

function potSize(state: GameState): number {
  return state.seats.reduce((sum, s) => sum + s.committedTotal, 0);
}

/** Small keyboard-hint chip; hidden from assistive tech (the label carries meaning). */
function Key({ children }: { children: string }) {
  return (
    <kbd
      aria-hidden="true"
      className="ml-1.5 rounded bg-black/25 px-1 text-[10px] font-normal leading-tight opacity-70"
    >
      {children}
    </kbd>
  );
}

export function ActionBar({ state, heroSeat }: { state: GameState; heroSeat: number }) {
  const heroAction = useGameStore((s) => s.heroAction);
  const isHeroTurn = state.actionOn === heroSeat && state.street !== 'PAYOUT';
  const legal = isHeroTurn ? getLegalActions(state, heroSeat) : null;

  const [betTo, setBetTo] = useState<number | null>(null);

  const pot = legal ? potSize(state) : 0;
  const presets = legal
    ? [0.33, 0.66, 1.25].map((mult) => {
        const raw = state.currentBet + Math.round(pot * mult);
        return Math.max(legal.minTo, Math.min(raw, legal.maxTo));
      })
    : [];
  // Clamp to the current legal range: a target held over from a previous turn
  // (e.g. a big raise sized when the stack was deep) must never exceed this
  // decision's all-in amount, or the engine would reject the action.
  const activeBetTarget = legal ? Math.max(legal.minTo, Math.min(betTo ?? presets[1]!, legal.maxTo)) : 0;

  // Keyboard shortcuts: F = fold, C = check/call, R or B = bet/raise. Skipped
  // while typing in a field and while it isn't the hero's turn.
  useEffect(() => {
    if (!isHeroTurn || !legal) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        heroAction({ type: 'fold' });
      } else if (k === 'c') {
        if (legal.canCheck) {
          e.preventDefault();
          heroAction({ type: 'check' });
        } else if (legal.canCall) {
          e.preventDefault();
          heroAction({ type: 'call' });
        }
      } else if ((k === 'r' || k === 'b') && (legal.canBet || legal.canRaise)) {
        e.preventDefault();
        heroAction({ type: legal.canBet ? 'bet' : 'raise', amount: activeBetTarget });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isHeroTurn, legal, activeBetTarget, heroAction]);

  if (!isHeroTurn || !legal) {
    return <div className="flex h-16 items-center justify-center text-sm text-slate-400">Waiting…</div>;
  }

  const btn =
    'rounded-lg px-5 py-2 font-semibold text-white transition-transform duration-100 active:scale-95';

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      {(legal.canBet || legal.canRaise) && (
        <div className="flex w-full max-w-md flex-col items-center gap-1.5">
          <input
            type="range"
            min={legal.minTo}
            max={legal.maxTo}
            step={1}
            value={activeBetTarget}
            onChange={(e) => setBetTo(Number(e.target.value))}
            className="w-full accent-amber-400"
            aria-label="Bet amount"
          />
          <div className="flex gap-2 text-xs">
            {(['33%', '66%', '125%'] as const).map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => setBetTo(presets[i]!)}
                className="rounded-full bg-slate-700 px-2.5 py-1 text-slate-200 transition-colors hover:bg-slate-600 active:scale-95"
              >
                {label} ({presets[i]})
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={() => heroAction({ type: 'fold' })} className={`${btn} bg-rose-600 hover:bg-rose-500`}>
          Fold
          <Key>F</Key>
        </button>

        {legal.canCheck ? (
          <button type="button" onClick={() => heroAction({ type: 'check' })} className={`${btn} bg-slate-600 hover:bg-slate-500`}>
            Check
            <Key>C</Key>
          </button>
        ) : (
          <button
            type="button"
            disabled={!legal.canCall}
            onClick={() => heroAction({ type: 'call' })}
            className={`${btn} bg-slate-600 hover:bg-slate-500 disabled:opacity-40`}
          >
            Call {legal.callAmount}
            <Key>C</Key>
          </button>
        )}

        {(legal.canBet || legal.canRaise) && (
          <button
            type="button"
            onClick={() => heroAction({ type: legal.canBet ? 'bet' : 'raise', amount: activeBetTarget })}
            className={`${btn} bg-emerald-600 hover:bg-emerald-500`}
          >
            {legal.canBet ? 'Bet' : 'Raise'} {activeBetTarget}
            <Key>R</Key>
          </button>
        )}
      </div>
    </div>
  );
}
