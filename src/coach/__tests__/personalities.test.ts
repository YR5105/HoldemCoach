import { describe, expect, it } from 'vitest';
import { plausiblePostflopActionsForCombo } from '../../bots/botPolicy';
import type { Card } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { HAND_STRENGTH_ORDER } from '../handStrength';
import {
  personalityCallRange,
  personalityOpenRange,
  personalityThreeBetRange,
  transformRange,
} from '../personalities';
import { getCallRange, getOpenRaiseRange, getThreeBetRange } from '../ranges';

const evaluator = new PokersolverEvaluator();

describe('transformRange (spec §4)', () => {
  it('a 1.4x widen takes round(size × 1.4) top hands from the strength ordering', () => {
    const base = getOpenRaiseRange('UTG');
    const widened = transformRange(base, 1.4);
    expect(widened.size).toBe(Math.round(base.size * 1.4));
    // The widened range is exactly a prefix of the strength ordering.
    expect([...widened].every((h) => HAND_STRENGTH_ORDER.indexOf(h) < widened.size)).toBe(true);
  });

  it('a 0.6x tighten shrinks the range and keeps only top-ordered hands', () => {
    const base = getOpenRaiseRange('BTN');
    const tightened = transformRange(base, 0.6);
    expect(tightened.size).toBe(Math.round(base.size * 0.6));
    expect(tightened.has('AA')).toBe(true);
    expect(tightened.size).toBeLessThan(base.size);
  });

  it('factor 1 returns the base range unchanged', () => {
    const base = getOpenRaiseRange('CO');
    expect(transformRange(base, 1)).toBe(base);
  });

  it('caps at all 169 hands', () => {
    const base = getOpenRaiseRange('BTN');
    expect(transformRange(base, 5).size).toBeLessThanOrEqual(169);
  });
});

describe('personality range transforms', () => {
  it('LAG opens wider than TAG, Nit tighter', () => {
    const tag = personalityOpenRange('TAG', 'CO');
    const lag = personalityOpenRange('LAG', 'CO');
    const nit = personalityOpenRange('Nit', 'CO');
    expect(lag.size).toBeGreaterThan(tag.size);
    expect(nit.size).toBeLessThan(tag.size);
    expect(tag).toEqual(getOpenRaiseRange('CO'));
  });

  it("Station's 3-bet range is unchanged but call range is 1.8x wider", () => {
    const base3bet = getThreeBetRange('CO_BTN', false);
    const baseCall = getCallRange('CO_BTN', 'BB')!;
    expect(personalityThreeBetRange('Station', 'CO_BTN', false)).toEqual(base3bet);
    expect(personalityCallRange('Station', 'CO_BTN', 'BB')!.size).toBe(
      Math.round(baseCall.size * 1.8),
    );
  });
});

describe('Station never folds a made pair (spec §4)', () => {
  const board: Card[] = ['9c', '5d', '2h'];

  it('a weak pair facing a bet can only call for Station, but can fold for TAG', () => {
    const weakPair: [Card, Card] = ['5s', '7c']; // pair of 5s, below top pair -> WEAK bucket
    const station = plausiblePostflopActionsForCombo(weakPair, board, true, 'Station', evaluator);
    const tag = plausiblePostflopActionsForCombo(weakPair, board, true, 'TAG', evaluator);
    expect(station.has('fold')).toBe(false);
    expect(station.has('call')).toBe(true);
    expect(tag.has('fold')).toBe(true);
  });

  it('total air can still fold even for Station', () => {
    const air: [Card, Card] = ['Ks', 'Jc']; // no pair on 9-5-2
    const station = plausiblePostflopActionsForCombo(air, board, true, 'Station', evaluator);
    expect(station.has('fold')).toBe(true);
  });
});
