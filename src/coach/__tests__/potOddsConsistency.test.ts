import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Action, Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { decideBotAction } from '../../bots/botPolicy';
import { gradeDecision, isGradableDecision } from '../grader';

const evaluator = new PokersolverEvaluator();

/**
 * Flop spot where hero (seat 0) faces seat 1's all-in and would be all-in to
 * call — so every remaining card is dealt with no further betting and hero
 * realizes 100% of their equity. Raw pot-odds price here is ~33%.
 */
function allInFlop(heroCards: Card[]): GameState {
  const stack = 40;
  return {
    seed: 'potodds-allin',
    config: { players: 2, blinds: [1, 2], startingStack: 200 },
    street: 'FLOP',
    seats: [
      { seatIndex: 0, stack, folded: false, allIn: false, committedThisStreet: 0, committedTotal: 20, hasActed: false, raiseCapped: false, sittingOut: false, holeCards: heroCards },
      { seatIndex: 1, stack: 0, folded: false, allIn: true, committedThisStreet: stack, committedTotal: 20 + stack, hasActed: true, raiseCapped: false, sittingOut: false, holeCards: ['Ac', 'Kc'] as Card[] },
    ],
    board: ['3s', '6c', 'Qc'],
    deck: [],
    currentBet: stack,
    minRaise: 2,
    actionOn: 0,
    lastAggressor: 1,
    buttonSeat: 0,
    actionLog: [{ seat: 1, street: 'FLOP', action: 'bet', amount: stack }],
    payout: null,
    rngCounter: 0,
  };
}

// ---------------------------------------------------------------------------
// The reported bug: an all-in call priced in at ~38% equity vs a ~33% price
// was told to fold — because the grader wrongly discounted equity by a flop
// realization factor even though an all-in realizes 100% of it. That produced
// "Folding was the better play … the pot was offering a good price", which is
// self-contradictory. Both the verdict and the wording must now be correct.
// ---------------------------------------------------------------------------

describe('all-in equity is fully realized', () => {
  it('recommends calling a priced-in all-in (does not falsely fold), with matching wording', () => {
    const state = allInFlop(['Jh', '9d']); // ~38% equity, above the ~33% price
    const grade = gradeDecision(state, 0, { seat: 0, type: 'fold' }, evaluator);

    expect(grade.equity).toBeGreaterThan(0.33); // hero beats the price
    // With full realization (all-in) calling is +EV, so it is the better play.
    // A flop realization discount (R < 1) would have wrongly folded this.
    expect(grade.best.action).toBe('call');
    expect(grade.severity).not.toBe('OK'); // folding a priced-in call is a mistake

    expect(grade.message).toContain('Calling was the better play');
    expect(grade.message).toContain('good price');
    expect(grade.message).not.toContain('Folding was the better play');
  });

  it('still folds an all-in that is genuinely below the price — with matching wording', () => {
    const state = allInFlop(['8h', '7h']); // ~29% equity, below the ~33% price
    const grade = gradeDecision(state, 0, { seat: 0, type: 'call' }, evaluator);

    expect(grade.best.action).toBe('fold');
    expect(grade.message).toContain('Folding was the better play');
    expect(grade.message).toContain('The price was too high');
    expect(grade.message).not.toContain('good price');
  });
});

// ---------------------------------------------------------------------------
// General invariant: the coach must never contradict its own recommendation.
// ---------------------------------------------------------------------------

function legalActions(state: GameState, seat: number): Action[] {
  const legal = getLegalActions(state, seat);
  const acts: Action[] = [];
  if (legal.canFold) acts.push({ seat, type: 'fold' });
  if (legal.canCheck) acts.push({ seat, type: 'check' });
  if (legal.canCall) acts.push({ seat, type: 'call' });
  if (legal.canBet) acts.push({ seat, type: 'bet', amount: legal.minTo });
  if (legal.canRaise) acts.push({ seat, type: 'raise', amount: legal.minTo });
  return acts;
}

function playoutSpots(seeds: string[], cap: number, players = 3) {
  const spots: { state: GameState; heroSeat: number }[] = [];
  for (const seed of seeds) {
    let s = startHand(createInitialState({ players, blinds: [1, 2], startingStack: 200 }, seed, 0));
    let guard = 0;
    while (s.payout === null && s.actionOn >= 0 && guard++ < 300) {
      if (isGradableDecision(s, s.actionOn)) {
        spots.push({ state: s, heroSeat: s.actionOn });
        if (spots.length >= cap) return spots;
      }
      s = applyAction(s, decideBotAction(s, s.actionOn, 'TAG', evaluator), evaluator);
    }
  }
  return spots;
}

describe('the coach never contradicts itself on price', () => {
  it('"good price" only appears when the advice is to continue; "too high" only when it is to fold', () => {
    const spots = playoutSpots(Array.from({ length: 30 }, (_, i) => `pc-${i}`), 34);
    // Plus the crafted all-in spots across a spread of hero hands.
    for (const cards of [['Jh', '9d'], ['8h', '7h'], ['Ah', '2d'], ['5h', '4h']] as Card[][]) {
      spots.push({ state: allInFlop(cards), heroSeat: 0 });
    }

    let checked = 0;
    for (const { state, heroSeat } of spots) {
      for (const act of legalActions(state, heroSeat)) {
        const g = gradeDecision(state, heroSeat, act, evaluator);
        const msg = g.message;
        if (msg.includes('good price')) {
          expect(g.best.action, `good-price with fold advice: "${msg}"`).not.toBe('fold');
        }
        if (msg.includes('The price was too high')) {
          expect(g.best.action, `too-high without fold advice: "${msg}"`).toBe('fold');
        }
        // The exact self-contradiction from the bug report must never occur.
        expect(
          msg.includes('good price') && msg.includes('Folding was the better play'),
          `self-contradiction: "${msg}"`,
        ).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  }, 30000);
});
