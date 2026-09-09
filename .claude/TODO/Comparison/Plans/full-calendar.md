# `next-full-calendar` — plan

**Items:** C02 (breaking) · C03 (functional) · C08 (ux, shared)
**Cutover verdict: blocks pilot cutover. Month navigation shows an empty church.**
**Owns:** `packages/embed-sdk/src/components/full-calendar.ts` and its five
`full-calendar-*` sub-modules, `src/services/fullCalendarService.ts`

## What the feedback says

**There is no legacy calendar widget** — this is a new capability, so every item here is
measured against MP itself rather than against a predecessor. That is freeing: there is no
parity argument to satisfy, only a correctness one.

Two data bugs and one dialog bug:

- **C02** — `loadCardsData()` computes a **single** window (first of the current month, +3
  months) and issues exactly one request. The toolbar's `‹`/`›` only move `miniCalMonth` and
  re-render; they never refetch. Five month navigations produced **two** requests, both for
  the same range. MP has eight public services in December 2026 and the widget shows zero.
  Worse, the card grid is never re-scoped either, so the header can read "December 2026" while
  the cards below list September — which reads as a *data error*, not a navigation limit.
- **C03** — `getEvents()` filters by **containment**
  (`Event_Start_Date >= start AND Event_End_Date <= end`) where the correct test is
  **overlap**. A retreat running Oct 30 → Nov 2 is present in October and absent from
  November, both days of which it occupies. Today's dataset happens to contain no public
  multi-day events, which is the only reason this has not been noticed.
- **C08** — the event modal declares `role="dialog" aria-modal="true"` and never takes focus.

## Where the new widget is already better — protect these

- **The `grid` and `week` views are correct.** They run through FullCalendar's own `events`
  callback, which refetches per visible range — verified, each month issued its own 200 with
  the right range. Whatever C02's fix is, do not disturb them.
- **The FullCalendar 7 SRI pre-flight passes**: all four pinned assets 200, zero integrity
  errors, both stylesheets attached, grid matches MP. The `FC_ASSETS` table and the `:host`
  variable contract in `full-calendar-styles.ts` are working as designed — see `CLAUDE.md`
  before touching either.
- Card `LEARN MORE` is a real `<button>` and Enter works; the List view's rows are `<button>`
  too. **This widget avoided the C05/C10/C22 card bug** that the three finders share.

## Phase 1 — make the data correct

### C03 first — it is a one-line fix and it changes what "correct" means for C02

`fullCalendarService.ts:124`:

```ts
const filter = `Event_Start_Date < '${endDate}' AND Event_End_Date > '${startDate}' AND Cancelled = 0 AND Visibility_Level_ID = 4`;
```

Half-open on both sides keeps an event ending exactly at the window start out and one
starting exactly at the window end out, which is what FullCalendar's exclusive-`end`
convention expects.

**Add a unit test in `fullCalendarService.test.ts` with a fixture pair straddling each
edge.** The current suite cannot catch this because the live dataset has no multi-day events —
and multi-day events are exactly the ones a church most wants on a calendar: retreats, VBS
weeks, mission trips, conferences, Holy Week.

`next-add-to-calendar`, `next-event-details` and `next-event-finder` address single events by
id and are unaffected.

### C02 — give the non-FullCalendar views the data path the FullCalendar views already have

1. Derive `[start, end)` from `miniCalMonth`, **padded to the mini calendar's leading and
   trailing week** so its edge cells are populated.
2. Make every month change — toolbar `‹`/`›`/`Today` **and** the mini calendar's own
   `onMonthChange` (two call sites, `:733-736` and `:812-815`) — await a fetch for that range
   before re-rendering.
3. Keep a small per-range cache so paging back and forth is cheap.
4. Scope `displayEvents` to the displayed month (falling back to the clicked day when
   `selectedDate` is set) so **the header and the card list can never disagree**. That is the
   non-negotiable half: an empty month is a limitation, a mismatched header is a bug report.

## Phase 2 — the product question C02 raises, and it is worth answering deliberately

The item flags it and then declines to decide: *should Cards and List be month-scoped at all,
or a rolling multi-month digest?*

They are currently neither — a fixed three-month window with a month header above it — which
is how the mismatch happened. Both answers are defensible and they suit different pages:

| Mode | Reads as | Best for |
|---|---|---|
| `month` | "what's on in December" | a calendar page, paired with the mini calendar |
| `rolling` | "the next N events" | a homepage strip or a sidebar |

**Recommendation: make it explicit rather than implicit.** Add
`cards-scope="month | rolling"` (default `month`, matching the mini calendar the cards sit
under) and, in `rolling` mode, **hide or relabel the month toolbar** so the header never
claims a scope the list does not have. A rolling digest is arguably the better default for a
church homepage — most visitors want "what's coming up", not "what happened in March" — and
we can offer both, which legacy could not because it had no calendar at all.

## Phase 3 — the modal

C08, handled by `CROSS-3-accessibility.md` §4. Specifics for this file:

- `renderDetailModal` (`full-calendar-modal.ts:112-273`) has the attributes and Escape right;
  it is missing focus-in, a Tab trap, and focus restoration.
- `showEventModal` (`full-calendar.ts:551-565`) is where the triggering element is known —
  pass it through, or capture `this.root.activeElement` before rendering.
- **`next-add-to-calendar` already implements this whole pattern** (`add-to-calendar.ts:315-318`
  focuses the first option, `:163-167` restores on Escape). Lift it into the shared helper
  rather than writing a third version.
- `aria-modal="true"` with focus outside the dialog is *worse* than no dialog semantics: the
  user is focused on content assistive tech has been told to hide.

## Do better than parity

There is no parity here, so the bar is "is this a good calendar":

- **Prefetch the adjacent months.** Once ranged fetching exists, fetching `±1` month
  alongside the current one makes `‹`/`›` instant. The per-range cache makes this nearly free
  and it is the difference between a calendar that feels native and one that flickers.
- **Say when a month is genuinely empty.** "No events in December" is information; a blank
  grid is ambiguous with a failed load. Especially important because C02's symptom *was* a
  blank grid.
- **Multi-day events deserve better than a chip.** Once C03 lets them through, they will
  appear for the first time. Check the spanning-bar rendering in `grid` view and how a
  multi-day event reads in `cards` and `list` — the comparison run saw one only in October,
  so the November-half rendering is effectively untested.
- **Keep styling off generated class names.** `CLAUDE.md` is explicit: FullCalendar 7 emits
  build-generated hashes (`fc-classic-wsy`), so style through `--fc-classic-*`, the `*Class`
  hook options, or `data-date` / `aria-current="date"`. Worth re-reading before any visual
  work here.

## Acceptance

- Navigating to any month issues a fetch for that month's padded range and renders its events.
- The toolbar title and the card list always describe the same period.
- A fixture event straddling a month boundary appears in **both** months, with a unit test.
- The modal takes focus on open, traps Tab, and returns focus to the trigger on close.
- `grid` and `week` behaviour is unchanged.

## Depends on / unblocks

Independent. C08 wants the `CROSS-3` `dialogFocus` helper but does not need to wait for it.
