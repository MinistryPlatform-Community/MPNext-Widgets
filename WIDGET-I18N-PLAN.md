# Widget Localisation Plan

**Status:** proposed, not started
**Author:** drafted 2026-09-09
**Closes:** `.claude/TODO/Comparison/C67-no-mp-configurable-labels.md`,
`.claude/TODO/Comparison/C73-no-locale-selector-no-localisation.md`
**Ships:** `en`, `es`, `pt-BR`

Every string in every `next-*` widget is a hardcoded English literal, and all 43
date/number/currency call sites are pinned to `"en-US"`. This plan replaces both with a
file-based message catalogue and a page-wide locale singleton, so a bilingual church can
serve its congregation from the production widgets.

## Decisions taken up front

These are settled; the rest of the document assumes them.

| Decision | Choice | Why not the alternative |
|---|---|---|
| Catalogue home | Typed `.ts` files in the SDK repo | **Explicitly not MP.** No `GetLabels` equivalent, no `Application_Labels` read, no per-render fetch of church-authored copy. A new language is a developer step plus a deploy. |
| Locale codes | `en`, `es`, `pt-BR` | Generic neutral Spanish serves the whole US diaspora; Brazilian Portuguese is overwhelmingly the US diaspora variant. `es-MX` / `es-419` / `es-US` fall back to `es`; `pt` / `pt-PT` fall back to `pt-BR`. |
| Who chooses | Page-declared **and** visitor-selectable | Bilingual sites already set `<html lang>`, so those work with zero configuration; a visitor on a monolingual page can still switch, which is C73's actual parity requirement. |
| Message format | ICU-syntax subset, no parser dependency | Full ICU is ~10 KB for two plural sites. The subset is written in ICU-compatible syntax so a later move to real ICU is a parser swap, not a re-translation. |
| Translation review | Drafted here, shipped as final | No review gate, no `reviewed` flag. Accepts that some church-domain vocabulary (*pledge*, *stewardship*, *congregation*) may read stiffly to a native speaker; `pnpm i18n:check` makes any later correction a one-file edit. |
| Delivery | `en` inlined, `es`/`pt-BR` lazy chunks | Keeps the English path at exactly today's cost and today's zero network requests. |

## What this does not do

State this in the customer migration notes **before** a church commits to cutover, not
after. A file-based layer translates the widget *chrome*. It cannot translate content
MinistryPlatform holds:

- event titles and descriptions, group and opportunity names and descriptions
- congregation, ministry, program, and event-type names
- **MP Custom Form field labels and help text** — `next-custom-form` renders MP's own
  field definitions
- product names, publication names, contribution statement PDFs, and every notification
  email MP sends

So a Spanish visitor sees Spanish chrome around English content. Worth knowing: legacy
`GetLabels` did not solve this either — it translated labels, not content — so this is not
a regression against the widgets being migrated from. It is a limit of the approach, and
the honest thing to publish.

---

## 1. Measured scope

Re-measure rather than trusting these numbers after any conversion work lands.

| Surface | Count | Notes |
|---|---|---|
| Component files with user-facing copy | 30 | `packages/embed-sdk/src/components/*.ts`, excluding tests |
| Estimated unique strings | ~950 measured, ~1,200 realistic | Heuristic undercounts interpolated and variable-held strings |
| Pinned `"en-US"` / `toLocale*` sites | 43 | Plus `MONTHS` in `event-finder.ts:24` and `toLocaleString("default")` in `profile.ts:289` |
| Hardcoded `"USD"` | 6 | `my-giving.ts:488`, `my-pledges.ts:338`, `my-invoices.ts:460`, `checkout.ts:544`, `pay.ts:283`, `pledge-campaign.ts:60` |
| Ad-hoc pluralisation | 2 | `full-calendar-list.ts:148`, `my-invoices.ts:280` — `event${n > 1 ? "s" : ""}` |
| Server error strings rendered verbatim | 58 unique | Across the 27 `src/app/api/embed/` route directories |
| Components with `observedAttributes` | 19 of 30 | 11 need one added purely to observe `lang` |
| Components with `disconnectedCallback` | 6 of 30 | These 6 must call `super.disconnectedCallback()` — see §4 |

Heaviest files, which is also the batching order: `event-details.ts` (~100 strings),
`my-household.ts` (~75), `group-finder.ts` (~60), `plan-your-visit.ts` (~53),
`profile.ts` (~58), `online-directory.ts` (~48). The five `full-calendar-*` sub-modules are
nearly string-free and mostly need formatter changes rather than extraction.

Current bundle: **595 KB raw / 119 KB gzip**, single-file ES, content-hashed.

---

## 2. Module layout

```
packages/embed-sdk/src/i18n/
├── index.ts              # public surface: t, useLocale, LocaleSession, formatters
├── locale-session.ts     # page-wide singleton — mirrors shared/auth-session.ts
├── registry.ts           # SUPPORTED_LOCALES + BCP-47 fallback resolution
├── t.ts                  # interpolation + Intl.PluralRules selection + overrides layer
├── formatters.ts         # memoized Intl.* wrappers, locale + domain IANA zone
├── pseudo.ts             # dev-only en-XA generator (tree-shaken from prod)
└── locales/
    ├── en.ts             # typed source of truth — statically imported, inlined
    ├── es.ts             # satisfies Messages — lazy chunk
    └── pt-BR.ts          # satisfies Messages — lazy chunk
```

`packages/embed-sdk/src/components/locale-selector.ts` is the 26th widget.

### 2.1 Type safety is the load-bearing part

`en.ts` is a TypeScript const object, **not JSON**, which is what makes the whole thing
maintainable:

```ts
// locales/en.ts
export const en = {
  common: {
    loading: "Loading…",
    save: "Save",
    cancel: "Cancel",
    signIn: "Sign In",
    signInPrompt: "Please sign in to continue.",
    retry: "Try again",
  },
  eventFinder: {
    searchPlaceholder: "Search events",
    showAdvanced: "Advanced Search",
    hideAdvanced: "Hide Advanced Search",
    resultCount: { one: "{count} event", other: "{count} events" },
    empty: "No events match your search.",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    invoice_not_found: "We could not find that invoice.",
  },
} as const;

export type Messages = typeof en;
export type MessageKey = /* recursive keypath type over Messages */;
```

Every other locale is `satisfies Messages`:

```ts
// locales/es.ts
import type { Messages } from "./en";
export const es = { /* … */ } satisfies Messages;
```

Three properties follow, and they are the entire argument for `.ts` over JSON:

1. A missing key, an extra key, or a misspelled key is a **`tsc --noEmit` failure**.
2. **Adding a language is: create the file, let the compiler enumerate what is missing.**
   No spreadsheet, no manual diff.
3. `t()` takes a `MessageKey`, so call sites get autocomplete and a compile error on a
   typo — a class of bug that string-keyed i18n libraries only ever catch at runtime.

Namespaced per widget, with `common` and `errors` shared. The ~120 strings that repeat
across widgets ("Loading…", "Save", "Cancel", "Sign In") collapse to one entry each, which
is where the realistic ~1,200 total comes from rather than the naive per-file sum.

### 2.2 `t()` — the message formatter

Roughly 60 lines, no dependency:

```ts
t("eventFinder.searchPlaceholder")
t("eventFinder.resultCount", { count: 3 })   // → "3 events" / "3 eventos"
t("groupDetails.meetsOn", { days: ["Mon", "Wed"] })
```

- **Interpolation** is `{name}`, replaced from the vars object. Values are plain text;
  every widget already escapes at the interpolation boundary (`escapeHtml` /
  `escapeAttr`), so a translation can never inject markup. Keep that invariant — it is why
  translations do not need sanitising.
- **Plurals**: when a message value is an object rather than a string, the branch is chosen
  by `new Intl.PluralRules(locale).select(count)`. Correct for `en`, `es`, and `pt-BR`
  (all `one` / `other`), and correct for free if a language with `few` / `many` is ever
  added.
- **Fallback chain**: requested locale → `en` → the key itself. A missing key logs once per
  key in dev and renders the English. **This is what makes partial conversion safe**: a
  widget converted before its `es` namespace exists renders English, not `undefined`.
- **Overrides layer** (§6) is consulted before the catalogue.

### 2.3 Registry

```ts
export const SUPPORTED_LOCALES = {
  en:      { dir: "ltr", currency: "USD", load: null /* inlined */ },
  es:      { dir: "ltr", currency: "USD", load: () => import("./locales/es") },
  "pt-BR": { dir: "ltr", currency: "USD", load: () => import("./locales/pt-BR") },
} as const;
```

Resolution is BCP-47 truncating fallback plus an alias table: `es-MX` → `es`,
`pt` / `pt-PT` → `pt-BR`, unknown → `en`. Language names for the selector come from
`Intl.DisplayNames`, so the picker shows **"Español"** and **"Português (Brasil)"** as
endonyms with **zero strings to translate** — the platform already knows them in every
locale.

---

## 3. Delivery: verified, not assumed

**The code-splitting question is resolved.** I flagged a risk that Vite lib mode with
`formats: ["es"]` would force `inlineDynamicImports` and defeat lazy locales. Probed
empirically against this repo's Vite 8.2.2 by adding a throwaway dynamic import and
building:

```
dist/__split_probe_mod-edEHXweL.js    0.17 kB
dist/next-embed.es.js               595.26 kB │ gzip: 118.67 kB
```

A separate chunk was emitted. **Rolldown code-splits dynamic imports in lib mode**, so
`() => import("./locales/es")` is all the machinery needed. No custom
`scripts/build-locales.js`, no generated JSON, no second source of truth to keep in sync.

That probe also surfaced the one real gotcha: the emitted chunk was named
`__split_probe_mod-edEHXweL.js`, from rolldown's default `chunkFileNames`. The
`assetFileNames: "next-embed.[hash][extname]"` already in `vite.config.ts` governs
*assets*, not *chunks*. Since `scripts/copy-sdk.js` decides what to publish and what to
delete with `isBuildOwned(name)` — `name.startsWith("next-embed") || name.startsWith("mp-widget-overrides")` —
a default-named locale chunk would be **built, never published, and the SDK would 404 on
it in production**. So:

```ts
// packages/embed-sdk/vite.config.ts — rolldownOptions.output
chunkFileNames: "next-embed-locale-[name].[hash].js",
```

Concrete build-chain changes:

1. **`vite.config.ts`** — add the `chunkFileNames` above, keeping the `next-embed` prefix
   so both the publish domain and the cleanup domain in `copy-sdk.js` pick it up with no
   predicate change. (`isBuildOwned` needs no edit; verify with a clean build rather than
   assuming.)
2. **`scripts/hash-sdk.js`** — locale chunks arrive already content-hashed by rolldown, so
   nothing to hash. But the script currently renames only the single known bundle; confirm
   it leaves unrecognised `dist/` files untouched rather than erroring.
3. **`vercel.json`** — CORS is per exact `source` pattern in this repo, so locale chunks
   are inaccessible cross-origin without a new entry. Add:
   ```json
   {
     "source": "/embed-sdk/next-embed-locale-:name.:hash.js",
     "headers": [
       { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" },
       { "key": "Access-Control-Allow-Origin", "value": "*" }
     ]
   }
   ```
   Missing this is the single most likely way to ship a build that works locally and breaks
   on every customer site.
4. **`src/proxy.ts`** — no change. `/embed-sdk` is already a segment-matched public prefix,
   which covers the chunks.

**Cost profile.** English: unchanged, zero extra requests. `es` / `pt-BR`: one ~45 KB raw
(~12 KB gzip) request per page, `immutable`-cached, shared by every widget on the page.

**No flash of English.** `LocaleSession.ready` resolves synchronously for `en`. For anything
else the base class awaits it before first paint. Every widget already paints a spinner
while fetching its own data, so the locale chunk lands inside a window that already exists
— the visitor never sees English swap to Spanish.

---

## 4. `LocaleSession` and the base class

`locale-session.ts` deliberately mirrors `shared/auth-session.ts`, the pattern already
proven in this codebase: page-wide singleton, resolve once, cache, `onChange` so sibling
widgets stay consistent, persist the visitor's choice the way `nextwidgets_sid` is persisted.

```ts
const session = getLocaleSession();
session.getLocale();                 // "es"
await session.ready;                 // catalogue loaded
session.setLocale("pt-BR");          // persists + notifies every widget
session.onChange((locale) => { … }); // returns an unsubscribe
```

**Resolution precedence**, highest first:

1. `lang` attribute on the widget element — `<next-event-finder lang="pt-BR">`
2. `MPNextEmbed.setLocale("es")` / `MPNextEmbed.init({ locale })`
3. Visitor's persisted choice — `localStorage["nextwidgets_locale"]`, `sessionStorage` under
   `session-scope="tab"`, matching how `AuthSession` scopes `nextwidgets_sid`
4. Nearest `[lang]` ancestor, else `<html lang>` — **the rung that matters**: a bilingual
   WordPress/Polylang site already sets this, so those churches get translated widgets with
   no snippet edit at all
5. `navigator.languages`
6. `en`

Rung 1 is per-element, so one widget can be pinned while the rest of the page follows the
visitor. Rungs 2–6 are page-wide.

### Base-class changes (`shared/base-widget.ts`)

- Resolve the locale and `await localeSession.ready` before first `render()`.
- Expose `protected t` bound to the resolved locale, and `protected fmt` (the formatters),
  so no widget imports the i18n module directly. One path, same as the token plumbing.
- Subscribe to `onChange` in `connectedCallback`; **provide a `disconnectedCallback` that
  unsubscribes.** Only 6 of 30 components define one today
  (`add-to-calendar`, `full-calendar`, `my-household`, `my-invoices`, `profile`,
  `user-menu`) — those 6 must be edited to call `super.disconnectedCallback()`, or they
  leak a subscription per mount. This is the easiest thing in the plan to get silently
  wrong.
- Add `"lang"` to `observedAttributes` on all 30 components; **11 have no
  `observedAttributes` getter at all** and need one added. Note `C39-attribute-changed-callback-ignores-first-set.md`
  — several `attributeChangedCallback` implementations ignore the first set, so re-check
  each against that filed bug rather than pattern-matching the neighbours.
- Reflect `lang` and `dir` onto the shadow host so screen readers switch voice
  pronunciation automatically. `dir` must be an **attribute**, not inherited CSS:
  `:host { all: initial }` (present in every widget's styles) resets `direction`.

**RTL:** wire `dir` from the registry now, since it is nearly free. Do **not** audit
~1,300 lines of widget CSS for logical properties until an RTL language is actually
requested — that is a separate, larger piece of work and no shipped locale needs it.

---

## 5. Formatters

`formatters.ts` replaces all 43 pinned `"en-US"` sites with locale-aware, timezone-correct
equivalents, memoizing `Intl` instances in a `Map` exactly as `shared/calendar-links.ts:93`
already does (constructing them is expensive and these are called per row).

```ts
fmt.date(value, "long" | "short" | "monthDay" | "numeric")
fmt.time(value)
fmt.dateRange(start, end)          // collapses same-day; replaces 6 duplicated impls
fmt.currency(amount, code)
fmt.number(value)
fmt.relative(value)                // Intl.RelativeTimeFormat — "in 3 days"
fmt.list(items)                    // Intl.ListFormat — "Mon, Wed and Fri" / "lun, mié y vie"
fmt.monthNames()                   // replaces the MONTHS array + toLocaleString("default")
```

**Correction to an earlier draft of this plan — do not add a `timeZone`.** This document
previously claimed that the `toLocaleDateString` calls passing no `timeZone` were a latent
bug rendering in the browser's zone rather than the church's, and that threading the domain
IANA zone through them was "the same edit". That is wrong, and acting on it would
*introduce* the day-shift bug rather than fix one.

The widgets already handle this correctly, by a deliberate pattern documented in their own
comments (`my-groups.ts:216-238`, `my-pledges.ts:307`, `my-household.ts:177`,
`my-giving.ts:458`): MP returns wall-clock strings, so a widget parses the `YYYY-MM-DD`
parts and builds a **local** `Date` from them, then formats with **no** `timeZone`. The two
cancel out and the wall clock survives. Passing the domain zone into that formatter would
re-introduce exactly the shift the parsing exists to avoid.

So `formatters.ts` takes no `timeZone` and exposes no way to pass one. It changes the
**locale only**, leaving the wall-clock semantics byte-for-byte as they are.
`.claude/references/ministryplatform.datetimehandling.md` governs the *server* boundary
(`DomainTimezoneService`) and the case where a widget formats a true instant; neither is in
scope here.

One genuine cleanup does come free:

- **`formatDateRange` is duplicated across ~6 widgets** with subtly different same-day
  collapsing. One implementation.

**Currency.** The currency *code* is data — `my-invoices` already reads it off the invoice
— while the *locale* controls formatting. Default stays `USD`, overridable per widget by a
`currency` attribute and per locale by the registry default. `fmt.currency` never assumes a
symbol.

---

## 6. Label overrides (C67 part 1)

Separate capability from language, and cheap once `t()` exists: a church renaming
"Groups" → "Small Groups" is not translating anything. Every church that renamed widget
vocabulary in MP's Application Labels loses those renames on migration, so this recovers
real lost function.

```html
<next-group-finder lang="es"></next-group-finder>
<script>
  MPNextEmbed.setMessages("es", { "groupFinder.title": "Encuentra un Grupo Pequeño" });
</script>
```

- Overrides are a flat keypath → string map, consulted by `t()` **before** the catalogue,
  layered per locale (with a `*` bucket applying to all).
- Settable via `MPNextEmbed.setMessages()` or `MPNextEmbed.init({ messages })`, so a church
  needs no build step and no deploy of ours.
- Override values are still plain text through the same escaping boundary, so a host page
  cannot inject markup into a shadow root through this door. Worth an explicit test.
- Unknown keys warn in dev and are otherwise ignored — a stale override after a key rename
  must not blank a label.

---

## 7. Server error codes

Widgets today render `data.error` verbatim, so all 58 English strings from
`src/app/api/embed/` appear inside an otherwise-Spanish widget. Fix on the **client** side
of the contract, not by content-negotiating on the server:

```json
{ "error": "invoice_not_found", "message": "Invoice not found" }
```

- `error` becomes a stable machine code, snake_case. Several already are
  (`invalid_code`, `invalid_session`) — extend that convention rather than inventing one.
- `message` stays English and becomes **debug-only**: logged, never rendered.
- Widgets render `t("errors.<code>")`, falling back to `t("errors.generic")` for an
  unmapped code. A visitor never sees a raw server string again — which is the right
  outcome regardless of language, since most of these 58 are programmer errors
  ("Missing formId or formGuid") that no visitor should ever have read.
- The server catalogue stays language-agnostic, so no translation duplication and no
  `Accept-Language` plumbing.

Touches 27 route directories plus each widget's error branch. Mechanical, and safe to do
per-route because an unmapped code already falls back cleanly.

---

## 8. Guard tests

Without these the layer decays within a few PRs. All four follow the
`src/lib/no-template-concat.test.ts` pattern already established here — a repo-wide scan
that fails the run.

1. **Keyset parity** — every locale's keyset is *exactly* `en`'s. No missing, no extras.
   Largely redundant with `satisfies Messages`, but catches a locale file that stops being
   type-checked (excluded from a tsconfig, `as any`).
2. **Interpolation parity** — every `{placeholder}` in an `en` string appears in every
   translation of that string, and plural messages have every branch the locale's
   `Intl.PluralRules` can select. Catches the failure mode that renders a literal
   `{count}` to a visitor.
3. **No new English literals** — scan component templates for text between `>` and `<`
   containing two or more letters and no `${`, and fail on anything outside a shrinking
   allowlist. **This is the test that keeps the layer alive.** It also gives the conversion
   an objective finish line: the allowlist reaching empty.
4. **Override safety** — an override containing markup renders as text, not elements.

**Pseudo-locale** (`en-XA`): generated, never authored, dev-only and tree-shaken from
production. `"Search events"` → `"[Ŝéàŕćĥ éveñtŝ ······]"`, padded ~35%. Two bugs become
visible at a glance instead of by inspection — strings that were never extracted (they stay
plain ASCII) and layouts that break under longer translations (Spanish and Portuguese run
20–30% longer than English, which will overflow buttons somewhere in 30 widgets).

**Component tests**: render each converted widget under `es` and assert no English leaked
and no fallback markers appear. **Playwright**: one spec per phase loading a demo page with
`<html lang="es">`, plus one exercising `next-locale-selector` and asserting the choice
persists across a reload.

---

## 9. Phasing

Ordered so nothing regresses while conversion is partial — the `t()` fallback chain
(§2.2) means an unconverted widget and an untranslated namespace both render English.

**Phase 0 — infrastructure, no widget changes.**
`i18n/` module, `LocaleSession`, `t()`, `formatters.ts`, `registry.ts`, the `en` catalogue
skeleton (`common` + `errors` only), pseudo-locale, all four guard tests (with the §8.3
allowlist starting at "everything"), and the build-chain edits from §3 including the
`vercel.json` entry. Base-class changes land here, including the
`super.disconnectedCallback()` fixes to the 6 affected components.
*Exit:* a demo page with `<html lang="es">` shows a Spanish "Loading…" from a lazily
fetched chunk, and `pnpm build:sdk` publishes that chunk into `public/embed-sdk/`.

**Phase 1 — shared surfaces plus three pilot widgets, end to end.**
`shared/form-validation.ts` (its 7 built-in validation messages reach every form),
`shared/custom-form.ts`, `shared/api-client.ts`. Then `event-finder`, `my-invoices`, and
`user-menu` — deliberately one public widget, one authenticated data widget with currency
and pluralisation, and the auth widget with its MP-registration watch. Full `es` and
`pt-BR` for those namespaces.
*Exit:* the pipeline is validated in a browser under all three locales before ~1,000 more
strings are committed to its shape. **Expect to revise the catalogue structure here** —
this is the cheapest point at which to do it.

**Phase 2 — events and calendar.** `event-details` (the ~100-string file), `full-calendar`
and its 5 sub-modules, `add-to-calendar`. Absorbs most of the formatter migration.

**Phase 3 — groups and opportunities.** `group-finder`, `group-details`, `my-groups`,
`opportunity-finder`, `opportunity-details`, `plan-your-visit`, `custom-form`.

**Phase 4 — giving and payments.** `my-giving`, `my-pledges`, `pledge-campaign`,
`my-contribution-statement`, `statement-preferences`, `checkout`, `checkout-complete`,
`pay`, `subscriptions`. All 6 hardcoded `"USD"` sites die here.

**Phase 5 — people.** `profile`, `my-household` (~75 strings), `online-directory`.

**Phase 6 — the rest of the contract.** `next-locale-selector` widget plus demo page, the
§7 server error codes across 27 route directories, §6 label overrides, customer-facing
documentation of the §"What this does not do" limits, and closing C67 and C73.

Phases 2–5 are independent of one another and can be reordered or parallelised. Each is
one PR per phase or per widget; the §8.3 allowlist shrinks monotonically, which makes
progress objectively measurable rather than a matter of opinion.

---

## 10. Ongoing maintenance

**Staleness is the real failure mode of a file-only catalogue.** If `en` changes a string
and `es` keeps the old translation, nothing catches it — the type system sees a present
key of the right type, and the widget renders a confidently wrong sentence. So each
translation records a hash of the English it was made from:

```ts
export const es = {
  eventFinder: { searchPlaceholder: "Buscar eventos" },
} satisfies Messages;

export const _sources = { "eventFinder.searchPlaceholder": "a3f1c2" } as const;
```

- **`pnpm i18n:check`** — reports translations whose recorded English source no longer
  matches current English (stale), keys present in no source file (dead), and `t()` calls
  with no catalogue entry (missing). Non-zero exit in CI.
- **`pnpm i18n:sync`** — rewrites `_sources` after a translation is updated, so the flag
  clears deliberately rather than by accident.

Adding a language, end to end: add a `registry.ts` entry, copy `en.ts` to the new code,
run `tsc --noEmit` and let it enumerate every key, translate, add the `vercel.json` CORS
pattern if the chunk name shape changed, deploy. No MP configuration, no database, no
per-tenant setup.

---

## 11. Open risks

- **Layout overflow.** Spanish and Portuguese run 20–30% longer than English. Something in
  30 widgets will break — a button, a table header, a tab strip. The pseudo-locale finds
  these before a customer does; budget review time per phase rather than treating it as a
  bug tail.
- **`user-menu` under a non-English locale.** In `legacy` mode it renders MP's own
  `<mpp-user-login>`, whose copy comes from `GetLabels` and is therefore in *MP's* locale,
  not ours. A Spanish page can show a Spanish menu around an English MP login control. The
  `dual`/`hardened` branch uses our own Sign In and is unaffected. Confirm behaviour in a
  browser during Phase 1 and document it; do not attempt to drive MP's locale from here.
- **Guard test 3 precision.** A regex scanner over template literals will have both false
  positives (SVG content, CSS in `getStyles()`) and false negatives (strings held in
  variables). Tune it against the real tree in Phase 0 and accept the allowlist — an
  imperfect scanner that runs is worth far more than a perfect one that does not.
- **`full-calendar` and FullCalendar's own locale.** FullCalendar 7 ships its own locale
  files, loaded from CDN with SRI (`FC_ASSETS` in `full-calendar.ts`). Our chrome
  translating while FullCalendar's internal day and month headers stay English would look
  broken. Check in Phase 2 whether the `all/global.js` bundle already carries locale data
  or whether a **fifth pinned URL and hash** is needed — and if so, that hash must be
  computed in the same edit, per the `FC_VERSION` rule in `CLAUDE.md`.
- **`next-locale-selector` placement.** MP put it on all 21 sample pages. Ours is one
  widget a church may or may not embed, so the `<html lang>` rung (§4) is what most sites
  will actually rely on. Document that rung first in the customer setup notes; the selector
  is the fallback for sites that cannot set `lang`.

---

# Implementation record — 2026-09-09

Shipped on `feature/widget-i18n`. This section records where the plan above was
wrong, because those are the parts worth reading before changing any of this.

## Corrections to this plan, found while building

**1. The `timeZone` claim was wrong and acting on it would have added a bug.**
Corrected in place in §5 above. The widgets already parse MP wall-clock strings
into a *local* `Date` and format with no zone; adding the domain zone
re-introduces the day-shift that parsing exists to avoid. `formatters.ts` takes
no `timeZone` and exposes no way to pass one.

**2. `observedAttributes` was the wrong mechanism for watching `lang`.** The
plan said to add `"lang"` to all 30 components' static lists. A
`MutationObserver` in the base class is strictly better: no edit to 30 files (11
of which have no `observedAttributes` at all), and it sidesteps
`attributeChangedCallback`, several implementations of which ignore the first set
(C39). It also has to sidestep them — the base class *reflects* the resolved
locale onto the host as `lang` for assistive tech, so a naive implementation
reads its own output back as input and pins the widget's locale forever.
`declaredLang()` is the distinction that makes this safe, and
`widget-locale.test.ts` guards it.

**3. Lazy locale chunks worked, but the naming nearly shipped a 404.** The plan
flagged code-splitting in Vite lib mode as a risk needing a spike; it works. The
real hazard was one the plan did not anticipate: rolldown's default
`chunkFileNames` produces a name `scripts/copy-sdk.js` does not recognise as
build-owned, so the chunk is built, never published, and 404s in production —
and does **not** reproduce under `vite dev`, which serves the import off the
filesystem. `vite.config.ts` now pins a `next-embed`-prefixed pattern, and
`vercel.json` carries the matching CORS entry.

**4. `Intl.PluralRules` reports a `many` category for `es` and `pt-BR`.** The
plan asserted all three shipped locales are `one`/`other`. They are not: both
Spanish and Portuguese select `many` for whole millions, and Brazilian
Portuguese selects **`one` for zero** ("0 evento", not "0 eventos"). Every
plural message therefore needs three branches in those locales, which
`catalogue-parity.test.ts` enforces. This is also a retroactive argument for the
design: a `count === 1` check would have been wrong for `pt-BR` at zero, in a
way no English-speaking reviewer would have noticed.

**5. The literal scanner was wrong twice before it was right.** Worth recording
because both drafts looked plausible:
- Scanning whole files reported TypeScript generics as UI copy — `Promise<void>`
  opens an angle bracket the next `<` appears to pair with — putting ~200
  phantom findings in files containing no English at all.
- Scanning only top-level template literals missed every string inside a nested
  ternary template, which is how these widgets build most conditional markup. It
  under-counted `my-invoices.ts` at 13 when it had 27, and would have let a file
  be declared "done" with a third of its copy still hardcoded.
- A third pass excluded `console.*` arguments: developer diagnostics are not
  congregant-facing copy, and one in `user-menu.ts` embeds sample markup
  (`<script id="MPWidgets" …>`) that reads as prose between `>` and `<`.

## Delivered beyond the plan

- **`pnpm i18n:check` / `i18n:sync`** with real staleness detection, backed by
  recorded source hashes in `packages/embed-sdk/i18n-sources/`. Verified by
  changing an English string and watching both locales report stale.
- **`error-codes.test.ts`** — reads the codes straight out of
  `src/app/api/embed/**` and asserts each resolves to a message in all three
  locales, and that no route answers with English prose. This is what makes
  adding a route safe; nothing else catches a new code with no translation,
  because the response is well-formed and the widget renders a plausible
  sentence.
- **`WIRE_CODE_KEYS`** so a wire code whose catalogue key is spelled differently
  (`auth_required` → `errors.authRequired`) does not duplicate its sentence
  across three catalogues.
- **`e2e/widget/localisation.spec.ts`** — asserts the lazy chunk is fetched
  exactly once and never for English, that it returns 200 with a JS content
  type, and that English is never painted before Spanish arrives. jsdom cannot
  cover any of those.

## Known-open, deliberately

- **`{{userLocale}}` is not forwarded to payment vendors.** MP's
  `mpp-smart-link` passed the chosen locale out to the giving vendor; a visitor
  who picks Spanish here still lands on the vendor's default language. Needs the
  vendor's parameter contract; tracked with C74.
- **`user-menu.ts` in `legacy` mode.** It renders MP's own `<mpp-user-login>`,
  whose copy comes from `GetLabels` in *MP's* locale. A Spanish page can show a
  Spanish menu around an English MP login control. `dual`/`hardened` uses our own
  Sign In and is unaffected.
- **`my-invoices.ts` searches the *formatted* date string**, so the searchable
  text is now locale-dependent — typing "sep" will not match `sept.` in Spanish.
  Pre-existing design, surfaced by this work; changing search semantics was out
  of scope.
- **No RTL audit.** `dir` is wired from the registry and reflected onto every
  host, but no shipped locale is RTL and ~1,300 lines of widget CSS have not been
  reviewed for logical properties.
- **No demo page for `next-locale-selector`**, by request. `<html lang="es">` on
  any existing demo page exercises the whole path.
