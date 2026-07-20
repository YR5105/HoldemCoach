import type { Card as CardType } from '../engine/types';

const SUIT_SYMBOL: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RED_SUITS = new Set(['h', 'd']);

export function PlayingCard({ card, faceDown = false, small = false }: { card?: CardType; faceDown?: boolean; small?: boolean }) {
  const sizeClasses = small ? 'w-8 h-11 text-xs' : 'w-12 h-16 text-base';

  if (faceDown || !card) {
    return (
      <div
        className={`${sizeClasses} animate-deal-in rounded-md border border-indigo-300/40 bg-gradient-to-br from-indigo-700 to-indigo-900 shadow-sm`}
      />
    );
  }

  const rank = card[0];
  const suit = card[1]!;
  const red = RED_SUITS.has(suit);

  return (
    <div
      className={`${sizeClasses} animate-deal-in flex flex-col items-center justify-center rounded-md border border-black/10 bg-white font-semibold shadow-sm ${
        red ? 'text-red-600' : 'text-slate-900'
      }`}
    >
      <span>{rank}</span>
      <span className="-mt-1">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}
