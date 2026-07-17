import type { Rank } from './types';

const RANK_CHARS = '23456789TJQKA';

export function rankValue(rankChar: string): number {
  const idx = RANK_CHARS.indexOf(rankChar[0]!);
  if (idx === -1) throw new Error(`invalid rank "${rankChar}"`);
  return idx + 2;
}

export function rankFromValue(value: number): Rank {
  const ch = RANK_CHARS[value - 2];
  if (!ch) throw new Error(`invalid rank value ${value}`);
  return ch as Rank;
}
