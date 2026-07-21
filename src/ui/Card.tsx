import type { Card as CardType } from '../engine/types';

const SUIT_SYMBOL: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RED_SUITS = new Set(['h', 'd']);

export type CardSize = 'sm' | 'md' | 'lg';

// Mobile-first sizes; sm: restores the roomier desktop sizing. `lg` is for the
// hero's own hole cards, which stay big and legible even on a phone.
const SIZE_CLASSES: Record<CardSize, string> = {
  sm: 'w-7 h-10 text-[11px] sm:w-8 sm:h-11 sm:text-xs',
  md: 'w-8 h-11 text-sm sm:w-12 sm:h-16 sm:text-base',
  lg: 'w-12 h-16 text-lg sm:w-14 sm:h-20 sm:text-xl',
};

export function PlayingCard({
  card,
  faceDown = false,
  small = false,
  size,
  delayMs = 0,
}: {
  card?: CardType;
  faceDown?: boolean;
  /** Back-compat shorthand for size="sm". */
  small?: boolean;
  size?: CardSize;
  /** Staggers the deal-in entrance (e.g. flop cards fanning out). */
  delayMs?: number;
}) {
  const sizeClasses = SIZE_CLASSES[size ?? (small ? 'sm' : 'md')];
  const delayStyle = delayMs ? { animationDelay: `${delayMs}ms` } : undefined;

  if (faceDown || !card) {
    return (
      <div
        style={delayStyle}
        className={`${sizeClasses} animate-deal-in rounded-md border border-indigo-300/40 bg-gradient-to-br from-indigo-700 to-indigo-900 shadow-sm`}
      />
    );
  }

  const rank = card[0];
  const suit = card[1]!;
  const red = RED_SUITS.has(suit);

  return (
    <div
      style={delayStyle}
      className={`${sizeClasses} animate-deal-in flex flex-col items-center justify-center rounded-md border border-black/10 bg-white font-semibold shadow-sm ${
        red ? 'text-red-600' : 'text-slate-900'
      }`}
    >
      <span className="leading-none">{rank}</span>
      <span className="-mt-0.5 leading-none">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}
