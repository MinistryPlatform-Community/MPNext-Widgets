# C57. `next-my-household` shows household members' birthdays without the year; legacy shows the full date

**Widget:** `next-my-household` (old: My Household — `/widgets/my_household.aspx`, tag `mpp-household`)
**Severity:** cosmetic
**Confidence:** confirmed — both widgets driven signed in against the same four household members, member rows read out of both shadow roots, dates checked against MP
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-household`'s member list prints the full date of birth:

```
Chris Kehayias      Head of Household   Nov 25, 1978    Edit Household Member
Sarah Kehayias      Head of Household   Sep 19, 1981    Edit Household Member
Aiden Kehayias      Minor Child         May 20, 2009    Edit Household Member
Jillian Kehayias    Minor Child         Mar 29, 2011    Edit Household Member
```

## New behaviour

`next-my-household`'s member list prints month and day only:

```
Kehayias, Chris     Head of Household   Nov 25    Edit
Kehayias, Sarah     Head of Household   Sep 19    Edit
Kehayias, Aiden     Minor Child         May 20    Edit
Kehayias, Jillian   Minor Child         Mar 29    Edit
```

Same four members, same order, same household positions — only the year is
dropped. The data is present: MP holds
`Contacts.Date_of_Birth = "1978-11-25T00:00:00"` for Contact 98, the member Edit
panel exposes the full date for editing, and the year is available to the widget.
It is the summary row that truncates it.

Two smaller differences in the same row, recorded here rather than filed
separately since they are the same line of the same template:

- **Name order.** Legacy renders `Chris Kehayias` (given name first); ours renders
  `Kehayias, Chris` (file-as order). Ours matches MP's `Display_Name`; legacy
  reassembles first + last. Neither is wrong, but a church switching over will
  see every name in their household flip.
- **Control label.** Legacy's per-member control reads `Edit Household Member`
  (an `<a>`); ours reads `Edit` (a `<button>`). At the household level ours is an
  icon-only button with `aria-label="Edit household"` where legacy has a text
  `Edit` link.

## Why it matters

Small, but it is the difference between a useful row and a decorative one. A
parent looking at their household to check which child's record has the wrong
birth date cannot tell from the list — every row shows a month and day that is
already right, and they have to open each member's Edit panel in turn to find the
wrong year. Two children born the same month and day are indistinguishable.
Legacy answered the question from the list.

Note that this is the *household* widget, where every record shown belongs to the
signed-in user's own household. It is not the directory: `next-online-directory`
also drops the year (`OnlineDirectoryService.formatBirthday()` returns
`"Mon D"` and `"MM-DD"` only) and there it is deliberate and correct — legacy
sends `dateofBirth` in full to every browser that can see the directory, and
withholding it is a privacy improvement, not a defect. Do not "fix" both from
this item.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/my-household-new-authed.png` — `Nov 25`, `Sep 19`, `May 20`, `Mar 29`
  - `.claude/playwright/widget/screenshots/my-household-old-authed.png` — `Nov 25, 1978`, `Sep 19, 1981`, `May 20, 2009`, `Mar 29, 2011`
  - `.claude/playwright/widget/screenshots/my-household-new-authed-mobile.png` / `my-household-old-authed-mobile.png` — same at 390 x 844
- Member rows read from `next-my-household`'s shadow root:
  `["Kehayias, Chris Head of Household Nov 25 Edit", "Kehayias, Sarah Head of Household Sep 19 Edit", …]`
- Legacy shadow text: `… Chris KehayiasHead of HouseholdNov 25, 1978Edit Household Member …`
- MP verification (client credentials):
  `GET /tables/Contacts?$select=Contact_ID,Date_of_Birth&$filter=Contact_ID=98`
  → `"Date_of_Birth": "1978-11-25T00:00:00"`. So the year exists and matches
  legacy's rendering; ours is formatting it away.
- Both widgets agreed on everything else in this view: household name `Kehayias`,
  congregation `Main Congregation`, primary address
  `2720 Bradfordt Drive, West Melbourne, FL 32904-7322`, 4 members, same
  positions, same order.

## Where to fix

`packages/embed-sdk/src/components/my-household.ts` — the member-row template
(around the `Edit` button at `:414`, which is the household-level control; the
per-member row is rendered in the members loop below it). Whatever formats the
member's date of birth for the summary row is the single place to change.

If the value arrives from the API already truncated, the fix is server-side
instead: `src/services/householdService.ts` / `src/app/api/embed/household/route.ts`
would need to send the full date. Worth checking which before editing the
component — the widget's Edit panel has the full date, so it is probably present
in the payload and only the summary formats it short.

## Suggested fix

Render the full date in the member row, formatted through
`Intl.DateTimeFormat` with the MP domain time zone from `getMpTimezone()` (per
CLAUDE.md's date/time rule) rather than a hand-rolled month table — e.g.
`Nov 25, 1978`, matching legacy.

Be careful not to reintroduce the classic off-by-one: MP stores wall-clock in the
domain zone, so `new Date("1978-11-25T00:00:00")` parsed as local and formatted in
another zone can render `Nov 24`. See
`.claude/references/ministryplatform.datetimehandling.md`.

The name order and the `Edit` / `Edit Household Member` label are judgement calls
for whoever owns the copy; I would keep ours on both (`Display_Name` is what MP
considers canonical, and `Edit` inside a row that already names the member is
less redundant) and note the change in the migration guide instead.
