import type { EquitySnapshot } from '../equity/equityClient';
import type { PotOdds } from '../store/gameStore';
import { AnimatedNumber } from './AnimatedNumber';

/** Spec §9 color states: green ≥ needed+10pts, yellow within ±10, red below. */
function dialColor(equityPct: number, requiredPct: number): string {
  if (equityPct >= requiredPct + 10) return '#34d399'; // emerald-400
  if (equityPct >= requiredPct - 10) return '#facc15'; // yellow-400
  return '#f87171'; // red-400
}

const R = 26;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function WinDial({ equity, potOdds }: { equity: EquitySnapshot | null; potOdds: PotOdds }) {
  const equityPct = equity ? equity.equity * 100 : null;
  const requiredPct = potOdds.required * 100;
  const color = equityPct !== null ? dialColor(equityPct, requiredPct) : '#64748b';
  const dash = equityPct !== null ? (equityPct / 100) * CIRCUMFERENCE : 0;

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={R} fill="none" stroke="#334155" strokeWidth="6" />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
            className="transition-all duration-300"
          />
        </svg>
        <div
          data-testid="win-percent"
          className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums transition-colors duration-300"
          style={{ color }}
        >
          {equityPct !== null ? (
            <>
              <AnimatedNumber value={equityPct} />%
            </>
          ) : (
            '…'
          )}
        </div>
      </div>

      <div className="text-xs leading-5 text-slate-300">
        <div className="font-medium text-slate-100">Win probability</div>
        {potOdds.toCall > 0 ? (
          <div className="tabular-nums">
            need {Math.round(requiredPct)}% · have{' '}
            {equityPct !== null ? (
              <>
                <AnimatedNumber value={equityPct} />%
              </>
            ) : (
              '…'
            )}
          </div>
        ) : (
          <div>no bet to call</div>
        )}
        {equity && <div className="text-slate-500">±{Math.round(equity.ci95 * 100)}%</div>}
      </div>
    </div>
  );
}
