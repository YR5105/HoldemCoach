import { useEffect, useMemo, useState } from 'react';
import { listGuesses, listHands, type GuessDoc, type HandDoc } from '../store/handHistory';
import { computeStats, type Stats } from '../store/stats';

// Dark-mode series hue from the validated reference palette (single series /
// single measure -> one hue; severity colors stay reserved for severity chips).
const SERIES = '#3987e5';
const GRID = '#334155';
const TEXT_SECONDARY = '#94a3b8';

const CATEGORY_LABEL: Record<string, string> = {
  preflop: 'Preflop',
  cbet: 'C-bet',
  facing_bet: 'Facing bets',
  bluff: 'Bluffing',
  sizing: 'Sizing',
};

export function DashboardScreen() {
  const [docs, setDocs] = useState<HandDoc[] | null>(null);
  const [guesses, setGuesses] = useState<GuessDoc[]>([]);

  useEffect(() => {
    void listHands(10000).then((hands) => setDocs(hands.reverse())); // oldest first
    void listGuesses().then(setGuesses);
  }, []);

  const stats: Stats | null = useMemo(
    () => (docs ? computeStats(docs, guesses) : null),
    [docs, guesses],
  );

  if (!stats) {
    return <div className="p-8 text-center text-sm text-slate-500">Loading…</div>;
  }

  if (stats.handsPlayed === 0) {
    return (
      <div className="p-12 text-center text-sm text-slate-500">
        No hands yet — your progress shows up here once you play.
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Hands played" value={String(stats.handsPlayed)} />
        <StatTile
          label="EV loss / 100 hands"
          value={`${stats.evLossPer100.toFixed(1)}bb`}
          hint="lower is better"
        />
        <StatTile
          label="Guess-first accuracy"
          value={stats.guessMeanErrorPct !== null ? `±${stats.guessMeanErrorPct.toFixed(0)}%` : '—'}
          hint={stats.guessCount > 0 ? `${stats.guessCount} guesses` : 'no guesses yet'}
        />
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-200">EV loss per 100 hands</h2>
        <p className="mb-3 text-xs text-slate-500">per {250}-hand window · lower is better</p>
        {stats.windows.length >= 2 ? (
          <TrendChart windows={stats.windows} />
        ) : (
          <p className="py-6 text-center text-xs text-slate-500">
            The trend line appears after 250 hands ({stats.handsPlayed} so far).
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">EV lost by category</h2>
        <CategoryBars stats={stats} />
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-200">Top leaks</h2>
        {stats.topLeaks.length === 0 ? (
          <p className="text-xs text-slate-500">No leaks found yet — keep playing.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {stats.topLeaks.map((leak, i) => (
              <li key={leak.category} className="rounded-lg bg-slate-950 px-3 py-2">
                <div className="text-sm text-slate-200">
                  {i + 1}. {CATEGORY_LABEL[leak.category] ?? leak.category}
                  <span className="ml-2 text-xs text-slate-500">
                    {leak.evLoss.toFixed(1)}bb lost · {leak.mistakes} mistake{leak.mistakes === 1 ? '' : 's'}
                  </span>
                </div>
                {leak.exampleMessage && (
                  <div className="mt-0.5 text-xs text-slate-400">{leak.exampleMessage}</div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-center">
      <div className="text-xl font-bold text-slate-100">{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{label}</div>
      {hint && <div className="text-[10px] text-slate-600">{hint}</div>}
    </div>
  );
}

function TrendChart({ windows }: { windows: Stats['windows'] }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 560;
  const H = 160;
  const PAD = { top: 12, right: 12, bottom: 24, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxY = Math.max(...windows.map((w) => w.evLossPer100), 1);
  const x = (i: number) => PAD.left + (windows.length === 1 ? innerW / 2 : (i / (windows.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;

  const path = windows.map((w, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(w.evLossPer100)}`).join(' ');
  const yTicks = [0, maxY / 2, maxY];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="EV loss per 100 hands across 250-hand windows"
      onMouseLeave={() => setHover(null)}
    >
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" strokeDasharray="2 4" />
          <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill={TEXT_SECONDARY}>
            {t.toFixed(0)}
          </text>
        </g>
      ))}

      <path d={path} fill="none" stroke={SERIES} strokeWidth="2" strokeLinejoin="round" />

      {windows.map((w, i) => (
        <g key={w.startHand}>
          <circle cx={x(i)} cy={y(w.evLossPer100)} r={hover === i ? 5 : 3.5} fill={SERIES} stroke="#0f172a" strokeWidth="2" />
          {/* generous invisible hit target for the hover tooltip */}
          <rect
            x={x(i) - innerW / windows.length / 2}
            y={PAD.top}
            width={innerW / Math.max(windows.length - 1, 1)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill={TEXT_SECONDARY}>
            {w.startHand + 1}–{w.startHand + w.hands}
          </text>
        </g>
      ))}

      {hover !== null && (
        <g transform={`translate(${Math.min(x(hover), W - 110)},${Math.max(y(windows[hover]!.evLossPer100) - 30, 4)})`}>
          <rect width="104" height="24" rx="4" fill="#1e293b" stroke={GRID} />
          <text x="52" y="15" textAnchor="middle" fontSize="10" fill="#e2e8f0">
            {windows[hover]!.evLossPer100.toFixed(1)}bb / 100
          </text>
        </g>
      )}
    </svg>
  );
}

function CategoryBars({ stats }: { stats: Stats }) {
  const maxLoss = Math.max(...stats.categories.map((c) => c.evLoss), 0.1);
  return (
    <div className="flex flex-col gap-2">
      {stats.categories.map((c) => (
        <div key={c.category} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-slate-400">{CATEGORY_LABEL[c.category]}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-sm bg-slate-950">
            <div
              className="h-full rounded-sm transition-all"
              style={{ width: `${(c.evLoss / maxLoss) * 100}%`, backgroundColor: SERIES }}
              title={`${c.evLoss.toFixed(1)}bb lost across ${c.mistakes} mistakes`}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-slate-300">
            {c.evLoss > 0 ? `${c.evLoss.toFixed(1)}bb` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
