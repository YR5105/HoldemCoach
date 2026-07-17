import preflopData from '../data/preflop.json';
import { HAND_STRENGTH_ORDER, isInTopPercent } from './handStrength';
import type { Position } from './position';
import { parseRange } from './rangeParser';

export type OpenerClass = 'EP_MP' | 'CO_BTN' | 'SB';

const OPEN_RAISE_POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const;
export type OpenRaisePosition = (typeof OPEN_RAISE_POSITIONS)[number];

function memoize<T>(fn: () => T): () => T {
  let cached: T | undefined;
  let has = false;
  return () => {
    if (!has) {
      cached = fn();
      has = true;
    }
    return cached!;
  };
}

const openRaiseRanges = new Map<OpenRaisePosition, () => Set<string>>(
  OPEN_RAISE_POSITIONS.map((pos) => [pos, memoize(() => parseRange(preflopData.openRaise[pos]))]),
);

/** This position's opening range — the single source of truth (§ hard invariant 1). */
export function getOpenRaiseRange(position: OpenRaisePosition): Set<string> {
  return openRaiseRanges.get(position)!();
}

export function getOpenRaiseSizeBb(position: OpenRaisePosition): number {
  return position === 'SB' ? preflopData.openRaiseSizeBb.SB : preflopData.openRaiseSizeBb.default;
}

/** Buckets an opener's position into the coarser class the facing-open charts use. */
export function classifyOpener(position: OpenRaisePosition): OpenerClass {
  if (position === 'UTG' || position === 'HJ') return 'EP_MP';
  if (position === 'SB') return 'SB';
  return 'CO_BTN';
}

const epMpThreeBet = memoize(() => parseRange(preflopData.facingOpen.EP_MP.threeBet));
const coBtnThreeBet = memoize(() => parseRange(preflopData.facingOpen.CO_BTN.threeBet));
const coBtnBlindsExtra = memoize(() =>
  parseRange(preflopData.facingOpen.CO_BTN.threeBetFromBlindsExtra),
);
const vsSbOpenThreeBet = memoize(() => parseRange(preflopData.facingOpen.vsSbOpen.threeBet));

/**
 * The 3-bet range for facing `openerClass`. `fromBlinds` adds the extra
 * suited-connector bluffs the CO/BTN chart grants only to blinds (§3.2).
 */
export function getThreeBetRange(openerClass: OpenerClass, fromBlinds: boolean): Set<string> {
  if (openerClass === 'EP_MP') return epMpThreeBet();
  if (openerClass === 'SB') return vsSbOpenThreeBet();
  const base = coBtnThreeBet();
  return fromBlinds ? new Set([...base, ...coBtnBlindsExtra()]) : base;
}

const epMpCall = memoize(() => parseRange(preflopData.facingOpen.EP_MP.call));
const coBtnCall = memoize(() => parseRange(preflopData.facingOpen.CO_BTN.call));

/**
 * Flat-call range facing an EP/MP or CO/BTN open. Per spec §3.2, SB never
 * flats a CO/BTN open (3-bet or fold only) even though BB/IP responders do;
 * "vs SB open" isn't handled here — see getVsSbOpenCallRange.
 */
export function getCallRange(
  openerClass: 'EP_MP' | 'CO_BTN',
  responderPosition: Position,
): Set<string> | null {
  if (openerClass === 'CO_BTN' && responderPosition === 'SB') return null;
  return openerClass === 'EP_MP' ? epMpCall() : coBtnCall();
}

export function getThreeBetSizeMultiplier(inPosition: boolean): number {
  return inPosition ? preflopData.threeBetSizeMultiplier.ip : preflopData.threeBetSizeMultiplier.oop;
}

function topPercentExcluding(percent: number, excluding: Set<string>): Set<string> {
  const hands = new Set<string>();
  for (const hand of HAND_STRENGTH_ORDER) {
    if (excluding.has(hand)) continue;
    if (isInTopPercent(hand, percent)) hands.add(hand);
  }
  return hands;
}

/** BB's flat-call range vs an SB open (§3.2): top 55% of hands, excluding the 3-bet range. */
export function getVsSbOpenCallRange(): Set<string> {
  return topPercentExcluding(preflopData.facingOpen.vsSbOpen.callTopPercent, vsSbOpenThreeBet());
}

/**
 * §3.3's "BB vs BTN/SB open: defend top 40%" overlaps with the more
 * detailed, hand-list-based ranges above (CO_BTN.call already covers BB vs
 * CO/BTN, and vsSbOpen.call covers BB vs SB at 55%, not 40%). We treat the
 * explicit hand lists as authoritative and keep this 40% figure available
 * as spec-mandated infrastructure rather than wiring it into bot decisions
 * where it would silently override the more specific charts.
 */
export function getBbVsStealDefendRange(threeBetRange: Set<string>): Set<string> {
  return topPercentExcluding(preflopData.bbVsStealDefendTopPercent, threeBetRange);
}

const fourBetValueRange = memoize(() => parseRange(preflopData.fourBet.value));
const fourBetBluffRange = memoize(() => parseRange(preflopData.fourBet.bluff));

export function getFourBetValueRange(): Set<string> {
  return fourBetValueRange();
}

export function getFourBetBluffRange(): Set<string> {
  return fourBetBluffRange();
}

const facingFourBetContinueRange = memoize(() => parseRange(preflopData.facingFourBetContinue));

export function getFacingFourBetContinueRange(): Set<string> {
  return facingFourBetContinueRange();
}
