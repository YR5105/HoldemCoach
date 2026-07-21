# HoldemCoach — how the feedback is generated

This document describes exactly how the coach grades a decision and produces the
feedback you see. It is meant as a reference to compare against winning-poker
strategy resources and decide what to improve. Every rule below maps to real
code; file paths are given so you can dig in.

**Core philosophy:** the coach does **not** label plays "right" or "wrong." It
estimates how many big blinds (bb) a decision *costs* versus the best available
action, and grades by that cost. A decision that gives up almost nothing is
**OK** even if it isn't the textbook play.

Entry point: `gradeDecision()` in [`src/coach/grader.ts`](../src/coach/grader.ts).
All grading runs inside a Web Worker so the UI never blocks.

---

## 1. The pipeline at a glance

For one hero decision (the game state *before* the action):

1. **Reconstruct each opponent's hand range** from the action history
   (`villainNodeCombos`).
2. **Estimate hero equity** vs those ranges by Monte Carlo (`simulateEquity`).
3. **Enumerate candidate actions** (fold / check / call / a few bet or raise
   sizes) and compute an **EV in bb** for each (`candidateActions` + the EV
   formulas).
4. **Pick the best** (highest-EV) action; the chosen action's **EV loss** =
   `EV(best) − EV(chosen)`.
5. **Preflop only:** override the EV verdict with **chart** grading (see §5).
6. **Map EV loss → severity** (OK / Inaccuracy / Mistake / Blunder).
7. **Choose a reason and render a plain-English message.**
8. **Tag a leak category** for the dashboard.

The dominant simplification is in step 3: postflop EV is a **one-street
approximation** (see §6 and §10).

---

## 2. Opponent range reconstruction (`src/coach/nodeRange.ts`)

The coach never peeks at opponents' cards. It rebuilds the *range* each bot
could hold, from the actions they took, using the **same charts and policy the
bots actually play** ("one range model" — bots and coach share one source of
truth). This is why equity numbers are consistent with how the bots behave.

- **Preflop:** each voluntary action pins the bot to a chart range and the
  ranges are intersected:
  - Open-raise → that seat's **opening range** for its position.
  - Facing one raise → **3-bet range** (if they raised) or **flat-call range**
    (if they called).
  - Facing a 3-bet+ → **4-bet (value + bluff)** or **continue** range.
  - A check/limp gives no information (range stays wide).
- **Postflop:** combos are filtered to those for which the observed action had
  nonzero probability under that bot's policy (`plausiblePostflopActionsForCombo`).
  This is combo-level, not just bucket-level (e.g. a calling *Station* never
  folds a made pair, so those combos survive a "call").
- **Personalities** widen/tighten the base charts and set post-flop
  frequencies. From [`src/data/bots.json`](../src/data/bots.json):

  | Bot | foldToCbet | cbet | bluffRatio | raiseStrong | notes |
  |-----|-----------:|-----:|-----------:|------------:|-------|
  | TAG | 0.45 | 0.65 | 0.30 | 0.80 | tight-aggressive baseline |
  | LAG | 0.35 | 0.80 | 0.45 | 0.70 | loose-aggressive |
  | Station | 0.15 | 0.40 | 0.10 | 0.50 | never folds a pair/draw |
  | Nit | 0.65 | 0.55 | 0.10 | 0.90 | ultra-tight |
  | Balanced | 0.50 | 0.60 | 0.33 | 0.75 | near-baseline |

  Preflop range transforms per personality live in
  [`src/coach/personalities.ts`](../src/coach/personalities.ts).

> **Comparison note:** ranges are *bot-model* ranges, not solver ranges or
> reads on a human. Against these specific bots that's exactly right; as a model
> of "GTO villain" it's only as good as the bot policy.

---

## 3. Equity estimation (`src/equity/monteCarlo.ts`)

`simulateEquity` samples a combo for each villain from their reconstructed
range, deals the remaining board, evaluates the showdown, and tallies hero's pot
share (wins + split fractions). **1,000 iterations** in the app (seeded, so it's
deterministic); ±~2%. Hand ranking uses `pokersolver`.

Equity here is the classic **all-in equity**: "the share you win if all cards
run out." How much of it you actually *keep* is handled separately by the
realization factor (§6).

---

## 4. Hero hand bucket (`heroBucketOf`)

Used only for choosing the *wording* of feedback (not the EV math). Based on
equity, with a draw carve-out that counts "clean outs" (cards that make a
straight or better):

| Bucket | Rule |
|--------|------|
| MONSTER | equity ≥ 0.80 |
| STRONG | equity ≥ 0.65 |
| MARGINAL | equity ≥ 0.45 |
| DRAW | ≥ 8 clean outs, or (equity ≥ 0.25 and ≥ 4 clean outs) |
| AIR | everything else |

The card shows a friendly label ("monster hand", "drawing hand", "weak hand").

---

## 5. Preflop grading — charts (spec §3)

Preflop, the one-street EV model is too crude to trust, so the coach grades
against **hand charts** in [`src/data/preflop.json`](../src/data/preflop.json)
(`preflopChartVerdict` in the grader):

- **Unopened pot:** the position's **open-raise** range → chart says *raise* or
  *fold*.
- **Facing one open:** **3-bet** range → raise; else **flat-call** range → call;
  else fold. (SB never flats a CO/BTN open, per the chart.)
- **Facing a 3-bet+:** **4-bet value + bluff** → raise; **continue** range →
  call; else fold.

Grading tolerance:
- Playing the chart action → **OK** (EV loss 0).
- One "step" off a boundary (kicker/top-card/pair ±1) → at most an **Inaccuracy**.
- A clear deviation → EV loss is measured against the chart action and graded
  normally; it is **never** silently downgraded to OK by the mixed-strategy
  tolerance below.

> **Comparison notes:** the charts are static — they do **not** currently adjust
> for stack depth, ante/straddle, limpers, ICM/tournament pay jumps, or
> multiway vs heads-up sizing. Open size is fixed (2.5bb, 3bb from the SB).
> 3-bet/4-bet sizing is a fixed multiplier, not pot-geometry-aware.

---

## 6. Postflop grading — one-street EV (spec §6.3)

### Candidate actions (`candidateActions`)
- Always: **fold** and (**call** or **check**).
- If hero can **bet**: three sizes — **33%, 66%, 125%** of pot.
- If hero can **raise**: **2.5×** and **3.5×** the current bet, or a **jam** when
  the stack-to-pot ratio (SPR) < 1.5.

### EV formulas (in bb; `EV(fold) = 0`)
Let `E` = hero equity, `R` = realization factor (below), `pot` = current pot,
`toCall` = amount to call, `b` = bet size:

- **Check:** `EV = E · R · pot`
- **Call:** `EV = E · R · (pot + toCall) − toCall`
- **Bet:** `EV = FE · pot + (1 − FE) · [ E' · R · (pot + 2b) − b ]`

where:
- **FE (fold equity)** = probability villains fold. Per villain it is
  `foldableShare · foldToCbet · sizeScale`, capped at 0.95 and multiplied across
  villains. `foldableShare` = the fraction of their range in weak/foldable
  buckets; `sizeScale = clamp(b/pot, 0.33, 1.25) / 0.66` (so a 66%-pot bet =
  1×). One-street heuristic.
- **E'** = hero equity recomputed **vs only the range that continues** (the
  non-weak combos) — a crude nod to "you get called by better."

### Realization factor `R` (`realizationFactor`)
Raw equity is discounted by how much you expect to *realize* over future
streets (position, more betting to come):

| Street | In position | Out of position |
|--------|------------:|----------------:|
| River | 1.00 | 1.00 |
| Turn | 0.95 | 0.85 |
| Flop | 0.90 | 0.80 |

**All-in exception (`equityFullyRealized`):** if calling puts hero all-in, or
every live opponent is already all-in, then `R = 1.0` — the board runs out with
no more decisions, so 100% of equity is realized. (This fixed a bug where
priced-in all-in calls were wrongly folded.)

> **Comparison notes — this is where the model is roughest:**
> - EV is **one street only**: no turn/river planning, no multi-street barreling,
>   no implied or reverse-implied odds beyond the flat `R` constant.
> - `R` is a **coarse constant by street × position**. Real equity realization
>   depends heavily on **board texture, SPR, and range vs range** (see GTO Wizard
>   / Upswing). A dry board vs a wet board are treated the same.
> - Fold equity ignores **blockers/card removal**, **bet-sizing theory beyond one
>   scalar**, **minimum-defense-frequency (MDF)**, and **polarization / value-to-
>   bluff ratios**.
> - Only **3 bet sizes** and **2 raise sizes** are considered, so "optimal
>   sizing" feedback is quantized.

---

## 7. EV loss → severity (`severityForEvLoss`, `graderTypes.ts`)

Default thresholds (configurable in Settings → Advanced):

| EV loss (bb) | Severity |
|--------------|----------|
| < 0.1 | **OK** |
| 0.1 – 0.5 | **Inaccuracy** |
| 0.5 – 2.0 | **Mistake** |
| > 2.0 | **Blunder** |

Extra rules:
- **Mixed-strategy tolerance:** any action within **0.1bb** of the best is OK
  (so close spots aren't nagged) — *except* a clear preflop chart deviation.

> **Comparison note:** these bb thresholds are absolute, not scaled to pot size
> or stack depth. A 2bb error in a 5bb pot and in a 200bb pot grade the same.

---

## 8. Reason + message (`REASONS`, `buildMessage`)

Message template:
`"{Best action} was the better play. {reason} That cost you about {Δ} big blinds."`
(capped at 260 chars, deliberately jargon-free.)

Reason is chosen by `pickReason`:

| reasonKey | When | Gist |
|-----------|------|------|
| `preflop_chart` | any preflop grade | "strong/weak enough to play from {seat}" |
| `pot_odds` | best is fold, or a call/check | price vs your win % |
| `missed_value` | should have bet/raised a strong hand | get chips in while ahead |
| `missed_bluff` | should have bet/raised a weak hand | fold out better hands |
| `oop_discipline` | out of position with a marginal/weak hand | play tighter OOP |

**pot_odds wording is now verdict-driven** (fixed): it says "good price" only
when the recommendation is to *continue*, and "the price was too high" only when
it is to *fold*. The "needed X%" figure is the **realization-adjusted**
break-even — `toCall / (R · (pot + toCall))` — which equals the raw pot-odds
price when all-in and is higher when there's more betting to come. This
guarantees the numbers and the advice never contradict each other.

---

## 9. Leak categories (`classifyDecision`, dashboard)

Each decision is tagged for the dashboard's "EV lost by category":
`preflop`, `cbet` (you were last aggressor and could stab), `facing_bet`,
`sizing` (right action, wrong size), `bluff` (unforced aggression with a weak
hand). Stats aggregation lives in [`src/store/stats.ts`](../src/store/stats.ts).

---

## 10. Summary of known simplifications (the comparison checklist)

Use this list to map the coach against strategy content and prioritize
improvements:

1. **One-street postflop EV** — no multi-street game tree, no barreling lines,
   no implied/reverse-implied odds beyond a flat realization constant.
2. **Realization factor is a constant** by street × position — ignores board
   texture, SPR, and range-vs-range dynamics that real equity realization hinges
   on.
3. **Fold-equity heuristic** — ignores blockers, MDF, and value-to-bluff
   balancing; scales only by a bet-size scalar and the bot's fold frequency.
4. **Quantized sizing** — only 3 bet sizes / 2 raise sizes are evaluated.
5. **Static preflop charts** — no stack-depth, ICM, ante/straddle, limper, or
   multiway adjustments; fixed open/3-bet sizes.
6. **Opponent model = the bots** — ranges assume the fixed bot policy, not a
   solver equilibrium or a read on a real player.
7. **Absolute bb thresholds** for severity — not normalized to pot or stack.
8. **Coarse hand buckets** (equity cutoffs) used for message wording.
9. **Monte Carlo variance** — ~±2% at 1,000 iterations.

None of these make the coach *wrong* against its own bots — but they're the
gaps between "beats these bots" and "matches modern solver-based strategy," and
they're the natural targets if you want to push it toward winning play.

---

## 11. Where things live

| Concern | File |
|---------|------|
| Grading entry point, EV, realization, messages | `src/coach/grader.ts` |
| Severity thresholds & types | `src/coach/graderTypes.ts` |
| Opponent range reconstruction | `src/coach/nodeRange.ts` |
| Preflop charts (data) | `src/data/preflop.json` |
| Range parsing / personalities | `src/coach/ranges.ts`, `src/coach/personalities.ts` |
| Bot policy (mirrors the coach) | `src/bots/botPolicy.ts`, `src/data/bots.json` |
| Monte Carlo equity | `src/equity/monteCarlo.ts` |
| Dashboard stats | `src/store/stats.ts` |
| Feedback UI | `src/ui/FeedbackCard.tsx`, `src/ui/FeedbackLayer.tsx` |
