# HoldemCoach — QA prompts for Claude Code

Each section below is a self-contained task. Paste one at a time into Claude Code
from the repo root (`~/HoldemCoach`). They are ordered by priority: the first ones
protect the things that would most embarrass the app if broken (wrong poker math,
nonsense coaching). After each task, run `npx vitest run` and make sure the whole
suite passes before moving to the next.

Conventions the prompts rely on:

- Tests live next to code in `__tests__/` folders and run with Vitest (`npx vitest run`).
- The engine is deterministic: `createInitialState(config, seed, buttonSeat)` + the
  same actions always produce the same result.
- The grader entry point is `gradeDecision()` in `src/coach/grader.ts`.
- Coach messages must be plain English — no poker abbreviations (see prompt 3).

---

## 1. Grader sanity suite — the coach must never give absurd advice

```
Add a new test file src/coach/__tests__/graderSanity.test.ts that asserts the coach
never gives obviously wrong advice. Use the existing test helpers in
src/engine/__tests__/testHelpers.ts and the style of src/coach/__tests__/grader.test.ts
(structuredClone the state and overwrite holeCards to force specific hands).

Cover at least these invariants:

1. Premium hands are never told to fold preflop: for AA, KK, and AKs in every
   position (UTG, HJ, CO, BTN, SB), grading a raise must come back severity OK,
   and grading a fold must NOT come back OK.
2. Trash is never told to attack: for 72o and 83o opening from UTG/HJ/CO, grading
   a raise must be worse than OK, and grading a fold must be OK.
3. Priced-in calls are never graded as blunders: construct a river spot where the
   hero needs less than 25% equity to call and has a hand with clearly more (e.g.
   top pair vs a small bet). Grading a call must not be MISTAKE or BLUNDER.
4. The recommended action is always legal: for ~50 random seeded states across
   streets, grade every legal action and assert grade.best.action is in
   getLegalActions() for that state.
5. evLossBb is never negative and severity is monotone in evLossBb (an action
   with higher EV loss never gets a milder severity than one with lower EV loss
   in the same spot).

Keep total added runtime under ~20 seconds (cap Monte Carlo-heavy cases).
Run npx vitest run when done; all existing 116+ tests must still pass.
```

## 2. Engine fuzz test — chips can never appear or disappear

```
Add src/engine/__tests__/fuzz.test.ts: a property-based fuzz test of the poker
engine using its own determinism (no new dependencies — use a simple seeded RNG).

For 200 seeded random hands across table sizes 2–6:
- Play each hand to completion by repeatedly picking a uniformly random action
  from getLegalActions() (random raise sizes within [minTo, maxTo]).
- After every single action, assert:
  a. Chip conservation: sum of all stacks + all committed chips + awarded pots
     equals the sum of starting stacks. Exactly. No rounding drift.
  b. No stack is ever negative.
  c. If the hand is over, exactly the winners' stacks increased and the pot is 0.
- At hand end, replay the identical seed + action list through the replay module
  (src/engine/replay.ts) and assert the final state deep-equals the live one.

If a violation is found, print the seed and full action list in the failure
message so the case can be reproduced as a fixed regression test.
```

## 3. Plain-English guard — jargon can never creep back into coach messages

```
The coach's feedback messages were deliberately rewritten in plain English
(src/coach/grader.ts: REASONS, actionLabel, buildMessage). Add a regression test
src/coach/__tests__/plainEnglish.test.ts that keeps it that way.

Generate a few hundred graded decisions (vary: position, facing open/raise/re-raise,
streets, hand strengths — reuse the state-building approach from grader.test.ts)
and for every non-OK grade assert the message:
- never matches these jargon patterns (case-sensitive where sensible):
  /\bbb\b/, /\bEV\b/, /\bequity\b/, /\bGTO\b/, /\brange\b/, /\bc-?bet\b/,
  /\bUTG\b/, /\bHJ\b/, /\bCO\b/, /\bBTN\b/, /\bSB\b/, /\bBB\b/, /\bo\b after a
  hand like "K5o", /\+\d+(\.\d+)?bb/
  (the glossary FIELD may contain terms like "pot odds" — only the message text
  is under test)
- always ends with a period, is under 260 characters, and contains "big blind"
  whenever it mentions a cost
- mentions the raise when the preflop context was facing >= 1 raise (the
  'facing' logic added to ReasonCtx)

Also grep src/ui/*.tsx for user-visible strings containing "equity", "EV", or
"bb" and list any you find in a comment at the top of the test file as candidates
for the same treatment (don't change UI files in this task).
```

## 4. Equity engine accuracy — the win % dial must tell the truth

```
Add src/equity/__tests__/knownMatchups.test.ts benchmarking simulateEquity
(src/equity/monteCarlo.ts) against well-known exact preflop matchup numbers:

- AA vs KK: AA ≈ 81.9%
- AKs vs QQ: QQ ≈ 54%
- AKo vs 22: 22 ≈ 52.7%
- AA vs A2o (dominated): AA ≈ 92%
- T9s vs AA: AA ≈ 77%
- 3-way: AA vs KK vs QQ: AA ≈ 66.6%

Run each with enough iterations for stability (e.g. 20,000, fixed seed) and
assert within ±2 percentage points. Also add postflop spot checks: a flopped
flush draw vs top pair ≈ 35% with two cards to come; an open-ended straight
draw on the turn ≈ 18% with one card to come.

Then verify the UI's ± band is honest: WinDial (src/ui/WinDial.tsx) displays
±3% — run the same seed-varied simulation 30 times at the iteration count the
app actually uses in the worker path and assert the standard deviation is
consistent with the displayed band; if it is not, report (don't silently fix)
the correct band in the test output.
```

## 5. One-range-model invariant — bots and coach must agree on the charts

```
The project has a hard invariant: bots and the grader share one preflop range
model (see src/coach/ranges.ts, src/data/preflop.json, src/bots/botPolicy.ts).
Add src/coach/__tests__/oneRangeModel.test.ts:

1. Exhaustively iterate all 169 canonical starting hands. For each position and
   each hand, if the bot policy would open-raise it in an unopened pot, then
   gradeDecision must grade a hero open-raise of that same hand as OK — and
   vice versa: if the bot folds it, a hero fold must be OK. Any hand where bot
   behavior and grading disagree is a failure; print the hand + position.
2. Same idea facing a single open: bot's 3-bet/call/fold decision vs the
   grader's verdict for the same hand and positions.
3. Assert every range string in preflop.json parses without throwing and that
   parsed sets are non-empty and contain no impossible codes (e.g. "AAs").

To keep runtime sane, force hole cards via structuredClone as grader.test.ts
does, and skip equity computation where the chart path decides the grade.
```

## 6. Review & hand history integrity — what you replay is what you played

```
Test that the Review screen's data pipeline is lossless. Add
src/store/__tests__/handHistory.test.ts (extend if it exists):

1. Play 20 seeded hands programmatically through the game store / engine,
   persisting each to hand history as the app does.
2. For each saved hand: rebuild every intermediate state via the replay module
   and assert (a) the action sequence matches what was played, (b) hole cards,
   board, pot sizes and winners match, (c) every graded decision stored with
   the hand still matches a fresh gradeDecision call on the reconstructed
   pre-action state (same severity and best action — messages may differ only
   if wording changed between versions; compare reasonKey, not message text).
3. Serialization round-trip: JSON.stringify then parse the stored document and
   assert deep equality — catches Date/Map/undefined-field bugs.
4. Storage cap behavior: save more hands than the history limit (check
   src/store/handHistory.ts for the cap) and assert oldest-first eviction, no
   corruption.
```

## 7. Stats & dashboard math — leak numbers must add up

```
Audit the stats aggregation in src/store/stats.ts and its dashboard display
(src/ui/DashboardScreen.tsx). Add or extend src/store/__tests__/stats.test.ts:

1. Feed a synthetic, hand-built sequence of GradeResults with known evLossBb
   and categories, and assert: total EV lost equals the exact sum; per-category
   mistake counts are exact; the "per 250-hand window" normalization is
   arithmetically correct for windows smaller and larger than 250.
2. Severity boundary values (evLossBb exactly 0.1, 0.5, 2.0) land in the
   documented buckets of severityForEvLoss — no off-by-one at thresholds.
3. Persistence: simulate app restart by writing stats through the store,
   re-initializing it, and asserting identical readback (localStorage mock).
4. OK decisions must not count as mistakes anywhere in the aggregation.
Report (in your summary, not code) anything on the Dashboard that displays
jargon a beginner wouldn't know, with suggested plain-English replacements.
```

## 8. Playwright smoke test — the app boots and a full hand can be played

```
Set up Playwright for this Vite app (add as devDependency, config in repo root,
tests in e2e/). Write one smoke test that:

1. Starts the dev server (playwright config webServer against npm run dev).
2. Completes or skips onboarding (whichever the first-run flow requires).
3. Plays through at least 3 full hands clicking real buttons: waits for the
   hero's turn, clicks a legal action (prefer Call/Check, Fold when facing big
   bets), clicks "Next Hand" when it appears.
4. Asserts along the way: the pot number is always a non-negative integer; a
   feedback card eventually appears in Instant coach mode after a graded
   decision; the win-probability dial renders a percentage between 0 and 100.
5. Visits Review, Dashboard, and Settings tabs and asserts each renders its
   main heading without console errors (fail the test on any page error).

Add an npm script "test:e2e". Keep the whole run under 2 minutes. Do not modify
app code except to add stable data-testid attributes where selectors would
otherwise be brittle.
```

## 9. Coach modes behave as promised

```
Settings promises three coach modes (src/ui/SettingsScreen.tsx): "Instant pops a
card after each graded decision · Subtle shows a small dot · Review waits".
Write component tests (Vitest + @testing-library/react — add it if absent) that
mount the table UI with a mocked grade result and assert:

1. Instant: FeedbackCard appears immediately after a graded decision, and shows
   severity label, message, and the plain-English footer ("wins ~X% of the
   time · ... hand").
2. Subtle: no card, but the dot/indicator element appears with the severity
   color from SEVERITY_COLOR.
3. Review: nothing appears mid-hand; the feedback is present on the end-of-hand
   summary instead.
4. Switching modes mid-session takes effect on the next decision without reload.
5. The OK case renders the "Good decision" copy, never the mistake layout.
```

## 10. Worker parity — the equity worker must match the main-thread math

```
The app computes equity and grades inside a Web Worker
(src/workers/equity.worker.ts, protocol in src/workers/equityProtocol.ts).
Add a test that runs the worker's message-handling logic directly (import the
handler functions, not a real Worker) and asserts:

1. For 10 seeded scenarios, the worker-path result (equity and full GradeResult)
   deep-equals calling simulateEquity/gradeDecision directly with the same
   inputs — same seed in, identical numbers out.
2. Malformed or stale messages (unknown type, out-of-date request id if the
   protocol has one) are ignored or rejected without throwing.
3. Measure and print (console.info) the wall-clock time of a worst-case grade
   (river, multiway, all candidates) so we have a latency baseline; assert it
   stays under 2 seconds in CI conditions.
```

## 11. Onboarding & first-run copy audit (report only, no code changes)

```
Read every user-facing string in src/ui/Onboarding.tsx, src/ui/SettingsScreen.tsx,
src/ui/GuessPrompt.tsx, src/ui/WinDial.tsx, src/ui/ReviewScreen.tsx and
src/ui/DashboardScreen.tsx. Produce a markdown report (docs/copy-audit.md) with
a table: file, current string, why it may confuse a brand-new player, suggested
plain-English replacement. Flag every use of: bb, EV, equity, GTO, c-bet, 3-bet,
position abbreviations (UTG/HJ/CO/BTN/SB/BB), "range", "villain", "hero".
The coach card itself was already rewritten — use its tone as the target
(example: "wins ~46% of the time · medium-strength hand"). Do not change any
code in this task; the report is the deliverable so changes can be reviewed first.
```

## 12. Determinism & seed regression pack

```
Create src/engine/__tests__/goldenHands.test.ts: a golden-master test locking
in engine behavior. Pick 5 seeds that (between them) produce: a split pot, a
side pot with 3+ all-in players, a heads-up hand, a hand ending preflop, and a
hand reaching showdown on the river. Play each with a fixed scripted action
list and snapshot the full final state (winners, stacks, pots, board) as inline
expected objects — not snapshot files, so diffs are reviewable. Any future
engine change that alters the outcome of these hands will fail loudly. Add a
comment on each case explaining what scenario it locks in.
```

---

## Suggested order of battle

Run 1–5 first (correctness of math and coaching — the product's core promise),
then 6–7 (data integrity), then 8–10 (UI and infrastructure), and keep 11–12 as
cleanup/insurance. After each task lands, commit it separately:
`git add -A && git commit -m "qa: <task name>"` — that way any test that later
turns flaky is easy to isolate and revert.
