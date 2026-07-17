import { describe, expect, it } from 'vitest';
import { bucketMadeHand, decideBotAction } from '../../bots/botPolicy';
import { applyAction, getLegalActions } from '../../engine/actions';
import { createInitialState, startHand } from '../../engine/state';
import type { Card, GameState } from '../../engine/types';
import { PokersolverEvaluator } from '../../evaluator/pokersolverAdapter';
import { canonicalHand } from '../rangeParser';
import { getOpenRaiseRange } from '../ranges';
import { villainNodeCombos } from '../nodeRange';

const evaluator = new PokersolverEvaluator();

function sixMax(seed: string): GameState {
  return startHand(createInitialState({ players: 6, blinds: [1, 2], startingStack: 200 }, seed, 0));
}

describe('villainNodeCombos', () => {
  it('an unopened pot gives no information (full range minus dead cards)', () => {
    const s = sixMax('nr-1');
    const dead: Card[] = ['Ah', 'Ad'];
    const combos = villainNodeCombos(s, 4, dead, evaluator);
    // 50 unseen cards -> C(50,2) = 1225 combos.
    expect(combos.length).toBe(1225);
  });

  it("an open-raiser's range is exactly their position's RFI chart", () => {
    let s = sixMax('nr-2');
    // Seat 3 is UTG with button at 0. Force a raising hand and open.
    s = { ...structuredClone(s), seats: s.seats.map((seat, i) => (i === 3 ? { ...seat, holeCards: ['Ah', 'Kh'] as Card[] } : seat)) };
    s = applyAction(s, { seat: 3, type: 'raise', amount: 5 });

    const combos = villainNodeCombos(s, 3, [], evaluator);
    const utgRange = getOpenRaiseRange('UTG');
    const canonicals = new Set(combos.map((c) => canonicalHand(c)));
    expect(canonicals.size).toBe(utgRange.size);
    for (const hand of canonicals) expect(utgRange.has(hand)).toBe(true);
  });

  it('dead cards remove blocked combos from the reconstructed range', () => {
    let s = sixMax('nr-3');
    s = { ...structuredClone(s), seats: s.seats.map((seat, i) => (i === 3 ? { ...seat, holeCards: ['Ah', 'Kh'] as Card[] } : seat)) };
    s = applyAction(s, { seat: 3, type: 'raise', amount: 5 });

    const withoutDead = villainNodeCombos(s, 3, [], evaluator);
    const withDead = villainNodeCombos(s, 3, ['As', 'Ac'], evaluator);
    expect(withDead.length).toBeLessThan(withoutDead.length);
    for (const [a, b] of withDead) {
      expect(['As', 'Ac']).not.toContain(a);
      expect(['As', 'Ac']).not.toContain(b);
    }
  });

  it('a postflop raise narrows the range to STRONG-bucket combos only', () => {
    // Hand-built state: seat 1 called preflop (no raise -> no preflop info),
    // then check-raised the flop. TAG policy only ever raises STRONG buckets.
    let s = sixMax('nr-4');
    // Play to a cheap flop: everyone folds except SB(1)/BB(2); SB calls, BB checks.
    s = { ...structuredClone(s), seats: s.seats.map((seat, i) => (i === 1 ? { ...seat, holeCards: ['9h', '9d'] as Card[] } : seat)) };
    s = applyAction(s, { seat: 3, type: 'fold' });
    s = applyAction(s, { seat: 4, type: 'fold' });
    s = applyAction(s, { seat: 5, type: 'fold' });
    s = applyAction(s, { seat: 0, type: 'fold' });
    s = applyAction(s, { seat: 1, type: 'call' });
    s = applyAction(s, { seat: 2, type: 'check' });
    expect(s.street).toBe('FLOP');

    // SB bets, BB raises.
    s = applyAction(s, { seat: 1, type: 'bet', amount: 3 });
    s = applyAction(s, { seat: 2, type: 'raise', amount: 9 });

    const combos = villainNodeCombos(s, 2, [], evaluator);
    expect(combos.length).toBeGreaterThan(0);
    for (const combo of combos) {
      const bucket = bucketOf(combo, s.board);
      expect(bucket).toBe('STRONG');
    }
  });

  it('every action a bot actually takes keeps its true hand inside the reconstructed range', () => {
    // The consistency invariant, tested end to end and per personality: play
    // full bot-vs-bot hands with a mixed lineup; after every voluntary
    // action, the acting bot's real hole cards must be inside
    // villainNodeCombos' reconstruction for that seat AND personality.
    const lineup = ['TAG', 'LAG', 'Station', 'Nit', 'Balanced', 'TAG'] as const;
    for (const seed of ['consist-1', 'consist-2', 'consist-3', 'consist-4']) {
      let s = sixMax(seed);
      let guard = 0;
      while (s.street !== 'PAYOUT') {
        if (guard++ > 200) throw new Error('non-terminating hand');
        const seatIdx = s.actionOn;
        const personality = lineup[seatIdx]!;
        const legal = getLegalActions(s, seatIdx);
        let action = decideBotAction(s, seatIdx, personality);
        if (action.type === 'bet' && !legal.canBet) action = { seat: seatIdx, type: 'check' };
        if (action.type === 'raise' && !legal.canRaise) {
          action = legal.canCall ? { seat: seatIdx, type: 'call' } : { seat: seatIdx, type: 'fold' };
        }
        s = applyAction(s, action);

        const seat = s.seats[seatIdx]!;
        if (seat.folded || s.street === 'PAYOUT') continue;
        const combos = villainNodeCombos(s, seatIdx, [], evaluator, personality);
        const hole = seat.holeCards as [Card, Card];
        const found = combos.some(
          ([a, b]) => (a === hole[0] && b === hole[1]) || (a === hole[1] && b === hole[0]),
        );
        expect(
          found,
          `seed=${seed} seat=${seatIdx} (${personality}) hole=${hole.join('')} after ${action.type}`,
        ).toBe(true);
      }
    }
  });
});

function bucketOf(combo: [Card, Card], board: readonly Card[]) {
  return bucketMadeHand(combo, board, evaluator);
}
