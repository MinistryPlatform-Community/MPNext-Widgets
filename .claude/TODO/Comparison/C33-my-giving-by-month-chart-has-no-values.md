# C33. `next-my-giving`'s "By Month" chart is a static SVG with no tooltip, axis or values — legacy's is an interactive chart

**Widget:** `next-my-giving` (old: My Giving)
**Severity:** ux
**Confidence:** confirmed — inspected both shadow roots; legacy carries a CanvasJS chart with a live tooltip node, ours carries 9 bare `<rect>`s.
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-my-giving`'s `.by-month-chart` hosts CanvasJS:
`canvasjs-chart-container`, `canvasjs-chart-canvas`, `canvasjs-chart-toolbar`,
`canvasjs-chart-tooltip`. Hovering a month shows that month's total (the tooltip node's
placeholder text, present in the shadow root even unhovered, is *"Sample Tooltip"*), and
the toolbar offers CanvasJS's save/print affordances. The "By Program" chart is the same
kind of object.

## New behaviour

`packages/embed-sdk/src/components/my-giving.ts:263-321` (`renderByMonthChart`) hand-rolls
an SVG: one `<rect>` per month scaled to `max`, plus a three-letter month label. There
is no y-axis, no gridline, no value label, no `<title>`, no hover state and no tooltip —
`role="img" aria-label="Giving by month"` is the whole accessible name. So a donor
looking at the chart can see that June was the biggest month but cannot learn what any
month actually was, and there is no equivalent of the CanvasJS readout anywhere else in
the widget (the donation list is per-gift, not per-month).

The "By Program" doughnut *does* have a legend with the dollar amount per program, so
the gap is specific to By Month.

Two smaller differences in the same chart, worth fixing together: it silently truncates
to the current month in the current year (`monthsToShow = currentMonth`), and it
disappears entirely as soon as a month filter is chosen — after selecting March 2026 the
widget rendered only "By Program".

## Why it matters

The By Month chart is the only place either widget summarises giving by period, and it
is the thing a donor looks at when they want "how much did I give in May". Ours renders
a shape and withholds the number. Because the SVG is generated per render there is also
nothing for a keyboard or screen-reader user at all — the chart is a single image with a
four-word label, where the legacy chart at least exposed values through its tooltip.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-giving-old-authed.png` (CanvasJS
  charts, tooltip node) vs `my-giving-new-initial.png` (flat bars) and
  `my-giving-new-month-march.png` (By Month gone under a month filter)
- Legacy shadow-root class list, captured live:
  `["…","by-month-chart","chart-title","canvasjs-chart-container","canvasjs-chart-canvas","canvasjs-chart-toolbar","canvasjs-chart-tooltip","by-program-chart",…]`
- New shadow root: `svg[role=img][aria-label="Giving by month"]` containing only
  `<rect>` + `<text>` pairs; `a11y` probe reported `svgs: ["Giving by month","Giving by program"]`
  and `headings: []`
- Data being charted is correct — By Program legend totals matched MP exactly
  (Annual Appeal $14,000.00 / Tithes $2,917.36 / Offerings $2,571.89 /
  Faith Formation $13.33), so this is a presentation gap, not a data gap.
- Script: `.claude/playwright/widget/scripts/giving/giving-deep.mjs`, `.claude/playwright/widget/scripts/giving/giving-old-deep.mjs`

## Where to fix

`packages/embed-sdk/src/components/my-giving.ts:263-321` (`renderByMonthChart`), and
`:250-261` (`renderCharts`, which is what drops the chart under a month filter)

## Suggested fix

No charting library needed and none should be added (CDN policy). Give each bar a
`<title>` child — that alone produces a native browser tooltip with
`${MONTH_NAMES[i]}: ${formatCurrency(totals[i])}` and is read by screen readers — and
print the value above or inside each non-zero bar, or add a max-value y-axis label so
the scale is legible. Then either keep By Month visible under a month filter (a single
bar is still informative) or say why it is hidden. If a hover treatment is wanted,
`<rect>` + a CSS `:hover` fill change plus the `<title>` is the whole implementation.

## Resolution — 2026-10-11

**Fixed** (W5, branch `ws/w5-giving`), with no charting library (CDN policy).
`renderByMonthChart` in `my-giving.ts`:

- **Every month is a `<g>` with a `<title>`** — "March 2026: $1,250.00" — so hovering any
  month (a full-height transparent hit area, so even a short or `$0` month) shows the
  browser's native tooltip.
- **Every non-zero bar prints its value** above it in compact currency ("$1.5K",
  `Intl.NumberFormat` `notation: "compact"` in the widget's locale and default currency);
  the exact figure is in the tooltip and the table. Headroom was added above the tallest bar.
- **Hover/selected treatment:** CSS fill change on `.chart-month:hover` and on the month
  chosen in the month filter.
- **A visually hidden `<table>`** (caption, Month / Amount headers, one row per month up to
  the current one) gives screen-reader and keyboard users the numbers — better than
  legacy's mouse-only CanvasJS tooltip. The SVG keeps `role="img"` + its label.

**Decisions on the two smaller behaviours** (re-checked against `Plans/my-giving.md`):

- *Months-shown cap:* all **twelve** slots are now laid out; in the current year the months
  still to come keep their slot with a muted axis label and no bar, so the chart says "the
  year is not over" instead of silently showing nine bars. The hidden table lists only the
  months that have happened.
- *Hide-on-month-select:* **removed.** By Month stays visible under a month filter, showing
  that month's single bar in place (highlighted). Total Giving already reports the filtered
  month's total (the API returns that month only), which answers "how much did I give in
  May" directly, so no extra month-total row was added.

The money path is unchanged: bucketing still reads the `YYYY-MM-DD` prefix via
`parseDateParts`. Tests (`giving-widgets.test.ts`) cover tooltips, printed values, the
hidden table, the month filter, and the year boundary (a Dec 31 23:30 gift lands in December
of that year, not January). New catalogue keys `myGiving.month`, `myGiving.monthYear`,
`myGiving.barTooltip` in en / es / pt-BR.
