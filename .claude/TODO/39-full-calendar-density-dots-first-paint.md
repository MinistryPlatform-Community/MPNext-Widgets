# 39. Density dots never appear on the first paint of `week`

**Depends on:** nothing.
**Risk:** none — a missing decoration, not a fault. No throw, no console output.
**Size:** ~1 hour, most of it deciding whether the feature is wanted at all.

## Not a FullCalendar 7 regression

Filed while doing item 7 (FullCalendar 6→7) on 2026-09-08. Item 7's file
asserted that `addDensityDots()` "silently stops working" under v7 because it
appended to `.fc-daygrid-day-frame`, a class v7 does not emit. Half of that was
right — the class lookup could never match on v7, and it is gone; the hook now
appends to the element it is handed, which is the `role="gridcell"` day cell.

But the dots were **already absent on the first paint under 6.1.21**, for a
reason that has nothing to do with the library version, and the port did not
change it either way. Measured on v7 after the port, `America/New_York`, live MP
data:

| step | `.nw-fc-density-dots` |
|---|---|
| mount `view="week"` (first paint) | **0** |
| switch to `grid` | 0 (by design — the `currentView !== "grid"` guard) |
| switch back to `week` | **2** |

So the mechanism works. What fails is the ordering.

## Why

`initCalendar()` constructs the calendar and calls `calendarInstance.render()`.
`dayCellDidMount` fires **synchronously during that render** — 7 times on
`timeGridWeek` (the all-day row), 42 times on `dayGridMonth` — and
`addDensityDots()` reads `this.eventCountsByDate`:

```ts
const count = this.eventCountsByDate[key] || 0;
const dotCount = getDensityDotCount(count);
if (dotCount === 0) return;      // <- always taken on first paint
```

`eventCountsByDate` is only populated by `fetchEvents()`, which FullCalendar
invokes **asynchronously** through the `events` option, strictly after the
render that already mounted every day cell. On the first paint the map is `{}`,
so every cell scores 0 and returns early. On a later `changeView()` the map is
warm from the previous fetch, the cells re-mount, and the dots appear — which is
exactly the table above.

This is why the count was 0 in item 7's v7 measurement *and* would have been 0
in the same measurement on 6.1.21. It was read as a v7 breakage; it is a
first-paint race that predates the port.

## Decide first: is this feature wanted on `week` at all?

`week` is a `timeGridWeek`, where every event is already drawn as a positioned
block with its time — the density dots duplicate information the view shows
directly. `grid` is explicitly excluded for that reason
(`// grid view already shows events`). The dots exist to make the **mini
calendar** views (`month` / `calendar`, rendered by `full-calendar-mini-cal.ts`,
a separate path that runs after data loads and shows 10 dots correctly) legible
at a glance, and that is where they earn their place.

Two honest outcomes:

1. **Drop it.** Delete `addDensityDots()` and the `dayCellDidMount` option from
   `initCalendar()`. The mini-cal path keeps its own dots; nothing else calls it.
   This is the recommended option — it deletes a feature that has never once
   rendered on its intended view.
2. **Make it fire after the fetch.** Keep it and re-apply once counts exist.

## If option 2

Do **not** re-`render()` the whole calendar to re-run the hook. The day cells
carry `data-date="YYYY-MM-DD"` — a stable v7 attribute, unlike the class names
(`fc-classic-wsy fc-1h fc-MA …`, build-generated hashes, not a public API). So
after `fetchEvents()` resolves, walk `#nw-fc-mount [data-date]` in the shadow
root and apply the dots directly, keying off the attribute rather than the hook:

```ts
// after this.eventCountsByDate = buildEventCountMap(events)
if (this.needsFullCalendar() && this.currentView !== "grid") {
  for (const cell of this.root.querySelectorAll<HTMLElement>("#nw-fc-mount [data-date]")) {
    const key = cell.dataset.date;
    if (key) this.addDensityDotsForKey(key, cell);
  }
}
```

`addDensityDots()` currently takes a `Date` and derives the key with
`toDateKey()`; splitting the key-taking half out is what makes it callable from
both the hook and this pass. It already removes an existing `.nw-fc-density-dots`
before appending, so running it twice on a cell is safe.

## Steps

1. Decide 1 or 2 above.
2. If 2: verify on both `week` first paint *and* after a `grid` → `week` switch,
   so the double-apply path is exercised.
3. Add a test. `full-calendar.test.ts` already drives the FullCalendar options
   directly — `liveInstances()[0].options.events(...)` then
   `dayCellDidMount(...)` — which is how the existing dot test reaches a warm
   count map, and a first-paint test is the same two calls in the other order.

## Done when

Either the feature is gone and no code path references it, or dots appear on the
first paint of `week` as well as after a view switch, with a test that fails in
the pre-fix ordering. Standard verification gate passes.
