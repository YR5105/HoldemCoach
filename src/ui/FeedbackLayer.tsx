import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useSettingsStore } from '../store/settingsStore';
import { FeedbackCard, SEVERITY_COLOR } from './FeedbackCard';

/** Meter zone color, reusing the severity palette (spec §6 R5). */
function meterColor(value: number): string {
  if (value >= 67) return '#4ade80'; // green-400 — same -400 shade family as the palette
  if (value >= 34) return SEVERITY_COLOR.INACCURACY; // amber
  return SEVERITY_COLOR.BLUNDER; // red
}

/**
 * Renders graded-decision feedback per the configured mode (spec §9, §6 R5):
 *  - instant: modal card as soon as a grade lands
 *  - subtle:  12px severity dot near the HUD; click expands the card
 *  - review:  nothing during the hand (summary renders at end of hand)
 *  - meter:   ambient performance bar + severity dot; click either to expand
 */
export function FeedbackLayer() {
  const feedback = useGameStore((s) => s.feedback);
  const openIndex = useGameStore((s) => s.openFeedbackIndex);
  const openFeedback = useGameStore((s) => s.openFeedback);
  const meter = useGameStore((s) => s.meter);
  const meterDelta = useGameStore((s) => s.meterDelta);
  const street = useGameStore((s) => s.state.street);
  const winners = useGameStore((s) => s.state.payout?.winners);
  const heroSeat = useGameStore((s) => s.heroSeat);
  const mode = useSettingsStore((s) => s.feedbackMode);

  const latestIndex = feedback.length - 1;
  const latest = latestIndex >= 0 ? feedback[latestIndex]! : null;
  const toggleLatest = () => openFeedback(openIndex === latestIndex ? null : latestIndex);
  const isDrop = latest?.grade.severity === 'MISTAKE' || latest?.grade.severity === 'BLUNDER';

  // "Won, but…" nudge: reset its dismissal whenever a new hand starts (leaves PAYOUT).
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  useEffect(() => {
    if (street !== 'PAYOUT') setNudgeDismissed(false);
  }, [street]);

  // Instant mode: auto-open each new grade once (skip OKs to avoid nagging).
  useEffect(() => {
    if (mode !== 'instant' || !latest || latest.seen) return;
    if (latest.grade.severity === 'OK') return;
    openFeedback(latestIndex);
  }, [mode, latest, latestIndex, openFeedback]);

  if (mode === 'review') return null;

  const openItem = openIndex !== null ? feedback[openIndex] : null;

  // Won the pot yet misplayed a decision along the way — a gentle "results
  // aren't the grade" nudge, meter mode only, never auto-opening the card.
  const heroWon = street === 'PAYOUT' && !!winners?.some((w) => w.seat === heroSeat);
  const hadBigMistake = feedback.some(
    (f) => f.grade.severity === 'MISTAKE' || f.grade.severity === 'BLUNDER',
  );
  const showNudge = mode === 'meter' && heroWon && hadBigMistake && !nudgeDismissed;

  return (
    <>
      {mode === 'subtle' && latest && (
        <button
          type="button"
          aria-label="Show coach feedback"
          onClick={toggleLatest}
          className="animate-pop-in absolute -top-1.5 right-0 rounded-full ring-2 ring-slate-900 transition-transform hover:scale-125"
          style={{
            width: 12,
            height: 12,
            backgroundColor: SEVERITY_COLOR[latest.grade.severity],
          }}
        />
      )}

      {mode === 'meter' && (
        <div className="absolute -top-2 right-0 flex items-center gap-1.5">
          {/* Ambient performance bar — no text, deep dive always one tap away. */}
          <div className="relative">
            <button
              type="button"
              data-testid="perf-meter"
              aria-label={`Performance meter at ${Math.round(meter)} of 100 — show coach feedback`}
              onClick={() => latest && toggleLatest()}
              className="block h-2 w-[120px] overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700"
            >
              <div
                key={latestIndex}
                className={`h-full rounded-full transition-all duration-300${isDrop ? ' animate-pop-in' : ''}`}
                style={{ width: `${meter}%`, backgroundColor: meterColor(meter) }}
              />
            </button>
            {/* Floating +/- delta that fades out after each meter change. */}
            {latest && meterDelta !== 0 && (
              <span
                key={latestIndex}
                data-testid="meter-delta"
                className="animate-meter-delta pointer-events-none absolute -top-4 right-0 text-xs font-bold tabular-nums"
                style={{ color: meterDelta > 0 ? '#4ade80' : SEVERITY_COLOR.BLUNDER }}
              >
                {meterDelta > 0 ? `+${meterDelta}` : meterDelta}
              </span>
            )}
          </div>
          {latest && (
            <button
              type="button"
              aria-label="Show coach feedback"
              onClick={toggleLatest}
              className="animate-pop-in rounded-full ring-2 ring-slate-900 transition-transform hover:scale-125"
              style={{ width: 12, height: 12, backgroundColor: SEVERITY_COLOR[latest.grade.severity] }}
            />
          )}
        </div>
      )}

      {showNudge && (
        <div
          data-testid="won-but-nudge"
          className="animate-fade-in absolute -top-12 right-0 flex w-64 items-start gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 shadow-xl"
        >
          <span>Nice pot — one decision along the way could have cost you. Tap the bar to see.</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNudgeDismissed(true)}
            className="ml-auto shrink-0 rounded px-1 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
          >
            ✕
          </button>
        </div>
      )}

      {openItem && (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => openFeedback(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <FeedbackCard grade={openItem.grade} onClose={() => openFeedback(null)} />
          </div>
        </div>
      )}
    </>
  );
}

/** End-of-hand mistake summary for review mode (also useful after any hand). */
export function HandSummary() {
  const feedback = useGameStore((s) => s.feedback);
  const mode = useSettingsStore((s) => s.feedbackMode);

  if (mode !== 'review') return null;
  const graded = feedback.filter((f) => f.grade.severity !== 'OK');

  return (
    <div className="mx-auto w-full max-w-md">
      {graded.length === 0 ? (
        <p className="text-center text-sm text-slate-400">No mistakes this hand — well played.</p>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {graded.map((f, i) => (
            <FeedbackCard key={i} grade={f.grade} />
          ))}
        </div>
      )}
    </div>
  );
}
