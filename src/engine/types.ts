export type Suit = 'c' | 'd' | 'h' | 's';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

/** Two-character card code, e.g. "Ah", "Td", "2c" — matches pokersolver's format. */
export type Card = `${Rank}${Suit}`;

export type Street = 'WAITING' | 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN' | 'PAYOUT';

export type ActionType = 'post-sb' | 'post-bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface Seat {
  seatIndex: number;
  stack: number;
  holeCards: Card[] | null;
  folded: boolean;
  allIn: boolean;
  /** Chips committed this street (resets each street). */
  committedThisStreet: number;
  /** Chips committed across the whole hand (used for side-pot layering). */
  committedTotal: number;
  /** Whether this seat has acted since the last full raise on the current street. */
  hasActed: boolean;
  /**
   * True when this seat already acted against the last full raise and can
   * therefore only call/fold in response to a subsequent all-in-for-less
   * (an incomplete raise never reopens raising rights).
   */
  raiseCapped: boolean;
  sittingOut: boolean;
}

export interface GameConfig {
  players: number;
  blinds: [number, number];
  startingStack: number;
}

export interface ActionLogEntry {
  seat: number;
  street: Street;
  action: ActionType;
  /** Total chips added to the pot by this action (0 for fold/check). */
  amount: number;
}

export interface PotShare {
  seat: number;
  amount: number;
}

export interface Pot {
  amount: number;
  eligibleSeats: number[];
}

export interface PayoutResult {
  pots: Pot[];
  winners: PotShare[];
  /** Seat -> best 5-card hand description, only populated for seats that reached showdown. */
  showdownHands?: Record<number, { descr: string; cards: Card[] }>;
}

export interface GameState {
  seed: string;
  config: GameConfig;
  street: Street;
  seats: Seat[];
  board: Card[];
  /** Remaining cards in deal order; index 0 is the next card to be dealt. */
  deck: Card[];
  currentBet: number;
  minRaise: number;
  actionOn: number;
  lastAggressor: number | null;
  buttonSeat: number;
  actionLog: ActionLogEntry[];
  payout: PayoutResult | null;
  /** Monotonically increasing counter used to derive per-action RNG state deterministically. */
  rngCounter: number;
}

export interface Action {
  seat: number;
  type: ActionType;
  /** For 'bet'/'raise': the total amount the seat is putting in this street (to-amount), not the delta. */
  amount?: number;
}
