# C36. Giving dates render as "Jun 8, 2026" where legacy renders "6/8/2026" / "01/01/2026"

**Widget:** `next-my-giving`, `next-my-pledges` (old: My Giving, My Pledges)
**Severity:** cosmetic
**Confidence:** confirmed — same MP rows read out of both widgets side by side.
**Found:** 2026-09-08, comparison run

## Old behaviour

| Legacy widget | Field | Rendered |
|---|---|---|
| `mpp-my-giving` | donation date | `6/8/2026` — `M/D/YYYY`, no leading zeros |
| `mpp-my-pledges` | first installment | `12 installments beginning 01/01/2026` — `MM/DD/YYYY`, zero-padded |

Note that legacy is not internally consistent either: two widgets, two formats. Both are
numeric US short dates.

## New behaviour

| New widget | Field | Rendered |
|---|---|---|
| `next-my-giving` | donation date | `Jun 8, 2026` |
| `next-my-pledges` | first installment | `12 installments beginning Jan 1, 2026` |

Both come from
`toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })`
(`my-giving.ts` `formatDonationDate`, `my-pledges.ts` `formatInstallmentDate`).

The underlying date handling is **correct** and was tested at a year boundary
specifically: a donation created at `2025-12-31T23:30:00` renders in the 2025 year view
with the 2025 total ($11.11 in both widgets, matching MP), and one at
`2026-01-01T00:30:00` renders in 2026 — no off-by-one-day and no off-by-one-*year*
drift, on either system. `parseDateParts()` reading the `YYYY-MM-DD` prefix rather than
`new Date(iso)` is doing its job. This item is purely about the presentation string.

Currency formatting, by contrast, matches legacy exactly on both widgets:
`$19,502.58`, `$1,000.00`, `$0.00 of $1,200.00 (0%)` — same symbol, same thousands
separator, same two decimals, same `Intl`-shaped output. No finding there.

## Why it matters

Low stakes on its own, but it is the visible difference a church notices first after a
migration, and on a giving statement page a numeric date is what donors are used to
matching against their bank records. Worth a deliberate decision rather than a
side effect of which `Intl` options each widget happened to pass — and note that
whichever format is chosen cannot currently be overridden by the customer at all
(see `C67`: there is no `GetLabels` equivalent and no locale concept in the new SDK, so
this string is hardcoded English/US for every tenant).

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-giving-new-initial.png` vs
  `my-giving-old-authed.png`; `my-pledges-new-initial.png` vs `my-pledges-old-authed.png`
- Extracted rows, same four MP records, new widget:
  `[{"date":"Jun 8, 2026","title":"Annual Appeal","amount":"$1,000.00"},{"date":"Jun 8, 2026","title":"Annual Appeal","badges":["Spouse"],"amount":"$1,000.00"},{"date":"Jun 8, 2026","title":"Annual Appeal","badges":["Spouse"],"amount":"$10,000.00"},{"date":"PENDING","title":"Tithes","amount":"$180.94"}]`
- Legacy, same four:
  `6/8/2026 | Annual Appeal | $1,000.00 | 6/8/2026 | Annual Appeal | Spouse | $1,000.00 | 6/8/2026 | Annual Appeal | Spouse | $10,000.00 | PENDING | Tithes | $180.94`
- Year-boundary fixtures: `Donation_ID` 2641 (`2025-12-31T23:30:00`, $11.11) and 2642
  (`2026-01-01T00:30:00`, $22.22), created and deleted during this run; both widgets and
  `api_MPPW_GetMyGivingHistory` agreed on which year each belongs to.
- Screenshot of the boundary case: `my-giving-new-2025-year-boundary.png`
- Scripts: `.claude/playwright/widget/scripts/giving/giving-deep.mjs`, `.claude/playwright/widget/scripts/giving/giving-old-deep.mjs`

## Where to fix

- `packages/embed-sdk/src/components/my-giving.ts` — `formatDonationDate`
- `packages/embed-sdk/src/components/my-pledges.ts` — `formatInstallmentDate`

## Suggested fix

Pick one and apply it in both places. If legacy parity is the goal,
`{ month: "numeric", day: "numeric", year: "numeric" }` reproduces `6/8/2026`. If the
long form is the intended house style, keep it and note the deviation somewhere a
migrating customer will see it. I lean toward keeping the current long form (it is
unambiguous for non-US readers, which matters if `C67`/locale ever lands) and simply
making both widgets consistent with each other and with any other `next-*` widget that
prints a date — worth one sweep across the SDK rather than two edits here.
