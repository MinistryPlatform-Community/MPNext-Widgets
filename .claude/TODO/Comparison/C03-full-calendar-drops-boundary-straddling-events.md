# C03. `/api/embed/full-calendar` filters by containment, not overlap, so any event straddling the visible range is silently dropped

**Widget:** `next-full-calendar` (new only; verified against MP)
**Severity:** functional
**Confidence:** confirmed — reproduced in the browser with a purpose-built MP fixture and matched against the two MP queries
**Found:** 2026-09-08, comparison run

## Old behaviour

No legacy calendar exists. The reference is MP: an event that runs 2026-10-30 → 2026-11-02
is, by any calendar's definition, an event *in November* as well as in October.

## New behaviour

`FullCalendarService.getEvents()` builds

```sql
Event_Start_Date >= '<start>' AND Event_End_Date <= '<end>' AND Cancelled = 0 AND Visibility_Level_ID = 4
```

(`src/services/fullCalendarService.ts:124`) — a **containment** test. The correct
test for "does this event appear in this window" is **overlap**:
`Event_Start_Date < end AND Event_End_Date > start`.

Reproduced with a fixture event `ZZTEST-Multi-Day Retreat`, 2026-10-30 09:00 →
2026-11-02 17:00, `Visibility_Level_ID = 4`, `Cancelled = 0`. Driving the `grid`
(FullCalendar `dayGridMonth`) view month by month:

| Month shown | Range requested | Chips rendered | ZZTEST retreat visible |
|---|---|---|---|
| September 2026 | `2026-08-30` … `2026-10-11` | 13 | — (correctly out of range) |
| October 2026 | `2026-09-27` … `2026-11-08` | 16 | **yes** (both the timed chip and the multi-day bar) |
| **November 2026** | `2026-11-01` … `2026-12-13` | 12 | **NO** |
| December 2026 | `2026-11-29` … `2027-01-10` | 12 | — (correctly out of range) |

November's window starts 2026-11-01, the event starts 2026-10-30, so
`Event_Start_Date >= '2026-11-01'` excludes it — even though the event occupies
November 1st and 2nd. The same clause drops the mirror case: an event that starts
inside the window but ends after it fails `Event_End_Date <= '<end>'`.

MP confirms it is purely the filter shape:

```
containment (widget's filter), 2026-08-30 … 2026-10-11  -> 13 rows
overlap    (correct filter),   2026-08-30 … 2026-10-11  -> 13 rows   (identical when nothing straddles)
```

With the straddling fixture present, the November containment query returns 12 and the
November overlap query returns 13.

## Why it matters

Multi-day events are exactly the ones a church most wants on a calendar — retreats,
VBS weeks, mission trips, conferences, Holy Week. Any of them that crosses a month
boundary vanishes from one of the two months it belongs to, with no error and no
partial render: the visitor simply does not see the retreat when they look at the
month it starts in. The same clause also drops a long event from *every* month it
merely passes through. Today's MPI dataset happens to contain **no** public multi-day
events (`DATEDIFF(day, Event_Start_Date, Event_End_Date) >= 1 AND Visibility_Level_ID = 4`
→ 0 rows), which is the only reason this has not been noticed; it will surface the
first time a customer publishes a retreat.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/full-calendar-new-grid-oct-2026.png`
  (the retreat present in October, both as a timed chip and a spanning bar)
- Screenshot: `.claude/playwright/widget/screenshots/full-calendar-new-grid-nov-2026.png`
  (November 1–2 empty; the retreat is gone)
- Network: `200 GET /api/embed/full-calendar?start=2026-11-01T00:00:00-04:00&end=2026-12-13T00:00:00-05:00`
- MP verification (client credentials), the two `$filter` forms quoted above, plus
  `GET /tables/Events?$filter=Cancelled = 0 AND Visibility_Level_ID = 4 AND DATEDIFF(day, Event_Start_Date, Event_End_Date) >= 1 AND Event_Start_Date >= '2026-06-01'`
  → 0 rows (no pre-existing multi-day public events, hence the fixture).
- Script: `…/scratchpad/events/06-fc-multiday.mjs`

## Where to fix

`src/services/fullCalendarService.ts:124` — the `filter` string in `getEvents()`.

## Suggested fix

Swap containment for overlap:

```ts
const filter = `Event_Start_Date < '${endDate}' AND Event_End_Date > '${startDate}' AND Cancelled = 0 AND Visibility_Level_ID = 4`;
```

Half-open on both sides keeps an event that ends exactly at the window start out and an
event that starts exactly at the window end out, which is what FullCalendar's own
exclusive-`end` convention expects. Worth a unit test in
`src/services/fullCalendarService.test.ts` with a fixture pair straddling each edge —
the current test suite cannot catch this because the live dataset has no multi-day
events. `next-add-to-calendar`, `next-event-details` and `next-event-finder` all
address single events by id and are unaffected.
