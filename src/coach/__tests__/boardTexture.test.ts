import { describe, expect, it } from 'vitest';
import type { Card } from '../../engine/types';
import { classifyBoardTexture } from '../boardTexture';

describe('classifyBoardTexture', () => {
  it('returns null preflop (no board)', () => {
    expect(classifyBoardTexture([])).toBeNull();
    expect(classifyBoardTexture(['Ks', '7d'] as Card[])).toBeNull();
  });

  it('classic dry boards are DRY', () => {
    expect(classifyBoardTexture(['Ks', '7d', '2c'] as Card[])).toBe('DRY'); // rainbow, disconnected
    expect(classifyBoardTexture(['Ah', '8s', '3d'] as Card[])).toBe('DRY');
    expect(classifyBoardTexture(['Qc', 'Qd', '2h'] as Card[])).toBe('DRY'); // paired boards block draws
    expect(classifyBoardTexture(['Kh', '7h', '2d'] as Card[])).toBe('DRY'); // one backdoor suit alone isn't wet
  });

  it('coordinated / suited boards are WET', () => {
    expect(classifyBoardTexture(['9h', '8h', '6s'] as Card[])).toBe('WET'); // connected + two-tone
    expect(classifyBoardTexture(['7d', '6c', '5s'] as Card[])).toBe('WET'); // very connected rainbow
    expect(classifyBoardTexture(['As', 'Ks', 'Qs'] as Card[])).toBe('WET'); // monotone broadway
    expect(classifyBoardTexture(['Qh', 'Jh', '2d'] as Card[])).toBe('WET'); // connected + flush draw
  });

  it('handles 4- and 5-card boards', () => {
    expect(classifyBoardTexture(['Ks', '7d', '2c', '2s'] as Card[])).toBe('DRY');
    expect(classifyBoardTexture(['9h', '8h', '6s', '7c'] as Card[])).toBe('WET');
  });
});
