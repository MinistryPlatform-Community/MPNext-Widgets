# C73. Legacy `mpp-locale-selector` has no counterpart — the new SDK has no locale concept at all

**Widget:** none (old: Locale Selector, present on **every** page of `/widgets/*`)
**Severity:** functional
**Confidence:** confirmed — the tag is on all 21 fetched sample pages; the absence in this repo is a whole-tree grep. No browser used.
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

```html
<mpp-locale-selector></mpp-locale-selector>
```

Configured by nothing — `observedAttributes` is `[]` and `configurationItems` is `[]`; the
only attribute `LocaleSelector.js` reads is the universal `customCss`. It is placed
top-left on **all 21** pages of MP's sample site, including the pages for widgets that have
nothing to do with language.

That ubiquity is the finding. It is not an optional extra: legacy widget copy is fetched
per render from `GET /Api/ConfigurationApi/GetLabels?componentName=<tag>` (see **C67**),
and this element is the control that changes which language that call returns. MP also
plumbs the choice outward — `/widgets/giving.aspx` forwards `{{userLocale}}` to the payment
vendor through `mpp-smart-link`:

```
https://testing.realm.dev/givechurch/give/default?authenticated={{isAuthenticated}}&user={{userDisplayName}}&email={{userEmail}}&userLocale={{userLocale}}
```

So a locale, once chosen, follows the visitor across widgets and out to third parties.

## New behaviour

There is no locale element, and no locale anywhere: no locale/language route under
`src/app/api/embed/` (27 directories), no locale handling in
`packages/embed-sdk/src/shared/`, and no label-resolution path for a locale to select (the
subject of C67). Every string in every `next-*` widget is an English literal in the
component source.

The only formatting that is locale-shaped is hardcoded to US English, e.g.
`packages/embed-sdk/src/components/my-invoices.ts:451`:

```ts
return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
```

That is a pinned literal, not a resolved locale — so dates, and by the same pattern
currency, render US-style regardless of visitor or church.

## Why it matters

A bilingual church — Spanish/English is the common case in the US, and MP ships the
selector on its own sample site, so this is a supported deployment rather than an edge
case — cannot serve its congregation from the new widgets in both languages. There is no
partial mitigation available either: Shadow DOM keeps a page-level i18n library out, and a
church cannot substitute the text (C68 covers the styling half of the same wall).

Filed separately from C67 because they are separable pieces of work with different scope:
C67 is "labels come from somewhere configurable", this is "there is a visitor-selectable
locale that the label source and the outbound merge tokens both honour". C67 without C73
still gets a church its own vocabulary; C73 needs C67 first.

## Evidence

- Present on all 21 sample pages: `<mpp-locale-selector></mpp-locale-selector>`, verified
  by diffing every fetched page against the others (only the widget line differs — see
  CONFIG-MAP.md section 1)
- Loader table entry: `{tag:"mpp-locale-selector", script:"/dist/LocaleSelector.js",
  name:"Locale Selector"}` in `/widgets/dist/MPWidgets.js`
- Old surface: `observedAttributes` `[]` in `/widgets/dist/LocaleSelector.js`; the
  configurator's `WidgetDetails` name for it is "Language & Locale"
- Locale plumbed outward: the `{{userLocale}}` merge token on
  `curl https://mpi.ministryplatform.com/widgets/giving.aspx`
- New: 25-element roster has no locale element; `ls src/app/api/embed/` → no locale route;
  `packages/embed-sdk/src/components/my-invoices.ts:451` pins `"en-US"`
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 1, 3, 6

## Where to fix

- new `packages/embed-sdk/src/components/locale-selector.ts` (+ demo page)
- `packages/embed-sdk/src/shared/` — a page-wide locale singleton, the same shape as
  `auth-session.ts` (one fetch, cached, `onChange` so sibling widgets re-render)
- every `packages/embed-sdk/src/components/*.ts` that formats a date or currency — replace
  the pinned `"en-US"` with the resolved locale

## Suggested fix

**Do C67 first.** A locale selector with nothing to select is worse than none — it would
switch a preference that no label honours.

When C67 lands, the natural design here mirrors `AuthSession`
(`packages/embed-sdk/src/shared/auth-session.ts`): a page-wide singleton that resolves the
locale once, exposes `onChange`, persists the choice the way `nw_sid` is persisted, and is
read by the label fetch and by every `Intl.*` call. Note the date rule in this repo —
`.claude/references/ministryplatform.datetimehandling.md` — already says client-side
formatting must use `Intl.DateTimeFormat` with the domain's IANA zone; adding a locale to
those call sites is the same edit, so the two changes want doing together rather than
twice.

Scope honestly: this is a roadmap item spanning all 25 widgets, not a patch. If it is out
of scope, record "English-only, US formats" in the customer migration notes, because a
bilingual church needs that before cutover, not after.

---

## RESOLVED — 2026-09-09

`next-locale-selector` exists
(`packages/embed-sdk/src/components/locale-selector.ts`), and so does the locale
concept it selects. **C67 was done first**, as this file insisted — a selector
with nothing to select would have been worse than none.

The suggested fix here was followed almost exactly:

- **A page-wide singleton shaped like `auth-session.ts`** —
  `packages/embed-sdk/src/i18n/locale-session.ts`. Resolves once, caches,
  exposes `onChange` so sibling widgets re-render together, persists the choice
  as `nw_locale` the way `nw_sid` is persisted, and listens for `storage` events
  so switching language in one tab reaches the others.
- **Read by every `Intl.*` call** — `i18n/formatters.ts` replaced all 43
  `"en-US"`-pinned call sites, including the `my-invoices.ts:451` this file
  named, plus a hardcoded 12-month array in `event-finder.ts` and a
  `toLocaleString("default")` in `profile.ts:289` that followed the *browser's*
  locale rather than the page's.

One thing this file got wrong, and it is worth recording because acting on it
would have introduced a bug. The suggestion was that adding a locale to those
call sites is "the same edit" as the date rule in
`.claude/references/ministryplatform.datetimehandling.md`, i.e. that they should
also start passing the domain IANA zone. They should not. The widgets already
parse MP wall-clock strings into a *local* `Date` and format with **no**
`timeZone`, so the two cancel out and the wall clock survives — passing the
domain zone into those formatters re-introduces exactly the day-shift the
parsing exists to avoid. `formatters.ts` therefore takes no `timeZone` and
exposes no way to pass one; it changes the locale only. That reference governs
the *server* boundary, which is a different problem.

Beyond the suggested design:

- **Zero translated strings of its own.** Options are endonyms from
  `Intl.DisplayNames` — "English", "Español", "Português (Brasil)" — so the
  roster costs nothing to translate and a new locale adds no copy here. A
  Spanish speaker scans for "Español", not for "Spanish".
- **The selector is usually not the important path.** The resolution ladder
  reads `<html lang>`, so a bilingual site whose CMS marks up its own pages gets
  translated widgets with no snippet change and no selector at all. This element
  is for sites that cannot set `lang`. README "Widget Languages" documents the
  `<html lang>` route first, deliberately.
- `variant="inline"` renders a button group instead of a dropdown; `locales`
  restricts the offered set; a single offered locale renders nothing, because a
  picker with one option is worse than no picker.

**Not done:** the `{{userLocale}}` merge token this file notes MP forwarding to
the payment vendor through `mpp-smart-link`. `next-checkout` and `next-pay` are
localised, but neither forwards the resolved locale outward to a third-party
payment page — a visitor who chose Spanish still lands on the vendor's default
language. That is a separate, smaller item and needs the vendor's own parameter
contract; `mpp-smart-link` itself has no counterpart (filed as C74).
