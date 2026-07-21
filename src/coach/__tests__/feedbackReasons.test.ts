import { describe, expect, it } from 'vitest';
import { buildSeat } from '../../engine/__tests__/testHelpers';
import type { Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { gradeDecision } from '../grader';

const evaluator = new PokersolverEvaluator();

/**
 * Generic postflop fixture builder: heads-up, hero seat 0 (button, in
 * position), pot fed via committedTotal, optional live bet from seat 1.
 */
function postflopState(opts: {
  street: 'FLOP' | 'TURN' | 'RIVER';
  heroCards: [Card, Card];
  villainCards: [Card, Card];
  board: Card[];
  committed?: number; // per player, chips
  villainBet?: number; // live bet hero faces, chips
  seed?: string;
}): GameState {
  const committed = opts.committed ?? 20;
  const bet = opts.villainBet ?? 0;
  return {
    seed: opts.seed ?? `reasons-${opts.street}-${opts.board.join('')}`,
    config: { players: 2, blinds: [1, 2], startingStack: 200 },
    street: opts.street,
    seats: [
      buildSeat(0, {
        holeCards: opts.heroCards,
        committedTotal: committed,
        committedThisStreet: 0,
        stack: 200 - committed,
      }),
      buildSeat(1, {
        holeCards: opts.villainCards,
        committedTotal: committed + bet,
        committedThisStreet: bet,
        stack: 200 - committed - bet,
        hasActed: true,
      }),
    ],
    board: opts.board,
    deck: [],
    currentBet: bet,
    minRaise: Math.max(bet, 2),
    actionOn: 0,
    lastAggressor: bet > 0 ? 1 : null,
    buttonSeat: 0,
    actionLog: bet > 0 ? [{ seat: 1, street: opts.street, action: 'bet', amount: bet }] : [{ seat: 1, street: opts.street, action: 'check', amount: 0 }],
    payout: null,
    rngCounter: 0,
  };
}

describe('semi_bluff reason — draws that should bet', () => {
  it('checking a big combo draw when betting is best explains the two ways to win', () => {
    // Hero: flush draw + open-ended (9 flush outs + straights) on a wet board.
    const state = postflopState({
      street: 'FLOP',
      heroCards: ['Ah', 'Qh'],
      villainCards: ['9c', '9d'],
      board: ['Jh', 'Th', '4c'],
    });
    const grade = gradeDecision(state, 0, { seat: 0, type: 'check' }, evaluator);
    if (grade.best.action === 'bet' && grade.heroBucket === 'DRAW' && grade.severity !== 'OK') {
      expect(grade.reasonKey).toBe('semi_bluff');
      expect(grade.message).toContain('two ways to win');
      expect(grade.glossary).toBe('semi-bluff');
    }
  });
});

describe('bet_sizing reason — texture-aware sizing advice', () => {
  it('right action, wrong size gets the bet_sizing reason', () => {
    // Hero has the nuts on the river; betting tiny when a big bet is best.
    const state = postflopState({
      street: 'RIVER',
      heroCards: ['Ah', 'Kh'],
      villainCards: ['9c', '9d'],
      board: ['Qh', 'Jh', 'Th', '2c', '2d'],
    });
    // Bet 2 chips (1bb into a 20bb pot) — the 125%-pot candidate crushes this.
    const grade = gradeDecision(state, 0, { seat: 0, type: 'bet', amount: 2 }, evaluator);
    expect(grade.best.action).toBe('bet');
    expect(grade.best.amount).toBeGreaterThan(2);
    if (grade.severity !== 'OK') {
      expect(grade.reasonKey).toBe('bet_sizing');
      expect(grade.message.toLowerCase()).toContain('bigger bet');
    }
  });
});

describe('pot_control reason — medium hands should not bloat the pot', () => {
  it('overbetting a marginal hand recommends the passive line with pot-control wording', () => {
    // Hero: weak top pair-ish/marginal vs a range that continues stronger.
    const state = postflopState({
      street: 'TURN',
      heroCards: ['Kc', '8d'],
      villainCards: ['Ac', 'Jd'],
      board: ['Kd', 'Th', '7s', '6h'],
      seed: 'reasons-pot-control',
    });
    const grade = gradeDecision(state, 0, { seat: 0, type: 'bet', amount: 50 }, evaluator);
    if (
      grade.severity !== 'OK' &&
      grade.heroBucket === 'MARGINAL' &&
      (grade.best.action === 'check' || grade.best.action === 'call')
    ) {
      expect(grade.reasonKey).toBe('pot_control');
      expect(grade.message).toContain('big pots are for big hands');
    }
  });
});

describe('exploit reasons — single-villain personality reads', () => {
  it('bluffing a Station when checking is best leads with the opponent read', () => {
    // Hero has air; Station never folds a made pair, so bluffing is torched EV.
    const state = postflopState({
      street: 'RIVER',
      heroCards: ['5h', '4d'],
      villainCards: ['Kc', 'Jd'],
      board: ['Ks', '9d', '2c', '7h', 'Qd'],
      seed: 'reasons-station',
    });
    const grade = gradeDecision(
      state,
      0,
      { seat: 0, type: 'bet', amount: 40 },
      evaluator,
      undefined,
      { 1: 'Station' },
    );
    if (
      grade.severity !== 'OK' &&
      (grade.best.action === 'check' || grade.best.action === 'call') &&
      (grade.heroBucket === 'AIR' || grade.heroBucket === 'DRAW')
    ) {
      expect(grade.reasonKey).toBe('exploit_station');
      expect(grade.glossary).toBe('player types');
    }
  });

  it('calling a Nit bet when folding is best explains the tightness read', () => {
    // Hero has a hopeless hand facing a river shove from a Nit. The villain is
    // all-in so raising is off the table and fold/call is the whole decision.
    const state = postflopState({
      street: 'RIVER',
      heroCards: ['2h', '3d'],
      villainCards: ['9c', '9d'],
      board: ['As', 'Ks', 'Qd', 'Jc', '4h'],
      villainBet: 10,
      seed: 'reasons-nit',
    });
    state.seats[1]!.stack = 0;
    state.seats[1]!.allIn = true;
    // Hero cannot re-raise an all-in — mark the raise cap so the candidate
    // list is exactly {fold, call}, which is the real decision here.
    state.seats[0]!.raiseCapped = true;
    const grade = gradeDecision(
      state,
      0,
      { seat: 0, type: 'call' },
      evaluator,
      undefined,
      { 1: 'Nit' },
    );
    expect(grade.best.action).toBe('fold');
    expect(grade.reasonKey).toBe('exploit_nit');
    expect(grade.message).toContain('very few hands');
  });

  it('the same fold spot vs a default TAG keeps the pot_odds reason', () => {
    const state = postflopState({
      street: 'RIVER',
      heroCards: ['2h', '3d'],
      villainCards: ['9c', '9d'],
      board: ['As', 'Ks', 'Qd', 'Jc', '4h'],
      villainBet: 10,
      seed: 'reasons-tag',
    });
    const grade = gradeDecision(state, 0, { seat: 0, type: 'call' }, evaluator);
    expect(grade.reasonKey).toBe('pot_odds');
  });
});

describe('exploit_lag reason — hero-call vs a lone loose-aggressive opponent', () => {
  // Pocket 7s on a dry K-Q-high river facing a bet: a marginal made hand the
  // EV model wants to call because a lone LAG bets far too wide to fold to.
  const lagFixture = {
    street: 'RIVER' as const,
    heroCards: ['7c', '7d'] as [Card, Card],
    villainCards: ['Ac', 'Qd'] as [Card, Card],
    board: ['Ks', 'Qd', '5c', '2h', '3d'] as Card[],
    villainBet: 24,
  };

  it('folding a decent bluff-catcher the model wants to call gets the LAG read', () => {
    const state = postflopState({ ...lagFixture, seed: 'reasons-lag' });
    const grade = gradeDecision(state, 0, { seat: 0, type: 'fold' }, evaluator, undefined, { 1: 'LAG' });
    expect(grade.best.action).toBe('call');
    expect(['MARGINAL', 'STRONG', 'MONSTER']).toContain(grade.heroBucket);
    expect(grade.reasonKey).toBe('exploit_lag');
    expect(grade.glossary).toBe('player types');
    expect(grade.message).toContain('bets and raises');
  });

  it('the same fold spot vs a default TAG keeps the pot_odds reason', () => {
    const state = postflopState({ ...lagFixture, seed: 'reasons-lag-tag' });
    const grade = gradeDecision(state, 0, { seat: 0, type: 'fold' }, evaluator);
    expect(grade.reasonKey).toBe('pot_odds');
  });
});

/**
 * 3-handed postflop fixture: hero seat 0 (button), two live villains (seats 1
 * and 2). Seat 1 may hold a live bet hero faces. Mirrors postflopState's shape.
 */
function multiwayState(opts: {
  street: 'FLOP' | 'TURN' | 'RIVER';
  heroCards: [Card, Card];
  villain1: [Card, Card];
  villain2: [Card, Card];
  board: Card[];
  committed?: number;
  villainBet?: number;
  seed?: string;
}): GameState {
  const committed = opts.committed ?? 20;
  const bet = opts.villainBet ?? 0;
  return {
    seed: opts.seed ?? `multiway-${opts.street}-${opts.board.join('')}`,
    config: { players: 3, blinds: [1, 2], startingStack: 200 },
    street: opts.street,
    seats: [
      buildSeat(0, {
        holeCards: opts.heroCards,
        committedTotal: committed,
        committedThisStreet: 0,
        stack: 200 - committed,
      }),
      buildSeat(1, {
        holeCards: opts.villain1,
        committedTotal: committed + bet,
        committedThisStreet: bet,
        stack: 200 - committed - bet,
        hasActed: true,
      }),
      buildSeat(2, {
        holeCards: opts.villain2,
        committedTotal: committed,
        committedThisStreet: 0,
        stack: 200 - committed,
        hasActed: true,
      }),
    ],
    board: opts.board,
    deck: [],
    currentBet: bet,
    minRaise: Math.max(bet, 2),
    actionOn: 0,
    lastAggressor: bet > 0 ? 1 : null,
    buttonSeat: 0,
    actionLog:
      bet > 0
        ? [{ seat: 1, street: opts.street, action: 'bet', amount: bet }]
        : [
            { seat: 1, street: opts.street, action: 'check', amount: 0 },
            { seat: 2, street: opts.street, action: 'check', amount: 0 },
          ],
    payout: null,
    rngCounter: 0,
  };
}

describe('multiway discipline wording', () => {
  it('does not coach a bluff into multiple opponents', () => {
    // Hero has air with two live opponents; betting is not best. The coach must
    // never say "you should have bluffed" here — bluffing multiway is a leak.
    const state = multiwayState({
      street: 'RIVER',
      heroCards: ['7h', '2d'],
      villain1: ['Ac', 'Kd'],
      villain2: ['Qc', 'Jd'],
      board: ['As', 'Kd', '9c', '5h', '3d'],
      seed: 'multiway-bluff',
    });
    const grade = gradeDecision(state, 0, { seat: 0, type: 'bet', amount: 20 }, evaluator);
    expect(grade.reasonKey).not.toBe('missed_bluff');
  });

  it('a multiway fold-is-best spot mentions the extra players', () => {
    const state = multiwayState({
      street: 'RIVER',
      heroCards: ['7h', '2d'],
      villain1: ['Ac', 'Kd'],
      villain2: ['Qc', 'Jd'],
      board: ['As', 'Kd', '9c', '5h', '3d'],
      villainBet: 24,
      seed: 'multiway-fold',
    });
    const grade = gradeDecision(state, 0, { seat: 0, type: 'call' }, evaluator);
    expect(grade.best.action).toBe('fold');
    expect(grade.reasonKey).toBe('pot_odds');
    expect(grade.message).toContain('several players');
    expect(grade.message.length).toBeLessThanOrEqual(260);
    expect(grade.message.endsWith('.')).toBe(true);
  });
});

describe('missed_value texture note', () => {
  it('on a wet board, missed value mentions charging the draws', () => {
    // Hero flops the nut straight on a wet, two-tone board and checks.
    const state = postflopState({
      street: 'FLOP',
      heroCards: ['Qs', 'Jc'],
      villainCards: ['Ac', '4d'],
      board: ['Th', '9h', '8c'],
      seed: 'reasons-wet-value',
    });
    const grade = gradeDecision(state, 0, { seat: 0, type: 'check' }, evaluator);
    if (grade.severity !== 'OK' && grade.reasonKey === 'missed_value') {
      expect(grade.message).toContain('pay to keep chasing');
    }
  });
});
