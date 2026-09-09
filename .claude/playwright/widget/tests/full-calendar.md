# full-calendar — comparison test log

- **New**: `next-full-calendar` — http://localhost:5173/demo-full-calendar.html
  (page carries two instances: `#main-calendar` with defaults, and a second with
  `view="cards" show-toolbar="false"`. All measurements below are on `#main-calendar`.)
- **Old**: **none.** MPWidgets.js knows 36 `mpp-*` tags and none of them is a
  month/week/day calendar (CONFIG-MAP §3.1) — this is one of only two genuinely
  new-only elements. Data was therefore compared against the legacy **Event Finder**
  over the same date range and against **MP directly** via client credentials.
- **Tested**: 2026-09-08 by subagent `events` (block C01–C09)
- **Auth state(s) tested**: signed out and signed in as `PLAYWRIGHT_MP_USERNAME`
  (`assertAuthenticated` → `ver=1, sub=03a109d5…, mpToken=true`)
- **Scripts**: `…/scratchpad/events/04-fc.mjs`, `05-fc-views.mjs`, `06-fc-multiday.mjs`,
  `18-fc-authed.mjs`, `19-fc-kbd.mjs`, plus the MP helper `mp.mjs`

## What I tested

1. **CDN / SRI pre-flight.** Logged every `cdn.jsdelivr.net` response and watched the
   console for any integrity or CSP failure, then confirmed the calendar is actually
   *styled* (both stylesheets present as `<link>` in the shadow root, day cells and
   event chips painted) rather than silently unstyled.
2. **All six views** (`month`, `grid`, `week`, `list`, `cards`, `calendar`) via the
   toolbar buttons, capturing the toolbar title, the active button, the rendered event
   set and the request range for each.
3. **Month navigation** — `‹` ×1, `›` ×4 and ×5, and `Today` — recording the toolbar
   title, the mini-calendar density dots, the card list, and **every**
   `/api/embed/full-calendar` request issued.
4. **Data parity against MP** for the exact range each view requested, running both the
   widget's own containment `$filter` and the correct overlap `$filter` and diffing them.
5. **Data parity against the legacy Event Finder** for the same months.
6. **Boundary-straddling events**, with a purpose-built fixture
   (`ZZTEST-Multi-Day Retreat`, 2026-10-30 09:00 → 2026-11-02 17:00) driven through the
   `grid` view month by month.
7. **Detail modal** — opened by mouse and by keyboard, checking `role`, `aria-modal`,
   `aria-label`, whether focus enters the dialog, Tab containment, Escape, and
   backdrop click.
8. **Filter chips** (Campus / Ministry) against MP's own congregation and ministry lists.
9. **Density dots** — confirmed the mini calendar paints them and that their absence
   from the FullCalendar day cells is the deliberate outcome of `.claude/TODO/39`
   (**not** filed as a regression, and no `dayCellDidMount` proposed).
10. **Responsive** at 390×844.
11. **Timezone handling** — cross-checked the requested ranges (offset-tagged,
    `-04:00` / `-05:00` across the DST boundary) against MP's wall-clock storage and
    `.claude/references/ministryplatform.datetimehandling.md` before treating any
    difference as a bug.

## Results

| # | Check | Expected / MP | Observed | Verdict |
|---|---|---|---|---|
| 1 | `all/global.js` | 200, hash matches | `200 fullcalendar@7.1.0/all/global.js` | **pass** |
| 2 | `themes/classic/global.js` | 200, hash matches | `200 fullcalendar@7.1.0/themes/classic/global.js` | **pass** |
| 3 | `skeleton.css` | 200, hash matches | `200 fullcalendar@7.1.0/skeleton.css` | **pass** |
| 4 | `themes/classic/theme.css` | 200, hash matches | `200 fullcalendar@7.1.0/themes/classic/theme.css` | **pass** |
| 5 | Any integrity / SRI console error | none | **none** (console filtered for `integrity\|Subresource\|Failed to find a valid digest`) | **pass** |
| 6 | "Failed to load calendar library." | never shown | never shown | **pass** |
| 7 | Calendar is actually styled | stylesheets attached, cells painted | 2 `<link rel=stylesheet>` in the shadow root + 1 adopted sheet; 42 `[data-date]` day cells; 13 `.nw-fc-event` chips | **pass** — all four assets genuinely load and apply |
| 8 | `month` view first paint | current month | title `September 2026`, mini-cal `September 2026`, 12 cards + `Show More`, dots on 1, 5, 6, 12, 13, 19, 20, 26, 27 | **pass** |
| 9 | `grid` view (dayGridMonth) | Aug 30 – Oct 10 | 42 day cells `2026-08-30 … 2026-10-10`, 13 event chips | **pass** |
| 10 | `grid` data vs MP (containment filter, same range) | 13 | 13 | **pass** — exact |
| 11 | `grid` data vs MP (overlap filter, same range) | 13 | 13 | **pass** — identical because nothing straddles today |
| 12 | `week` view | Sep 6 – 12 | title `Sep 6 – 12, 2026` (v7 `view.title` correctly overridden), 2 chips: Sun 10AM Worship (Sep 6), Saturday Night Service (Sep 12) | **pass** |
| 13 | `list` view | agenda grouped by date | `Tuesday, September 1, 2026 / 1 event / Faith Formation Registration 9:00 AM – 12:00 PM / Main Congregation / Faith Formation …` | **pass** |
| 14 | Filter chips | MP congregations + ministries | `Campus: All, Main Congregation`; `Ministry: All, *Temp Ministry, Religious Education` | **pass** (scoped to the loaded events, by design) |
| 15 | Mini-calendar density dots | present | `.nw-fc-density-dot` on every day with an event, plus a `.nw-fc-density-legend` | **pass** |
| 16 | Density dots on FullCalendar day cells | **deliberately absent** (`.claude/TODO/39`, resolved as "dropped") | absent | **pass — not a regression, not filed** |
| 17 | `.fc-*` class names | build-generated, unusable | confirmed (targeted `[data-date]` and roles instead throughout) | n/a |
| 18 | Month `‹` → August 2026 | events for August | title + mini-cal move to `August 2026`; **no request issued**; dots only on the trailing September cells; card list unchanged | **FAIL → C02** |
| 19 | Month `›` ×4 → December 2026 | MP has 8 public events (227, 385, 228, 386, 229, 387, 230, 388) | title `December 2026`, **0 dots**, **no request issued**, card list still September | **FAIL → C02** |
| 20 | Month `›` ×5 → January 2027 | legacy finder lists events to Jan 3 2027 | 0 dots, card list still September | **FAIL → C02** |
| 21 | Total `full-calendar` requests across 5 navigations | ≥ 5 | **2** (the same range twice) | **FAIL → C02** |
| 22 | Card list scoped to the displayed month | yes | no — same 12 cards in every month, header and list disagree | **FAIL → C02** |
| 23 | `grid`/`week` refetch per range | yes | yes — Sep/Oct/Nov/Dec each issued its own 200 with the correct offset-tagged range | **pass** |
| 24 | Boundary-straddling event in **October** grid (Sep 27 – Nov 8) | visible | visible — timed chip *and* the multi-day bar | **pass** |
| 25 | Boundary-straddling event in **November** grid (Nov 1 – Dec 13) | visible (it occupies Nov 1–2) | **absent** | **FAIL → C03** |
| 26 | MP overlap vs containment for November | overlap 13, containment 12 | matches the filter shape exactly | **FAIL → C03** |
| 27 | Modal `role` / `aria-modal` / `aria-label` | set | `dialog` / `true` / the event title | **pass** |
| 28 | Focus enters the modal | yes | **no** — `focusInModal: false`; focus stays on the (now overlaid) `LEARN MORE` button | **FAIL → C08** |
| 29 | Tab trapped in the modal | yes | no trap present | **FAIL → C08** |
| 30 | Escape closes the modal | yes | yes | **pass** |
| 31 | Backdrop click closes the modal | yes | yes | **pass** |
| 32 | Card `LEARN MORE` reachable by keyboard | yes | yes — it is a real `<button>`; Enter opens the modal | **pass** |
| 33 | `list` view rows keyboard-reachable | yes | yes — rows are `<button class="nw-fc-agenda-row">` | **pass** |
| 34 | Signed-in render | same + admin enrichment when applicable | identical (12 cards, same chips); the test user is not a calendar admin, so the admin path was not entered | **pass**, admin path not exercised |
| 35 | Console errors | none beyond MP noise | only `User not authenticated.` ×2 (MPWidgets.js on an anonymous page) | **pass** |
| 36 | API failures | none | none (`apiFailures()` empty) | **pass** |
| 37 | Responsive 390×844 | usable | mini calendar + single-column cards | **pass** |
| 38 | Datetime handling | MP wall-clock, no UTC shift | requested ranges carry the correct offsets across the DST boundary (`-04:00` for Nov 1, `-05:00` for Dec 13); rendered times match MP's stored wall clock exactly (e.g. `Event_Start_Date 2026-09-12T18:05:00` → `6:05 PM`) | **pass** — no date bug |

## Cross-check against the legacy Event Finder

The two widgets deliberately show **different sets**, and this is not a defect:

- Event Finder runs `api_MPPW_SearchEvents`, which returns **34** future events on MPI
  (verified directly) — the online-available, registration-relevant subset.
- The calendar reads `Events` directly with `Cancelled = 0 AND Visibility_Level_ID = 4`,
  which is **518** events all-time and 264 future — so it shows things the finder does
  not (`Faith Formation Registration`, etc.).

Where they overlap they agree: every Saturday Night Service / Sunday 10AM Worship
Service the finder lists for September appears in the calendar's September views with
the same title, campus and times. The only place the calendar is *missing* events the
finder shows is December 2026 and January 2027 — which is C02, not a query-scope
difference.

## Findings filed

- `C02-full-calendar-month-nav-no-refetch.md` — Month/Cards/Calendar/List views fetch a
  single fixed 3-month window and never refetch or re-scope, so `‹`/`›` produce empty or
  stale months (December 2026 shows 0 of MP's 8 public events). **breaking**
- `C03-full-calendar-drops-boundary-straddling-events.md` — the API filters by
  containment instead of overlap, so a multi-day event vanishes from a month it
  actually occupies. **functional**
- `C08-full-calendar-modal-no-focus-management.md` — the modal declares
  `aria-modal="true"` but never takes focus and traps nothing. **ux**

## Where the new widget is better

Everything here is new capability — the legacy stack has no calendar at all:

- **Six views** off one element (`month`, `grid`, `week`, `list`, `cards`, `calendar`)
  with a shared toolbar, plus `view` and `show-toolbar` as attributes.
- **FullCalendar 7 with real SRI on all four pinned assets**, all four verified to load
  and apply. The `:host` theme-variable block in `full-calendar-styles.ts` correctly
  substitutes for the `palette.css` that cannot work inside a shadow tree — the
  calendar renders with borders, today highlight, event chips and now-indicator.
- **Week title fixed against v7's regression** — v7's own `view.title` reports
  "September 2026" for a `timeGridWeek`; `formatWeekTitle()` restores
  `Sep 6 – 12, 2026` and spells out both months across a boundary.
- **Mini-calendar density dots plus a legend**, and clicking a day filters the cards.
- **Campus and Ministry filter chips** derived from the loaded event set.
- **Detail modal** with description, location, campus, event type and a Register
  hand-off — the legacy finder had no in-place detail at all.
- **Admin enrichment** path (`/api/embed/full-calendar/{id}`) for calendar admins.
- **`Cache-Control: public, max-age=300`** on the events response.

## Not tested / blocked

- **The admin-enriched modal.** `PLAYWRIGHT_MP_PASSWORD`'s user is a non-admin MP OAuth
  user (per BRIEF), so `checkCalendarAdmin()` returns false and
  `GET /api/embed/full-calendar/{id}` is never called. Unblocking needs a test user in
  the calendar-admin user group.
- **`Visibility_Level_ID` semantics beyond 4.** `dp_Visibility_Levels` is
  *"restricted by your organization's administrator"* for our API user
  (`500 User 'apiuser' does not have access to the table`), so the level names could not
  be read. Per-level row counts *were* readable: 1 → 1, 2 → 239, 3 → 0, **4 → 518**,
  5 → 0. Level 4 is clearly the public level (it is the one the legacy finder's events
  live at), which is enough for C03 and C06.
- **A second congregation's events.** MPI has two congregations but only
  `Main Congregation` (id 1) has public events in the window, so "does the calendar drop
  a second congregation's events" could not be answered with real data. The Campus chip
  renders and filters correctly on the one congregation present.
- **All-day events.** `Events` has no all-day flag on MPI and no event in the window has
  midnight-to-midnight bounds, so the all-day render path was not exercised. The
  multi-day path *was*, via the fixture (C03).
- **`.claude/TODO/39` density dots.** Confirmed absent from FullCalendar day cells and
  deliberately **not** filed; no `dayCellDidMount` proposed.

## MP fixture data

`ZZTEST-Multi-Day Retreat` (`Event_ID 760`, 2026-10-30 09:00 → 2026-11-02 17:00,
`Visibility_Level_ID = 4`) was created for check #24–#26 and **deleted** at the end of
the run, along with the two other `ZZTEST-` events. Full inventory and the recreate
recipe are in `event-details.md`. Nothing calendar-related was left behind.

## Screenshots

- `full-calendar-new-initial.png` — baseline, default `month` view (new-only widget, so
  the old-side baseline is `event-finder-old-initial.png`, the data reference)
- `full-calendar-new-month.png` — `month` view, mini calendar + dots + cards + chips
- `full-calendar-new-mobile.png` — 390×844
- `full-calendar-new-grid.png` — `grid` (dayGridMonth), styled, 42 day cells, 13 chips
  (proof the four SRI-pinned assets load *and* apply)
- `full-calendar-new-week.png` — `week`, corrected `Sep 6 – 12, 2026` title
- `full-calendar-new-list.png` / `full-calendar-new-list-view.png` — agenda view
- `full-calendar-new-authed.png` — signed in, identical render
- `full-calendar-new-december-empty.png` — **C02**: title "December 2026", no dots, September cards
- `full-calendar-new-grid-oct-2026.png` — **C03**: the straddling retreat present in October
- `full-calendar-new-grid-nov-2026.png` — **C03**: Nov 1–2 empty, the retreat gone
- `full-calendar-new-event-modal.png` — detail modal
- `full-calendar-new-modal-keyboard.png` — **C08**: modal opened from the keyboard, focus still behind it
