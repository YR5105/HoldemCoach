import type { Evaluator } from '../evaluator/Evaluator';
import { PokersolverEvaluator } from '../evaluator/pokersolverAdapter';
import { resolveShowdown } from './pots';
import { actableSeats, canAct, nextToActFrom } from './seatOrder';
import { drawCard, logAction } from './state';
import type { Action, GameState, Street } from './types';

const defaultEvaluator: Evaluator = new PokersolverEvaluator();

const STREET_ORDER: Street[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'SHOWDOWN'];

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  canRaise: boolean;
  /** Minimum total to-amount for a bet/raise (committedThisStreet after acting). */
  minTo: number;
  /** Maximum total to-amount (all-in). */
  maxTo: number;
}

export function getLegalActions(state: GameState, seatIndex: number): LegalActions {
  const seat = state.seats[seatIndex];
  if (!seat) throw new Error(`no seat ${seatIndex}`);
  if (state.actionOn !== seatIndex) {
    throw new Error(`it is not seat ${seatIndex}'s turn (action is on seat ${state.actionOn})`);
  }
  if (!canAct(seat)) {
    throw new Error(`seat ${seatIndex} cannot act (folded, all-in, or sitting out)`);
  }

  const toCall = state.currentBet - seat.committedThisStreet;
  const callAmount = Math.min(toCall, seat.stack);
  const maxTo = seat.committedThisStreet + seat.stack;
  const minTo = Math.min(state.currentBet + state.minRaise, maxTo);

  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount,
    canBet: state.currentBet === 0 && seat.stack > 0,
    canRaise: state.currentBet > 0 && !seat.raiseCapped && seat.stack > callAmount,
    minTo,
    maxTo,
  };
}

function validateAction(legal: LegalActions, action: Action) {
  switch (action.type) {
    case 'fold':
      if (!legal.canFold) throw new Error('fold is not legal here');
      return;
    case 'check':
      if (!legal.canCheck) throw new Error('check is not legal; must call or fold');
      return;
    case 'call':
      if (!legal.canCall) throw new Error('call is not legal; use check instead');
      return;
    case 'bet':
      if (!legal.canBet) throw new Error('bet is not legal; use raise instead');
      break;
    case 'raise':
      if (!legal.canRaise) throw new Error('raise is not legal here');
      break;
    default:
      throw new Error(`unexpected action type ${action.type}`);
  }
  const amount = action.amount;
  if (amount === undefined) throw new Error(`${action.type} requires an amount`);
  if (amount > legal.maxTo) throw new Error(`amount ${amount} exceeds max (all-in) of ${legal.maxTo}`);
  if (amount < legal.minTo && amount !== legal.maxTo) {
    throw new Error(`amount ${amount} is below minimum ${legal.minTo} (or must be all-in at ${legal.maxTo})`);
  }
}

/**
 * Applies one player action and runs the state machine forward: closes the
 * betting round if appropriate, deals the next street, auto-runs remaining
 * streets when no one can act further, and settles the hand at showdown.
 * `evaluator` defaults to the pokersolver adapter but can be swapped (e.g.
 * a WASM evaluator) since engine code never hand-rolls hand ranking.
 */
export function applyAction(
  state: GameState,
  action: Action,
  evaluator: Evaluator = defaultEvaluator,
): GameState {
  const legal = getLegalActions(state, action.seat);
  validateAction(legal, action);

  const s: GameState = structuredClone(state);
  const seat = s.seats[action.seat]!;

  switch (action.type) {
    case 'fold': {
      seat.folded = true;
      seat.hasActed = true;
      logAction(s, { seat: action.seat, street: s.street, action: 'fold', amount: 0 });
      break;
    }
    case 'check': {
      seat.hasActed = true;
      logAction(s, { seat: action.seat, street: s.street, action: 'check', amount: 0 });
      break;
    }
    case 'call': {
      const amt = legal.callAmount;
      seat.stack -= amt;
      seat.committedThisStreet += amt;
      seat.committedTotal += amt;
      if (seat.stack === 0) seat.allIn = true;
      seat.hasActed = true;
      logAction(s, { seat: action.seat, street: s.street, action: 'call', amount: amt });
      break;
    }
    case 'bet':
    case 'raise': {
      const target = action.amount!;
      const delta = target - seat.committedThisStreet;
      const increment = target - s.currentBet;
      const isFullRaise = increment >= s.minRaise;

      seat.stack -= delta;
      seat.committedThisStreet = target;
      seat.committedTotal += delta;
      if (seat.stack === 0) seat.allIn = true;
      s.currentBet = target;

      for (const other of s.seats) {
        if (other.seatIndex === seat.seatIndex || !canAct(other)) continue;
        if (isFullRaise) {
          other.hasActed = false;
          other.raiseCapped = false;
        } else {
          // Incomplete raise: seats that already acted against the last full
          // raise are capped to call/fold; seats yet to act keep full rights.
          if (other.hasActed) other.raiseCapped = true;
          other.hasActed = false;
        }
      }

      if (isFullRaise) {
        s.minRaise = increment;
        s.lastAggressor = seat.seatIndex;
      }

      seat.hasActed = true;
      seat.raiseCapped = false;
      logAction(s, { seat: action.seat, street: s.street, action: action.type, amount: target });
      break;
    }
  }

  return progressHand(s, evaluator);
}

function isBettingRoundClosed(state: GameState): boolean {
  for (const seat of state.seats) {
    if (!canAct(seat)) continue;
    if (seat.committedThisStreet !== state.currentBet) return false;
    if (!seat.hasActed) return false;
  }
  return true;
}

function progressHand(s: GameState, evaluator: Evaluator): GameState {
  const remaining = s.seats.filter((seat) => !seat.folded);
  if (remaining.length === 1) {
    return settleHand(s, evaluator);
  }

  if (isBettingRoundClosed(s)) {
    return advanceStreet(s, evaluator);
  }

  const n = s.seats.length;
  s.actionOn = nextToActFrom(s, (s.actionOn + 1) % n) ?? -1;
  return s;
}

function resetStreetState(s: GameState) {
  for (const seat of s.seats) {
    seat.committedThisStreet = 0;
    seat.hasActed = false;
    seat.raiseCapped = false;
  }
  s.currentBet = 0;
  s.minRaise = s.config.blinds[1];
  s.lastAggressor = null;
}

function dealCommunity(s: GameState, count: number) {
  drawCard(s); // burn
  for (let i = 0; i < count; i++) {
    s.board.push(drawCard(s));
  }
}

function advanceStreet(s: GameState, evaluator: Evaluator): GameState {
  resetStreetState(s);

  const currentIdx = STREET_ORDER.indexOf(s.street as (typeof STREET_ORDER)[number]);
  const nextStreet = STREET_ORDER[currentIdx + 1]!;
  s.street = nextStreet;

  if (nextStreet === 'FLOP') dealCommunity(s, 3);
  else if (nextStreet === 'TURN') dealCommunity(s, 1);
  else if (nextStreet === 'RIVER') dealCommunity(s, 1);
  else if (nextStreet === 'SHOWDOWN') return settleHand(s, evaluator);

  if (actableSeats(s).length < 2) {
    // No one left who can voluntarily act — keep running the board out.
    return advanceStreet(s, evaluator);
  }

  const n = s.seats.length;
  s.actionOn = nextToActFrom(s, (s.buttonSeat + 1) % n) ?? -1;
  return s;
}

function settleHand(s: GameState, evaluator: Evaluator): GameState {
  const payout = resolveShowdown(s.seats, s.board, s.buttonSeat, evaluator);
  for (const share of payout.winners) {
    s.seats[share.seat]!.stack += share.amount;
  }
  s.payout = payout;
  s.street = 'PAYOUT';
  s.actionOn = -1;
  return s;
}
