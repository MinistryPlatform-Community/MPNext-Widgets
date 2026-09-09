# C38. The Go Paperless toggle moved out of the statement widget into `next-statement-preferences`, so a migrated embed silently loses it

**Widget:** `next-my-contribution-statement` + `next-statement-preferences` (old: `mpp-my-contribution-statement`, which does both jobs)
**Severity:** ux
**Confidence:** confirmed — drove both widgets against the same MP `Donors` row and watched what each reads and writes.
**Found:** 2026-09-08, comparison run

## Old behaviour

One element, one page, three jobs. `mpp-my-contribution-statement` renders, inside a
single shadow root:

1. `H1: My Contribution Statements` → `H2: Your Church Name` → *"Select statement year"*
   → a radio group of years → `Save as PDF`
2. the **Go Paperless!** control — *"Go Paperless! Get Statements online/via email."*
   with `<input type="checkbox" id="StatementMethod">`, which on change issues
   `GET /widgets/Api/ContributionsApi/SetStatementMethod?goPaperless=<bool>`
3. the My Giving link-out (`C62`, already filed)

A church that pasted `<mpp-my-contribution-statement>` got all three.

## New behaviour

The paperless control is a **separate custom element**,
`next-statement-preferences`, with its own demo page and its own
`GET`/`PUT /api/embed/statement-preferences`. `next-my-contribution-statement` renders
only the year picker and Save as PDF (confirmed: its visible text is exactly
*"My Contribution Statements | Your Church Name | Select statement year | 2025 | 2024 |
Save as PDF"* — no toggle, no link).

**The MP field is the same** and the semantics agree. `Donors.Statement_Method_ID`,
where `1 = Postal Mail`, `2 = Email/Online`, `4 = No Statement Needed`:

| Action | Writes |
|---|---|
| ours, toggle on → off | `Statement_Method_ID = 1` (verified in MP) |
| legacy, `SetStatementMethod?goPaperless=false` | `Statement_Method_ID = 1` (verified in MP) |
| ours, `paperless: true` | `Statement_Method_ID = 2` (`statementPreferencesService.setPreference`) |

So no data divergence — this is purely about the toggle no longer being where a
migrating site expects it.

**And ours reads the value correctly where legacy does not.** With the same donor row
set to each of the three methods in turn:

| `Statement_Method_ID` in MP | `next-statement-preferences` | legacy checkbox |
|---|---|---|
| 1 (Postal Mail) | unchecked ✓ | **checked** ✗ |
| 2 (Email/Online) | checked ✓ | checked ✓ |
| 4 (No Statement Needed) | unchecked ✓ | **checked** ✗ |

Legacy renders the box checked unconditionally, so a donor on Postal Mail is shown
"Go Paperless" as already on. Ours reads the real value and round-trips it (flip →
`200 PUT` → *"Statement method updated"* → reload → still flipped → MP agrees). That
part is a straight improvement and is why this item is `ux` and not `functional`.

## Why it matters

Nothing is broken and nothing is lost *if the host page is updated*. The risk is
entirely in the migration: the customer-facing instruction for this page changes from
"paste one tag" to "paste two tags", and a church that swaps
`mpp-my-contribution-statement` → `next-my-contribution-statement` one-for-one ends up
with donors who can download statements but can no longer turn paperless on or off, with
no error and nothing on screen hinting that a control went missing. That is the failure
mode worth guarding against, because it is invisible.

There is also a shared gap worth recording here rather than filing separately: both
systems model a three-value MP field as a boolean, so a donor sitting on
`4 = No Statement Needed` who touches the toggle is silently moved to `1 = Postal Mail`
(ours) — legacy does the same thing. Neither widget can express "no statement", and
neither warns.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-contribution-statement-old-authed.png`
  (toggle + link present inside the legacy widget),
  `my-contribution-statement-new-authed.png` (neither),
  `statement-preferences-new-authed.png`, `statement-preferences-new-flipped.png`,
  `my-contribution-statement-old-paperless-write.png`
- Legacy write, captured live:
  `GET https://mpi.ministryplatform.com/widgets/Api/ContributionsApi/SetStatementMethod?goPaperless=false`
- Ours: `200 PUT /api/embed/statement-preferences` with body `{"paperless":false}`
- MP verification, before/after each write:
  `GET /tables/Donors?$select=Donor_ID,Contact_ID,Statement_Method_ID&$filter=Contact_ID = 98`
  → `Donor_ID 6`, `Statement_Method_ID` observed as 2 → 1 (ours) and 1 (legacy). Restored
  to its original value (2) at the end of the run.
- Read-state matrix above produced by setting `Statement_Method_ID` to 1, 2 and 4 via the
  API and reloading both widgets each time.
- Scripts: `.claude/playwright/widget/scripts/giving/stmt-deep2.mjs`, `.claude/playwright/widget/scripts/giving/old-stmt.mjs`,
  `.claude/playwright/widget/scripts/giving/paperless-matrix.mjs`

## Where to fix

- `packages/embed-sdk/src/components/my-contribution-statement.ts` (the widget that
  would host it) and `packages/embed-sdk/src/components/statement-preferences.ts` (the
  behaviour to reuse)
- `packages/embed-sdk/demo-my-contribution-statement.html` — currently shows only the one
  element
- `packages/embed-sdk/vite.config.ts` — the canonical customer snippet injected into
  every demo page
- `src/app/api/embed/statement-preferences/route.ts` — the `PUT` is scoped to
  `widget: ["statement-preferences", "user-menu"]`, so it would need `"my-contribution-statement"`
  adding if the toggle is embedded there

## Suggested fix

Cheapest honest option: leave the split (it is a defensible decomposition) but make the
migration visible — document the pair in the customer snippet and add
`<next-statement-preferences>` to `demo-my-contribution-statement.html` so the demo shows
the legacy page's full surface. Better option if it is cheap: have
`next-my-contribution-statement` render the preferences control itself behind an
opt-out attribute (e.g. `hide-statement-preferences`), reusing
`statement-preferences.ts` rather than duplicating it, so a one-for-one tag swap keeps
working. Separately, consider surfacing the third `Statement_Method` value instead of
collapsing it to a boolean — a three-way radio (Postal Mail / Email·Online / No
statement) would stop the silent `4 → 1` rewrite in both widgets.
