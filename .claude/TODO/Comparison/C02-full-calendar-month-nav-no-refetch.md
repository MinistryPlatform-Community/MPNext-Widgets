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

## Resolution — 2026-10-11

**Fixed** (W2, branch `ws/w2-events`). All changes are in `full-calendar.ts`, plus an optional
`emptyText` argument on `renderCardsGrid` / `renderAgendaList`. The `grid` and `week` views
are untouched: they still refetch through FullCalendar's own `events` callback.

**Range-driven data for `month` / `calendar` / `cards` / `list`:**

- `monthGridRange(miniCalMonth)` derives `[start, end)` from the displayed month. The range is
  padded back to the Sunday on or before the 1st and forward to the Saturday on or after the
  last day, so the mini calendar's grey edge cells get their dots.
- Every month change goes through one `goToMonth()`. That covers:
  - the toolbar `‹`, `›` and `Today`;
  - both mini-calendar `onMonthChange` sites;
  - the mini calendar's own Today link.

  `goToMonth()` calls `loadCardsData()`, which awaits the fetch for the new range. A day
  selected in another month is cleared.
- **Per-range cache.** One promise per `[start, end)`. A failed fetch evicts itself, so the
  next visit or Try Again really retries.
- **Prefetch.** The months either side are prefetched after each load, so `‹` / `›` paint
  instantly.
- **Stale responses.** A response for a month the visitor has already left is dropped
  (`loadSeq`).
- **Scoping.** `displayEvents` is scoped to the displayed month by **overlap**, not by start
  date. A clicked day is matched by overlap too, so a multi-day event lists on every day and
  month it occupies (the client half of C03). The header and the list can no longer disagree.
- **States.** While a range is in flight, the cards area shows a loading line rather than the
  previous month's cards or a premature "no events". A failed range shows an inline error with
  **Try Again**. Before this change the cards area simply stayed blank and only an event fired.
  The toolbar and mini calendar stay usable throughout.
- **Empty months.** An empty month now says so: "No events in January 2027."
  (`fullCalendar.noEventsInMonth`).

**`cards-scope="month|rolling"`** (epic decision: default `month`).

- `rolling` lists from today forward over 3 months.
- The toolbar drops `‹` / `›` / `Today` and titles itself "Upcoming events"
  (`fullCalendar.upcomingTitle`). The empty state is `fullCalendar.noUpcomingEvents`.
- **Decided:** `rolling` applies only to `cards` and `list`. The `month` and `calendar` views
  pair their cards with a mini calendar, which is month-scoped by nature. A rolling list under
  a single-month mini calendar would reintroduce the header/list disagreement this item was
  filed about.
- **Migration note:** `view="cards" show-toolbar="false"` used to show a fixed "this month + 2"
  window. Under the `month` default it now shows only the current month, with no navigation.
  A homepage strip should set `cards-scope="rolling"`. The demo page and its copy-paste snippet
  now do.
- New keys: `noEventsInMonth`, `noUpcomingEvents` and `upcomingTitle`, added in en, es and
  pt-BR, followed by `pnpm i18n:sync`.

**Reconfigure (C39).** The widget's private `connectedOnce` guard is replaced by the base
class's `painted` flag.

- `view` and `show-toolbar` still re-render through the existing paths.
- `cards-scope` and `api-host` go through `reconfigure()` → `reload()`. `reload()` clears the
  cache and reloads: `refetchEvents()` on the FullCalendar views, `loadCardsData()` otherwise.
- `openAttributeCallbacks()` also replays a `cards-scope` that changed mid-init.
- The TODO 20/32 lifecycle suite passes unchanged.

**Tests:** new `full-calendar-range.test.ts` (15 cases) covers:

- the padded-range and rolling-range maths, and day overlap;
- the first-paint range and month-scoped list;
- `›` ×2 → December shows the Christmas service under a December header;
- the Oct 30 → Nov 2 retreat listed in both months;
- `‹` into past months;
- mini-calendar arrows refetching;
- cache and prefetch (no refetch on paging back);
- the empty-month sentence;
- Today;
- the error, then Try Again;
- rolling scope: its range, toolbar and title;
- rolling being ignored on `month`;
- `cards-scope` reconfiguring after first paint.

**Left open:** the agenda list groups a straddling event under its start date. In November
the retreat therefore sits under an "Oct 30" heading at the top of November's list. That is
correct data in a slightly odd place. It is cosmetic and is noted here rather than filed.
