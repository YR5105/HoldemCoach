import botsData from '../data/bots.json';
import { HAND_STRENGTH_ORDER } from './handStrength';
import type { Position } from './position';
import {
  getCallRange,
  getOpenRaiseRange,
  getThreeBetRange,
  getVsSbOpenCallRange,
  type OpenerClass,
  type OpenRaisePosition,
} from './ranges';

export type Personality = keyof typeof botsData;

export const PERSONALITIES = Object.keys(botsData) as Personality[];

/**
 * Spec §4 widen/tighten transform: rank all 169 hands by the precomputed
 * strength ordering; a 1.4× widen of an 18%-range takes the top 25.2%.
 * The result is machine-readable (a plain hand set), which the equity
 * engine requires.
 */
export function transformRange(range: Set<string>, factor: number): Set<string> {
  if (factor === 1) return range;
  const target = Math.min(HAND_STRENGTH_ORDER.length, Math.max(1, Math.round(range.size * factor)));
  return new Set(HAND_STRENGTH_ORDER.slice(0, target));
}

interface RangeFactors {
  /** Applied to open-raise and 3-bet ranges. */
  aggressive: number;
  /** Applied to flat-call ranges. */
  call: number;
}

/** Preflop transforms per spec §4's personality table. */
const FACTORS: Record<Personality, RangeFactors> = {
  TAG: { aggressive: 1, call: 1 },
  LAG: { aggressive: 1.4, call: 1.4 },
  Station: { aggressive: 1, call: 1.8 }, // 3-bet range unchanged; call ranges 1.8×
  Nit: { aggressive: 0.6, call: 0.6 },
  Balanced: { aggressive: 1, call: 1 },
};

export function personalityOpenRange(personality: Personality, position: OpenRaisePosition): Set<string> {
  return transformRange(getOpenRaiseRange(position), FACTORS[personality].aggressive);
}

export function personalityThreeBetRange(
  personality: Personality,
  openerClass: OpenerClass,
  fromBlinds: boolean,
): Set<string> {
  return transformRange(getThreeBetRange(openerClass, fromBlinds), FACTORS[personality].aggressive);
}

export function personalityCallRange(
  personality: Personality,
  openerClass: 'EP_MP' | 'CO_BTN',
  responderPosition: Position,
): Set<string> | null {
  const base = getCallRange(openerClass, responderPosition);
  return base ? transformRange(base, FACTORS[personality].call) : null;
}

export function personalityVsSbOpenCallRange(personality: Personality): Set<string> {
  return transformRange(getVsSbOpenCallRange(), FACTORS[personality].call);
}

export interface PersonalityParams {
  foldToCbet: number;
  cbet: number;
  bluffRatio: number;
  raiseStrong: number;
  callsWithAnyPairOrDraw?: boolean;
}

export function personalityParams(personality: Personality): PersonalityParams {
  return botsData[personality];
}
