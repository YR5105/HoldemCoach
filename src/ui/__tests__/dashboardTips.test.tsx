// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { CoachAnnotation, HandDoc } from '../../store/handHistory';

// Controlled hand history: DashboardScreen loads hands via listHands/listGuesses.
const hands: HandDoc[] = [];
vi.mock('../../store/handHistory', () => ({
  listHands: () => Promise.resolve(hands),
  listGuesses: () => Promise.resolve([]),
}));

// Import after the mock is registered.
const { DashboardScreen, LEAK_TIPS } = await import('../DashboardScreen');

function coach(overrides: Partial<CoachAnnotation>): CoachAnnotation {
  return {
    equity: 0.5,
    best: 'bet',
    evLoss: 0,
    severity: 'OK',
    reasonKey: 'pot_odds',
    message: 'placeholder',
    category: 'preflop',
    ...overrides,
  };
}

function handWith(actions: HandDoc['actions']): HandDoc {
  return {
    id: `h-${Math.random()}`,
    ts: Date.now(),
    seed: 's',
    config: { players: 2, blinds: [1, 2], heroSeat: 0, bots: ['TAG'], buttonSeat: 0, startingStack: 200 },
    holeCards: {},
    board: [],
    actions,
    result: { winners: [0], potAwarded: [], showdown: false },
  };
}

afterEach(() => {
  hands.length = 0;
  cleanup();
});

// Same jargon list the coach's plain-English guard enforces.
const JARGON: RegExp[] = [
  /\bbb\b/,
  /\bEV\b/,
  /\bequity\b/,
  /\bGTO\b/,
  /\brange\b/,
  /\bc-?bet\b/,
  /\bUTG\b/,
  /\bHJ\b/,
  /\bCO\b/,
  /\bBTN\b/,
  /\bSB\b/,
  /\bBB\b/,
  /\b[2-9TJQKA][2-9TJQKA][os]\b/,
  /\+\d+(\.\d+)?bb/,
];

describe('dashboard leak tips', () => {
  it('renders the tip for the single worst (highest EV lost) category', async () => {
    hands.push(
      handWith([
        // Dominant sizing leak.
        { seat: 0, street: 'FLOP', action: 'bet', amount: 5, hero: true, coach: coach({ category: 'sizing', severity: 'MISTAKE', evLoss: 6 }) },
        // A smaller preflop leak that must lose the tie-break.
        { seat: 0, street: 'PREFLOP', action: 'call', amount: 2, hero: true, coach: coach({ category: 'preflop', severity: 'INACCURACY', evLoss: 0.4 }) },
      ]),
    );

    render(<DashboardScreen />);

    const tip = await screen.findByTestId('leak-tip');
    expect(tip.textContent).toContain(LEAK_TIPS.sizing);
    expect(tip.textContent).toContain('small bets work on dry boards');
  });

  it('shows no tip when there are no leaks yet', async () => {
    hands.push(
      handWith([
        { seat: 0, street: 'PREFLOP', action: 'call', amount: 2, hero: true, coach: coach({ severity: 'OK', evLoss: 0 }) },
      ]),
    );

    render(<DashboardScreen />);
    // Wait for the async load to settle (stat tiles appear), then assert no tip.
    await waitFor(() => expect(screen.getByText('Hands played')).toBeTruthy());
    expect(screen.queryByTestId('leak-tip')).toBeNull();
  });

  it('every tip is plain English (no banned jargon tokens)', () => {
    for (const [category, tip] of Object.entries(LEAK_TIPS)) {
      for (const pattern of JARGON) {
        expect(pattern.test(tip), `jargon ${pattern} in ${category} tip: "${tip}"`).toBe(false);
      }
    }
  });
});
