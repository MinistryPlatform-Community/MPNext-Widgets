# 21. `demo-full-calendar.html` cannot select the `grid` view

**Depends on:** nothing.
**Risk:** none in production — demo page only.
**Size:** ~5 minutes.

## The problem

`ViewType` in `packages/embed-sdk/src/components/full-calendar.ts:33` has six
values:

```ts
type ViewType = "month" | "grid" | "week" | "list" | "cards" | "calendar";
```

and the widget's own toolbar renders a button for all six (Month / Grid / Week /
List / Cards / Calendar). But the demo page's control `<select id="view-select">`
(`packages/embed-sdk/demo-full-calendar.html`) offers only five:

```html
<option value="cards">Cards</option>
<option value="list">List</option>
<option value="month">Month</option>
<option value="week">Week</option>
<option value="calendar">Calendar</option>
```

`grid` is missing — and `grid` is one of the **two views that actually mount
FullCalendar** (`needsFullCalendar()` returns true for `week` and `grid` only).

## Why it matters

`pnpm test:widget` is the documented way to QA this widget, and the demo's
controls are the obvious way to drive it. Anyone doing the visual QA that items
7 and 20 call for has to notice the gap and drive the attribute from the
console instead (`document.getElementById('main-calendar').setAttribute('view','grid')`).
Both of those items had to work around it on 2026-09-07.

Note the widget's in-shadow toolbar *does* expose Grid, so it is reachable by
clicking — but only when `show-toolbar` is on, and the demo's Toolbar control
can turn it off, at which point `grid` becomes unreachable from the page
entirely.

## Steps

1. Add `<option value="grid">Grid</option>` to `#view-select`, ordered next to
   Month/Week so the list reads in the same order as the widget's toolbar.
2. While there: the demo's default `<option>` is `cards`, but the widget's own
   default `currentView` is `month`, so the select disagrees with what is on
   screen until the first Apply. Make the select's initial selection match the
   widget default.

## Done when

All six `ViewType` values are selectable from `demo-full-calendar.html`, the
select's initial value matches the widget's initial view, and the standard
verification gate passes.
