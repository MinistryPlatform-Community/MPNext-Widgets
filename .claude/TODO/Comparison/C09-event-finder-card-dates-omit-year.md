# C09. `next-event-finder` card dates omit the year, so a result list spanning a year boundary is ambiguous — the legacy card always showed it

**Widget:** `next-event-finder` (old: Event Finder, `mpp-event-finder`)
**Severity:** cosmetic
**Confidence:** confirmed — both card sets read out of their shadow roots on the same unfiltered search
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy cards print the year on every result. Read from `mpp-event-finder`'s shadow root
on the default unfiltered search:

```
Saturday Night Service        Sat, Sep 12, 2026 6:05 PM - 7:30 PM   Main Congregation
Sunday 10AM Worship Service   Sun, Sep 13, 2026 10:00 AM - 11:30 AM Main Campus
…
Saturday Night Service        Sat, Jan 2, 2027 6:05 PM - 7:30 PM    Main Congregation
Sunday 10AM Worship Service   Sun, Jan 3, 2027 10:00 AM - 11:30 AM  Main Campus
```

## New behaviour

Same search, same 34 events, same order, same ids — but no year:

```
Saturday Night Service        Sat, Sep 12, 6:05 PM – 7:30 PM        Main Congregation
Sunday 10AM Worship Service   Sun, Sep 13, 10:00 AM – 11:30 AM      Main Campus
…
Saturday Night Service        Sat, Jan 2, 6:05 PM – 7:30 PM         Main Congregation
Sunday 10AM Worship Service   Sun, Jan 3, 10:00 AM – 11:30 AM       Main Campus
```

`formatDateRange()` uses `{ weekday: "short", month: "short", day: "numeric" }` with no
`year` (`packages/embed-sdk/src/components/event-finder.ts:383`). The default result
set on MPI runs from **Sep 12 2026 to Jan 3 2027**, so the last four cards are in a
different year from the first thirty and the card gives the reader nothing to tell
them apart. "Sat, Jan 2" is 16 weeks away, not last week, and the card reads as though
it could be either.

For the avoidance of doubt this is *only* the display format — the underlying data is
at exact parity. Old and new returned the same 34 events in the same order with the
same ids (set difference in both directions: empty), and every filter matches:
keyword "Worship" 37/37, `congregationId=2` 0/0, `monthId=11` 10/10 with identical
ids, `ministryId=5` 0/0, `signUpTypeId=1` 1/1 (the same event), Featured 0/0 — each
cross-checked against `api_MPPW_SearchEvents` directly.

## Why it matters

The event finder is unpaginated and shows the next ~4 months in one scroll, so a
year boundary falls inside a normal result list roughly a third of the year. A visitor
scanning for "the next Saturday service" cannot distinguish this year's from next
year's, and someone who lands on the page in December sees January dates that look
like they have already passed. It is a small change that removes information the legacy
widget gave for free, and it is the only user-visible formatting regression found in
this pair.

## Evidence

- Screenshot (old, year present): `.claude/playwright/widget/screenshots/event-finder-old-initial.png`
- Screenshot (new, year absent): `.claude/playwright/widget/screenshots/event-finder-new-initial.png`
- Card text extracted from both shadow roots: `…/scratchpad/events/old-ef.json`, `…/new-ef.json`
  (34 rows each, ids identical)
- Script: `…/scratchpad/events/02-ef-parity.mjs`

## Related cosmetic differences, deliberately not filed separately

All of these are wording, and all are subsumed by **C67** (no MP-configurable labels —
legacy copy comes from `GET /Api/ConfigurationApi/GetLabels`, ours is hardcoded
English). Recorded here so the list is complete rather than as separate items:

| Legacy | New |
|---|---|
| `Campus` (label) | `Congregation` |
| `Any Campus` (placeholder) | `All Congregations` |
| `Key Word` (label) | `Search events…` (placeholder, `aria-label="Search events"`) |
| `Show Advanced` / `Hide Advanced` | `Advanced Search` / `Hide Advanced Search` |
| `Search Events` (submit) | `Search` |
| `All Events` (sign-up type, value `0`) | `Both` (value `""`) |
| `0 Events found. Please try again with different search criteria.` | `No events found.` |
| `To see additional results, please refine your search filters above` (standing footer) | — (no footer) |

## Where to fix

`packages/embed-sdk/src/components/event-finder.ts:379-405` (`formatDateRange`) —
specifically `dateFmt` on `:383`.

## Suggested fix

Include the year when it is not the current one, which keeps the common case short and
the ambiguous case unambiguous: compute `const thisYear = new Date().getFullYear()` and
build `dateFmt` with `year: "numeric"` when either endpoint's year differs from it (or
from the start's year, for the cross-year range branch at `:402-404`). Always-on
`year: "numeric"` also matches legacy exactly and is a one-line change if the extra
width is acceptable. `next-full-calendar`'s modal already prints
`Tue, Sep 1, 2026, 9:00 AM – …` with the year, and `next-event-details` prints
`Saturday, September 12, 2026, …`, so the finder is the outlier inside our own stack.
