# 20. Toggling `show-toolbar` blanks the `grid`/`week` calendar

**Depends on:** nothing. Independent of item 7 — reproduced on the shipping
`fullcalendar@6.1.21` pin, and again on the abandoned 7.1.0 attempt.
**Risk:** medium — a host page that flips the attribute at runtime (responsive
layout, a "compact mode" switch, a CMS re-render) ends up with an empty widget
and **no error anywhere**.
**Size:** ~30 minutes.

## The problem

Found on 2026-09-07 while browser-testing item 7. Measured in the Shadow DOM of
`<next-full-calendar>` on `http://localhost:5173/demo-full-calendar.html`:

| step | shadow-root text length | `#nw-fc-mount` children |
|---|---|---|
| `view="grid"` | 610 | 1 |
| then `show-toolbar="false"` | **0** | **0** |

The calendar disappears completely — blank widget, no console error, no
`fullCalendarError` event. Same on `view="week"`. `cards` and the other
non-FullCalendar views are **not** affected (they re-render fine).

Setting `show-toolbar="false"` as an **initial** attribute is fine — a fresh
`<next-full-calendar view="grid" show-toolbar="false">` renders correctly
(text length 493, mount children 1). Only the runtime *toggle* breaks it.

## Cause

`packages/embed-sdk/src/components/full-calendar.ts`, `attributeChangedCallback`:

```ts
} else if (name === "show-toolbar") {
  this.showToolbar = next !== "false";
  this.render();
  this.rebuildCurrentView();
}
```

`render()` does `container.innerHTML = this.renderInner()`, which **replaces the
`#nw-fc-mount` element** the live FullCalendar instance is attached to. The
instance keeps a reference to the now-detached node.

`rebuildCurrentView()` then does:

```ts
if (this.needsFullCalendar()) {
  if (this.calendarInstance) {
    this.calendarInstance.render();   // re-renders into the DETACHED element
  }
} else {
  this.renderCardsOrCalendarView();
}
```

so FullCalendar happily re-renders into the orphaned div and the fresh, empty
`#nw-fc-mount` in the DOM stays empty. Nothing throws, which is why this has
gone unnoticed.

Contrast `switchView()`, which gets this right: it calls `destroyCalendar()`
before `render()` and `initCalendar()` after.

## Fix

In the FullCalendar branch of `rebuildCurrentView()`, treat the mount as
replaced: `destroyCalendar()` before the `render()` that wiped it, then
`adoptCalendarStyles()` + `initCalendar()` against the new `#nw-fc-mount` —
i.e. the same sequence `switchView()` already uses. Re-binding the existing
instance is not enough; FullCalendar has no supported "re-attach to a new
element" call.

Keep the non-FullCalendar branch as is.

## Steps

1. Change the `needsFullCalendar()` branch of `rebuildCurrentView()` to
   destroy + re-init rather than `calendarInstance.render()`.
2. Check the other `rebuildCurrentView()` call site (the `view` attribute path
   already routes through `switchView()`, so `show-toolbar` is the only caller
   that can hit this).
3. Browser-test on `demo-full-calendar.html`: on `grid` **and** on `week`,
   toggle the demo's Toolbar select Show → Hide → Show and confirm the calendar
   survives all three states with events still rendered. Repeat with the
   attribute set from the console (the demo's View select has no `grid`
   option — see item 21).
4. Confirm no regression to `switchView()` (Month → Grid → Week → List → Cards
   → Calendar round trip).

## Done when

Toggling `show-toolbar` on `grid` and `week` keeps the calendar rendered with
its events, and the standard verification gate passes.
