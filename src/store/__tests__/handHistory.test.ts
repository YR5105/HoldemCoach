import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applyAction } from '../../engine/actions';
import { buildReplay } from '../../engine/replay';
import { createInitialState, startHand } from '../../engine/state';
import type { ActionLogEntry, Card, GameState, Street } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { decideBotAction } from '../../bots/botPolicy';
import { gradeDecision, isGradableDecision } from '../../coach/grader';
import {
  buildHandDoc,
  listHands,
  saveHand,
  toCoachAnnotation,
  type CoachAnnotation,
  type HandDoc,
} from '../handHistory';

const evaluator = new PokersolverEvaluator();

const HERO = 0;
const CONFIG = { players: 3, blinds: [1, 2] as [number, number], startingStack: 200 };
const START_STACKS = [200, 200, 200];

/**
 * Plays one seeded hand with every seat driven by the bot policy, grading the
 * hero's decisions against the pre-action state and keying each annotation by
 * actionLog length — exactly what gameStore.heroAction does. Returns the built
 * hand document and the live final state.
 */
function playAndBuildDoc(seed: string): { doc: HandDoc; liveFinal: GameState } {
  let s = startHand(createInitialState(CONFIG, seed, 0, START_STACKS));
  const annotations = new Map<number, CoachAnnotation>();
  let guard = 0;
  while (s.payout === null && s.actionOn >= 0 && guard++ < 300) {
    const seat = s.actionOn;
    const action = decideBotAction(s, seat, 'TAG', evaluator);
    if (seat === HERO && isGradableDecision(s, HERO)) {
      const grade = gradeDecision(s, HERO, action, evaluator);
      annotations.set(s.actionLog.length, toCoachAnnotation(grade));
    }
    s = applyAction(s, action, evaluator);
  }
  const doc = buildHandDoc(s, HERO, annotations, { 1: 'TAG', 2: 'TAG' }, START_STACKS);
  return { doc, liveFinal: s };
}

function docToActionLog(doc: HandDoc): ActionLogEntry[] {
  return doc.actions.map((a) => ({
    seat: a.seat,
    street: a.street as Street,
    action: a.action as ActionLogEntry['action'],
    amount: a.amount,
  }));
}

describe('hand history is lossless and replay-consistent', () => {
  const seeds = Array.from({ length: 20 }, (_, i) => `hh-${i}`);
  const played = seeds.map(playAndBuildDoc);

  it('actually graded a meaningful number of hero decisions', () => {
    const graded = played.reduce((sum, { doc }) => sum + doc.actions.filter((a) => a.coach).length, 0);
    expect(graded, 'so the re-grading check is not vacuous').toBeGreaterThanOrEqual(10);
  });

  it('reconstructs board, hole cards, pots and winners from each saved hand', () => {
    for (const { doc, liveFinal } of played) {
      const steps = buildReplay(CONFIG, doc.seed, doc.config.buttonSeat, docToActionLog(doc), doc.config.startingStacks);
      const replayFinal = steps[steps.length - 1]!.state;

      // Strongest single check: the whole reconstructed state matches live play.
      expect(replayFinal).toEqual(liveFinal);

      // And explicitly, the fields the Review screen reads off the doc.
      expect(replayFinal.actionLog).toEqual(liveFinal.actionLog); // action sequence
      expect(replayFinal.board).toEqual(doc.board);
      expect(replayFinal.payout?.winners.map((w) => w.seat) ?? []).toEqual(doc.result.winners);
      expect(replayFinal.payout?.winners.map((w) => ({ seat: w.seat, amount: w.amount })) ?? []).toEqual(
        doc.result.potAwarded,
      );
      for (const [seat, cards] of Object.entries(doc.holeCards)) {
        expect(replayFinal.seats[Number(seat)]!.holeCards).toEqual(cards as Card[]);
      }
    }
  });

  it('re-grading each reconstructed decision reproduces the stored verdict', () => {
    for (const { doc } of played) {
      const steps = buildReplay(CONFIG, doc.seed, doc.config.buttonSeat, docToActionLog(doc), doc.config.startingStacks);
      doc.actions.forEach((a, i) => {
        if (!a.coach) return;
        const pos = steps.findIndex((st) => st.actionIndex === i);
        expect(pos, `no replay step for hero action ${i}`).toBeGreaterThan(0);
        const preState = steps[pos - 1]!.state;
        const chosen = {
          seat: HERO,
          type: a.action as ActionLogEntry['action'],
          amount: a.action === 'bet' || a.action === 'raise' ? a.amount : undefined,
        };
        const fresh = gradeDecision(preState, HERO, chosen, evaluator);
        // Wording may drift between versions; the verdict must not.
        expect(fresh.severity, `severity @ ${i}`).toBe(a.coach.severity);
        expect(fresh.best.action, `best @ ${i}`).toBe(a.coach.best);
        expect(fresh.reasonKey, `reasonKey @ ${i}`).toBe(a.coach.reasonKey);
      });
    }
  }, 30000);

  it('survives a JSON serialization round-trip (no Date/Map/undefined bugs)', () => {
    for (const { doc } of played) {
      expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    }
  });

  it('persists and reads back each hand through IndexedDB unchanged', async () => {
    for (const { doc } of played) await saveHand(doc);
    const listed = await listHands(100);
    const byId = new Map(listed.map((h) => [h.id, h]));
    for (const { doc } of played) {
      expect(byId.get(doc.id)).toEqual(doc);
    }
  });
});

// ---------------------------------------------------------------------------
// Storage cap. handHistory.ts never prunes the object store; the "cap" is the
// listHands read limit (default 100), which returns the newest hands by ts and
// drops the oldest from the view. (The DB itself grows unbounded — noted, not
// under test here.) We give the cap docs far-future timestamps so they dominate
// the newest-100 regardless of the 20 real hands saved above.
// ---------------------------------------------------------------------------

describe('storage cap evicts the oldest from the listing', () => {
  function capDoc(i: number, ts: number): HandDoc {
    return {
      id: `cap-${i}`,
      ts,
      seed: `cap-${i}`,
      config: { players: 2, blinds: [1, 2], heroSeat: 0, bots: ['TAG'], buttonSeat: 0, startingStack: 200 },
      holeCards: {},
      board: [],
      actions: [],
      result: { winners: [], potAwarded: [], showdown: false },
    };
  }

  it('listHands(100) keeps the 100 newest and evicts the oldest', async () => {
    const base = Date.now() + 1_000_000_000; // far ahead of any real hand's ts
    for (let i = 0; i < 120; i++) await saveHand(capDoc(i, base + i));

    const listed = await listHands(100);
    const ids = new Set(listed.map((h) => h.id));

    expect(listed.length).toBe(100);
    // Newest survive; the 20 oldest cap docs are evicted from the view.
    expect(ids.has('cap-119')).toBe(true);
    expect(ids.has('cap-20')).toBe(true);
    expect(ids.has('cap-19')).toBe(false);
    expect(ids.has('cap-0')).toBe(false);
    // Returned in newest-first order.
    expect(listed[0]!.id).toBe('cap-119');
  });
});
