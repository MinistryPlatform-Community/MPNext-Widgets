# my-giving — comparison test log

- **New**: `next-my-giving` — http://localhost:5173/demo-my-giving.html
- **Old**: My Giving — https://mpi.ministryplatform.com/widgets/my_giving.aspx
- **Tested**: 2026-09-08 by subagent giving (read side, block C30–C39)
- **Auth state(s) tested**: signed out (clean context) / signed in as PLAYWRIGHT_MP_USERNAME (MP user 98, Contact_ID 98, Donor_ID 6)
- **Script**: `.claude/playwright/widget/scripts/giving/new-baseline.mjs`, `giving-deep.mjs`, `giving-old-deep.mjs`, `old-deep2.mjs`, `signedout.mjs`, `kbd.mjs`
- **Config parity**: legacy page sets `hidesoftcredits="false"`; the new widget accepts the identical attribute name and `false` is its default, so the demo page is like-for-like as shipped (CONFIG-MAP §2.13, §4.11). No attribute mirroring needed.

## What I tested

1. Established ground truth first: `api_MPPW_GetMyGivingHistory @ContactId=98 @Year=<Y> @CongregationId=null` for 2022–2026 via `MPHelper` client credentials — the same proc both systems read through.
2. Created fixtures so the interesting cases existed at all: a **Dec 31 2025 23:30** donation ($11.11) and a **Jan 1 2026 00:30** donation ($22.22) for the year-boundary test; a **split gift** ($33.33 across Tithes $20.00 + Faith Formation $13.33, Faith Formation being `Tax_Deductible_Donations = false`); and a **soft credit** ($44.44 from Donor 5 with `Soft_Credit_Donor = 6`). All labelled ZZTEST in Notes, all deleted afterwards.
3. Baseline render, both systems, signed in, 1440×900. Element upgraded, shadow root populated, no console errors, no failed requests on either.
4. Compared `Total Giving` against MP for 2026, 2025, 2024, 2023, 2022.
5. Summed every visible donation amount after **SHOW MORE DONATIONS** and compared to the MP sum (both with and without soft credits).
6. Ticked **Include Soft Credit Donations** and re-summed; checked whether the headline total changed.
7. Verified badge rendering with `getComputedStyle` rather than text — legacy keeps all three badge spans in every row and hides them, so asserting on text would have produced a false "every donation is a spouse soft-credit non-deductible gift".
8. Selected **March** in the month picker (the month holding the split gift + soft credit) and compared the total, the rows and which charts render.
9. Walked the year navigator back from 2026 one year at a time on both systems until the "previous" control disabled, recording the label, disabled state and total at each step.
10. Checked the month `<select>` option list on both, including which options are `disabled`.
11. Signed-out render in a never-authenticated context, with every `/api/embed/*` status recorded.
12. 390×844 screenshot, both systems.
13. Tab order and computed focus outline for every focusable control; enumerated headings, labels, `svg[aria-label]` and tables in both shadow roots.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Renders, no console errors | yes | yes | **pass** |
| 2 | `Total Giving` 2026 vs MP `19502.58` | `$19,502.58` | `$19,502.58` | **pass — exact** |
| 3 | `Total Giving` 2025 / 2024 / 2023 / 2022 vs MP | `$11.11` / `$368.21` / `$0.00` / `$0.00` | same | **pass — exact** |
| 4 | Sum of all listed donations (soft off) vs MP non-soft sum | not summed on legacy | 42 rows, `$19,502.58` | **pass** |
| 5 | Sum of all listed donations (soft on) vs MP all-rows sum | — | 43 rows, `$19,547.02` | **pass** |
| 6 | Soft credit excluded from `Total Giving` | yes | yes (`$19,502.58` unchanged) | **pass** |
| 7 | Split gift shown as two rows, not double-counted | 2 rows | 2 rows `$20.00` + `$13.33` | **pass** |
| 8 | Non-deductible gift badged | `NON-DEDUCTIBLE` on the right row | `NON-DEDUCTIBLE` on the Faith Formation row only | **pass** |
| 9 | Non-deductible gift *included* in `Total Giving` | yes | yes | **parity** — both do; the widget disclaims "not for tax purposes" |
| 10 | Spouse gifts badged | `Spouse` x3 | `Spouse` x3, same rows | **pass** |
| 11 | Pending gifts show `PENDING` instead of a date | yes | yes | **pass** |
| 12 | Year boundary: Dec 31 2025 lands in 2025, Jan 1 2026 in 2026 | yes | yes | **pass — no TZ drift** |
| 13 | Month filter March 2026 | — | total `$33.33`, 2 rows, matches MP | **pass** |
| 14 | Year navigator range | floor 2022, ceiling 2026 (`button-disabled`) | floor 2022, ceiling 2026 (`disabled`) | **parity** |
| 15 | Future months disabled in current year | Oct/Nov/Dec 2026 disabled | Oct/Nov/Dec disabled | **parity** |
| 16 | Month option labels | `January 2026` | `January` | **diff → C37** |
| 17 | Soft-credit disclaimer | always shown, states amounts are excluded from the total | shown only when ticked, omits that clause | **diff → C37** |
| 18 | By Month chart | CanvasJS, tooltip + toolbar | static SVG, no values, no tooltip; disappears under a month filter | **diff → C33** |
| 19 | By Program chart | CanvasJS | SVG doughnut + legend with per-program dollar totals (matched MP) | **new is better** |
| 20 | Donation date format | `6/8/2026` | `Jun 8, 2026` | **diff → C36** |
| 21 | Currency format | `$19,502.58` / `$1,000.00` | identical | **pass** |
| 22 | Signed out | warning alert + `[Login]` button | red "Unable to Load / Authentication required" + dead "Try Again", no sign-in control | **diff → C30** |
| 23 | Signed-out headline total | `$0,000` (legacy placeholder bug) | n/a — error panel | legacy defect, not filed |
| 24 | 390x844 | renders | renders, controls wrap, month select goes full width | **pass** |
| 25 | Keyboard | year nav is a `div`, **not focusable**; only the select + checkbox reachable | all five controls are real button/select/input, focusable with visible rings | **new is better** |
| 26 | Headings | `H1: My Giving` | none | **diff → C35** |
| 27 | Month select accessible name | none | none | **parity**, not filed |

## Findings filed

- `C30-giving-widgets-signed-out-error-instead-of-sign-in.md` — signed out shows a red error with a dead "Try Again" and no Sign In.
- `C33-my-giving-by-month-chart-has-no-values.md` — By Month chart has no tooltip or values and vanishes under a month filter.
- `C35-giving-widgets-emit-no-headings.md` — no `h1`–`h4` anywhere (legacy has `H1: My Giving`).
- `C36-giving-date-format-differs-from-legacy.md` — `Jun 8, 2026` vs `6/8/2026`.
- `C37-my-giving-soft-credit-copy-and-month-labels.md` — month options drop the year; soft-credit disclaimer conditional and shortened.

## Where the new widget is better

- **Year navigation is keyboard operable.** Legacy's prev/next year are unfocusable `div.prev-year` / `.next-year`; ours are real buttons that disable properly and show a focus ring.
- **The By Program legend carries the dollar amount per program**, so the doughnut is readable without hover — legacy relies entirely on the CanvasJS tooltip.
- **Charts have `role="img"` and `aria-label`.** Legacy's canvases have neither.
- Legacy's anonymous state prints a fabricated headline total of `$0,000`; ours never shows a made-up number.

## Not tested / blocked

- **Chart bar-by-bar values.** I verified the data feeding the chart (per-month MP sums: 2026-01 $22.22, 2026-03 $33.33, 2026-04 $2,357.38, 2026-05 $5,089.65, 2026-06 $12,000.00) but did not measure SVG rect heights against them — the finding (C33) is that the widget shows no values at all, which makes a pixel comparison moot.
- **`hidesoftcredits="true"`.** The attribute is spelled identically on both widgets and its `false` path is exercised; the `true` path could not be set from script after upgrade (see `C39`), and the demo page cannot be edited under this run's rules. Element replacement would work — worth one line in a future pass.
- **`IsOmitAmount`.** No donation in this MP instance carries it, so the "amount hidden" render path is unexercised on both systems. It is set by MP's own statement machinery rather than a column I could confidently fake.
- **Congregation filtering.** Both the service and the legacy widget pass `@CongregationId = null`; the parameter still exists in the proc but neither surface exposes it, so there is nothing to compare.

## MP data created and cleaned up

Created via client credentials, all deleted at the end of the run: `Donations` 2641 (2025-12-31, $11.11), 2642 (2026-01-01, $22.22), 2643 (2026-03-15, $33.33 split), 2644 (2026-03-20, $44.44 soft-credit source, Donor 5) and their five `Donation_Distributions` (4178–4182).

Donations 2641/2642 were also given `Batch_ID = 4` mid-run, after discovering that `IsPending` in the proc is driven by `Batch_ID IS NULL` — without a batch every fixture rendered as `PENDING` instead of a date, which would have hidden the year-boundary date formatting entirely. Worth knowing for anyone building giving fixtures later.

One MP observation that is not a widget finding: `Donation_ID` 12 (Donor 6, 2025-11-05, $1,000) never appears in either widget, because it has no `Donation_Distributions` rows and the proc joins through them. Both systems agree; MP's data is the cause.

## Screenshots

- `screenshots/my-giving-old-initial.png` — legacy baseline, signed in
- `screenshots/my-giving-new-initial.png` — new baseline, signed in
- `screenshots/my-giving-old-authed.png` — legacy, CanvasJS charts and hidden badge spans
- `screenshots/my-giving-new-showmore.png` — all 42 rows expanded; visible amounts sum to `$19,502.58`
- `screenshots/my-giving-new-softcredits-on.png` — 43 rows, `$19,547.02` of rows, total still `$19,502.58`
- `screenshots/my-giving-new-month-march.png` — March filter: `$33.33`, split gift, By Month chart gone
- `screenshots/my-giving-new-2025-year-boundary.png` — 2025 view showing only the Dec 31 gift
- `screenshots/my-giving-new-year-floor.png` and `my-giving-old-year-floor.png` — both floor at 2022
- `screenshots/my-giving-new-signedout.png` and `my-giving-old-signedout.png` — the C30 pair
- `screenshots/my-giving-new-mobile.png` and `my-giving-old-mobile.png` — 390x844
