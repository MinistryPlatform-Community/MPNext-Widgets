# C67. All `next-*` widget copy is hardcoded English — there is no equivalent of MP's `GetLabels`, so churches lose every label override and all localisation

**Widget:** all 25 `next-*` elements (old: all 36 `mpp-*` widgets)
**Severity:** functional
**Confidence:** confirmed — the legacy mechanism was read out of the bundles; the absence in this repo is a whole-tree grep. No browser used.
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

**Legacy widgets contain almost no English.** Every label is fetched at render time from

```
GET /Api/ConfigurationApi/GetLabels?componentName=<tag>
```

and interpolated as `${this._i18n.<key>}` / `${t.<key>}` into the widget's template. The
evidence is how little text the bundles hold: `EventFinder.js` (123 KB) contains exactly
**two** label identifiers of its own (`showAdvancedSearchLabel`, `hideAdvancedSearchLabel`)
and both are i18n *keys*, not strings. Across the paired bundles the only hardcoded
English found at all is `value="Login"` (MyInvoices, Subscriptions, OnlineDirectory) and
`value="Close"` (OnlineDirectory).

Two capabilities follow from that, and churches use both:

1. **Label overrides.** A church renames "Group Finder" to "Find a Small Group", or
   "Opportunities" to "Serve", in MP's Application Labels — once — and every widget picks
   it up. (`mpp-user-label`, the legacy widget with no counterpart filed as C77, exists
   solely to render one of those labels standalone, which shows how central the mechanism
   is.)
2. **Localisation.** `<mpp-locale-selector>` — on **every page** of MP's own sample site,
   and the legacy widget filed as C73 — switches the locale, and `GetLabels` returns the
   translated set. The `mpp-smart-link` on `/widgets/giving.aspx` even forwards
   `{{userLocale}}` to the payment vendor.

## New behaviour

Every string in every `next-*` widget is a literal in the component source. There is no
label mechanism at all:

- no `GetLabels`-equivalent route: `src/app/api/embed/` has 27 route directories and none
  of them serves labels
- no `labels`/i18n fetch in `packages/embed-sdk/src/` — the only `labels` hits in the tree
  are CSS class names (`.ed-labels`, `.od-labels`) and event-attribute chips
- no locale concept anywhere in the SDK

Copy is written inline, e.g. `packages/embed-sdk/src/components/online-directory.ts:367-368`:

```html
<p>Please sign in to view the directory.</p>
<button class="nw-od-btn" data-action="login">Sign In</button>
```

That is also the one label difference visible without a browser: legacy says **"Login"**,
new says **"Sign In"**.

The one near-miss is `next-online-directory`, which does pull a few strings from
`/api/embed/online-directory/config` (`householdPrefix`, `minimumSearchLength` —
`online-directory.ts:177-184`). So the *pattern* exists in one widget; it is not a shared
capability.

## Why it matters

This lands on **every** customer, not some, and Shadow DOM means the host page cannot work
around it: a church cannot restyle the text away, cannot translate it with a page-level
i18n library, and cannot reach into the shadow root to rewrite it. Any church running a
non-English or bilingual site — MP ships a locale selector on its own sample site, so this
is a supported configuration, not an edge case — cannot migrate at all. Every church that
has renamed a widget's vocabulary to match its own ministry names silently loses those
renames on migration, and gets this repo's wording instead.

Note this is a *separate* gap from C68 (no `customCss`), and they compound: a church can
change neither the words nor the styling of a new widget.

## Evidence

- Legacy mechanism: `GetLabels` endpoint string and the `${this._i18n.…}` interpolations in
  `https://mpi.ministryplatform.com/widgets/dist/MyGiving.js` and
  `/widgets/dist/EventFinder.js`; endpoint list extracted from `MyGiving.js` includes
  `"/Api/ConfigurationApi/GetLabels?componentName="`
- Legacy locale surface: `<mpp-locale-selector>` present on all 21 sample pages;
  `{{userLocale}}` merge token on `/widgets/giving.aspx`
- Unauthenticated `curl` of `GetLabels?componentName=mpp-event-finder` returns
  `500 "Object reference not set to an instance of an object."` — it needs the CSRF/session
  headers MPWidgets.js establishes, which is **why capturing legacy copy requires a
  browser** (recorded in CONFIG-MAP.md section 6)
- Absence in this repo: `ls src/app/api/embed/` (27 dirs, no labels);
  `grep -rn 'GetLabels|getLabels' packages/embed-sdk/src src` → no matches
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` section 6

## Where to fix

- a new `src/app/api/embed/labels/route.ts` + `src/services/` reader over MP's
  Application Labels / `GetLabels` equivalent
- `packages/embed-sdk/src/shared/base-widget.ts` — a shared label-resolution helper so
  every widget goes through one path (the natural home, next to the token plumbing)
- all 25 `packages/embed-sdk/src/components/*.ts` — replace literals with label lookups

## Suggested fix

This is a large, cross-cutting change and almost certainly a roadmap item rather than a
patch, so the useful first step is deciding the *contract*, not writing the code: one
endpoint returning a flat key→string map per widget, fetched once per page (like
`AuthSession` fetches `/api/embed/auth/config` once) and shared across widgets, with the
in-source literal as the fallback when a key is absent. Doing it that way means widgets can
be converted one at a time and nothing regresses while the conversion is partial.

If full parity is out of scope, say so explicitly in `WIDGET-AUTH-MIGRATION-PLAN.md` or the
customer-facing migration notes — "the new widgets are English-only and their wording is
fixed" is a decision a church needs before it commits to cutover, not after. I am
deliberately not guessing which MP table backs Application Labels; check how
`/dist/UserLabels.js` queries it.

---

## RESOLVED — 2026-09-09

Both halves of this item now exist, but **not** the way "Where to fix" above
proposed. There is no `GetLabels` equivalent and no `src/app/api/embed/labels`
route: reading church-authored copy from MP per render was rejected in favour of
a catalogue in this repo. See `WIDGET-I18N-PLAN.md` for the reasoning and the
limits.

**Localisation** (the C73 half): the widget catalogue is TypeScript under
`packages/embed-sdk/src/i18n/locales/<code>/`, shipping `en`, `es` and `pt-BR`.
`en` defines the shape (`type Messages = typeof en`) and every other locale is
written `satisfies Messages`, so a missing or misspelled key is a `tsc --noEmit`
failure rather than a runtime gap. A new language is a developer step plus a
deploy — deliberately, and the item asked for that decision to be explicit.

**Label overrides** (this item's part 1, and the capability churches actually
lost on migration): `MPNextEmbed.setMessages(scope, map)` —
`packages/embed-sdk/src/i18n/overrides.ts`. A church renames "Groups" to "Small
Groups" from its own page with no build step and no deploy of ours. Overrides
beat both the locale catalogue and the English fallback, and are rendered as
text, so a host page cannot inject markup into a shadow root through them.

What the suggested fix got right, and what it did not:

- **Right:** "decide the contract, not the code, first", and "the in-source
  literal as the fallback when a key is absent". `t()` falls back
  overrides → locale → English → key, which is exactly what let the 30 files be
  converted in batches with nothing regressing while the conversion was partial.
- **Not taken:** one endpoint returning a flat key→string map per widget. A
  per-render fetch of copy is a network dependency on every widget's first
  paint, and it puts the catalogue somewhere no type checker can see it.

Note the item's own framing — "C67 without C73 still gets a church its own
vocabulary; C73 needs C67 first" — held up. The override layer is built on the
same `t()` lookup the translations use, so the two landed together rather than
in sequence.

**Not addressed, and not addressable this way:** MP-authored *content*. Event
titles and descriptions, group and opportunity names, congregation and ministry
names, **MP Custom Form field labels and help text**, product and fund names,
statement PDFs, and MP's notification emails all stay in whatever language staff
entered them. A Spanish visitor sees Spanish chrome around English content.
Legacy `GetLabels` did not solve this either — it translated labels, not content
— so this is not a regression against the widgets being migrated from, but it
does belong in the customer migration notes. README "Widget Languages" states it.

Also still true: this is a separate gap from **C68** (no `customCss`), which
remains open. A church can now change the words but still not the styling.
