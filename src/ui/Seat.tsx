import type { Personality } from '../coach/personalities';
import type { Seat as EngineSeat } from '../engine/types';
import { PlayingCard } from './Card';

/** Per-personality icon + accent for the seat badge (spec §9 "personality icon"). */
export const PERSONALITY_BADGE: Record<Personality, { icon: string; label: string; color: string }> = {
  TAG: { icon: '🎯', label: 'TAG', color: '#34d399' },
  LAG: { icon: '🔥', label: 'LAG', color: '#f87171' },
  Station: { icon: '📞', label: 'Station', color: '#60a5fa' },
  Nit: { icon: '🪨', label: 'Nit', color: '#a8a29e' },
  Balanced: { icon: '⚖️', label: 'Balanced', color: '#c084fc' },
};

interface SeatProps {
  seat: EngineSeat;
  isHero: boolean;
  isButton: boolean;
  isActive: boolean;
  position: string;
  personality?: Personality;
}

export function SeatView({ seat, isHero, isButton, isActive, position, personality }: SeatProps) {
  const showFaceUp = isHero && seat.holeCards;
  const badge = !isHero && personality ? PERSONALITY_BADGE[personality] : null;

  const eliminated = seat.sittingOut;

  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 transition-shadow ${
        isActive ? 'ring-2 ring-amber-400 shadow-lg shadow-amber-400/30' : ''
      } ${eliminated ? 'opacity-30' : seat.folded ? 'opacity-40' : ''}`}
    >
      <div className="flex gap-1">
        {seat.holeCards ? (
          seat.holeCards.map((c, i) => (
            <PlayingCard key={i} card={showFaceUp ? c : undefined} faceDown={!showFaceUp} small />
          ))
        ) : (
          <div className="h-11 w-8" />
        )}
      </div>

      <div className="flex items-center gap-1.5 rounded-full bg-slate-800/90 px-2.5 py-1 text-xs text-slate-100">
        {badge ? (
          <span title={badge.label} className="text-[13px] leading-none" style={{ filter: 'saturate(1.2)' }}>
            {badge.icon}
          </span>
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold">
            You
          </span>
        )}
        <span className="font-medium">{eliminated ? '—' : position}</span>
        {isButton && !eliminated && (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-bold text-slate-900">
            D
          </span>
        )}
      </div>

      <div className="text-xs text-slate-200">
        {eliminated ? (
          <span className="font-semibold text-rose-400">OUT</span>
        ) : (
          <>
            <span className="font-semibold">{seat.stack}</span>
            {seat.allIn && <span className="ml-1 text-amber-400">ALL-IN</span>}
            {seat.folded && <span className="ml-1 text-slate-400">FOLDED</span>}
          </>
        )}
      </div>

      {seat.committedThisStreet > 0 && (
        <div className="rounded-full bg-slate-900/80 px-2 py-0.5 text-[11px] text-amber-300">
          {seat.committedThisStreet}
        </div>
      )}
    </div>
  );
}
