# C68. No `customCss` and no domain custom-styles channel — a church cannot restyle any `next-*` widget at all

**Widget:** all 25 `next-*` elements (old: all 36 `mpp-*` widgets)
**Severity:** functional
**Confidence:** confirmed — the legacy mechanism was read out of the bundles; the absence in this repo is a whole-tree grep. No browser used.
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

**Every one of the 36 legacy widgets reads `customCss`** — it is the one attribute
universal across the catalogue. And it is only half of the story: legacy widgets have
**two** styling channels, both verified in `setStyleFiles()` in
`https://mpi.ministryplatform.com/widgets/dist/MyGiving.js` (identical code in every
bundle):

```js
this.customCssUrl = this.getAttribute("customCss");
// 1. domain-level, automatic, no markup required:
e.GetCustomStyles().then(t => t.forEach(url => {
  const link = document.createElement("link");
  link.rel = "stylesheet"; link.href = url;
  this._baseRoot.appendChild(link);           // appended into the shadow root
}));
// 2. per-element override:
if (this.customCssUrl) {
  const link = document.createElement("link");
  link.rel = "stylesheet"; link.href = this.customCssUrl;
  this._baseRoot.appendChild(link);
}
```

1. `GET /Api/ConfigurationApi/GetCustomStyles` returns the **domain's** configured
   stylesheet URLs and each is appended into every widget's shadow root automatically —
   which is how MP's own sample site brands its widgets
   (`_DomainData/mpi.ministryplatform.com/skins/default/…`).
2. Then `customCss="https://church.org/mp-widgets.css"` on an individual element appends a
   second sheet, so one page can look different from another.

Both append, so a church's rules land *after* the widget's own and win on equal
specificity.

## New behaviour

**Neither channel exists.**

- No `customcss` / `custom-css` attribute anywhere: `grep -rn 'custom-css|customCss|customcss'
  packages/embed-sdk/src` → no matches.
- No CSS-variable theming surface: **zero** `var(--…)` uses across all
  `packages/embed-sdk/src/components/*.ts`. (The `--fc-classic-*` names in
  `full-calendar-styles.ts` are declarations feeding FullCalendar's own internals, not a
  published contract for host pages.)
- No `part=` / `exportparts` on any element, so `::part()` is not available either.
- And the shadow root is closed to additions after the fact —
  `MPNextWidget.injectStyles()` (`packages/embed-sdk/src/shared/base-widget.ts:113-119`)
  **assigns** rather than appends:

```ts
this.root.adoptedStyleSheets = [sheet];
```

so even a host page that walked into the open shadow root and pushed a sheet would have it
replaced on the next render.

`public/embed-sdk/mp-widget-overrides.css` is not a counter-example: it is injected into
**MP's** shadow-DOM widgets via their `customcss` attribute (the `<mpp-user-login>` that
`next-user-menu` mounts). It styles the legacy widget, using the very mechanism the new
widgets lack.

## Why it matters

Like C67, this lands on **every** customer rather than some, and for the same structural
reason: Shadow DOM. A church whose brand is not `#004C97` blue and `#F1BE48` gold has no
supported way to change a single colour, font, spacing value or border on any new widget —
not an attribute, not a CSS variable, not a `::part()`, not a host-page rule, not even a
hack. On the legacy stack it configured one domain stylesheet and every widget matched the
site. "Looks nothing like our website and cannot be made to" is a cutover blocker, and it
is the kind of objection that surfaces during a sales conversation rather than a bug
report.

## Evidence

- Legacy mechanism: `setStyleFiles()` in `/widgets/dist/MyGiving.js`; the
  `"/Api/ConfigurationApi/GetCustomStyles"` endpoint string in the same bundle;
  `getAttribute("customCss")` present in **all 36** `/widgets/dist/*.js` bundles
- Legacy in use: the sample shell links
  `_DomainData/mpi.ministryplatform.com/skins/default/simple-grid.min.css`
- Absence in this repo: `grep -rn 'custom-css|customCss|customcss' packages/embed-sdk/src`
  → nothing; `var(--` count in `packages/embed-sdk/src/components/*.ts` → 0;
  `grep -rn 'part=|exportparts' packages/embed-sdk/src` → nothing
- Closed to additions: `packages/embed-sdk/src/shared/base-widget.ts:113-119`
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` section 4.18

## Where to fix

- `packages/embed-sdk/src/shared/base-widget.ts` — `injectStyles()` (:111-125) and a new
  `custom-css` attribute handled once for every widget
- optionally `src/app/api/embed/` — a `GetCustomStyles` equivalent, if domain-level
  styling should be automatic as it is on legacy

## Suggested fix

Two independent pieces, and the first is small enough to do now:

1. **Per-element `custom-css`.** In `base-widget.ts`, read `custom-css` and append a
   `<link>` to the shadow root after `injectStyles()` runs, and change `injectStyles()` to
   *push onto* `adoptedStyleSheets` rather than assign, so the host sheet survives
   re-renders and lands last. Note this is an author-controlled URL fetched into the page —
   `cdn-loader.ts` already establishes the house pattern of `integrity` +
   `crossOrigin="anonymous"` for external assets, so consider whether an optional
   `custom-css-integrity` belongs here too; that is a security call, not mine to make.
2. **A theming token contract** — publish a documented set of `--nw-*` custom properties
   (they pierce Shadow DOM, unlike selectors) covering the brand palette, radius, font
   stack and spacing scale, so most churches never need a stylesheet. This is the larger
   change and should be designed once across all 25 widgets rather than per widget.

If domain-level automatic styling is judged out of scope, record that in the migration
notes, because it is the piece a legacy church gets for free today.
