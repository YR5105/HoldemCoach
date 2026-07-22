# First-run copy audit

A review of every user-facing string in the onboarding and first-run screens,
flagging jargon a brand-new player is unlikely to know and suggesting a
plain-English replacement. The coach feedback card was already rewritten in
plain English (e.g. "wins ~46% of the time · medium-strength hand"); this audit
uses that card's tone as the target.

**This is a report only — no code was changed.** Each suggestion is a proposal
for review, not a committed edit.

Flagged terms: `bb`, `EV`, `equity`, `GTO`, `c-bet`, `3-bet`, position
abbreviations (`UTG`/`HJ`/`CO`/`BTN`/`SB`/`BB`), `range`, `villain`, `hero`,
plus a few adjacent poker-isms (`leaks`, `TAG`/`LAG`/`Nit`, `pot odds`).

Files reviewed: `src/ui/Onboarding.tsx`, `src/ui/SettingsScreen.tsx`,
`src/ui/GuessPrompt.tsx`, `src/ui/WinDial.tsx`, `src/ui/ReviewScreen.tsx`,
`src/ui/DashboardScreen.tsx`.

---

## src/ui/Onboarding.tsx

| Current string | Why it may confuse a brand-new player | Suggested plain-English replacement |
| --- | --- | --- |
| "A decision that forfeits less than 0.1bb is **OK** — even if it's not the most common play." | `bb` (big blinds) is undefined at this point; "forfeits" is abstract. | "A decision that costs you less than a tenth of a big blind is **OK** — even if it isn't the most common play." |
| "Bigger **EV** losses grade as Inaccuracy, Mistake, or Blunder, with the better action and the cost in big blinds." | `EV` (expected value) is unexplained jargon on the very first screen. | "Costlier mistakes grade as Inaccuracy, Mistake, or Blunder — each shows the better play and what it cost you, in big blinds." |
| "Your live win % and **pot odds** are on screen, so calls and folds become intuitive." | "pot odds" is a term of art; a total beginner won't know it yet. | "Your live win chance and the price you're being offered are always on screen, so calls and folds become intuitive." |

*Note:* "big blinds" itself is core poker vocabulary the app can't fully avoid,
but onboarding is the right place to define it once (e.g. a one-line "chips are
measured in big blinds — the forced bet each hand") rather than leaning on `bb`.

## src/ui/SettingsScreen.tsx

| Current string | Why it may confuse a brand-new player | Suggested plain-English replacement |
| --- | --- | --- |
| "Explain terms inline (pot odds, **c-bet**, …)" | `c-bet` (continuation bet) is exactly the kind of term this toggle is meant to demystify — using it as the label is circular. | "Explain poker terms inline as they come up" |
| "⚖️ Balanced near-**GTO**" | `GTO` (game-theory-optimal) is advanced jargon most players never learn. | "⚖️ Balanced — plays a solid, well-rounded style" |
| "🎯 **TAG** tight-aggressive · 🔥 **LAG** loose-aggressive · 📞 Station calls everything · 🪨 **Nit** ultra-tight" | `TAG`/`LAG`/`Nit` are insider labels; the descriptions are good but the abbreviations add noise. | "🎯 Tight & aggressive · 🔥 Loose & aggressive · 📞 Calls almost everything · 🪨 Very tight · ⚖️ Balanced" |
| "OK below (**bb**)", "Inaccuracy up to (**bb**)", "Mistake up to (**bb**)" | `bb` unit label in the advanced grading inputs. | "OK below (big blinds)", "Inaccuracy up to (big blinds)", "Mistake up to (big blinds)" |
| Bot personality dropdown values: "TAG / LAG / Station / Nit / Balanced" | The raw enum names are shown verbatim in the select. | Use friendly labels ("Tight-aggressive", "Loose-aggressive", "Calling station", "Nit (very tight)", "Balanced"). |

*Lower priority:* "grading thresholds" and the whole **Advanced** section are
opt-in and hidden by default, so their jargon is acceptable for the audience
that opens them.

## src/ui/GuessPrompt.tsx

| Current string | Why it may confuse a brand-new player | Suggested plain-English replacement |
| --- | --- | --- |
| "What's your **win probability** right now?" | "win probability" is clear enough, but "win chance" reads warmer for a beginner. | "What are your chances of winning this hand right now?" |

No hard jargon here — this screen is already close to the target tone.

## src/ui/WinDial.tsx

| Current string | Why it may confuse a brand-new player | Suggested plain-English replacement |
| --- | --- | --- |
| "±3%" (the confidence band under the dial) | An unlabeled ± value looks like noise; a beginner won't know it's the estimate's margin of error. | Add a tooltip/label: "estimate accurate to about ±3%" (or hide the band unless "advanced" display is on). |
| "need 40% · have 35%" | Terse; the meaning ("you need to win this often to call profitably") isn't spelled out. | Consider a hover: "need to win 40% to call · you're winning about 35%". |

"Win probability" and "no bet to call" are fine as-is.

## src/ui/ReviewScreen.tsx

| Current string | Why it may confuse a brand-new player | Suggested plain-English replacement |
| --- | --- | --- |
| "Good decision — no **EV** lost." | `EV` jargon in the replayer's per-decision note. | "Good decision — this didn't cost you anything." |
| "**equity** {X}% · best: {best}" | `equity` is undefined jargon; "best: fold" is terse shorthand. | "win chance {X}% · best play: {best}" |

The severity filter options ("Blunders / Mistakes / Inaccuracies") reuse the
terms onboarding defines, and "You / Bot N" is already beginner-friendly (no
`hero`/`villain` leaks into the UI here).

## src/ui/DashboardScreen.tsx

| Current string | Why it may confuse a brand-new player | Suggested plain-English replacement |
| --- | --- | --- |
| "**EV** loss / 100 hands" (stat tile) and value "{X}**bb**" | Both `EV` and `bb` appear in the headline metric a beginner sees first. | Label: "Chips lost per 100 hands"; value: "{X} big blinds". |
| "**EV** loss per 100 hands" (chart heading) | Same `EV` jargon as a section title. | "Chips lost per 100 hands (lower is better)" |
| "**EV** lost by category" (chart heading) | `EV` again. | "Where you're losing chips" |
| "{X}**bb** lost · {Y} mistakes" (leak row) | `bb` unit. | "{X} big blinds lost · {Y} mistakes" |
| "**EV** loss per 100 hands across 250-hand windows" (aria-label) | Screen-reader text carries the same jargon. | "Chips lost per 100 hands, in 250-hand windows" |
| "{X}**bb** / 100" (trend tooltip) | `bb`. | "{X} big blinds / 100 hands" |
| "**C-bet**" (category label) | `c-bet` (continuation bet) as a bare category name. | "Continuation bets" (or "Betting the flop"). |
| "Top **leaks**" (section heading) | "leaks" is poker slang for recurring mistakes. | "Your biggest leaks — where you lose the most" or simply "Biggest weaknesses". |

"per 250-hand window · lower is better" and "The trend line appears after 250
hands" are mildly technical but acceptable; "250-hand window" could be softened
to "every 250 hands".

---

## Summary of the highest-value fixes

1. Replace `EV` everywhere it faces the user (Onboarding, Review, Dashboard) —
   it's the single most common undefined term. "cost" / "chips lost" convey the
   same idea.
2. Replace the `bb` unit label with "big blinds" (Onboarding, Settings advanced,
   Dashboard).
3. Fix the circular "Explain terms inline (pot odds, c-bet…)" toggle label.
4. Soften the bot-personality abbreviations (`TAG`/`LAG`/`Nit`/`GTO`) to their
   plain descriptions, which are already written next to them.
5. Rename the "C-bet" dashboard category and the "Top leaks" heading.

## Notes / out of scope

- **`hero` / `villain`:** these appear throughout the code (variables, comments)
  but are **not** surfaced in any of the six audited screens — the UI uses
  "You" and "Bot N". No user-facing change needed.
- **Position abbreviations** (`UTG`/`HJ`/`CO`/`BTN`/`SB`/`BB`): none appear in
  these six files. They are rendered on the table by `src/ui/Seat.tsx`, which is
  outside this audit's scope but would be the next place to review if position
  labels are considered confusing for beginners.
- **`range` / `3-bet` / `GTO` (beyond the one Settings mention):** no other
  user-facing occurrences were found in the audited files.
