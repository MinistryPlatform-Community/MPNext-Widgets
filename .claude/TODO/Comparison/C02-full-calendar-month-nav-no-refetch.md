# C02. `next-full-calendar`'s Month / Cards / Calendar / List views fetch one fixed 3-month window and never refetch or re-scope, so navigating months shows stale or empty data

**Widget:** `next-full-calendar` (new only; data cross-checked against the legacy Event Finder and MP)
**Severity:** breaking
**Confidence:** confirmed — driven in the browser, request ranges captured, counts verified against MP
**Found:** 2026-09-08, comparison run

## Old behaviour

There is no legacy calendar widget, so the reference is the legacy **Event Finder**
and MP itself. `mpp-event-finder` with the Month filter set to `11` (November) returns
10 events; unfiltered it lists events continuously from Sep 2026 through **Jan 3 2027**
— i.e. the underlying data extends well past three months, and the legacy widget
reaches all of it.

## New behaviour

`connectedCallback` → `loadCardsData()` computes a **single** window of "first of the
current month → +3 months" (`packages/embed-sdk/src/components/full-calendar.ts:468-482`)
and issues exactly one request. Captured on `demo-full-calendar.html` (today = 2026-09-08):

```
GET /api/embed/full-calendar?start=2026-09-01T04:00:00.000Z&end=2026-12-01T05:00:00.000Z   200
```

Clicking the toolbar's `‹` / `›` then does **no** further fetch — `handleToolbarPrev`
/ `handleToolbarNext` only move `miniCalMonth` and re-render
(`full-calendar.ts:614-644`). Observed, in one session, with the request log:

| Toolbar title | Mini-calendar dots | `full-calendar` requests so far |
|---|---|---|
| September 2026 | 1, 5, 6, 12, 13, 19, 20, 26, 27 | 2 (both the same range) |
| August 2026 (`‹`) | none of its own | 2 |
| December 2026 (`›`×4) | none | 2 |
| January 2027 (`›`×5) | none | 2 |

MP has **8** public, non-cancelled events in December 2026 (`Event_ID` 227, 385, 228,
386, 229, 387, 230, 388 — the Saturday/Sunday services) and more in January 2027. The
widget shows **zero** for both. Past months are equally blank.

Second, related symptom from the same defect: the card grid under the mini calendar is
never scoped to the displayed month. `renderCardsOrCalendarView()` filters
`this.allEvents` only by the chips and by a *clicked* day
(`full-calendar.ts:697-706`), so with the title reading "December 2026" the cards below
still list **September** events — the same 12 cards as on first paint, in every month.

The `grid` and `week` views are unaffected: they run through FullCalendar's own
`events` callback, which refetches per visible range (verified: Sep/Oct/Nov/Dec each
issued its own 200 with the right range).

## Why it matters

The default view of this widget is `month`, and the toolbar's most obvious controls are
`‹` and `›`. A visitor who clicks `›` on a church's calendar page sees an empty month
and concludes the church has nothing on — while MP has eight public services that
month. Clicking `‹` to check last week is equally blank. And because the card list
never re-scopes, the page simultaneously shows "December 2026" in the header and a list
of September events, which reads as a data error rather than a navigation limit.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/full-calendar-new-december-empty.png`
  (title "December 2026", no dots, September cards below)
- Screenshot: `.claude/playwright/widget/screenshots/full-calendar-new-month.png` (first paint, for contrast)
- Network: exactly two `GET /api/embed/full-calendar?start=2026-09-01T04:00:00.000Z&end=2026-12-01T05:00:00.000Z`
  (both 200) across five month navigations; zero further requests.
- MP verification:
  `GET /tables/Events?$filter=Event_Start_Date >= '2026-12-01 00:00:00' AND Event_Start_Date < '2027-01-01 00:00:00' AND Cancelled = 0 AND Visibility_Level_ID = 4`
  → 8 rows.
- Script: `…/scratchpad/events/05-fc-views.mjs`

## Where to fix

`packages/embed-sdk/src/components/full-calendar.ts:467-497` (`loadCardsData` — the
hardcoded `+3` month window), `:614-644` (`handleToolbarPrev` / `handleToolbarNext` /
`handleToolbarToday`, which re-render without fetching), `:686-706`
(`renderCardsOrCalendarView`, which does not filter by `miniCalMonth`), and the
`onMonthChange` callbacks passed to `renderMiniCalendar` at `:733-736` and `:812-815`.

## Suggested fix

Give the non-FullCalendar views the same range-driven data path the FullCalendar views
already have: derive `[start, end)` from `miniCalMonth` (padded to the mini
calendar's leading/trailing week, so its edge cells are populated), and make every
month change — toolbar `‹`/`›`/`Today` and the mini calendar's own `onMonthChange` —
await a fetch for that range before re-rendering. Keep a small per-range cache so
paging back and forth is cheap. Then scope `displayEvents` to the displayed month
(falling back to the clicked day when `selectedDate` is set) so the header and the
card list can never disagree. Whether the "Cards"/"List" views should stay a rolling
multi-month digest rather than a single month is a product call — but they must at
least refetch when the range they claim to show moves.
