# PRD — Coach Feedback v2: Teach Like a Pro

**Author:** Product · **Status:** Ready for implementation · **Date:** 2026-07-21
**Audience:** Developers (incl. AI coding agents). Every requirement names exact files, functions, and acceptance criteria.

---

## 1. Product context

HoldemCoach is a No-Limit Hold'em training game: the user plays hands against
bots and every decision they make is graded by *what it cost* in big blinds,
not "right/wrong". The coach's feedback is the core product value — it is how
users actually improve.

**Users:** three onboarding personas (`beginner`, `casual`, `studied` in
`src/store/settingsStore.ts`). Feedback must stay plain-English for beginners
while being substantive enough for studied players.

**Where feedback appears (current UX):**

| Surface | File | Behavior |
|---------|------|----------|
| Feedback card | `src/ui/FeedbackCard.tsx` | Severity chip + 1-sentence message + win% + glossary term |
| Instant mode | `src/ui/FeedbackLayer.tsx` | Modal card pops on every non-OK grade |
| Subtle mode (default) | `src/ui/FeedbackLayer.tsx` | 12px severity dot; click expands card |
| Review mode | `HandSummary` in `FeedbackLayer.tsx` | Cards shown at end of hand |
| Leak dashboard | `src/ui/DashboardScreen.tsx` | EV lost by category (`preflop`, `cbet`, `facing_bet`, `sizing`, `bluff`) |
| Review screen | `src/ui/ReviewScreen.tsx` | Per-hand decision replay with grades |

**Grading engine:** `gradeDecision()` in `src/coach/grader.ts` (runs in a Web
Worker). Full architecture reference: `docs/coaching-logic.md`. Strategy
research this PRD is based on: winning-strategy material from Upswing Poker,
PokerCoaching.com (Jonathan Little), and solver-based training sites.

## 2. Problem

The grading engine is solid, but its *explanations* teach less than they
could. Before v2 there were only 5 reason templates. The coach knew things it
never told the user: board texture, the hero's draw potential, the opponent's
personality type, and why bet sizing matters. Top training content teaches
exactly these concepts; the app should too.

## 3. Goals / non-goals

**Goals**
1. Every non-OK grade teaches a named, pro-level concept (sizing by texture, semi-bluffing, pot control, opponent exploits) — not just "X was better".
2. Feedback stays consistent with the EV verdict (never contradicts the numbers shown).
3. Zero regressions: all existing tests keep passing.

**Non-goals (this phase)**
- No changes to the EV math, realization factor, or preflop charts (that is Phase 3, §7).
- No new UI surfaces; reuse `FeedbackCard` and the existing message template.
- No multi-street solver logic.

## 4. Hard constraints (verified in code — do not break)

1. **Plain-English guard:** all messages must pass `src/coach/__tests__/plainEnglish.test.ts`. Banned tokens include `bb`, `EV`, `equity`, `range`, `c-bet`, `GTO`, position abbreviations (`UTG`/`HJ`/`CO`/`BTN`/`SB`/`BB`), and hand codes like `T9s`. Messages ≤260 chars, end with a period; any "cost" mention must say "big blinds".
2. **Message template is fixed:** `"{Best action} was the better play. {reason} That cost you about {Δ} big blinds."` (`buildMessage` in `grader.ts`).
3. **One range model:** the coach's villain-range reconstruction must keep using the bots' own policy code path (`plausiblePostflopActionsForCombo` in `src/bots/botPolicy.ts`). Enforced by `oneRangeModel.test.ts`.
4. **Worker-safe:** `grader.ts` and anything it imports runs in a Web Worker — pure TS only, no DOM/React imports. Enforced by `workerParity.test.ts`.
5. **Determinism:** all randomness is seeded; grading the same state twice must give identical output.
6. **`reasonKey` is persisted** as a string in hand history (`src/store/handHistory.ts`) — only additive changes to the `ReasonKey` union.

## 5. Phase 1 — DONE (in working tree, uncommitted)

Implemented, tested (232/232 passing, `tsc --noEmit` clean), and documented in
`docs/coaching-logic.md` §8. Listed here so implementers know the baseline:

| Change | Files |
|--------|-------|
| Board texture classifier (`DRY`/`WET`, wording only) | `src/coach/boardTexture.ts` (new) + `boardTexture.test.ts` |
| `bet_sizing` reason — right action, wrong size; texture-aware ("small on dry, big on wet") | `grader.ts`, `graderTypes.ts` |
| `semi_bluff` reason — draws that should bet: "two ways to win" + real outs count | `grader.ts` |
| `pot_control` reason — overbet MARGINAL hand: "big pots are for big hands" | `grader.ts` |
| `exploit_station` / `exploit_nit` reasons — heads-up personality reads | `grader.ts` |
| `missed_value` wet-board addendum ("makes drawing hands pay") | `grader.ts` |
| Tests for all of the above | `feedbackReasons.test.ts` (new) |

**Action item P1-0: commit this work** as its own commit before starting Phase 2.

## 6. Phase 2 — Requirements (this PRD's scope)

> **Status:** R1–R4 implemented in `8e7222a`, R5 in `a06457b` — all verified.
> **R6 and R7 are the open requirements.** They respond to real user feedback:
> a huge won pot graded harshly (partly justified, partly simulation noise) and
> a request to detect behavioral patterns across hands.

### R1 — LAG exploit reason (`exploit_lag`)

**User story:** When a lone loose-aggressive opponent bets and I fold a decent
bluff-catcher that the EV model wanted to call, tell me *why*: this player
bluffs too often.

**Spec:**
- New `ReasonKey` value `exploit_lag` in `src/coach/graderTypes.ts`.
- In `pickReason` (`grader.ts`): when `villainType === 'LAG'`, hero is facing a bet (chosen or best is call), best action is `call`, chosen was `fold`, and `heroBucket` is `MARGINAL` or better → `exploit_lag`.
- Extend the `VillainType` union and the single-villain mapping in `gradeDecision` with `'LAG'`.
- Message (must pass jargon guard): "This opponent bets and raises far more often than they have a strong hand. Against them, a decent hand that can beat bluffs is worth a call." Glossary: `player types`.

**Acceptance criteria:**
- Deterministic unit test in `feedbackReasons.test.ts`: heads-up river fixture vs `{1: 'LAG'}` where hero folds a marginal made hand and `best.action === 'call'` → `reasonKey === 'exploit_lag'`.
- Same fixture vs default TAG → `pot_odds` (control test).
- `plainEnglish` suite still green.

### R2 — Multiway discipline wording

**User story:** When I lose EV in a pot with 2+ opponents, the coach should
mention that more players means stronger hands are needed — a core pro concept
currently never surfaced.

**Spec:**
- Add `multiway: boolean` to `ReasonCtx` in `grader.ts` (true when ≥2 live villains at the decision).
- `pot_odds` text when `multiway && !pricedIn`: append " With several players still in, someone usually has a strong hand — you need more than heads-up." (keep total ≤260 chars; if it would overflow, prefer the multiway sentence over nothing by shortening the base sentence is NOT allowed — instead skip the addendum when overflowing).
- `missed_bluff` must NOT fire multiway: bluffing multiway is a leak. In `pickReason`, when multiway and bucket is `AIR`, return `pot_odds` instead (the EV numbers still carry the verdict).

**Acceptance criteria:**
- Unit test: 3-player fixture where hero bluff-bets air and best is check → reason is NOT `missed_bluff`.
- Unit test: multiway fold-is-best spot → message contains "several players".

### R3 — Leak dashboard: category → lesson tips

**User story:** My dashboard says I lose EV to "sizing" but not what to do
about it. Each leak category should link to one actionable study tip.

**Spec:**
- New map in `src/ui/DashboardScreen.tsx` (UI layer, not grader): `LEAK_TIPS: Record<DecisionCategory, string>` with one plain-English sentence each:
  - `preflop`: "Stick to the starting-hand chart for your seat — discipline before the flop is the fastest way to stop losses."
  - `cbet`: "As the last raiser you can often keep betting: small on boards that miss everyone, bigger when many draws are possible."
  - `facing_bet`: "Compare the price against how often your hand wins — and fold when you are not getting it."
  - `sizing`: "Size bets by the board: small bets work on dry boards, big bets on coordinated ones."
  - `bluff`: "Bluff with hands that can still improve, and never bluff players who refuse to fold."
- Render the tip for the single worst category (highest EV lost) under the existing "EV lost by category" list.

**Acceptance criteria:**
- Component test (pattern: `src/ui/__tests__/coachModes.test.tsx`): dashboard with a dominant `sizing` leak renders the sizing tip text.
- Tips contain no banned jargon tokens (reuse the regex list from `plainEnglish.test.ts` in the new test).

### R4 — Severity-aware OK copy

**User story:** The OK card always says the same sentence; after a
well-played semi-bluff or value bet it should reinforce *what* was good.

**Spec:**
- In `FeedbackCard.tsx`, when `severity === 'OK'`, vary the copy by `grade.heroBucket` and `grade.chosen.action`:
  - chosen bet/raise + `MONSTER`/`STRONG`: "Good decision — betting strong hands builds the pot while you are ahead."
  - chosen bet/raise + `DRAW`: "Good decision — betting a draw gives you two ways to win."
  - chosen fold: "Good decision — saving chips is winning too."
  - otherwise: current copy ("Good decision — you didn't give up anything here.").
- Note: OK cards render in subtle/review mode expansion and `HandSummary`; instant mode skips OKs (`FeedbackLayer.tsx` line ~24) — unchanged.

**Acceptance criteria:**
- Component test: OK grade with `heroBucket: 'DRAW'`, chosen bet → renders the two-ways-to-win copy.

### R5 — Performance bar ("meter" feedback mode)

**User story:** Written feedback after every decision bothers me. I want an
ambient bar that rises when I play well and drops when I make mistakes —
small dips for small mistakes, big drops for blunders — with the written
explanation available only when I tap.

**Spec — mechanics (decision quality only, never pot results):**
- Bar value 0–100, session-scoped, starts at 75. Persist in `src/store/gameStore.ts` alongside the existing `feedback` array (the deltas derive from data already stored there — no grader changes).
- On each graded decision:
  - `severity === 'OK'` → `+2`, capped at 100.
  - otherwise → `−min(20, round(evLossBb × 4))`, floored at 0.
- Bar color by current value: ≥67 green, 34–66 amber, ≤33 red (reuse the severity color palette in `FeedbackCard.tsx`).
- Resets when a new session starts; the per-session series feeds the dashboard later (out of scope now — just keep the value in the store).

**Spec — UX:**
- New `FeedbackMode` value `'meter'` in `src/store/settingsStore.ts` (additive; persisted store, so missing key must default safely for existing users).
- Render in `src/ui/FeedbackLayer.tsx` where the subtle dot renders today: a slim horizontal bar (~120px) near the HUD, with the numeric value optional/hidden by default.
- Keep the subtle severity dot next to the bar after each graded decision; clicking either the dot or the bar opens the existing `FeedbackCard` for the latest grade — the deep dive is always one tap away, never pushed.
- On a `MISTAKE`/`BLUNDER` drop, animate the bar briefly (existing `animate-pop-in` pattern); no text appears.
- No written feedback ever auto-opens in meter mode (including end of hand — `HandSummary` stays review-mode-only).
- Onboarding defaults: `beginner` keeps `instant`; `casual`/`studied` may default to `meter` (change `completeOnboarding` in `settingsStore.ts`); Settings screen gets the fourth mode option in `src/ui/SettingsScreen.tsx`.

**Acceptance criteria:**
- Store unit test: sequence OK, OK, Inaccuracy(0.3bb), Blunder(6bb) from 75 → 75+2+2−1−20 = 58, and the bar never leaves [0, 100].
- Component test (pattern: `coachModes.test.tsx`): in meter mode, no `FeedbackCard` renders automatically after a Blunder grade; clicking the bar renders it.
- Component test: mode picker in Settings shows the meter option and persists it.
- Existing instant/subtle/review behavior unchanged (current `coachModes` tests still green).

### R6 — Big-pot grading robustness + meter fairness

**Problem (observed in production):** hero won a ~200bb pot but the meter
tanked. Two causes. (a) Legitimate: the coach grades decisions, not results —
some penalties were correct. (b) Defect: equity comes from Monte Carlo with
`MC_ITERATIONS = 1000` (`grader.ts` top), so each equity estimate carries
~±1.6% noise. EV terms multiply equity by pot-scale amounts, so in a 200bb pot
a single EV estimate carries ~±3bb of pure noise — and `evLossBb` compares two
independently-seeded estimates (`equityVs` uses a per-candidate seed suffix),
so the noise on the *difference* is larger still. The Blunder threshold is
2bb: in big pots the coach can manufacture phantom Blunders from noise, each
costing up to −20 on the meter.

**Spec — 6a, noise-aware severity (grader):**
- Make iterations pot-adaptive in `gradeDecision`: `iterations = min(4000, max(1000, round(potBb * 20)))`; thread it through `equityVs`/`simulateEquity` instead of the flat constant.
- Add `noiseMarginBb(potBb, iterations)` in `grader.ts` ≈ `k / sqrt(iterations) * potBb` — this is z·σ of the *difference* of two independent equity estimates scaled by pot (σ_equity = 0.5/√N; difference multiplies by √2). Start with k = 1.0 (≈1.4σ) and calibrate.
- Severity postflop uses `adjustedLoss = max(0, evLossBb − noiseMarginBb)` for tier mapping only; the displayed cost stays `evLossBb`. Preflop chart grading is deterministic — do NOT apply the margin there (keep the existing chart-deviation rules untouched).
- **Calibration constraint:** all existing fixture tests must pass unchanged (`grader.test.ts` river fixtures expect BLUNDER at ~5bb loss in a 15bb pot and MISTAKE/BLUNDER in the 20bb value fixture). If k = 1.0 breaks them, reduce k — the margin is meant to bite in 100bb+ pots, not 20bb ones. State the final k in a code comment with the math.

**Spec — 6b, meter fairness (store + UI):**
- Difficulty-weighted gains in `meterAfter` (`gameStore.ts`): pass the sorted `candidates` (already in `GradeResult`); let `gap = candidates[0].evBb − candidates[1].evBb` (0 if <2 candidates). OK reward: +2 when gap < 1, +4 when 1 ≤ gap < 3, +6 when gap ≥ 3 — a correct choice in a hard spot earns visibly more.
- Delta indicator: in the meter UI (`FeedbackLayer.tsx`), on each meter change render a small floating "+4"/"−12" label that fades out (~1s, CSS animation; pattern: existing `animate-pop-in`). No text otherwise.
- "Won, but…" nudge: at hand end (`state.street === 'PAYOUT'`) in meter mode only, when hero is in `payout.winners` AND any grade this hand was `MISTAKE`/`BLUNDER`, render one dismissible line near the bar: "Nice pot — one decision along the way could have cost you. Tap the bar to see." It must never auto-open the FeedbackCard, and must not appear in other modes.

**Acceptance criteria:**
- Unit test: with pot 200bb and two candidate EVs differing by less than the noise margin, severity is OK/INACCURACY — never BLUNDER.
- Unit test: `noiseMarginBb` grows with pot and shrinks with iterations; pot 15bb margin < 1bb (so small-pot grading is untouched).
- Existing `grader.test.ts`, `graderAccuracy.test.ts`, `graderSanity.test.ts` pass unchanged.
- Store test: OK grade with gap ≥ 3 moves meter +6; gap < 1 moves +2.
- Component test: winning hand containing a Blunder in meter mode shows the nudge; losing hand or mode ≠ meter shows nothing.

### R7 — Behavioral pattern detection: draw chasing + readability

**User insight:** most players respond to raises the same way when drawing —
passive calls at bad prices — which is both an EV leak and a *tell*: if raises
always mean a made hand and calls always mean a draw, observant opponents read
the player like a book. Detect both patterns across hands and teach the pro
fix (raise some strong draws to stay unreadable).

**Spec — data (additive, backward-compatible):**
- Add `heroBucket: string` to `CoachAnnotation` (`handHistory.ts`) and populate it in `toCoachAnnotation` from `grade.heroBucket`. Old IndexedDB docs lack the field — every consumer must skip records without it. No DB migration needed (documents are schemaless).

**Spec — stats (`src/store/stats.ts`, extend `computeStats`):**
- Chasing: over hero decisions where `coach.heroBucket === 'DRAW'` and `coach.category === 'facing_bet'`: `chaseSpots` = count, `chaseLeaks` = count with `severity !== 'OK'`, `chaseRate = chaseLeaks / chaseSpots`.
- Readability: over hero decisions with a coach annotation, aggression = action is `bet`/`raise`. `aggMadeRate` among `heroBucket ∈ {MONSTER, STRONG}` (n = `madeSpots`), `aggDrawRate` among `heroBucket === 'DRAW'` (n = `drawSpots`). `readabilityGap = aggMadeRate − aggDrawRate`.
- Expose all six numbers on the `Stats` type.

**Spec — dashboard ("Are you readable?" card, `DashboardScreen.tsx`):**
- Render the card only when at least one pattern clears its bar (below); otherwise omit entirely — never show "not enough data".
- Chasing line (requires `chaseSpots ≥ 10` and `chaseRate ≥ 0.5`): "When you hold a flush or straight draw and face a bet, you pay too much to keep chasing about {chaseRate}% of the time. Check the price against your chance of hitting before you call."
- Readability line (requires `madeSpots ≥ 10`, `drawSpots ≥ 10`, `readabilityGap ≥ 0.4`): "Your raises almost always mean a strong made hand — you raise {aggMadeRate}% of the time with strong hands but only {aggDrawRate}% with your draws. Observant opponents can read that. Raising some of your strong draws keeps them guessing."
- Both strings must pass the jargon regex list from `plainEnglish.test.ts` (note: "draw", "flush", "straight" are allowed; "range" is not).

**Acceptance criteria:**
- Stats unit test with synthetic `HandDoc`s: chase and readability numbers computed correctly; docs without `heroBucket` are skipped without error.
- Component test: card renders the chasing line at `chaseSpots = 12, chaseRate = 0.6`; renders nothing at `chaseSpots = 5` however bad the rate.
- Jargon test over both card strings.
- Existing `stats.test.ts` and `dashboardTips.test.tsx` pass unchanged.

## 7. Phase 3 — Deferred (do not implement now; listed for roadmap)

EV-model accuracy track, in priority order: texture-adjusted realization
factor; MDF-informed fold equity; extra bet-size candidates (50% pot; river
overbet only when hero is polarized); pot-normalized severity thresholds.
Each changes grading numbers and needs its own calibration pass against
`graderAccuracy.test.ts` — out of scope here.

Stretch (after R7): **exploit bots** — when R7 detects a readable pattern,
a bot personality that punishes it (stops paying off when the user's line
screams a completed draw). Touches `botPolicy.ts` and the one-range-model
invariant, so it needs its own design pass.

## 8. Verification checklist (applies to every requirement)

1. `npx vitest run` — full suite green (232 baseline + new tests).
2. `npx tsc -p tsconfig.app.json --noEmit` — clean.
3. New/changed messages audited against the `plainEnglish.test.ts` regex list.
4. `docs/coaching-logic.md` §8 table updated for any new `ReasonKey`.
5. No imports of UI/DOM code into `src/coach/**` (worker safety).

## 9. Success metrics (qualitative, this phase)

- Every non-OK grade names a concept a user could search a training site for (sizing, semi-bluff, pot control, player types, multiway).
- No feedback message ever contradicts the displayed numbers or the recommended action (already enforced for pot odds; keep it true for new reasons).
