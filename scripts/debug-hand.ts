/**
 * Debug console: plays one full hand through the pure engine (deal -> betting
 * -> showdown/payout) and prints every state transition. This is step 1's
 * "playable hand in a debug console" — no UI yet, just the engine + evaluator.
 *
 * Usage: npm run debug-hand [seed]
 */
import { applyAction, createInitialState, getLegalActions, startHand } from '../src/engine';
import type { Action, GameState } from '../src/engine/types';

const seed = process.argv[2] ?? `debug-${Date.now()}`;
const config = { players: 6, blinds: [1, 2] as [number, number], startingStack: 200 };

function fmtCards(cards: string[] | null | undefined): string {
  return cards && cards.length > 0 ? cards.join(' ') : '--';
}

function printSeats(state: GameState) {
  for (const seat of state.seats) {
    const tag = [
      seat.seatIndex === state.buttonSeat ? 'BTN' : '   ',
      seat.folded ? 'FOLDED' : seat.allIn ? 'ALL-IN' : '      ',
    ].join(' ');
    console.log(
      `  seat ${seat.seatIndex} ${tag}  stack=${String(seat.stack).padStart(4)}  ` +
        `committed=${String(seat.committedThisStreet).padStart(3)}  hole=${fmtCards(seat.holeCards)}`,
    );
  }
}

/** Chooses a simple, deterministic action so the hand is fully scripted. */
function chooseAction(state: GameState): Action {
  const seat = state.actionOn;
  const legal = getLegalActions(state, seat);
  if (legal.canBet) {
    const target = Math.min(legal.minTo * 2, legal.maxTo);
    return { seat, type: 'bet', amount: target };
  }
  if (legal.canCall) return { seat, type: 'call' };
  if (legal.canCheck) return { seat, type: 'check' };
  return { seat, type: 'fold' };
}

console.log(`\n=== HoldemCoach debug hand (seed="${seed}") ===\n`);
console.log(`Config: ${config.players}-max, blinds ${config.blinds.join('/')}, ${config.startingStack} starting stack\n`);

let state = startHand(createInitialState(config, seed, 0));
console.log(`-- ${state.street} --`);
printSeats(state);

let lastStreet = state.street;
while (state.street !== 'PAYOUT') {
  const action = chooseAction(state);
  state = applyAction(state, action);

  const entry = state.actionLog[state.actionLog.length - 1]!;
  console.log(`  seat ${entry.seat} ${entry.action}${entry.amount ? ` ${entry.amount}` : ''}`);

  if (state.street !== lastStreet && state.street !== 'PAYOUT') {
    lastStreet = state.street;
    console.log(`\n-- ${state.street} -- board: ${fmtCards(state.board)}`);
    printSeats(state);
  }
}

console.log(`\n-- PAYOUT -- board: ${fmtCards(state.board)}`);
printSeats(state);

console.log('\nPots:');
for (const pot of state.payout!.pots) {
  console.log(`  amount=${pot.amount} eligible=[${pot.eligibleSeats.join(', ')}]`);
}

console.log('\nWinners:');
for (const winner of state.payout!.winners) {
  const hand = state.payout!.showdownHands?.[winner.seat];
  console.log(`  seat ${winner.seat} wins ${winner.amount}${hand ? ` with ${hand.descr}` : ' (uncontested)'}`);
}

console.log(`\nFinal stacks: ${state.seats.map((s) => `seat${s.seatIndex}=${s.stack}`).join('  ')}`);
console.log(`\nReplay with: npm run debug-hand -- "${seed}"\n`);
