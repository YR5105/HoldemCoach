import { plausiblePostflopActionsForCombo, type Personality } from '../bots/botPolicy';
import { allCombos, expandRange } from '../equity/combos';
import type { Evaluator } from '../evaluator/Evaluator';
import type { ActionLogEntry, Card, GameState, Street } from '../engine/types';
import {
  personalityCallRange,
  personalityOpenRange,
  personalityThreeBetRange,
  personalityVsSbOpenCallRange,
} from './personalities';
import { positionForSeat } from './position';
import {
  classifyOpener,
  getFacingFourBetContinueRange,
  getFourBetBluffRange,
  getFourBetValueRange,
  type OpenRaisePosition,
} from './ranges';
import { HAND_STRENGTH_ORDER } from './handStrength';

const ALL_HANDS = new Set(HAND_STRENGTH_ORDER);

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

/**
 * The canonical-hand range implied by one preflop action, mirroring the
 * branches of decidePreflop. `raisesBefore` counts voluntary raises earlier
 * in the preflop log (blind posts excluded).
 */
function preflopActionRange(
  state: GameState,
  entry: ActionLogEntry,
  raisesBefore: ActionLogEntry[],
  personality: Personality,
): Set<string> | null {
  const n = state.seats.length;
  const position = positionForSeat(state.buttonSeat, entry.seat, n);

  if (raisesBefore.length === 0) {
    if (entry.action === 'raise' || entry.action === 'bet') {
      if (position === 'BB') return null; // policy never opens from BB; no chart to pin
      return personalityOpenRange(personality, position as OpenRaisePosition);
    }
    return null; // unopened check (BB option) or a limp: no information
  }

  const opener = raisesBefore[0]!.seat;
  const openerPosition = positionForSeat(state.buttonSeat, opener, n) as OpenRaisePosition;

  if (raisesBefore.length === 1) {
    const openerClass = classifyOpener(openerPosition);
    const fromBlinds = position === 'SB' || position === 'BB';
    if (entry.action === 'raise') return personalityThreeBetRange(personality, openerClass, fromBlinds);
    if (entry.action === 'call') {
      return openerClass === 'SB'
        ? personalityVsSbOpenCallRange(personality)
        : personalityCallRange(personality, openerClass, position);
    }
    return null;
  }

  // Facing a 3-bet or deeper.
  if (entry.action === 'raise') {
    return new Set([...getFourBetValueRange(), ...getFourBetBluffRange()]);
  }
  if (entry.action === 'call') return getFacingFourBetContinueRange();
  return null;
}

function boardForStreet(board: readonly Card[], street: Street): Card[] {
  if (street === 'FLOP') return board.slice(0, 3);
  if (street === 'TURN') return board.slice(0, 4);
  return board.slice(0, 5);
}

/**
 * Reconstructs a bot's hand range at the current node from the action log:
 * preflop actions pin it to the same charts decidePreflop reads, postflop
 * actions filter combos through the same bucket policy decidePostflop
 * samples from. This is the range model the equity display assumes —
 * PRD §9 requires it to be exactly what the bots actually play.
 */
export function villainNodeCombos(
  state: GameState,
  seatIndex: number,
  deadCards: Card[],
  evaluator: Evaluator,
  personality: Personality = 'TAG',
): [Card, Card][] {
  // Board cards can never be in anyone's hand, whatever the caller passed.
  const dead: Card[] = [...deadCards, ...state.board];
  const seatActions = state.actionLog.filter(
    (e) => e.seat === seatIndex && e.action !== 'post-sb' && e.action !== 'post-bb',
  );

  // 1. Preflop: intersect this personality's chart ranges implied by each
  //    voluntary action.
  let canonical = ALL_HANDS;
  const preflopLog = state.actionLog.filter((e) => e.street === 'PREFLOP');
  for (const entry of seatActions.filter((e) => e.street === 'PREFLOP')) {
    const before = preflopLog.slice(0, preflopLog.indexOf(entry));
    const raisesBefore = before.filter((e) => e.action === 'raise' || e.action === 'bet');
    const range = preflopActionRange(state, entry, raisesBefore, personality);
    if (range) canonical = intersect(canonical, range);
  }

  let combos = expandRange(canonical, dead);

  // 2. Postflop: keep only combos for which each observed action had
  //    probability > 0 under this personality's policy (combo-level, since
  //    e.g. Station never folds a made pair).
  const postflopStreets: Street[] = ['FLOP', 'TURN', 'RIVER'];
  for (const street of postflopStreets) {
    const streetLog = state.actionLog.filter((e) => e.street === street);
    for (const entry of seatActions.filter((e) => e.street === street)) {
      const before = streetLog.slice(0, streetLog.indexOf(entry));
      const facingBet = before.some((e) => e.action === 'bet' || e.action === 'raise');
      const board = boardForStreet(state.board, street);
      combos = combos.filter((combo) =>
        plausiblePostflopActionsForCombo(combo, board, facingBet, personality, evaluator).has(
          entry.action,
        ),
      );
    }
  }

  // 3. Fallbacks: an empty range breaks the simulation, so degrade gracefully
  //    (can happen when hero's cards block the entire reconstructed range).
  if (combos.length === 0) combos = expandRange(canonical, dead);
  if (combos.length === 0) combos = allCombos(dead);
  return combos;
}
