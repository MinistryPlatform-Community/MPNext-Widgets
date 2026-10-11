# C25. `next-opportunity-finder` shows a one-time opportunity as recurring ("Fridays") and drops its actual date; legacy shows "Fri, Dec 31, 2027"

**Widget:** `next-opportunity-finder` (old: Opportunity Finder — `/widgets/opportunity_finder.aspx`)
**Severity:** functional
**Confidence:** confirmed — a one-time opportunity was created via the MP API and both finders were read side by side
**Found:** 2026-09-08, comparison run

## Old behaviour

For a one-time opportunity (`Opportunity_Date = 2027-12-31`), the legacy card renders
two subtitles:

```html
<h4 class="mpp-card--subtitle opportunity-location">Main Congregation</h4>
<h4 class="mpp-card--subtitle opportunity-start-date">Fri, Dec 31, 2027 12:00 AM</h4>
```

Ongoing opportunities render `Ongoing` in the same slot. So the card always says
*when*.

## New behaviour

The same opportunity renders `Main Congregation · Fridays`. Every ongoing opportunity
in the same list renders `Main Congregation · Ongoing` — so the one-time entry reads
as a **weekly Friday commitment** and its date appears nowhere on the card.

Cause: `api_MPPW_SearchOpportunities` returns `MeetingDay: "Friday"`,
`MeetingTime: "2027-12-31T00:00:00"`, `StartDate: "2027-12-31T00:00:00"` for a dated
opportunity. `formatMeetingDay()` pluralises any `MeetingDay` that is not the literal
string `"Ongoing"` (`return \`${meetingDay}s\``), and `formatMeetingTime()` then
deliberately returns `""` for a midnight time ("Skip midnight (no real time component
on the opportunity)") — which is precisely the case for a date-only opportunity. Both
halves of the date are therefore discarded.

## Why it matters

A volunteer reads "Fridays" and expects a recurring slot; the opportunity is a single
Friday two years out. This is wrong information on a public page, not a formatting
nit, and it is systematic: every non-ongoing opportunity in the catalogue is
mislabelled the same way. The Frequency filter still separates them correctly (One
Time returns exactly this one, Ongoing returns the other three), so the list is right
and only the card copy lies.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/opportunity-finder-new-onetime-shows-fridays.png`
  vs `.claude/playwright/widget/screenshots/opportunity-finder-old-onetime-shows-date.png`
- Card text scraped from both shadow roots (identical order, identical set):

  | | new | old |
  |---|---|---|
  | ZZTEST-Serve-Compare | `Main Congregation · Fridays` | `Main Congregation / Fri, Dec 31, 2027 12:00 AM` |
  | Embracing AI | `Main Congregation · Ongoing` | `Main Congregation / Ongoing` |
  | Innovation Volunteer | `Main Congregation · Ongoing` | `Main Congregation / Ongoing` |
  | MyChurch Test Opportunity | `Main Congregation · Ongoing` | `Main Congregation / Ongoing` |

- MP verification — the proc row both sides read:
  `executeProcedure("api_MPPW_SearchOpportunities", { …, "@Keyword": "ZZTEST" })` →
  `{"Id":5,"MeetingDay":"Friday","MeetingTime":"2027-12-31T00:00:00","StartDate":"2027-12-31T00:00:00","RibbonText":"1 hour","Hidden":0}`
- Fixture `ZZTEST-Serve-Compare` (Opportunity 5) and its four test Responses have been deleted.

## Where to fix

`packages/embed-sdk/src/components/opportunity-finder.ts:404-421`
(`buildSubtitle`, `formatMeetingDay`, `formatMeetingTime`).

## Suggested fix

Decide recurring-vs-dated from the data rather than from the day string. The service
already carries `meetingTime` (falling back to `StartDate`), so: if
`meetingDay === "Ongoing"` render `"Ongoing"`; else if the parsed date is a real
calendar date, render it with `Intl.DateTimeFormat` (`weekday: "short", month: "short",
day: "numeric", year: "numeric"`) and append the time only when it is not midnight;
only pluralise the weekday when there is genuinely no date. Note the service currently
drops two other proc columns the same way — `Featured` is never returned by the proc
(it returns `RibbonText`), so the "Featured" badge in `renderCard` is unreachable
dead code; legacy does not render a ribbon either, so that half is parity, but the
dead branch is worth removing while in here.

## Resolution — 2026-10-11

**Fixed** (W4, branch `ws/w4-serving-forms`).

- **The card says *when* from the data, not from the day string.** `formatWhen()`
  (`opportunity-finder.ts`) replaces `formatMeetingDay` / `formatMeetingTime`:
  - `"Ongoing"` renders the translated "Ongoing".
  - A real `meetingTime` (which the service fills from `StartDate`) renders
    `this.fmt.date(d, "weekdayMedium")`, for example *Fri, Dec 31, 2027*.
  - The time is appended (`opportunityFinder.dateAtTime`) only when it is not midnight.
    A date-only opportunity stores midnight, and legacy's "12:00 AM" was meaningless.
    This is the "restore the time" half: a real time now shows next to its date, where
    before it was dropped along with the date.
  - Only a weekday with **no** date renders a recurrence. The stock proc never produces
    one (`MeetingDay` is `DATENAME(dw, Opportunity_Date)`), but a customised proc might.
- **Pluraliser key replaced in all three locales.** `everyDay: "{day}s"` (and es
  `"los {day}"`, which produced "los Friday") is gone from both `opportunityFinder` and
  `opportunityDetails`. The new `everyWeekday` key takes a weekday **localised by `Intl`**
  (`fmt.weekdayNames`), mapped from MP's English `DATENAME`: "Every Friday", "Cada
  viernes", "Toda semana, sexta-feira". `opportunity-details`' dateless fallback uses it
  too.
- **Dead "Featured" badge removed and the slot wired.** The proc never returns `Featured`
  (it returns `RibbonText`). `OpportunitySearchResult.featured` became `ribbonText`
  (types, service, widget), and the badge now shows MP's own commitment text ("1 hour"),
  untranslated because it is MP-authored. That follows the plan's "do better than parity"
  note; legacy rendered no ribbon. The `opportunityFinder.featured` key was removed in all
  three locales.
- `pnpm i18n:sync` was re-run.
- Tests: `opportunity-finder.test.ts` ("when (C25)") covers:
  - a one-time opportunity renders "Main Congregation · Fri, Dec 31, 2027" and never
    "Fridays";
  - a real time is kept;
  - Spanish dates and a dateless weekday are localised;
  - `RibbonText` renders in the badge.
