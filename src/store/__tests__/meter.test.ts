import { describe, expect, it } from 'vitest';
import { METER_START, meterAfter } from '../gameStore';
import type { GradeResult } from '../../coach/graderTypes';

/** Minimal grade stub — meterAfter only reads severity + evLossBb. */
function g(severity: GradeResult['severity'], evLossBb: number): Pick<GradeResult, 'severity' | 'evLossBb'> {
  return { severity, evLossBb };
}

describe('performance meter (spec §6 R5)', () => {
  it('starts at 75 and rewards OK / punishes by EV lost', () => {
    expect(METER_START).toBe(75);
    // Sequence from the acceptance criteria: OK, OK, Inaccuracy(0.3bb), Blunder(6bb).
    let v = METER_START; // 75
    v = meterAfter(v, g('OK', 0)); // +2 -> 77
    v = meterAfter(v, g('OK', 0)); // +2 -> 79
    v = meterAfter(v, g('INACCURACY', 0.3)); // -min(20, round(1.2)) = -1 -> 78
    v = meterAfter(v, g('BLUNDER', 6)); // -min(20, round(24)) = -20 -> 58
    expect(v).toBe(58);
  });

  it('caps at 100 and never dips below 0', () => {
    expect(meterAfter(100, g('OK', 0))).toBe(100); // already at cap
    expect(meterAfter(99, g('OK', 0))).toBe(100); // +2 would overshoot
    expect(meterAfter(5, g('BLUNDER', 100))).toBe(0); // big loss floors at 0
    expect(meterAfter(0, g('MISTAKE', 1))).toBe(0);

    let v = METER_START;
    for (let i = 0; i < 50; i++) v = meterAfter(v, g('BLUNDER', 6));
    expect(v).toBe(0);
    for (let i = 0; i < 50; i++) v = meterAfter(v, g('OK', 0));
    expect(v).toBe(100);
  });

  it('clamps a single blunder drop to at most 20 points', () => {
    // round(evLoss*4) can exceed 20; the drop is clamped there.
    expect(meterAfter(75, g('BLUNDER', 6))).toBe(55); // -20, not -24
    expect(meterAfter(75, g('MISTAKE', 1))).toBe(71); // -min(20, round(4)) = -4
  });
});
