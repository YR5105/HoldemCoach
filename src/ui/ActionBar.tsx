import { useState } from 'react';
import { getLegalActions } from '../engine/actions';
import type { GameState } from '../engine/types';
import { useGameStore } from '../store/gameStore';

function potSize(state: GameState): number {
  return state.seats.reduce((sum, s) => sum + s.committedTotal, 0);
}

export function ActionBar({ state, heroSeat }: { state: GameState; heroSeat: number }) {
  const heroAction = useGameStore((s) => s.heroAction);
  const isHeroTurn = state.actionOn === heroSeat && state.street !== 'PAYOUT';
  const legal = isHeroTurn ? getLegalActions(state, heroSeat) : null;

  const [betTo, setBetTo] = useState<number | null>(null);

  if (!isHeroTurn || !legal) {
    return <div className="flex h-16 items-center justify-center text-sm text-slate-400">Waiting…</div>;
  }

  const pot = potSize(state);
  const presets = [0.33, 0.66, 1.25].map((mult) => {
    const raw = state.currentBet + Math.round(pot * mult);
    return Math.max(legal.minTo, Math.min(raw, legal.maxTo));
  });

  const activeBetTarget = betTo ?? presets[1]!;

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
          />
          <div className="flex gap-2 text-xs">
            {(['33%', '66%', '125%'] as const).map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => setBetTo(presets[i]!)}
                className="rounded-full bg-slate-700 px-2.5 py-1 text-slate-200 hover:bg-slate-600"
              >
                {label} ({presets[i]})
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => heroAction({ type: 'fold' })}
          className="rounded-lg bg-rose-600 px-5 py-2 font-semibold text-white hover:bg-rose-500"
        >
          Fold
        </button>

        {legal.canCheck ? (
          <button
            type="button"
            onClick={() => heroAction({ type: 'check' })}
            className="rounded-lg bg-slate-600 px-5 py-2 font-semibold text-white hover:bg-slate-500"
          >
            Check
          </button>
        ) : (
          <button
            type="button"
            disabled={!legal.canCall}
            onClick={() => heroAction({ type: 'call' })}
            className="rounded-lg bg-slate-600 px-5 py-2 font-semibold text-white hover:bg-slate-500 disabled:opacity-40"
          >
            Call {legal.callAmount}
          </button>
        )}

        {(legal.canBet || legal.canRaise) && (
          <button
            type="button"
            onClick={() =>
              heroAction({ type: legal.canBet ? 'bet' : 'raise', amount: activeBetTarget })
            }
            className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white hover:bg-emerald-500"
          >
            {legal.canBet ? 'Bet' : 'Raise'} {activeBetTarget}
          </button>
        )}
      </div>
    </div>
  );
}
