# C37. `next-my-giving` drops the year from the month picker and no longer tells donors that soft credits are excluded from the total

**Widget:** `next-my-giving` (old: My Giving)
**Severity:** cosmetic
**Confidence:** confirmed — read both widgets' visible text and `<select>` option lists with the same MP data loaded.
**Found:** 2026-09-08, comparison run

## Old behaviour

Month picker options carry the year on every entry:

```
All Months 2026 / January 2026 / February 2026 / … / September 2026 /
October 2026 (disabled) / November 2026 (disabled) / December 2026 (disabled)
```

The soft-credit disclaimer is **always** visible under "Donations", regardless of the
checkbox, and it says what the number means:

> Soft Credit Donations will not appear on your tax statement as they were given by
> another entity at your request. **The dollar amounts for these donations will NOT be
> reflected in your donation total.**

## New behaviour

Month picker keeps the year only on the "all" entry and drops it from the months:

```
All Months 2026 / January / February / … / September /
October (disabled) / November (disabled) / December (disabled)
```

(The future-month disabling is identical on both, and both cap the year navigator at
`currentYear` and floor it at `currentYear − 4` — verified by walking legacy's
`.prev-year` until it took `button-disabled` at 2022, exactly matching
`MIN_YEAR_OFFSET = 4`. No finding there.)

The soft-credit note is shown **only while the checkbox is ticked**, and the wording
drops the part about the total:

> Soft credit donations are included below and reflect gifts you are credited with but
> did not personally contribute.

The behaviour it describes is unchanged and correct: `Total Giving` stayed at
`$19,502.58` with soft credits both off and on, while the list grew from 42 rows
($19,502.58) to 43 ($19,547.02) — the $44.44 soft credit is listed and excluded from the
total, on both systems, matching MP.

## Why it matters

The month labels are trivial — but the year matters in the one case where the control is
used at all, namely after navigating to a previous year, where "January" alone gives no
confirmation of which January is being filtered.

The disclaimer is the one with substance. A donor who ticks "Include Soft Credit
Donations" sees the list total ($19,547.02 worth of rows) diverge from the headline
Total Giving ($19,502.58) with nothing on screen explaining the $44.44 gap; legacy
explained precisely that. And because ours only renders the sentence when the box is
ticked, a donor who never ticks it never learns that soft credits exist or that they are
excluded.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-giving-new-softcredits-on.png`,
  `my-giving-new-initial.png`, `my-giving-old-authed.png`, and the year floors
  `my-giving-new-year-floor.png` / `my-giving-old-year-floor.png`
- New, soft credits on: 43 rows summing `$19,547.02`, `.total-amount` = `$19,502.58`,
  `.list-subtitle` = the two sentences quoted above
- New, soft credits off: 42 rows summing `$19,502.58`
- Legacy, same data: `Total Giving $19,502.58`, both disclaimer sentences present
  unconditionally
- MP: `api_MPPW_GetMyGivingHistory @ContactId=98 @Year=2026` → 43 rows, 1 with
  `IsSoftCredit = true` (`$44.44`); non-soft sum `19502.58`, all-rows sum `19547.02`
- Scripts: `.claude/playwright/widget/scripts/giving/giving-deep.mjs`, `.claude/playwright/widget/scripts/giving/giving-old-deep.mjs`

## Where to fix

`packages/embed-sdk/src/components/my-giving.ts` — `renderControls` (the month
`<option>` labels) and `renderDonationsList` (`showSoftDisclaimer` / the subtitle text)

## Suggested fix

Append `${this.selectedYear}` to each month option label. For the disclaimer: render the
soft-credit sentence whenever the toggle is *available* (i.e. whenever the data contains
a soft credit) rather than only when it is ticked, and restore the second clause —
something like *"Soft credit donations are gifts you are credited with but did not
personally contribute. Their amounts are not included in your Total Giving and will not
appear on your tax statement."* That covers legacy's meaning in our voice. Note this
string, like every other, is hardcoded English with no MP-configurable override —
`C67` is the mechanism, this item is just the copy.
