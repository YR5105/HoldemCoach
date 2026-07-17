import { describe, expect, it } from 'vitest';
import { positionForSeat } from '../position';

describe('positionForSeat', () => {
  it('labels a 6-max table in standard preflop acting order', () => {
    const button = 0;
    const n = 6;
    // seat (button+3)%6 = UTG ... wrapping through to SB, BB.
    expect(positionForSeat(button, 3, n)).toBe('UTG');
    expect(positionForSeat(button, 4, n)).toBe('HJ');
    expect(positionForSeat(button, 5, n)).toBe('CO');
    expect(positionForSeat(button, 0, n)).toBe('BTN');
    expect(positionForSeat(button, 1, n)).toBe('SB');
    expect(positionForSeat(button, 2, n)).toBe('BB');
  });

  it('is relative to the button, not absolute seat index', () => {
    const button = 3;
    const n = 6;
    expect(positionForSeat(button, button, n)).toBe('BTN');
    expect(positionForSeat(button, (button + 1) % n, n)).toBe('SB');
    expect(positionForSeat(button, (button + 2) % n, n)).toBe('BB');
  });

  it('heads-up: button is SB, the other seat is BB', () => {
    expect(positionForSeat(0, 0, 2)).toBe('SB');
    expect(positionForSeat(0, 1, 2)).toBe('BB');
  });

  it('3-handed: button acts first (UTG-equivalent) but keeps the BTN label', () => {
    expect(positionForSeat(0, 0, 3)).toBe('BTN');
    expect(positionForSeat(0, 1, 3)).toBe('SB');
    expect(positionForSeat(0, 2, 3)).toBe('BB');
  });

  it('every seat at a table gets a distinct position', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const labels = new Set<string>();
      for (let seat = 0; seat < n; seat++) {
        labels.add(positionForSeat(0, seat, n) + ':' + seat);
      }
      expect(labels.size).toBe(n);
    }
  });
});
