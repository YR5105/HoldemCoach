import { shuffledDeck } from './deck';
import { nextToActFrom } from './seatOrder';
import type { ActionLogEntry, GameConfig, GameState, Seat } from './types';

function createSeat(seatIndex: number, startingStack: number): Seat {
  return {
    seatIndex,
    stack: startingStack,
    holeCards: null,
    folded: false,
    allIn: false,
    committedThisStreet: 0,
    committedTotal: 0,
    hasActed: false,
    raiseCapped: false,
    sittingOut: false,
  };
}

export function createInitialState(config: GameConfig, seed: string, buttonSeat = 0): GameState {
  if (config.players < 2 || config.players > 9) {
    throw new Error('players must be between 2 and 9');
  }
  return {
    seed,
    config,
    street: 'WAITING',
    seats: Array.from({ length: config.players }, (_, i) => createSeat(i, config.startingStack)),
    board: [],
    deck: shuffledDeck(seed),
    currentBet: 0,
    minRaise: config.blinds[1],
    actionOn: -1,
    lastAggressor: null,
    buttonSeat,
    actionLog: [],
    payout: null,
    rngCounter: 0,
  };
}

export function drawCard(state: GameState) {
  const card = state.deck.shift();
  if (!card) throw new Error('deck is empty');
  return card;
}

export function logAction(state: GameState, entry: ActionLogEntry) {
  state.actionLog.push(entry);
}

function postBlind(state: GameState, seatIndex: number, amount: number, kind: 'post-sb' | 'post-bb') {
  const seat = state.seats[seatIndex]!;
  const posted = Math.min(amount, seat.stack);
  seat.stack -= posted;
  seat.committedThisStreet += posted;
  seat.committedTotal += posted;
  if (seat.stack === 0) seat.allIn = true;
  logAction(state, { seat: seatIndex, street: state.street, action: kind, amount: posted });
}

/**
 * WAITING -> PREFLOP: deals hole cards and posts blinds. Heads-up follows the
 * standard rule that the button posts the small blind and acts first preflop.
 */
export function startHand(state: GameState): GameState {
  if (state.street !== 'WAITING') {
    throw new Error(`startHand requires street WAITING, got ${state.street}`);
  }
  const s: GameState = structuredClone(state);
  const n = s.seats.length;
  s.street = 'PREFLOP';

  const sbSeat = n === 2 ? s.buttonSeat : (s.buttonSeat + 1) % n;
  const bbSeat = n === 2 ? (s.buttonSeat + 1) % n : (s.buttonSeat + 2) % n;

  const dealOrder = Array.from({ length: n }, (_, i) => (sbSeat + i) % n);
  for (let round = 0; round < 2; round++) {
    for (const seatIdx of dealOrder) {
      const seat = s.seats[seatIdx]!;
      const card = drawCard(s);
      seat.holeCards = seat.holeCards ? [...seat.holeCards, card] : [card];
    }
  }

  postBlind(s, sbSeat, s.config.blinds[0], 'post-sb');
  postBlind(s, bbSeat, s.config.blinds[1], 'post-bb');

  s.currentBet = s.config.blinds[1];
  s.minRaise = s.config.blinds[1];
  s.lastAggressor = bbSeat;

  const firstToAct = n === 2 ? sbSeat : (bbSeat + 1) % n;
  s.actionOn = nextToActFrom(s, firstToAct) ?? -1;

  return s;
}
