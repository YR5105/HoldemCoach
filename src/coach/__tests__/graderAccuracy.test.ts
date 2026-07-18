import { describe, expect, it } from 'vitest';
import { decideBotAction } from '../../bots/botPolicy';
import { applyAction } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { gradeDecision } from '../grader';
import { HAND_STRENGTH_ORDER } from '../handStrength';
import type { Position } from '../position';
import {
  classifyOpener,
  getCallRange,
  getOpenRaiseRange,
  getThreeBetRange,
  getVsSbOpenCallRange,
  type OpenRaisePosition,
} from '../ranges';

const evaluator = new PokersolverEvaluator();

type Enter = 'raise' | 'call' | 'fold';

/** Turns a canonical hand ("AQo", "88", "T9s") into two concrete hole cards. */
function handToCards(hand: string): [Card, Card] {
  if (hand.length === 2) return [`${hand[0]}h` as Card, `${hand[0]}d` as Card];
  const [hi, lo, suited] = [hand[0], hand[1], hand[2]];
  return suited === 's'
    ? [`${hi}h` as Card, `${lo}h` as Card]
    : [`${hi}h` as Card, `${lo}d` as Card];
}

// Button seat that puts the hero (seat 3) at each 6-max position, first to act
// unopened only after the earlier seats fold (see driveToHero).
const HERO_SEAT = 3;
const BUTTON_FOR_POSITION: Record<Position, number> = {
  UTG: 0, HJ: 5, CO: 4, BTN: 3, SB: 2, BB: 1,
};

/**
 * Plays the pot forward to the hero's turn: the designated opener (if any)
 * makes the first raise, everyone else before the hero folds. Leaves an
 * unopened pot when `openerSeat` is null.
 */
function driveToHero(seed: string, position: Position, cards: [Card, Card], openerSeat: number | null): GameState {
  let s = startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, BUTTON_FOR_POSITION[position]));
  s = structuredClone(s);
  s.seats[HERO_SEAT]!.holeCards = cards;
  let guard = 0;
  while (s.actionOn !== HERO_SEAT && s.street === 'PREFLOP') {
    if (guard++ > 12) throw new Error(`could not reach hero for ${position}`);
    const seat = s.actionOn;
    s = seat === openerSeat
      ? applyAction(s, { seat, type: 'raise', amount: 5 })
      : applyAction(s, { seat, type: 'fold' });
  }
  return s;
}

// ---------------------------------------------------------------------------
// Foundation: the bots' preflop decisions match the published charts for every
// one of the 169 starting hands, at every open position and facing every
// opener class. Bots and the coach share this "one range model", so a coach
// that ever disagreed with the bots would surface as a failure here or in the
// grader-vs-bot check below.
// ---------------------------------------------------------------------------
describe('bot preflop decisions match the charts for all 169 hands', () => {
  const openPositions: OpenRaisePosition[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];

  it('raise-first-in: opens exactly the charted hands at every position', () => {
    for (const pos of openPositions) {
      const range = getOpenRaiseRange(pos);
      for (const hand of HAND_STRENGTH_ORDER) {
        const state = driveToHero(`rfi-${pos}-${hand}`, pos, handToCards(hand), null);
        const action = decideBotAction(state, HERO_SEAT, 'TAG');
        const entered = action.type === 'raise' || action.type === 'bet';
        expect(entered, `${pos} ${hand}: chart ${range.has(hand) ? 'opens' : 'folds'} but bot ${action.type}s`).toBe(
          range.has(hand),
        );
      }
    }
  });

  // Hero is BB (seat 3, button seat 1); the opener sits in the seat matching
  // each opener class under that button: UTG=4, CO=0, SB=2.
  const facing: { label: string; openerSeat: number; openerClass: ReturnType<typeof classifyOpener> }[] = [
    { label: 'EP open (UTG)', openerSeat: 4, openerClass: 'EP_MP' },
    { label: 'CO open', openerSeat: 0, openerClass: 'CO_BTN' },
    { label: 'SB open', openerSeat: 2, openerClass: 'SB' },
  ];

  function expectedVsOpen(openerClass: ReturnType<typeof classifyOpener>, hand: string): Enter {
    const threeBet = getThreeBetRange(openerClass, true); // hero in BB -> fromBlinds
    if (threeBet.has(hand)) return 'raise';
    const call = openerClass === 'SB' ? getVsSbOpenCallRange() : getCallRange(openerClass, 'BB');
    if (call?.has(hand)) return 'call';
    return 'fold';
  }

  it('facing an open from the big blind: 3-bets / calls / folds per the charts', () => {
    for (const { label, openerSeat, openerClass } of facing) {
      for (const hand of HAND_STRENGTH_ORDER) {
        const state = driveToHero(`vs-${label}-${hand}`, 'BB', handToCards(hand), openerSeat);
        const action = decideBotAction(state, HERO_SEAT, 'TAG');
        const got: Enter = action.type === 'raise' || action.type === 'bet' ? 'raise' : action.type === 'call' ? 'call' : 'fold';
        expect(got, `${label} ${hand}`).toBe(expectedVsOpen(openerClass, hand));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The coach's recommendation matches that same chart decision AND the bot's
// action, the message never points opposite its headline, and a chart-approved
// action always grades OK. Full Monte Carlo grading is slow, so this runs on a
// curated in/boundary/out sample per scenario.
// ---------------------------------------------------------------------------
describe('grader preflop recommendation matches chart + bot, reads consistently', () => {
  const rfiSample = ['AA', 'AQo', 'AJo', 'A9s', 'KTs', 'T9s', '22', 'ATo', 'A8s', 'KJo', '76s', '72o'];

  it(
    'raise-first-in at UTG, CO, BTN',
    () => {
      for (const pos of ['UTG', 'CO', 'BTN'] as OpenRaisePosition[]) {
        const range = getOpenRaiseRange(pos);
        for (const hand of rfiSample) {
          const state = driveToHero(`g-rfi-${pos}-${hand}`, pos, handToCards(hand), null);
          const grade = gradeDecision(state, HERO_SEAT, { seat: HERO_SEAT, type: 'fold' }, evaluator);
          const bot = decideBotAction(state, HERO_SEAT, 'TAG');
          const wantsRaise = range.has(hand);

          expect(grade.best.action, `${pos} ${hand} best`).toBe(wantsRaise ? 'raise' : 'fold');
          expect(bot.type === 'raise' || bot.type === 'bet', `${pos} ${hand} bot`).toBe(wantsRaise);

          const msg = grade.message.toLowerCase();
          const entersRec = msg.includes('raising') || msg.includes('calling');
          const foldRationale = msg.includes('too weak') || msg.includes('fold it here');
          expect(entersRec && foldRationale, `${pos} ${hand} contradiction: ${msg}`).toBe(false);

          if (!wantsRaise) expect(grade.severity, `${pos} ${hand} fine fold`).toBe('OK');
        }
      }
    },
    40_000,
  );

  it(
    'facing an open from the BB (EP open)',
    () => {
      const openerClass = 'EP_MP';
      const threeBet = getThreeBetRange(openerClass, true);
      const call = getCallRange(openerClass, 'BB')!;
      const sample = ['AA', 'AKs', 'QQ', 'JJ', 'AQs', 'T9s', '98s', 'AQo', '72o', 'K5o'];
      for (const hand of sample) {
        const state = driveToHero(`g-vs-${hand}`, 'BB', handToCards(hand), 4);
        const grade = gradeDecision(state, HERO_SEAT, { seat: HERO_SEAT, type: 'fold' }, evaluator);
        const expected: Enter = threeBet.has(hand) ? 'raise' : call.has(hand) ? 'call' : 'fold';

        expect(grade.best.action, `${hand} best`).toBe(expected);
        const msg = grade.message.toLowerCase();
        const entersRec = msg.includes('raising') || msg.includes('calling');
        const foldRationale = msg.includes('too weak') || msg.includes('fold it here');
        expect(entersRec && foldRationale, `${hand} contradiction: ${msg}`).toBe(false);
        if (expected === 'fold') expect(grade.severity, `${hand} fine fold`).toBe('OK');
      }
    },
    40_000,
  );

  // Regression: limping (calling) a hand the chart wants raised must not read
  // "too weak, fold it here". Earlier sweeps only graded folds, so this gap —
  // hero enters the pot passively — slipped through.
  it(
    'limping a chart-open hand recommends raising, never "fold it here"',
    () => {
      const openHands = ['99', 'AQo', 'KJs', 'ATo', 'AJs']; // all inside HJ/CO opens
      for (const pos of ['HJ', 'CO'] as OpenRaisePosition[]) {
        for (const hand of openHands) {
          const state = driveToHero(`limp-${pos}-${hand}`, pos, handToCards(hand), null);
          const grade = gradeDecision(state, HERO_SEAT, { seat: HERO_SEAT, type: 'call' }, evaluator);
          expect(grade.best.action, `${pos} ${hand} limp best`).toBe('raise');
          const msg = grade.message.toLowerCase();
          expect(msg, `${pos} ${hand} limp message`).toContain('strong enough to raise');
          expect(msg, `${pos} ${hand} limp message`).not.toContain('too weak');
          expect(msg, `${pos} ${hand} limp message`).not.toContain('fold it here');
        }
      }
    },
    40_000,
  );
});
