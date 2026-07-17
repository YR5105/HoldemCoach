import { describe, expect, it } from 'vitest';
import { decideBotAction } from '../../bots/botPolicy';
import { createInitialState, startHand } from '../../engine/state';
import type { Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { gradeDecision } from '../grader';
import { HAND_STRENGTH_ORDER } from '../handStrength';
import { getOpenRaiseRange } from '../ranges';

const evaluator = new PokersolverEvaluator();

/** Turns a canonical hand ("AQo", "88", "T9s") into two concrete hole cards. */
function handToCards(hand: string): [Card, Card] {
  if (hand.length === 2) return [`${hand[0]}h` as Card, `${hand[0]}d` as Card];
  const [hi, lo, suited] = [hand[0], hand[1], hand[2]];
  return suited === 's'
    ? [`${hi}h` as Card, `${lo}h` as Card]
    : [`${hi}h` as Card, `${lo}d` as Card];
}

/** 6-max, unopened pot, hero (seat 3) is UTG and first to act. */
function utgRfi(seed: string, cards: [Card, Card]): GameState {
  const s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
  const clone = structuredClone(s);
  clone.seats[3]!.holeCards = cards;
  return clone;
}

// ---------------------------------------------------------------------------
// Foundation: the bots' preflop decision matches the published charts exactly.
// Bots and the coach share this "one range model", so if the coach ever tells
// you to play a hand differently from how the bots play it, that shows up as a
// divergence here or in the grader-vs-bot check below.
// ---------------------------------------------------------------------------
describe('bot RFI decisions match the UTG chart for all 169 hands', () => {
  it('opens exactly the charted hands, folds the rest', () => {
    const range = getOpenRaiseRange('UTG');
    for (const hand of HAND_STRENGTH_ORDER) {
      const state = utgRfi(`rfi-${hand}`, handToCards(hand));
      const action = decideBotAction(state, 3, 'TAG');
      const entered = action.type === 'raise' || action.type === 'bet';
      expect(entered, `${hand}: chart ${range.has(hand) ? 'opens' : 'folds'} but bot ${action.type}s`).toBe(
        range.has(hand),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The coach's recommendation matches that same chart decision, and the
// user-facing message never points the opposite direction from its headline.
// A curated set spanning clearly-in, boundary, and clearly-out hands (full MC
// grading is too slow to run on all 169).
// ---------------------------------------------------------------------------
describe('grader RFI recommendation matches the chart and reads consistently', () => {
  const sample = [
    'AA', 'KK', 'QQ', 'AKo', 'AQo', 'AJo', // in range
    'A9s', 'KTs', 'QTs', 'JTs', 'T9s', '98s', '22', 'KQo', // in range
    'ATo', 'A8s', 'KJo', '87s', '76s', 'Q9s', 'J9s', // out of range for UTG
    '72o', 'T8o', '53o', 'J5o', // clearly out
  ];

  it(
    'each hand: best action matches chart + bot, message is consistent, chart-fold folds grade OK',
    () => {
      const range = getOpenRaiseRange('UTG');
      for (const hand of sample) {
        const state = utgRfi(`grade-${hand}`, handToCards(hand));
        const grade = gradeDecision(state, 3, { seat: 3, type: 'fold' }, evaluator);
        const bot = decideBotAction(state, 3, 'TAG');
        const chartWantsRaise = range.has(hand);

        // 1. The coach recommends the chart action.
        expect(grade.best.action, `${hand} best action`).toBe(chartWantsRaise ? 'raise' : 'fold');

        // 2. Grader and bot (independent implementations of the same chart)
        //    agree on whether to enter the pot.
        const botEnters = bot.type === 'raise' || bot.type === 'bet';
        expect(botEnters, `${hand} bot agreement`).toBe(chartWantsRaise);

        // 3. The message never points the opposite way from its headline.
        const msg = grade.message.toLowerCase();
        const recommendsEntering = msg.includes('raising') || msg.includes('calling');
        const rationaleIsFold = msg.includes('too weak') || msg.includes('fold it here');
        expect(recommendsEntering && rationaleIsFold, `${hand} contradiction: ${msg}`).toBe(false);

        // 4. Folding a hand the chart also folds is never penalized.
        if (!chartWantsRaise) expect(grade.severity, `${hand} fine fold`).toBe('OK');
      }
    },
    30_000,
  );
});
