# 32. `<next-full-calendar view="grid|week">` constructs two FullCalendars and leaks one

**Depends on:** nothing. Independent of item 20 — reproduced on `dev` **before**
that fix, with item 20's change stashed out.
**Risk:** low-to-medium — one orphaned FullCalendar instance per widget mount.
It is invisible (the visible calendar is the second one, and it works), but the
orphan keeps its event handlers, its `datesSet`/`events` callbacks and its
detached DOM alive for the life of the page, and `disconnectedCallback` only
ever destroys the *second* one.
**Size:** ~30 minutes.

> Found on 2026-09-07 while writing the regression tests for item 20.
> **Pre-existing**, and not caused by that fix.

## The problem

Mounting `<next-full-calendar view="grid">` (or `view="week"`) creates **two**
`FullCalendar.Calendar` instances, both live. Measured against unmodified `dev`
with a stand-in for the `FullCalendar` global that counts constructions:

```
document.body.innerHTML = '<next-full-calendar api-host="…" view="grid"></next-full-calendar>';
// after the mount settles:
INSTANCES: 2  live: 2
```

Only one of them is bound to the `#nw-fc-mount` that is actually in the shadow
DOM. The other is bound to a mount node that a later `render()` already threw
away, and is never destroyed — `destroyCalendar()` only knows about
`this.calendarInstance`, which by then points at the survivor.

## Cause

`packages/embed-sdk/src/components/full-calendar.ts` initialises the calendar
from two independent entry points, and on a parsed/upgraded element both run:

1. `attributeChangedCallback("view", …)` fires **before** `connectedCallback`
   for attributes present in the markup (and, on upgrade, for every existing
   attribute). `currentView` still defaults to `"month"`, so `view="grid"` is a
   real change and `switchView("grid")` runs its `!wasFC && nowFC` branch:
   `loadFullCalendar()` → `render()` → `initCalendar()` → **instance A**.
2. `connectedCallback()` then reads the same attribute into `currentView`,
   does its own `loadFullCalendar()` → `render()` → `initCalendar()` →
   **instance B**. Its `render()` replaced the mount A was bound to.

Both are async and interleave on the microtask queue, so the ordering is not
even stable — it just happens that B wins today.

`show-toolbar="false"` in the markup does not trigger this (its
`attributeChangedCallback` branch does not construct a calendar when there is
no instance yet), and neither does a non-FullCalendar `view`, where
`switchView()`'s cards branch does no FullCalendar work.

## Fix sketch

`connectedCallback` should be the single initialisation path.
`attributeChangedCallback` should do nothing until the element has connected and
finished its first render — the usual Web Component guard:

```ts
private connectedOnce = false;   // set at the end of connectedCallback
attributeChangedCallback(...) {
  if (!this.connectedOnce) return;   // connectedCallback reads the attributes itself
  …
}
```

`connectedCallback` already reads `view` and `show-toolbar` off the element, so
nothing is lost by ignoring the pre-connection callbacks. Check the other four
widgets for the same shape before settling on the pattern.

Do **not** fix it by making `initCalendar()` destroy an existing instance first
— that hides the double work rather than removing it, and leaves the two
`loadFullCalendar()`/`render()` passes in place.

## Steps

1. Add the "not connected yet" guard to `attributeChangedCallback` and set the
   flag at the end of `connectedCallback` (including the `catch` branch).
2. Confirm `switchView()` is still reached for genuine runtime `view` changes.
3. Tighten `packages/embed-sdk/src/components/full-calendar.test.ts`: it
   currently counts *instances bound to the current mount* precisely because of
   this bug (see the comment on `expectLiveCalendar`). Once fixed, assert
   `liveInstances()` overall — one calendar, full stop — and drop that comment.
4. Grep the other widgets (`user-menu`, `add-to-calendar`, `profile`,
   `my-invoices`) for an `attributeChangedCallback` that duplicates
   `connectedCallback` work.

## Testing

- The stand-in-`FullCalendar` harness in
  `packages/embed-sdk/src/components/full-calendar.test.ts` already has
  everything needed: assert `FakeCalendar.instances` has length 1 after a mount
  with `view="grid"` and with `view="week"`.
- Browser: mount the demo page, and confirm from the console that removing the
  element runs `destroy()` with nothing left behind.
- Standard verification gate.

## Done when

`<next-full-calendar view="grid">` and `view="week"` each construct exactly one
`FullCalendar.Calendar`, `disconnectedCallback` destroys it, and the test file
asserts the total live count rather than the per-mount count.
