# 7. FullCalendar 6→7 (CDN runtime dep)

**Depends on:** nothing.
**Risk:** **high** — attempted 2026-09-07 and **abandoned**. This is not a
version bump; it is a rewrite of the FullCalendar integration.
**Size:** was "small diff + visual QA". Actually **1–2 days**, and it forces a
visual-design decision.

## Status: attempted 2026-09-07, not merged — do not simply retry

The bump was applied end to end (`FC_VERSION` → `7.1.0`, `FC_SRI` recomputed,
moved CDN path) and browser-tested against live MP data at
`http://localhost:5173/demo-full-calendar.html`. **The `grid` and `week` views
lose every piece of their styling**, and the fix is not a few selectors. The
tree was restored to `6.1.21`; only this document changed.

6.x is still maintained (`6.1.21` is current on the `6` line) and nothing about
`7.1.0` fixes a bug we have. **Staying on 6.1.21 is the correct outcome until
someone budgets the port below.**

## Current state (unchanged)

`packages/embed-sdk/src/components/full-calendar.ts:23-31`:

```ts
const FC_VERSION = "6.1.21";
const FC_SRI = "sha384-WDvnzcla8X1CQM97EnYyl4OoTCvmMFp5lBiVNO3IjVdvLMOUjwt+iuYb/Mru5A9v";
const FC_CDN_BASE = `https://cdn.jsdelivr.net/npm/fullcalendar@${FC_VERSION}`;
```

`FC_CDN_BASE` is consumed once, at `full-calendar.ts:129`:

```ts
await loadScript(`${FC_CDN_BASE}/index.global.min.js`, FC_SRI);
```

> **Bumping `FC_VERSION` REQUIRES recomputing `FC_SRI`** (added in item 10, done).
> The script tag carries `integrity` + `crossOrigin="anonymous"`, so a new
> version with the old hash is *blocked by the browser* — `week`/`grid` render
> "Failed to load calendar library." Recompute in the same commit as the bump.

## What was measured on 2026-09-07

### The two constants, if someone retries

For `7.1.0` the path **moves** and the hash is:

```
url:  https://cdn.jsdelivr.net/npm/fullcalendar@7.1.0/all/global.js
sri:  sha384-yWkgABI02aCf8JCYAEQvzSyenUdhkerT0PnFLYOT4ldOYQiZIjZBE0gyAUfNbnRx
```

`index.global.min.js` **404s on v7** — v7 renamed it to `all/global.js`
(upstream: "`/all.global.js` -> `/all/global.js`"). There is **no published
minified global bundle in v7**: `all/global.js` is 863,866 bytes unminified,
and `all/global.min.js` returns 200 only because jsDelivr auto-minifies it on
the fly — i.e. exactly the CDN-generated-bytes trap written up in item 15. Use
`all/global.js`. Its jsDelivr bytes hash identically to the npm tarball's own
`package/all/global.js`, so the hash above covers author-published bytes.

### Verified non-blockers (so nobody re-investigates them)

- **`window.FullCalendar` still exists** and `new FullCalendar.Calendar(el, opts)`
  still works. `all/global.js` is an IIFE assigning `var FullCalendar`.
  `window.FullCalendar.version === "7.1.0"`.
- **`initialView: "dayGridMonth" | "timeGridWeek"` unchanged.** `fcViewMap` is fine.
- **The `temporal-polyfill@^1.0.1` peerDependency does not apply to the global
  bundle.** The bundle ships its own shim and branches on
  `globalThis.Temporal ? native : shim`. No second script needed.
- **No SRI failure.** With the hash above, zero "Failed to find a valid digest"
  console errors and no "Failed to load calendar library." text on any view.
- **Dates and times are correct under v7.** Verified against MP source rows
  (`Events` 16 / 214 / 372 / 215 / 373 — `2026-09-01T09:00:00`,
  `2026-09-05T18:05:00`, `2026-09-06T10:00:00`, `2026-09-12T18:05:00`,
  `2026-09-13T10:00:00`) under **three** browser time zones (`UTC`,
  `America/New_York`, `Australia/Sydney`). v7 renders `9:00am`, `6:05pm`,
  `10:00am`, `6:05pm`, `10:00am` in all three — byte-identical to v6 and to MP's
  wall-clock values. **There is no off-by-one-day regression.** v7 still parses
  the naive `Event_Start_Date` string as local time, so the wall-clock semantics
  the widget relies on are preserved.
- **The four non-FullCalendar views are untouched.** `month`, `list`, `cards`,
  `calendar` are rendered by `full-calendar-cards.ts` / `-list.ts` / `-mini-cal.ts`
  and never call into the library. They rendered identically on v7.

### The blocker: v7 deletes the entire styling contract

Three findings, each of which alone kills the drop-in bump.

**1. v7 ships no CSS in the bundle.** v6's `index.global.min.js` injects a
`<style>` into `<head>`, which is the whole basis of
`adoptCalendarStyles()` (`full-calendar.ts:194-204`) — it clones every
`head style` whose text contains `.fc`/`fc-` into the Shadow DOM. Under v7 that
query returns **0 elements** (`createElement("style")` count in `all/global.js`:
zero). `grid` renders as a **flat vertical list of unstyled text** — no grid, no
columns, no borders. v7 requires three external stylesheets:

```
/skeleton.css
/themes/<name>/theme.css
/themes/<name>/palette.css        (monarch/forma/breezy/pulse use palettes/<color>.css)
```

`injectExternalCSS()` (`shared/cdn-loader.ts`) exists but has **no `integrity`
parameter** — its docstring explicitly says to add one "alongside the first real
caller." This would be that caller, so item 10's SRI invariant has to be
extended to `<link>` before this ships.

**2. The theme is a separate plugin + a separate script.** `all/global.js`
exports only `Calendar, CalendarController, DayGrid, Interaction,
JsonRequestError, List, MultiMonth, Preact, PreactJSXRuntime, ProtectedApi,
ProtectedStyles, Shared, TimeGrid, formatDate, formatRange, globalLocales,
globalPlugins, joinClassNames, sliceEvents, version` — **no theme.** Each theme
is its own CDN global (`/themes/classic/global.js`, `/themes/monarch/global.js`,
…) that must be loaded and registered. So the widget goes from *one* pinned,
SRI-checked script to **two scripts + three stylesheets**, five pinned URLs with
five hashes to maintain per bump.

**3. `fc-*` class names no longer exist — they are build-generated hashes.**
This is the one that makes it a rewrite rather than a port. Upstream: "you
cannot style an `fc-*` class-name like `.fc-event` because FullCalendar's
default DOM no longer includes them." Measured in the Shadow DOM on v7:

| selector (used by our CSS/JS) | nodes on v6 | nodes on v7 |
|---|---|---|
| `.fc-daygrid-day-number` | >0 | **0** |
| `.fc-event` | >0 | **0** |
| `.fc-button` | >0 | **0** |
| `.fc-day-today` | >0 | **0** |
| `.fc-col-header-cell-cushion` | >0 | **0** |
| `.fc-timegrid-now-indicator-line` | >0 | **0** |
| `.fc-popover` / `.fc-popover-header` | >0 | **0** |
| `.fc-list-event-dot` / `.fc-daygrid-event-dot` | >0 | **0** |
| `.fc-toolbar-title` | >0 | **0** |
| `.fc-daygrid-day-frame` | >0 | **0** |

What v7 actually emits is `fc-pp`, `fc-1q`, `fc-vg`, `fc-DP`, `fc-Fk`, `fc-Q3`,
… — minifier output, **not a stable public API**, so they cannot be targeted
even as a stopgap; a patch release would re-break them.

Consequences in this repo:

- **All 23 `.fc-*` rules in `full-calendar-styles.ts` are dead** (lines ~68-225):
  the `#004C97` toolbar buttons, the today highlight, event chips, the
  now-indicator line/arrow, column headers, the "+N more" popover, and the
  mobile breakpoint overrides. The calendar loses the brand entirely and
  inherits whichever upstream theme is chosen.
- **`addDensityDots()` silently stops working.** It appends to
  `.fc-daygrid-day-frame` (`full-calendar.ts:288-291`); zero matches on v7 →
  `.nw-fc-density-dots` count measured **0** on `grid`/`week` under v7 vs 10 on
  the mini-cal views. No error is thrown — the feature just disappears. Its hook
  `dayCellDidMount` was also renamed upstream.
- **`eventColor: "#004C97"` changes meaning** — in v7 it applies to *background*
  events only; `eventBackgroundColor`/`eventBorderColor` collapsed into
  `eventColor` and `eventTextColor` became `eventContrastColor`. The per-event
  `color` returned by `getEventColor(Event_Type_ID)` (`full-calendar.ts:376-386`)
  needs re-mapping.
- **`datesSet` title format changed.** On `week`, v6 reports
  `"Sep 6 – 12, 2026"`; v7 reports `"September 2026"`. `updateToolbarTitle()`
  gets a visibly worse title on the week view.

Other renames noted upstream but not individually exercised, since the above
already blocks: `*ClassNames` → `*Class` (plural→singular, e.g.
`eventClassNames` → `eventClass`), render-hook arg types `*Data` → `*Info`,
`.updateSize()` removed (not used here), `createPlugin()` no longer needed,
`headerToolbar` now off by default (we already pass `false`).

### Evidence

Screenshots captured during the attempt (not committed):
`v6-grid.png`, `v6-week.png` (baseline, correct);
`v7-grid-nocss.png` (v7 straight bump — unstyled vertical text list);
`v7-grid-withcss.png`, `v7-week-withcss.png` (v7 + `skeleton.css` +
`themes/classic/*.css` — layout returns, but no borders, no today highlight,
no event chips, no brand colour, no now-indicator).

## What a real v7 port needs

1. **Pick a theme.** `classic`, `monarch`, `forma`, `breezy`, `pulse`. This is a
   design decision about how `next-full-calendar` should look on church sites —
   not something to decide inside a dependency-bump branch.
2. **Add `integrity` support to `injectExternalCSS()`** and pin + hash all five
   URLs (2 scripts, 3 stylesheets), keeping them next to `FC_VERSION` the way
   item 10 established.
3. **Rebuild the brand styling through v7's hook settings** (`eventClass`,
   `dayCellClass`, `*Content`, and the theme's CSS custom properties) instead of
   `.fc-*` selectors, and delete the dead rules from `full-calendar-styles.ts`.
4. **Re-implement the density dots** on v7's renamed day-cell hook, without
   depending on `.fc-daygrid-day-frame`.
5. **Re-map event colours** for the new `eventColor`/`eventContrastColor`
   semantics.
6. **Fix `updateToolbarTitle()`** for the new `view.title` on `timeGridWeek`.
7. Re-run the full visual QA below.

## Steps (unchanged, for whoever does the port)

1. `pnpm build:sdk`, then verify the pinned version **and** the new hash landed:
   `grep -o "fullcalendar@[0-9.]*\|sha384-[A-Za-z0-9+/=]*" public/embed-sdk/next-embed.*.es.js`
   (grep the freshly **hashed** bundle — see item 16.)
2. **Visual QA** via `pnpm test:widget` (http://localhost:5173,
   `demo-full-calendar.html`) against a live MP domain. Exercise every value of
   `ViewType`: `month`, `grid`, `week`, `list`, `cards`, `calendar` — plus
   `showToolbar` and the admin branch (`isAdmin`). Note the demo's View `<select>`
   has no `grid` option (item 21) — set the attribute from the console.
3. Re-check date rendering under at least two zones and diff against the MP rows.
   The harness used on 2026-09-07 was a throwaway Playwright script driving
   `chromium.launch()` + `newContext({ timezoneId })` over the running demo.

## Done when

All six views render correctly against live MP data **with the brand styling
intact**, `FC_SRI` (and every other pinned hash) matches freshly computed
values, the browser console shows no "Failed to find a valid digest" error on
`week`/`grid`, event dates match MP's wall-clock values under a non-UTC `TZ`,
and the standard verification gate passes.
