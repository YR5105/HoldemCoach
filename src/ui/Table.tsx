import { useEffect, useRef } from 'react';
import { positionForSeat } from '../coach/position';
import { computePotOdds, isGuessDue, useGameStore } from '../store/gameStore';
import { useSettingsStore } from '../store/settingsStore';
import { ActionBar } from './ActionBar';
import { PlayingCard } from './Card';
import { FeedbackLayer, HandSummary } from './FeedbackLayer';
import { GuessPrompt, GuessReveal } from './GuessPrompt';
import { SeatView } from './Seat';
import { WinDial } from './WinDial';

/**
 * Screen position for seat slot `slot` of `n` around the oval, starting at
 * the hero's slot (bottom center) and going clockwise. Seats are rotated into
 * slots so the hero always renders at the bottom whatever their seat index.
 */
function slotStyle(slot: number, n: number): { top: string; left: string } {
  const theta = Math.PI / 2 + (slot / n) * 2 * Math.PI;
  return {
    left: `${50 + 42 * Math.cos(theta)}%`,
    top: `${50 + 40 * Math.sin(theta)}%`,
  };
}

export function Table() {
  const state = useGameStore((s) => s.state);
  const heroSeat = useGameStore((s) => s.heroSeat);
  const newHand = useGameStore((s) => s.newHand);
  const init = useGameStore((s) => s.init);
  const personalities = useGameStore((s) => s.personalities);

  // Kicks off any bot turn already pending in the initial hand (e.g. hero
  // isn't first to act preflop). Runs exactly once on mount.
  const initRanRef = useRef(false);
  useEffect(() => {
    if (initRanRef.current) return;
    initRanRef.current = true;
    init();
  }, [init]);

  const n = state.seats.length;

  return (
    <div className="flex flex-col items-center justify-center bg-slate-950 p-4 text-slate-100">
      <div className="relative aspect-[16/10] w-full max-w-3xl rounded-[45%] border-8 border-slate-800 bg-emerald-800 shadow-2xl">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div className="flex gap-1.5">
            {state.board.map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
            {Array.from({ length: 5 - state.board.length }).map((_, i) => (
              <div key={`empty-${i}`} className="h-16 w-12 rounded-md border border-dashed border-white/20" />
            ))}
          </div>
          <div className="rounded-full bg-black/30 px-3 py-1 text-sm font-medium">
            Pot: {state.seats.reduce((sum, s) => sum + s.committedTotal, 0)}
          </div>
          {state.street === 'PAYOUT' && state.payout && (
            <div className="mt-1 rounded-lg bg-black/50 px-3 py-1.5 text-center text-sm">
              {state.payout.winners.map((w) => (
                <div key={w.seat}>
                  Seat {w.seat} wins {w.amount}
                  {state.payout!.showdownHands?.[w.seat] ? ` — ${state.payout!.showdownHands![w.seat]!.descr}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>

        {state.seats.map((seat) => {
          const slot = (seat.seatIndex - heroSeat + n) % n;
          const style = slotStyle(slot, n);
          return (
            <div
              key={seat.seatIndex}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ top: style.top, left: style.left }}
            >
              <SeatView
                seat={seat}
                isHero={seat.seatIndex === heroSeat}
                isButton={seat.seatIndex === state.buttonSeat}
                isActive={seat.seatIndex === state.actionOn}
                position={positionForSeat(state.buttonSeat, seat.seatIndex, n)}
                personality={personalities[seat.seatIndex]}
              />
            </div>
          );
        })}
      </div>

      <div className="relative mt-4 w-full max-w-2xl">
        <FeedbackLayer />
        {state.street === 'PAYOUT' ? (
          <div className="flex flex-col items-center gap-4">
            <HandSummary />
            <button
              type="button"
              onClick={newHand}
              className="rounded-lg bg-amber-500 px-6 py-2.5 font-semibold text-slate-900 hover:bg-amber-400"
            >
              Next Hand
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center justify-center gap-8">
              <HeroEquityDisplay />
              <ActionBar state={state} heroSeat={heroSeat} />
            </div>
            <GuessReveal />
            <BeginnerHint />
          </div>
        )}
      </div>

      <FeedbackModeSwitcher />
    </div>
  );
}

/** Inline term explainer for beginner mode (F8): shown only on hero's turn. */
function BeginnerHint() {
  const state = useGameStore((s) => s.state);
  const heroSeat = useGameStore((s) => s.heroSeat);
  const beginnerHints = useSettingsStore((s) => s.beginnerHints);
  if (!beginnerHints || state.actionOn !== heroSeat) return null;

  const potOdds = computePotOdds(state, heroSeat);
  const text =
    potOdds.toCall > 0
      ? `Pot odds: you must pay ${potOdds.toCall} to win a ${potOdds.pot}-chip pot, so a call breaks even if you win ${Math.round(potOdds.required * 100)}% of the time.`
      : 'No bet to match — checking is free, betting builds a pot when your hand (or story) is strong.';

  return (
    <p className="max-w-md rounded-lg bg-slate-900/80 px-3 py-1.5 text-center text-xs text-slate-400">
      💡 {text}
    </p>
  );
}

/**
 * The equity area of the HUD: the win % dial normally; a "guess first" prompt
 * every 25th decision (spec §7 Q2); nothing when hero folded or win % is
 * turned off in settings.
 */
function HeroEquityDisplay() {
  const state = useGameStore((s) => s.state);
  const heroSeat = useGameStore((s) => s.heroSeat);
  const equity = useGameStore((s) => s.equity);
  const decisionCount = useGameStore((s) => s.decisionCount);
  const guessSatisfiedAt = useGameStore((s) => s.guessSatisfiedAt);
  const winProbabilityVisible = useSettingsStore((s) => s.winProbabilityVisible);
  const potOdds = computePotOdds(state, heroSeat);

  if (state.seats[heroSeat]!.folded) return null;

  const isHeroTurn = state.actionOn === heroSeat;
  const guessPending =
    isHeroTurn && isGuessDue(decisionCount) && guessSatisfiedAt !== state.actionLog.length;

  if (guessPending) return <GuessPrompt />;
  if (!winProbabilityVisible) return null;
  return <WinDial equity={equity} potOdds={potOdds} />;
}

function FeedbackModeSwitcher() {
  const mode = useSettingsStore((s) => s.feedbackMode);
  const setMode = useSettingsStore((s) => s.setFeedbackMode);
  return (
    <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
      <span className="mr-1">Coach:</span>
      {(['instant', 'subtle', 'review'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={`rounded-full px-2.5 py-1 capitalize ${
            mode === m ? 'bg-slate-700 text-slate-100' : 'hover:bg-slate-800 hover:text-slate-300'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
