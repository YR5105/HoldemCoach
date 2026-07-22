import { useEffect, useMemo, useState } from 'react';
import { buildReplay, type ReplayStep } from '../engine/replay';
import type { ActionType, Card as CardType } from '../engine/types';
import { listHands, type HandDoc } from '../store/handHistory';
import { PlayingCard } from './Card';
import { SEVERITY_COLOR } from './FeedbackCard';
import type { Severity } from '../coach/graderTypes';

const SEVERITY_ORDER: Severity[] = ['BLUNDER', 'MISTAKE', 'INACCURACY', 'OK'];

function worstSeverity(doc: HandDoc): Severity | null {
  let worst: Severity | null = null;
  for (const action of doc.actions) {
    const s = action.coach?.severity as Severity | undefined;
    if (!s) continue;
    if (worst === null || SEVERITY_ORDER.indexOf(s) < SEVERITY_ORDER.indexOf(worst)) worst = s;
  }
  return worst;
}

export function ReviewScreen() {
  const [hands, setHands] = useState<HandDoc[]>([]);
  const [filter, setFilter] = useState<Severity | 'ALL'>('ALL');
  const [selected, setSelected] = useState<HandDoc | null>(null);

  useEffect(() => {
    void listHands(200).then(setHands);
  }, []);

  const filtered = hands.filter((h) => {
    if (filter === 'ALL') return true;
    return h.actions.some((a) => a.coach?.severity === filter);
  });

  if (selected) {
    return <Replayer doc={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Hand history</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Severity | 'ALL')}
          className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200"
        >
          <option value="ALL">All hands</option>
          <option value="BLUNDER">Blunders</option>
          <option value="MISTAKE">Mistakes</option>
          <option value="INACCURACY">Inaccuracies</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">
          {hands.length === 0 ? 'No hands yet — play some poker first.' : 'No hands match this filter.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((doc) => {
            const worst = worstSeverity(doc);
            const heroCards = doc.holeCards[doc.config.heroSeat] ?? [];
            const won = doc.result.winners.includes(doc.config.heroSeat);
            return (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => setSelected(doc)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-left hover:border-slate-600"
                >
                  <div className="flex gap-1">
                    {heroCards.map((c, i) => (
                      <PlayingCard key={i} card={c} small />
                    ))}
                  </div>
                  <div className="flex-1 text-xs text-slate-400">
                    <div className="text-sm text-slate-200">
                      {new Date(doc.ts).toLocaleString()} · {doc.config.players}-max
                    </div>
                    <div>
                      board {doc.board.length > 0 ? doc.board.join(' ') : '—'} ·{' '}
                      {won ? 'won' : 'lost'}
                    </div>
                  </div>
                  {worst && worst !== 'OK' && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold text-slate-900"
                      style={{ backgroundColor: SEVERITY_COLOR[worst] }}
                    >
                      {worst}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Replayer({ doc, onBack }: { doc: HandDoc; onBack: () => void }) {
  const steps = useMemo<ReplayStep[] | null>(() => {
    try {
      return buildReplay(
        {
          players: doc.config.players,
          blinds: doc.config.blinds,
          startingStack: doc.config.startingStack ?? 200,
        },
        doc.seed,
        doc.config.buttonSeat ?? 0,
        doc.actions.map((a) => ({
          seat: a.seat,
          street: a.street as never,
          action: a.action as ActionType,
          amount: a.amount,
        })),
        doc.config.startingStacks,
      );
    } catch (err) {
      console.error('replay failed:', err);
      return null;
    }
  }, [doc]);

  const [stepIndex, setStepIndex] = useState(0);

  if (!steps) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <BackButton onBack={onBack} />
        <p className="py-12 text-center text-sm text-slate-500">
          This hand can't be replayed (it was saved by an older version).
        </p>
      </div>
    );
  }

  const step = steps[stepIndex]!;
  const { state } = step;
  const coach = step.entry && step.entry.seat === doc.config.heroSeat
    ? doc.actions[step.actionIndex]?.coach
    : undefined;
  const pot = state.seats.reduce((sum, s) => sum + s.committedTotal, 0);

  return (
    <div className="mx-auto w-full max-w-2xl p-4">
      <BackButton onBack={onBack} />

      <div className="mb-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-center gap-1.5">
          {state.board.map((c: CardType, i: number) => (
            <PlayingCard key={i} card={c} />
          ))}
          {state.board.length === 0 && <span className="text-sm text-slate-500">preflop</span>}
        </div>
        <div className="mb-3 text-center text-sm text-slate-300">
          {state.street} · pot {pot}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {state.seats.map((seat) => (
            <div
              key={seat.seatIndex}
              className={`rounded-lg border px-2 py-1.5 text-xs ${
                step.entry?.seat === seat.seatIndex
                  ? 'border-amber-400 bg-slate-800'
                  : 'border-slate-800 bg-slate-950'
              } ${seat.folded ? 'opacity-40' : ''}`}
            >
              <div className="mb-1 flex items-center justify-between text-slate-300">
                <span>
                  {seat.seatIndex === doc.config.heroSeat ? 'You' : `Bot ${seat.seatIndex}`}
                  {seat.seatIndex === state.buttonSeat ? ' · BTN' : ''}
                </span>
                <span>{seat.stack}</span>
              </div>
              <div className="flex gap-1">
                {(seat.holeCards ?? []).map((c, i) => (
                  <PlayingCard key={i} card={c} small />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-2">
        <button
          type="button"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          className="rounded-lg bg-slate-700 px-4 py-1.5 text-sm text-slate-100 disabled:opacity-40"
        >
          ← Prev
        </button>
        <div className="text-center text-sm text-slate-300">
          {step.entry
            ? `${step.entry.seat === doc.config.heroSeat ? 'You' : `Bot ${step.entry.seat}`} ${step.entry.action}${step.entry.amount ? ` ${step.entry.amount}` : ''}`
            : 'Hand start'}
          <div className="text-xs text-slate-500">
            step {stepIndex + 1} / {steps.length}
          </div>
        </div>
        <button
          type="button"
          disabled={stepIndex === steps.length - 1}
          onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
          className="rounded-lg bg-slate-700 px-4 py-1.5 text-sm text-slate-100 disabled:opacity-40"
        >
          Next →
        </button>
      </div>

      {coach && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm">
          <span
            className="mr-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-slate-900"
            style={{ backgroundColor: SEVERITY_COLOR[coach.severity as Severity] ?? '#94a3b8' }}
          >
            {coach.severity}
          </span>
          <span className="text-slate-200">
            {coach.severity === 'OK' ? 'Good decision — no EV lost.' : coach.message}
          </span>
          <div className="mt-1 text-xs text-slate-500">
            equity {Math.round(coach.equity * 100)}% · best: {coach.best}
            {coach.bestSize !== undefined ? ` ${coach.bestSize}` : ''}
          </div>
        </div>
      )}

      {state.payout && stepIndex === steps.length - 1 && (
        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-center text-sm text-slate-200">
          {state.payout.winners.map((w) => (
            <div key={w.seat}>
              {w.seat === doc.config.heroSeat ? 'You win' : `Bot ${w.seat} wins`} {w.amount}
              {state.payout!.showdownHands?.[w.seat] ? ` — ${state.payout!.showdownHands[w.seat]!.descr}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
    >
      ← All hands
    </button>
  );
}
