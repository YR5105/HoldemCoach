import { describe, expect, it } from 'vitest';
import {
  classifyOpener,
  getBbVsStealDefendRange,
  getCallRange,
  getFacingFourBetContinueRange,
  getFourBetBluffRange,
  getFourBetValueRange,
  getOpenRaiseRange,
  getOpenRaiseSizeBb,
  getThreeBetRange,
  getThreeBetSizeMultiplier,
  getVsSbOpenCallRange,
} from '../ranges';

describe('open raise ranges', () => {
  it('UTG is tighter than BTN', () => {
    const utg = getOpenRaiseRange('UTG');
    const btn = getOpenRaiseRange('BTN');
    expect(utg.size).toBeLessThan(btn.size);
    expect(utg.has('AA')).toBe(true);
    expect(utg.has('72o')).toBe(false);
    expect(btn.has('72o')).toBe(false); // still not in even the widest RFI chart
    expect(btn.has('53s')).toBe(true);
  });

  it('SB opens for 3bb, everyone else for 2.5bb', () => {
    expect(getOpenRaiseSizeBb('SB')).toBe(3);
    expect(getOpenRaiseSizeBb('BTN')).toBe(2.5);
  });
});

describe('classifyOpener', () => {
  it('groups positions into the facing-open chart classes', () => {
    expect(classifyOpener('UTG')).toBe('EP_MP');
    expect(classifyOpener('HJ')).toBe('EP_MP');
    expect(classifyOpener('CO')).toBe('CO_BTN');
    expect(classifyOpener('BTN')).toBe('CO_BTN');
    expect(classifyOpener('SB')).toBe('SB');
  });
});

describe('facing an open', () => {
  it('EP/MP 3-bet range is a subset of premium hands', () => {
    const threeBet = getThreeBetRange('EP_MP', false);
    expect(threeBet.has('QQ')).toBe(true);
    expect(threeBet.has('AKs')).toBe(true);
    expect(threeBet.has('72o')).toBe(false);
  });

  it('CO/BTN 3-bet range gains suited-connector bluffs only from the blinds', () => {
    const fromButton = getThreeBetRange('CO_BTN', false);
    const fromBlinds = getThreeBetRange('CO_BTN', true);
    expect(fromButton.has('76s')).toBe(false);
    expect(fromBlinds.has('76s')).toBe(true);
    expect(fromBlinds.has('65s')).toBe(true);
  });

  it('SB facing a CO/BTN open has no flat-call range (3-bet or fold only)', () => {
    expect(getCallRange('CO_BTN', 'SB')).toBeNull();
  });

  it('BB and IP responders do have a flat-call range vs CO/BTN and EP/MP opens', () => {
    expect(getCallRange('EP_MP', 'BB')).not.toBeNull();
    expect(getCallRange('CO_BTN', 'BB')!.has('76s')).toBe(true);
    expect(getCallRange('CO_BTN', 'CO')!.has('76s')).toBe(true);
  });

  it('3-bet sizing is 3x in position and 4x out of position', () => {
    expect(getThreeBetSizeMultiplier(true)).toBe(3);
    expect(getThreeBetSizeMultiplier(false)).toBe(4);
  });

  it('BB vs SB open has a percent-based call range that excludes the 3-bet range', () => {
    const threeBet = getThreeBetRange('SB', true);
    const call = getVsSbOpenCallRange();
    expect(call.size).toBeGreaterThan(0);
    for (const hand of call) {
      expect(threeBet.has(hand)).toBe(false);
    }
  });
});

describe('BB vs steal defend range (§3.3, kept as separate spec-mandated infra)', () => {
  it('defends more hands than are in the 3-bet range, and never overlaps it', () => {
    const threeBet = getThreeBetRange('CO_BTN', true);
    const defend = getBbVsStealDefendRange(threeBet);
    expect(defend.size).toBeGreaterThan(0);
    for (const hand of defend) {
      expect(threeBet.has(hand)).toBe(false);
    }
  });
});

describe('4-bet ranges', () => {
  it('value range is premium, bluff range is a single suited ace', () => {
    expect(getFourBetValueRange().has('KK')).toBe(true);
    expect(getFourBetValueRange().has('AKs')).toBe(true);
    expect(getFourBetBluffRange()).toEqual(new Set(['A5s']));
  });

  it('facing a 4-bet, only continue with the premium range', () => {
    const cont = getFacingFourBetContinueRange();
    expect(cont.has('QQ')).toBe(true);
    expect(cont.has('JJ')).toBe(false);
  });
});
