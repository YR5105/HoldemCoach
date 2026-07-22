import { describe, expect, it } from 'vitest';
import type { CoachAnnotation, HandDoc } from '../handHistory';
import { computeStats } from '../stats';

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

function heroAct(action: string, c: CoachAnnotation): Act {
  return { seat: 0, street: 'FLOP', action, amount: 0, hero: true, coach: c };
}

function docOf(actions: Act[]): HandDoc {
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

describe('pattern stats — chasing (spec §6 R7)', () => {
  it('counts draw-vs-bet spots and how many leaked', () => {
    const actions: Act[] = [];
    // 12 draw + facing_bet spots; 8 leak (non-OK), 4 clean.
    for (let i = 0; i < 8; i++) {
      actions.push(heroAct('call', coach({ heroBucket: 'DRAW', category: 'facing_bet', severity: 'MISTAKE', evLoss: 1 })));
    }
    for (let i = 0; i < 4; i++) {
      actions.push(heroAct('call', coach({ heroBucket: 'DRAW', category: 'facing_bet', severity: 'OK' })));
    }
    // Noise that must NOT count as chasing: a draw NOT facing a bet, and a made hand facing a bet.
    actions.push(heroAct('bet', coach({ heroBucket: 'DRAW', category: 'cbet', severity: 'MISTAKE', evLoss: 1 })));
    actions.push(heroAct('call', coach({ heroBucket: 'STRONG', category: 'facing_bet', severity: 'MISTAKE', evLoss: 1 })));

    const p = computeStats([docOf(actions)], []).patterns;
    expect(p.chaseSpots).toBe(12);
    expect(p.chaseLeaks).toBe(8);
    expect(p.chaseRate).toBeCloseTo(8 / 12, 5);
  });
});

describe('pattern stats — readability (spec §6 R7)', () => {
  it('measures how differently hero plays made hands vs draws', () => {
    const actions: Act[] = [];
    // 10 strong made hands: 8 aggressive (bet/raise), 2 passive.
    for (let i = 0; i < 5; i++) actions.push(heroAct('bet', coach({ heroBucket: 'MONSTER' })));
    for (let i = 0; i < 3; i++) actions.push(heroAct('raise', coach({ heroBucket: 'STRONG' })));
    for (let i = 0; i < 2; i++) actions.push(heroAct('check', coach({ heroBucket: 'STRONG' })));
    // 10 draws: 3 aggressive, 7 passive.
    for (let i = 0; i < 3; i++) actions.push(heroAct('bet', coach({ heroBucket: 'DRAW' })));
    for (let i = 0; i < 7; i++) actions.push(heroAct('call', coach({ heroBucket: 'DRAW' })));

    const p = computeStats([docOf(actions)], []).patterns;
    expect(p.madeSpots).toBe(10);
    expect(p.aggMadeRate).toBeCloseTo(0.8, 5);
    expect(p.drawSpots).toBe(10);
    expect(p.aggDrawRate).toBeCloseTo(0.3, 5);
    expect(p.readabilityGap).toBeCloseTo(0.5, 5);
  });
});

describe('pattern stats — backward compatibility', () => {
  it('skips annotations without heroBucket without error', () => {
    const actions: Act[] = [
      // Pre-R7 record: no heroBucket. Looks like a chase spot but must be skipped.
      heroAct('call', coach({ category: 'facing_bet', severity: 'MISTAKE', evLoss: 1 })),
      // One real chase spot with the field present.
      heroAct('call', coach({ heroBucket: 'DRAW', category: 'facing_bet', severity: 'MISTAKE', evLoss: 1 })),
    ];
    const p = computeStats([docOf(actions)], []).patterns;
    expect(p.chaseSpots).toBe(1); // only the record carrying heroBucket
    expect(p.chaseLeaks).toBe(1);
    expect(p.madeSpots).toBe(0);
    expect(p.drawSpots).toBe(1);
  });
});
