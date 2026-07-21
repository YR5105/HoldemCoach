import { useEffect } from 'react';
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
  const mode = useSettingsStore((s) => s.feedbackMode);

  const latestIndex = feedback.length - 1;
  const latest = latestIndex >= 0 ? feedback[latestIndex]! : null;
  const toggleLatest = () => openFeedback(openIndex === latestIndex ? null : latestIndex);
  const isDrop = latest?.grade.severity === 'MISTAKE' || latest?.grade.severity === 'BLUNDER';

  // Instant mode: auto-open each new grade once (skip OKs to avoid nagging).
  useEffect(() => {
    if (mode !== 'instant' || !latest || latest.seen) return;
    if (latest.grade.severity === 'OK') return;
    openFeedback(latestIndex);
  }, [mode, latest, latestIndex, openFeedback]);

  if (mode === 'review') return null;

  const openItem = openIndex !== null ? feedback[openIndex] : null;

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
          <button
            type="button"
            data-testid="perf-meter"
            aria-label={`Performance meter at ${Math.round(meter)} of 100 — show coach feedback`}
            onClick={() => latest && toggleLatest()}
            className="h-2 w-[120px] overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700"
          >
            <div
              key={latestIndex}
              className={`h-full rounded-full transition-all duration-300${isDrop ? ' animate-pop-in' : ''}`}
              style={{ width: `${meter}%`, backgroundColor: meterColor(meter) }}
            />
          </button>
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
