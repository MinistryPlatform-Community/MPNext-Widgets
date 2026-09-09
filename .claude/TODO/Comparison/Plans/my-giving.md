# `next-my-giving` — plan

**Items:** C30 (functional, shared) · C39 (functional, shared) · C33 (ux) · C35 (ux, shared) ·
C37 (cosmetic) · C36 (cosmetic, shared) · C79 (cosmetic, shared)
**Cutover verdict: C30 blocks cutover; nothing else does. The data is exact.**
**Owns:** `packages/embed-sdk/src/components/my-giving.ts`

## What the feedback says

Start with what passed, because it bounds the work: **the money is right.** Total giving
matched MP to the cent across five years on both systems. Soft credits are listed and
correctly excluded from totals. A split gift shows as two rows without double-counting.
Non-deductible gifts are badged. The By Program legend totals matched MP exactly (Annual
Appeal $14,000.00 / Tithes $2,917.36 / Offerings $2,571.89 / Faith Formation $13.33). And
dates hold at the year boundary — a Dec 31 23:30 gift lands in 2025 and a Jan 1 00:30 gift in
2026, on both systems, because `parseDateParts()` reads the `YYYY-MM-DD` prefix rather than
`new Date(iso)`. **Every item below is presentation.**

- **C30** — signed out, the widget renders a red *"Unable to Load / Authentication required /
  [Try Again]"*. On this widget that is the worst version of the class: the panel is
  indistinguishable from a real outage, so a donor whose token merely expired cannot tell
  "sign in again" from "the giving system is down".
- **C39** — `attributeChangedCallback` guards on `oldValue !== null`, so `hidesoftcredits` set
  from script after mount is ignored.
- **C33** — the "By Month" chart is a hand-rolled SVG with **no values, no axis, no
  `<title>`, no hover, no tooltip**. A donor can see June was the biggest month and cannot
  learn what any month was. Legacy's CanvasJS chart at least exposed values on hover.
- **C37** — the month picker drops the year from every month except "All Months", and the
  soft-credit disclaimer is shown **only while the checkbox is ticked** and no longer says
  that soft credits are excluded from the total.
- **C35 / C36 / C79** — no headings, `Jun 8, 2026` vs legacy's `6/8/2026`, and
  `hidesoftcredits` instead of `hide-soft-credits`.

## Where the new widget is already better — protect these

- **Money math is exact and verified against MP.** Nothing in this plan touches the data path.
- Currency formatting matches legacy exactly (`$19,502.58`, `$1,000.00`).
- The year navigator's floor and future-month disabling match legacy precisely
  (`MIN_YEAR_OFFSET = 4`, verified by walking legacy's `.prev-year` to 2022).
- The **By Program** doughnut has a legend with a dollar amount per program — so the gap is
  specific to By Month, and By Program is the model to follow.

## Phase 1 — C30, signed-out (blocks cutover)

Per `CROSS-1-signed-out-and-auth-states.md`. Call sites: `my-giving.ts:74-101`
(`loadDonations` catch) and `:166-177` (the error render). Legacy's wording is *"Please login
to view your giving information."*

This widget is the strongest argument for `CROSS-1`'s Phase 2 idea: legacy rendered its chrome
plus a `$0,000` placeholder behind the prompt, so a signed-out visitor could see what the page
*is*. A muted skeleton behind the sign-in prompt is better than either a red error panel or a
bare sentence. `/giving` is a page anonymous visitors land on constantly.

## Phase 2 — C33, make the chart say something

No charting library, and none should be added — the CDN policy in `CLAUDE.md` and the
`add-to-calendar-button` removal are the precedent. None is needed:

1. **Give each bar a `<title>` child.** That alone produces a native browser tooltip with
   `${MONTH_NAMES[i]}: ${formatCurrency(totals[i])}` **and is read by screen readers** — which
   makes it strictly better than legacy's CanvasJS, whose tooltip was mouse-only.
2. **Print the value** above or inside each non-zero bar, or at minimum add a max-value y-axis
   label so the scale is legible.
3. `<rect>` + a CSS `:hover` fill change is the whole hover treatment.

**Fix the two smaller behaviours in the same pass** (`renderCharts`, `:250-261`):

- It truncates to the current month in the current year (`monthsToShow = currentMonth`), so a
  donor viewing 2026 in September sees nine bars and no indication the year is unfinished.
- **It disappears entirely under a month filter.** Selecting March 2026 renders only By
  Program. Either keep it visible (a single bar is still informative, and its absence looks
  like a bug) or explain the omission.

Why this matters: By Month is the **only** place either widget summarises giving by period, and
it is what a donor looks at when they want "how much did I give in May". Ours renders a shape
and withholds the number.

## Phase 3 — C37, and the copy that carries meaning

Two changes; the second has substance.

**The month picker.** Append the year to each option (`January 2026`, not `January`). Trivial,
but the control is only *used* after navigating to a previous year, which is exactly when
"January" alone gives no confirmation of which January.

**The soft-credit disclaimer.** Ours renders only when the checkbox is ticked, and drops the
clause about the total. Legacy shows it unconditionally and says:

> *"…The dollar amounts for these donations will NOT be reflected in your donation total."*

The behaviour is identical and correct on both sides — Total Giving stays at $19,502.58 with
soft credits on and off, while the list grows from 42 rows to 43 ($19,547.02). **But a donor
who ticks the box sees the list total diverge from the headline by $44.44 with nothing on
screen explaining the gap**, and a donor who never ticks it never learns soft credits exist.

Fix: render the sentence whenever the toggle is *available* (i.e. whenever the data contains a
soft credit), and restore the excluded-from-total clause — something like *"Soft credit
donations are gifts you are credited with but did not personally contribute. Their amounts are
not included in your Total Giving and will not appear on your tax statement."* That covers
legacy's meaning in our voice.

## Phase 4 — the shared items

- **C35** — swap `<div class="title">` → `<h1 class="title">`, `.chart-title` → `<h2>`,
  `.section-label` → `<h2>`, plus `h1,h2 { font: inherit; margin: 0 }`. See `CROSS-3` §3, and
  honour the new `heading-level` attribute.
- **C36** — keep the long date form (`Jun 8, 2026`); it is unambiguous for non-US readers and
  legacy was not internally consistent anyway. Make every `next-*` widget agree in the
  `CROSS-5` locale sweep rather than editing two files here.
- **C39 / C79** — see `CROSS-4`. Drop the `oldValue !== null` guard (`:63-67`); rename
  `hidesoftcredits` → `hide-soft-credits` with the old spelling as a warning alias.

## Do better than parity

- **The chart should be readable as data, not only as a picture.** Alongside the `<title>`
  elements, render a visually-hidden `<table>` of month/amount pairs. That gives screen-reader
  and keyboard users the actual numbers — something neither CanvasJS nor our SVG offers — for
  about fifteen lines of markup.
- **"How much did I give in May" deserves a direct answer.** A donor's real question is a
  number, not a bar. Consider a month-total row above the donation list when a month filter is
  active, which is currently the one state where the chart vanishes.
- **Soft credits are confusing by nature.** Rather than a checkbox plus a paragraph, consider
  showing soft-credit rows always, badged, greyed and visibly excluded from the running total.
  The badge already exists. That explains the concept by construction instead of by disclaimer
  — better than either system.

## Acceptance

- Anonymous load renders a sign-in prompt, not a red error panel.
- Every bar exposes its month and amount to hover **and** to a screen reader.
- By Month renders under a month filter, or its absence is explained.
- The month picker shows the year; the soft-credit note appears whenever soft credits exist and
  states that they are excluded from the total.
- Setting `hide-soft-credits` on a mounted widget re-renders it; the legacy spelling still
  works and warns once.
- Total Giving still matches MP to the cent across five years (regression guard).

## Depends on / unblocks

C30 → `CROSS-1`. C35 → `CROSS-3`. C36 → `CROSS-5`. C39/C79 → `CROSS-4`. C33 and C37 are
independent and are the two that actually change what a donor can learn from this page.
