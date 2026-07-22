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

const { DashboardScreen, READABILITY_COPY } = await import('../DashboardScreen');

function coach(o: Partial<CoachAnnotation>): CoachAnnotation {
  return {
    equity: 0.5,
    best: 'bet',
    evLoss: 0,
    severity: 'OK',
    reasonKey: 'pot_odds',
    message: 'm',
    category: 'facing_bet',
    ...o,
  };
}

type Act = HandDoc['actions'][number];
const heroAct = (action: string, c: CoachAnnotation): Act => ({ seat: 0, street: 'FLOP', action, amount: 0, hero: true, coach: c });

function pushHand(actions: Act[]) {
  hands.push({
    id: `h-${Math.random()}`,
    ts: Date.now(),
    seed: 's',
    config: { players: 2, blinds: [1, 2], heroSeat: 0, bots: ['TAG'], buttonSeat: 0, startingStack: 200 },
    holeCards: {},
    board: [],
    actions,
    result: { winners: [0], potAwarded: [], showdown: false },
  });
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

describe('dashboard "Are you readable?" card (spec §6 R7)', () => {
  it('shows the chasing line once there are enough draw-vs-bet spots', async () => {
    const actions: Act[] = [];
    for (let i = 0; i < 8; i++) actions.push(heroAct('call', coach({ heroBucket: 'DRAW', category: 'facing_bet', severity: 'MISTAKE', evLoss: 1 })));
    for (let i = 0; i < 4; i++) actions.push(heroAct('call', coach({ heroBucket: 'DRAW', category: 'facing_bet', severity: 'OK' })));
    pushHand(actions); // chaseSpots = 12, chaseRate = 8/12 ≈ 0.67 (>= 0.5)

    render(<DashboardScreen />);

    const line = await screen.findByTestId('chasing-line');
    expect(line.textContent).toContain('flush or straight draw');
    expect(line.textContent).toContain('67%');
  });

  it('renders nothing at only 5 draw-vs-bet spots, however bad the rate', async () => {
    const actions: Act[] = [];
    for (let i = 0; i < 5; i++) actions.push(heroAct('call', coach({ heroBucket: 'DRAW', category: 'facing_bet', severity: 'BLUNDER', evLoss: 3 })));
    pushHand(actions); // chaseSpots = 5 (below the gate) with rate 1.0

    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByText('Hands played')).toBeTruthy());
    expect(screen.queryByTestId('chasing-line')).toBeNull();
    expect(screen.queryByTestId('readability-line')).toBeNull();
  });

  it('shows the readability line when made and draw play diverge enough', async () => {
    const actions: Act[] = [];
    for (let i = 0; i < 9; i++) actions.push(heroAct('bet', coach({ heroBucket: 'MONSTER' })));
    actions.push(heroAct('check', coach({ heroBucket: 'STRONG' }))); // 10 made, aggMadeRate 0.9
    for (let i = 0; i < 2; i++) actions.push(heroAct('bet', coach({ heroBucket: 'DRAW' })));
    for (let i = 0; i < 8; i++) actions.push(heroAct('call', coach({ heroBucket: 'DRAW' }))); // 10 draws, aggDrawRate 0.2 -> gap 0.7
    pushHand(actions);

    render(<DashboardScreen />);

    const line = await screen.findByTestId('readability-line');
    expect(line.textContent).toContain('90%');
    expect(line.textContent).toContain('20%');
  });

  it('every card string is plain English (no banned jargon tokens)', () => {
    const samples = [READABILITY_COPY.chasing(60), READABILITY_COPY.readability(90, 20)];
    for (const text of samples) {
      for (const pattern of JARGON) {
        expect(pattern.test(text), `jargon ${pattern} in "${text}"`).toBe(false);
      }
    }
  });
});
