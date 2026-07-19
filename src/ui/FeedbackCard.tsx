import type { GradeResult, HeroBucket, Severity } from '../coach/graderTypes';

export const SEVERITY_COLOR: Record<Severity, string> = {
  OK: '#94a3b8', // slate-400 (gray)
  INACCURACY: '#facc15', // yellow-400
  MISTAKE: '#fb923c', // orange-400
  BLUNDER: '#f87171', // red-400
};

/** Beginner-friendly hand-strength labels (replaces jargon like "air"). */
const BUCKET_LABEL: Record<HeroBucket, string> = {
  MONSTER: 'monster hand',
  STRONG: 'strong hand',
  MARGINAL: 'medium-strength hand',
  DRAW: 'drawing hand',
  AIR: 'weak hand',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  OK: 'OK',
  INACCURACY: 'Inaccuracy',
  MISTAKE: 'Mistake',
  BLUNDER: 'Blunder',
};

export function FeedbackCard({ grade, onClose }: { grade: GradeResult; onClose?: () => void }) {
  const color = SEVERITY_COLOR[grade.severity];

  return (
    <div data-testid="feedback-card" className="w-80 rounded-xl border border-slate-700 bg-slate-900 p-4 text-left shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-900"
          style={{ backgroundColor: color }}
        >
          {SEVERITY_LABEL[grade.severity]}
        </span>
        <span className="text-xs text-slate-400">{grade.street.toLowerCase()}</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-2 rounded px-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      {grade.severity === 'OK' ? (
        <p className="text-sm text-slate-200">Good decision — you didn't give up anything here.</p>
      ) : (
        <p className="text-sm text-slate-200">{grade.message}</p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
        <span>
          wins ~{Math.round(grade.equity * 100)}% of the time
          {/* The hand-strength bucket describes a MADE hand, so it only makes
              sense once there's a board — a preflop "weak hand" for 99 is
              misleading. */}
          {grade.street !== 'PREFLOP' && ` · ${BUCKET_LABEL[grade.heroBucket]}`}
        </span>
        <span className="underline decoration-dotted" title="Glossary term (full glossary coming with onboarding)">
          {grade.glossary}
        </span>
      </div>
    </div>
  );
}
