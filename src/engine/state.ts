import { shuffledDeck } from './deck';
import { nextToActFrom } from './seatOrder';
import type { ActionLogEntry, GameConfig, GameState, Seat } from './types';

function createSeat(seatIndex: number, stack: number): Seat {
  const sittingOut = stack <= 0;
  return {
    seatIndex,
    stack: Math.max(0, stack),
    holeCards: null,
    // A seat with no chips is out of the hand entirely — sitting out AND
    // folded, so the "one player left" and showdown logic ignore it.
    folded: sittingOut,
    allIn: false,
    committedThisStreet: 0,
    committedTotal: 0,
    hasActed: false,
    raiseCapped: false,
    sittingOut,
  };
}

/**
 * Creates a fresh WAITING state. `seatStacks` (optional) sets each seat's
 * starting chips — used to carry stacks between hands in a continuous match;
 * seats with 0 chips are eliminated (sitting out). Omit it for a fresh table
 * where everyone gets `config.startingStack`.
 */
export function createInitialState(
  config: GameConfig,
  seed: string,
  buttonSeat = 0,
  seatStacks?: number[],
): GameState {
  if (config.players < 2 || config.players > 9) {
    throw new Error('players must be between 2 and 9');
  }
  return {
    seed,
    config,
    street: 'WAITING',
    seats: Array.from({ length: config.players }, (_, i) =>
      createSeat(i, seatStacks ? (seatStacks[i] ?? 0) : config.startingStack),
    ),
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

/** Seat indices with chips and not eliminated, in seat order. */
function activeSeatIndices(state: GameState): number[] {
  return state.seats.filter((s) => !s.sittingOut && s.stack > 0).map((s) => s.seatIndex);
}

/** How many players are still in the match (have chips). */
export function activePlayers(state: GameState): number {
  return activeSeatIndices(state).length;
}

/** The next seat clockwise from the current button that still has chips. */
export function nextButtonSeat(state: GameState): number {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.buttonSeat + i) % n;
    const seat = state.seats[idx]!;
    if (!seat.sittingOut && seat.stack > 0) return idx;
  }
  return state.buttonSeat;
}

/**
 * WAITING -> PREFLOP: deals hole cards and posts blinds among the players who
 * still have chips. Eliminated seats are skipped entirely. Blind order follows
 * the standard rules, including the heads-up case (button posts the small
 * blind and acts first preflop) when exactly two players remain — even if
 * they aren't in adjacent seats after others have busted.
 */
export function startHand(state: GameState): GameState {
  if (state.street !== 'WAITING') {
    throw new Error(`startHand requires street WAITING, got ${state.street}`);
  }
  const s: GameState = structuredClone(state);
  const n = s.seats.length;
  s.street = 'PREFLOP';

  const active = activeSeatIndices(s);
  if (active.length < 2) {
    throw new Error('startHand needs at least 2 players with chips');
  }
  if (s.seats[s.buttonSeat]!.sittingOut || s.seats[s.buttonSeat]!.stack === 0) {
    throw new Error('button must be on a seat with chips');
  }

  // Active seats clockwise, with the button last (index 0 = first seat after
  // the button = the small blind in 3-handed+).
  const clockwise: number[] = [];
  for (let i = 1; i <= n; i++) {
    const idx = (s.buttonSeat + i) % n;
    const seat = s.seats[idx]!;
    if (!seat.sittingOut && seat.stack > 0) clockwise.push(idx);
  }

  const headsUp = active.length === 2;
  const sbSeat = headsUp ? s.buttonSeat : clockwise[0]!;
  const bbSeat = headsUp ? clockwise[0]! : clockwise[1]!;
  // Preflop first to act: heads-up it's the SB/button; otherwise UTG (the
  // seat after the big blind, wrapping to the button when 3-handed).
  const firstToAct = headsUp ? sbSeat : (clockwise[2] ?? s.buttonSeat);

  // Deal two cards to each active seat, clockwise starting from the SB.
  const sbPos = clockwise.indexOf(sbSeat);
  const dealOrder = [...clockwise.slice(sbPos), ...clockwise.slice(0, sbPos)];
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

  s.actionOn = nextToActFrom(s, firstToAct) ?? -1;

  return s;
}
