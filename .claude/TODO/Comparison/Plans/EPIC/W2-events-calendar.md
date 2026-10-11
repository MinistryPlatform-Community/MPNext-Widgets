# W2: Events & calendar (wave 1)

**Branch:** `ws/w2-events` · **Items:** C02 · C03 · C04 · C05 · C06 · C07 · C08 · C09
**Design source:** `Plans/full-calendar.md`, `Plans/event-finder.md`, `Plans/event-details.md`, `Plans/add-to-calendar.md`
**Owns:** `full-calendar*.ts`, `event-finder.ts`, `event-details.ts`, `add-to-calendar.ts` ·
`fullCalendarService.ts`, `addToCalendarService.ts`, the event-finder service · their routes and
tests · the `events.ts` locale namespaces · the matching demo pages.
**Not owned:** `eventDetailsService.ts` belongs to W1 because of C01, so don't touch it. C07 is
fixed in the component.

**Status at 2026-10-11:** all open.

## Order

1. **C06: public-only add-to-calendar.**
   - Fix: `addToCalendarService.ts:52-58` adds `Cancelled = 0 AND Visibility_Level_ID = 4`.
   - Extract the predicate as `publicEventFilter()` (an exported constant or function in the
     events services) and use it at `fullCalendarService.ts:124` and `:217`. Line `:217` is
     missing `Cancelled = 0`, which is a sweep finding.
   - Sweep: audit every `src/app/api/embed/*` route that reads `Events` under a public token
     and record the result in C06's resolution.
   - Test: a `Visibility_Level_ID = 2` id returns null; so does a cancelled id.
   - Correction: `eventDetailsService` reads through `api_MPPW_GetEventById`, so there is no
     `$filter` to "mirror" there.
2. **C03: overlap, not containment.**
   - At `fullCalendarService.ts:124`, change the filter to `Event_Start_Date < end AND Event_End_Date >= start`.
   - Datetimes go through `DomainTimezoneService.toMpSqlDatetime`.
   - Add a multi-day straddling fixture test. Live data lacks one, which is why it survived.
3. **C02: refetch on navigation, plus `cards-scope`.**
   - `full-calendar.ts:486-525` fetches a fixed window. Derive the range from `miniCalMonth`,
     padded to whole weeks.
   - Wire the toolbar prev/next/today handlers (`:658-692`) and both mini-calendar
     `onMonthChange` sites (`:749-752`, `:861-864`) to await a fetch.
   - Cache results per range.
   - Scope `displayEvents` to the displayed month so the header and list can't disagree.
   - Add `cards-scope="month|rolling"` (default `month`). In `rolling` mode, hide or relabel
     the month toolbar.
   - Adopt the W0 reconfigure convention. Today's `connectedOnce` guard is a C39 variant.
4. **C08: modal focus.**
   - `full-calendar-modal.ts:115-117`: adopt W0 `dialogFocus()`.
   - Have `showEventModal` (`full-calendar.ts:542-590`) capture the trigger.
5. **C05: cards.** At `event-finder.ts:357`, switch to W0 `cardLink()` and remove the
   `role="link"` div plus its click-only handler (`:216-223`). Keep emitting the
   `*Selected` event.
6. **C04: Featured filter.**
   - Add a Featured checkbox to the Advanced grid (`event-finder.ts:292-317`), and read it in
     `readFormState` (`:226-237`).
   - The `featured` attribute seeds the checkbox.
   - The `eventFinder.featured` key already exists.
7. **C09: year on cards.**
   - Show the year when it differs from the current year. The `weekdayShort` preset at
     `formatters.ts:62` has none.
   - Prefer a component-level choice between `weekdayShort` and `weekdayMedium` over editing
     `formatters.ts`, which belongs to W0.
   - Remove the "C09 tracks…" comment at `:346-348`.
8. **C07: no anonymous basic-contact churn.**
   - Gate `loadBasicContact()` (`event-details.ts:356, 388-407`) on
     `this.authSession.isAuthenticated()`.
   - `base-widget.ts`'s refresh-on-401 is W0 territory. If it still double-fires for a public
     token after the gate, report it rather than edit it.
   - Adopt W0 reconfigure. The `event-id && this.event` guard is the C39 variant.

## Protect
- Event-finder 34/34 data parity.
- `next-add-to-calendar` value parity across all five formats. Its existing tests must pass
  untouched after the `dialogFocus` move in W0.
- FullCalendar 7 SRI table: don't bump `FC_VERSION`. Style only through `--fc-classic-*`,
  never `.fc-*`.

## Stale-plan corrections
- `formatDateRange()`/`dateFmt` no longer exist. Dates go through `this.fmt.dateRange`.
- Line numbers are listed above.
- For copy, edit the catalogue in all three locales.

## Acceptance
- The acceptance criteria in each design-source plan.
- Every finder result opens with Enter and with Ctrl-click.
- December shows December's events.
- A three-day retreat that crosses a range boundary appears.
- Non-public and cancelled ids return 404 from add-to-calendar.
- Epic gates pass.
