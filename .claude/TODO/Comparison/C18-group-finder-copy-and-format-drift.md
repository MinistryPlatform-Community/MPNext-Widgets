# C18. `next-group-finder` copy, date format and empty-state text all drift from the legacy Group Finder

**Widget:** `next-group-finder` (old: Group Finder, `/widgets/group_finder.aspx`)
**Severity:** cosmetic
**Confidence:** confirmed — both widgets rendered side by side, anonymously, with the same attribute configuration (`targeturl` + `showsuggestagroupbutton="true"`)
**Found:** 2026-09-08, comparison run (groups agent)

This is one item covering the finder's user-visible copy as a single surface, not eight
items. Every row below was measured in the same pair of runs and they share one cause and
one fix location; splitting them would be noise. (Distinct from **C67**, which is about
there being no way to *configure* labels from MP at all — this item is about the
hardcoded defaults themselves not matching what churches see today.)

## Old behaviour vs new behaviour

| # | Surface | Old | New |
|---|---|---|---|
| 1 | Widget heading | `Group Finder` (an `h1` above the form) | *none* — the form is the first thing in the shadow root |
| 2 | Congregation filter label | `Campus` | `Congregation` |
| 3 | Congregation "any" option | `Any Campus` | `All Congregations` |
| 4 | Keyword field | visible label `Key Word` | no visible label; placeholder `Search groups…` + `aria-label="Search groups"` |
| 5 | Advanced toggle | `Show Advanced` | `Advanced Search` (and `Hide Advanced Search` when open) |
| 6 | Group Focus "any" option | `All Group Focuses` | `All Focuses` |
| 7 | Submit button | `Search Groups` | `Search` |
| 8 | Meeting-day checkbox labels | `Su Mo Tu We Th Fr Sa` | `Sunday Monday Tuesday Wednesday Thursday Friday Saturday` |
| 9 | Card meeting line | `Mondays @ 6:30 PM` (day pluralised, `@` separator) | `Monday · 6:30 PM` (singular, middot separator) |
| 10 | Card capacity line | `Capacity: 2 of 20` | `2 of 20` (no label) |
| 11 | Card start-date line | `Already Meeting` | `Already meeting` (sentence case) |
| 12 | Card image, no photo | default group icon (`/widgets/Content/icons/icon-group.svg`) | text placeholder rendering `NoImageText` from the proc, e.g. `Small Group` |
| 13 | Empty state | `0 Groups found. Please try again with different search criteria.` (in a `mppw-alert__warning` with an icon) | `No groups found.` (plain text, no styling, no guidance) |

Row 9 deserves a note: `Mondays` is legacy's own pluralisation of the recurring meeting
day and reads correctly for a repeating group; `Monday` reads like a one-off. Neither side
shows `MeetingFrequency` on the card even though the proc returns it (`Every Other Week`
for the group above) — the detail view shows it on both. That part is parity.

Row 12 is the most visible on a real page: with no group photo, legacy shows a neutral
icon and ours shows a word inside a grey box, which looks like a rendering failure rather
than a placeholder.

Row 13 is the one with a functional edge: legacy tells the visitor *what to do next*
("try again with different search criteria") and styles it as an alert; ours is a bare
sentence that is easy to miss.

Everything of substance is otherwise identical. The filter controls are a complete
one-for-one match (keyword, congregation, parent group / neighborhood, city-or-postal,
group focus, life stage, 7 meeting days, 4 meeting times, meets-online), the ">20 results"
info hint exists on both, and all eleven filter combinations tested returned the same
groups in the same order — see `.claude/playwright/widget/tests/group-finder.md`.

## Why it matters

Copy drift is what a church's staff notices first on the day they migrate, and it lands as
"the new widget is wrong" rather than "the new widget is different". `Campus` → `Congregation`
(rows 2–3) is the sharpest: MP's own default vocabulary in this instance is Campus, and the
congregation names on this domain literally read "Main Congregation" / "Friends & Internet
Campus", so `All Congregations` above a list containing "Campus" entries reads as a
mismatch. The empty state (row 13) and the no-photo placeholder (row 12) are the two that
actively look broken to a visitor. None of this blocks a flow, which is why it is one
cosmetic item, but all of it is on the public page.

## Evidence

- Baseline pair: `.claude/playwright/widget/screenshots/group-finder-old-initial.png`,
  `group-finder-new-initial.png`
- Empty state pair: `group-finder-old-empty-state.png`, `group-finder-new-empty-state.png`
- Mobile (390×844) pair: `group-finder-old-mobile.png`, `group-finder-new-mobile.png`
  (both reflow to a single column; no horizontal overflow on either)
- Measured label arrays:
  - old: `["Campus","Key Word","Neighborhood","City or Postal Code","Group Focus","Life Stage","Su","Mo","Tu","We","Th","Fr","Sa","Meeting Days","Morning","Lunchtime","Afternoon","Evening","Meets Online", …]`
  - new: `["Congregation","Neighborhood","City or Postal Code","Group Focus","Life Stage","Meeting Days","Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Meeting Times","Morning","Lunchtime","Afternoon","Evening","Meets Online"]`
- Card HTML, both sides, quoted in `.claude/playwright/widget/tests/group-finder.md`
- Empty-state strings: `old empty copy: "0 Groups found. Please try again with different search criteria."` /
  `new empty copy: "No groups found."`
- Scripts: `.claude/playwright/widget/scripts/groups-gf-public.mjs`, `.claude/playwright/widget/scripts/groups-gf-filters.mjs`

## Where to fix

`packages/embed-sdk/src/components/group-finder.ts` — `renderSearchForm()` (`:445-513`),
`renderResults()` (`:515-538`), `renderCard()` (`:540-570`), `capacityLabel()` (`:572-580`),
`formatMeetingTime()` / `formatStart()`, and `MEETING_DAYS` (`:36-44`).

## Suggested fix

Decide once whether the new SDK is deliberately re-voicing MP's copy or is meant to match
it, and write that decision down — right now it is neither, which is how a table like this
happens. If matching is the goal, the mechanical changes are: restore the `Campus` /
`Any Campus` / `All Group Focuses` / `Search Groups` / `Show Advanced` strings and the
`Key Word` visible label, prefix the capacity line with `Capacity: `, pluralise the meeting
day, use `@` between day and time, and title-case `Already Meeting`.

Two are worth fixing regardless of that decision:

- **Empty state** — adopt legacy's wording and give it the widget's own alert styling, so
  it both explains and is visible.
- **No-photo placeholder** — render an inline SVG group icon (the `groupSvg()` helper in
  `my-groups.ts` already exists and is used for exactly this case) instead of painting
  `NoImageText` as body text. Keep `NoImageText` as the `alt`/`aria-label`.

Note that any per-church wording ultimately depends on **C67** (no MP label channel), so
this item is about picking better hardcoded defaults, not about making them configurable.
