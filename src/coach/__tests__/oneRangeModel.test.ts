import { describe, expect, it } from 'vitest';
import preflopData from '../../data/preflop.json';
import { applyAction } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Action, Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { decideBotAction } from '../../bots/botPolicy';
import { gradeDecision, preflopChartAction } from '../grader';
import { parseRange } from '../rangeParser';

const evaluator = new PokersolverEvaluator();

// Button on seat 0, 6-max: fixed seat<->position mapping (see position.ts).
const POS_SEAT = { UTG: 3, HJ: 4, CO: 5, BTN: 0, SB: 1, BB: 2 } as const;
const PREFLOP_ORDER = [3, 4, 5, 0, 1, 2];

// ---------------------------------------------------------------------------
// All 169 canonical hands + a representative two-card combo for each.
// ---------------------------------------------------------------------------

const RANKS = 'AKQJT98765432'; // high -> low, so the first index is the higher card

function allCanonicalHands(): string[] {
  const hands: string[] = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
      if (i === j) hands.push(RANKS[i]! + RANKS[i]!);
      else {
        hands.push(RANKS[i]! + RANKS[j]! + 's');
        hands.push(RANKS[i]! + RANKS[j]! + 'o');
      }
    }
  }
  return hands;
}

function comboFor(hand: string): [Card, Card] {
  if (hand.length === 2) return [`${hand[0]}h`, `${hand[0]}d`] as [Card, Card];
  const [hi, lo, suit] = [hand[0]!, hand[1]!, hand[2]!];
  return suit === 's' ? [`${hi}h`, `${lo}h`] : [`${hi}h`, `${lo}d`] as [Card, Card];
}

/** decideBotAction's action type mapped onto the chart's three verdicts. */
function botVerdict(type: Action['type']): 'raise' | 'call' | 'fold' {
  if (type === 'raise' || type === 'bet') return 'raise';
  if (type === 'call') return 'call';
  return 'fold'; // fold or a free check == "not entering / not continuing"
}

function baseState(seed: string): GameState {
  return startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
}

/** Unopened pot with `heroSeat` first to act (everyone before them folds). */
function firstInState(heroSeat: number, cards: [Card, Card]): GameState {
  let s = structuredClone(baseState('orm-open'));
  s.seats[heroSeat]!.holeCards = cards;
  for (const seat of PREFLOP_ORDER) {
    if (seat === heroSeat) break;
    s = applyAction(s, { seat, type: 'fold' }, evaluator);
  }
  return s;
}

/** `openerSeat` opens to 5; folds around to `heroSeat`, who faces one raise. */
function facingOpenState(openerSeat: number, heroSeat: number, cards: [Card, Card]): GameState {
  let s = structuredClone(baseState('orm-facing'));
  s.seats[heroSeat]!.holeCards = cards;
  for (const seat of PREFLOP_ORDER) {
    if (seat === heroSeat) break;
    s = applyAction(s, seat === openerSeat ? { seat, type: 'raise', amount: 5 } : { seat, type: 'fold' }, evaluator);
  }
  return s;
}

// ---------------------------------------------------------------------------
// 1. Unopened pot: bot open-raise/fold agrees with the grader's chart verdict
//    for every hand and position. Uses only decideBotAction + preflopChartAction
//    (both pure, no Monte Carlo), so all 169 hands run cheaply.
// ---------------------------------------------------------------------------

describe('one range model — unopened pot (bot vs grader chart)', () => {
  const hands = allCanonicalHands();

  for (const pos of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
    it(`bot open/fold matches the chart for all 169 hands from ${pos}`, () => {
      const heroSeat = POS_SEAT[pos];
      const disagreements: string[] = [];
      for (const hand of hands) {
        const s = firstInState(heroSeat, comboFor(hand));
        const bot = botVerdict(decideBotAction(s, heroSeat, 'TAG', evaluator).type);
        const chart = preflopChartAction(s, heroSeat);
        // Open charts only ever say raise or fold.
        if (bot !== chart) disagreements.push(`${hand}: bot=${bot} chart=${chart}`);
      }
      expect(disagreements, `${pos} disagreements:\n${disagreements.join('\n')}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Facing a single open: bot 3-bet/call/fold agrees with the grader's verdict
//    across representative opener/responder classes (EP_MP, CO_BTN+blinds, SB).
// ---------------------------------------------------------------------------

describe('one range model — facing one open (bot vs grader chart)', () => {
  const hands = allCanonicalHands();
  const scenarios: [string, number, number][] = [
    ['UTG open, BTN responds (EP_MP, in position)', POS_SEAT.UTG, POS_SEAT.BTN],
    ['BTN open, BB responds (CO_BTN, from blinds)', POS_SEAT.BTN, POS_SEAT.BB],
    ['SB open, BB responds (vs SB open)', POS_SEAT.SB, POS_SEAT.BB],
  ];

  for (const [label, openerSeat, heroSeat] of scenarios) {
    it(`bot vs chart agree for all 169 hands — ${label}`, () => {
      const disagreements: string[] = [];
      for (const hand of hands) {
        const s = facingOpenState(openerSeat, heroSeat, comboFor(hand));
        const bot = botVerdict(decideBotAction(s, heroSeat, 'TAG', evaluator).type);
        const chart = preflopChartAction(s, heroSeat);
        if (bot !== chart) disagreements.push(`${hand}: bot=${bot} chart=${chart}`);
      }
      expect(disagreements, `${label} disagreements:\n${disagreements.join('\n')}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// gradeDecision honors the chart verdict (ties the cheap oracle above to the
// real grader). Sampled hands only, since gradeDecision runs Monte Carlo.
// ---------------------------------------------------------------------------

describe('gradeDecision honors the chart the bots follow', () => {
  const cases: { pos: keyof typeof POS_SEAT; hand: string }[] = [
    { pos: 'UTG', hand: 'AA' },
    { pos: 'UTG', hand: '72o' },
    { pos: 'CO', hand: 'KK' },
    { pos: 'BTN', hand: 'A2o' },
    { pos: 'SB', hand: '99' },
  ];

  it('grading the chart action is OK; the opposite action is not', () => {
    for (const { pos, hand } of cases) {
      const heroSeat = POS_SEAT[pos];
      const s = firstInState(heroSeat, comboFor(hand));
      const chart = preflopChartAction(s, heroSeat);
      expect(chart, `${hand} from ${pos}`).not.toBeNull();

      const matching: Action =
        chart === 'raise' ? { seat: heroSeat, type: 'raise', amount: 6 } : { seat: heroSeat, type: 'fold' };
      const opposite: Action =
        chart === 'raise' ? { seat: heroSeat, type: 'fold' } : { seat: heroSeat, type: 'raise', amount: 6 };

      expect(gradeDecision(s, heroSeat, matching, evaluator).severity, `${hand} ${pos} matching`).toBe('OK');
      expect(gradeDecision(s, heroSeat, opposite, evaluator).severity, `${hand} ${pos} opposite`).not.toBe('OK');
    }
  }, 20000);
});

// ---------------------------------------------------------------------------
// 3. Every range string in preflop.json parses, is non-empty, and contains no
//    impossible hand codes.
// ---------------------------------------------------------------------------

describe('preflop.json ranges are well-formed', () => {
  const PAIR_RE = /^([2-9TJQKA])\1$/;
  const NONPAIR_RE = /^([2-9TJQKA])([2-9TJQKA])([so])$/;
  const rankValue = (c: string) => RANKS.length - RANKS.indexOf(c); // higher rank -> higher value

  function isValidCanonical(h: string): boolean {
    if (PAIR_RE.test(h)) return true;
    const m = NONPAIR_RE.exec(h);
    if (!m) return false;
    // Higher card must come first, and the two ranks must differ (no "AAs").
    return rankValue(m[1]!) > rankValue(m[2]!);
  }

  const p = preflopData;
  const rangeStrings: [string, string][] = [
    ['openRaise.UTG', p.openRaise.UTG],
    ['openRaise.HJ', p.openRaise.HJ],
    ['openRaise.CO', p.openRaise.CO],
    ['openRaise.BTN', p.openRaise.BTN],
    ['openRaise.SB', p.openRaise.SB],
    ['facingOpen.EP_MP.threeBet', p.facingOpen.EP_MP.threeBet],
    ['facingOpen.EP_MP.call', p.facingOpen.EP_MP.call],
    ['facingOpen.CO_BTN.threeBet', p.facingOpen.CO_BTN.threeBet],
    ['facingOpen.CO_BTN.threeBetFromBlindsExtra', p.facingOpen.CO_BTN.threeBetFromBlindsExtra],
    ['facingOpen.CO_BTN.call', p.facingOpen.CO_BTN.call],
    ['facingOpen.vsSbOpen.threeBet', p.facingOpen.vsSbOpen.threeBet],
    ['fourBet.value', p.fourBet.value],
    ['fourBet.bluff', p.fourBet.bluff],
    ['facingFourBetContinue', p.facingFourBetContinue],
  ];

  for (const [label, str] of rangeStrings) {
    it(`${label} parses to a non-empty set of valid codes`, () => {
      const set = parseRange(str);
      expect(set.size, `${label} is empty`).toBeGreaterThan(0);
      for (const hand of set) {
        expect(isValidCanonical(hand), `${label} has impossible code "${hand}"`).toBe(true);
      }
    });
  }
});
