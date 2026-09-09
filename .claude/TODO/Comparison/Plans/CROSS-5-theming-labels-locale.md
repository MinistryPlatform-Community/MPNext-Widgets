# CROSS-5 — Theming, labels and locale: the three platform gaps

**Items:** C68 (no custom CSS / no theming surface) · C67 (no MP-configurable labels) ·
C73 (no locale concept) · C77 (`mpp-user-label`, blocked on C67) · C36 (date-format drift,
resolved by locale) · plus the copy rows folded in from C09, C18, C19, C37
**Severity:** functional · **Cutover verdict: C68 blocks cutover; C67/C73 block any non-English or heavily-branded church**
**Decision recorded 2026-09-09: all three are committed workstreams, not deferred.**
**Owns:** `packages/embed-sdk/src/shared/base-widget.ts`, a new `labels` route and service,
a new locale singleton, and eventually every component

## Why these three are one plan

They are separable pieces of work but they share one structural cause and one structural
consequence.

The cause: **Shadow DOM**. Legacy widgets used it too, but legacy shipped two escape hatches
with it — `GetCustomStyles` + `customCss` for appearance, `GetLabels` for words — and the
new SDK shipped neither. So a church cannot change the styling *or* the wording of a new
widget by any means: not an attribute, not a CSS variable, not a `::part()`, not a host-page
rule, not a hack. `injectStyles()` even *assigns* `adoptedStyleSheets`, so a sheet pushed
into the open shadow root is replaced on the next render.

The consequence: **these land on every customer, not some**. "Looks nothing like our website
and cannot be made to" is a cutover blocker that surfaces in a sales conversation rather
than a bug report. And every cosmetic copy item in this backlog (C09's missing year, C18's
thirteen rows of finder wording, C19's detail-view wording, C37's soft-credit disclaimer) is
downstream of C67 — until labels are configurable, each of those is an argument about which
English string is least wrong.

## Sequencing — this is the order, and it matters

```
1. Theming tokens (--nw-*)        ← ship first, unblocks branding for cutover
2. custom-css + domain stylesheet ← completes the C68 story
3. Labels endpoint + resolver     ← C67; convert widgets incrementally
4. Locale singleton               ← C73; needs 3 to be meaningful
5. next-user-label                ← C77; the cheapest consumer of 3, and its best test
```

**Do not build the locale selector before labels.** A selector that switches a preference no
label honours is worse than no selector: it advertises a capability that does nothing.

---

## 1. Theming tokens — `--nw-*` (do this first)

Custom properties pierce Shadow DOM, which selectors do not. That makes a **documented token
contract the right primitive and a genuine improvement on what legacy offered**: legacy gave
churches a stylesheet and let them fight the widget's own specificity; we can give them a
supported surface that survives a widget re-render and an SDK upgrade.

Publish a `--nw-*` set on `:host` with the brand palette as defaults, covering at minimum:

| Group | Tokens |
|---|---|
| Colour | `--nw-color-primary` `#004C97`, `--nw-color-secondary` `#002855`, `--nw-color-accent` `#F1BE48`, `--nw-color-info` `#009CDE`, `--nw-color-success` `#86AD3F`, `--nw-color-error` `#FF6D6A`, `--nw-color-text` `#2D2926`, `--nw-color-surface`, `--nw-color-border`, `--nw-color-muted` |
| Type | `--nw-font-family`, `--nw-font-size-base`, `--nw-line-height`, `--nw-font-weight-heading` |
| Shape | `--nw-radius`, `--nw-radius-lg`, `--nw-border-width`, `--nw-shadow` |
| Space | `--nw-space-1` … `--nw-space-6` |
| Controls | `--nw-button-bg`, `--nw-button-fg`, `--nw-button-radius`, `--nw-focus-ring` |

Current component CSS uses **zero** `var(--…)`, so this is a real conversion, not a rename.
Do it once across all 25 widgets rather than per widget — a half-converted token set is worse
than none because a church cannot tell which rules it can reach.

Add `part=` to the handful of structural elements that a church may need to reposition
(card, card media, toolbar, form row, submit button) so `::part()` covers what tokens
cannot. Keep the `part` list small and deliberate; every part is an API.

## 2. `custom-css` and the domain stylesheet channel

Two channels, matching legacy, both needed:

1. **Per-element `custom-css`** — read in `base-widget.ts`, append a `<link>` into the shadow
   root **after** `injectStyles()` runs.
2. **Domain-level automatic styling** — a `GetCustomStyles` equivalent under
   `src/app/api/embed/`, fetched once per page and applied to every widget, so a church
   configures its stylesheet once and every widget matches the site. This is what legacy
   churches get for free today; without it, branding becomes per-tag markup.

**Required companion change:** `injectStyles()` must *push onto* `adoptedStyleSheets` rather
than assign, or the host sheet is discarded on the next render. That single line is currently
what makes the shadow root closed to additions.

**Security call to make explicitly, not by default:** `custom-css` is an author-controlled URL
fetched into the page. `cdn-loader.ts` already establishes the house pattern of `integrity` +
`crossOrigin="anonymous"` for external assets. Decide whether an optional
`custom-css-integrity` belongs here, and whether the domain channel should be restricted to
`https:`. That is an auth-design decision, not a styling one.

## 3. Labels — C67

Legacy widgets contain almost no English: every string comes from
`GET /Api/ConfigurationApi/GetLabels?componentName=<tag>` and is interpolated as
`${this._i18n.<key>}`. `EventFinder.js` (123 KB) holds exactly two label identifiers of its
own, and both are keys. Churches use this two ways: renaming vocabulary ("Groups" →
"Life Groups") and localisation.

### The contract, decided before any code

- **One endpoint**, `GET /api/embed/labels`, returning a flat `key → string` map, fetched
  **once per page and shared across widgets** — the same shape `AuthSession` uses for
  `/api/embed/auth/config`. This is better than legacy, which fetched per widget per render
  (N round trips on a page with several widgets).
- **The in-source literal is the fallback** when a key is absent. That is what makes an
  incremental conversion safe: widgets convert one at a time and nothing regresses while
  the conversion is partial.
- Namespace keys by widget (`eventFinder.searchButton`) so a church can override one
  widget's vocabulary without touching another's.

### Then, and only then, settle the copy items

Once labels exist, the backlog's copy rows stop being arguments and become **default values**.
Fold in and decide once:

- **C18** — thirteen rows of group-finder drift (`Campus`/`Congregation`,
  `Any Campus`/`All Congregations`, `Search Groups`/`Search`, `Mondays @ 6:30 PM` /
  `Monday · 6:30 PM`, `Capacity: 2 of 20` / `2 of 20`, the empty state).
- **C19** — the group-details equivalents.
- **C09** — the event-finder copy table.
- **C37** — the soft-credit disclaimer wording.

**Guiding principle for choosing the defaults** (this is the whole point of the exercise):
*pick the better string, not the legacy string.* The user goal is a great experience, not a
byte-identical migration. Concretely that means:

- Keep ours where ours is clearer — `Someone else…` beats `Blank Form`; `Make Changes` beats
  `Back to Event Details`; `Sign In` beats `Login`.
- Take legacy's where legacy said more — its empty state (*"0 Groups found. Please try again
  with different search criteria."*) tells the visitor what to do next; ours (*"No groups
  found."*) does not. Adopt legacy's *meaning* in our voice and give it the widget's alert
  styling.
- Match MP's own vocabulary where the church's data uses it — `Campus` is what this MP
  instance calls congregations, and `All Congregations` above a list containing "Campus"
  entries reads as a mismatch. With labels landed this becomes the church's call anyway,
  which is the correct answer.

Write the decision down. Right now the SDK is neither re-voicing MP's copy deliberately nor
matching it, and that is how a thirteen-row drift table happens.

## 4. Locale — C73

`<mpp-locale-selector>` is on **all 21** pages of MP's own sample site, and the choice is
plumbed outward — `/widgets/giving.aspx` forwards `{{userLocale}}` to the payment vendor. So
this is a supported MP deployment, not an edge case, and a bilingual church cannot migrate
without it.

Design it as a page-wide singleton mirroring `AuthSession`
(`packages/embed-sdk/src/shared/auth-session.ts`): resolve once, expose `onChange` so sibling
widgets re-render together, persist the choice the way `nw_sid` is persisted. It feeds two
consumers:

1. **The label fetch** (`/api/embed/labels?locale=`).
2. **Every `Intl.*` call in the SDK.** This is where **C36** resolves: `next-my-giving` prints
   `Jun 8, 2026` and `next-my-pledges` `Jan 1, 2026` from hardcoded `en-US` options, while
   `next-my-invoices:451` pins `"en-US"` outright. Do not fix C36 as two edits in two files —
   sweep every date and currency call onto the resolved locale in one pass.

**Combine this with the existing date rule.** `.claude/references/ministryplatform.datetimehandling.md`
already requires client-side formatting to use `Intl.DateTimeFormat` with the domain's IANA
zone from `getMpTimezone()`. Adding a locale to those call sites is the *same edit* — do them
together rather than touching every date twice.

**On the C36 format question specifically:** keep the long form (`Jun 8, 2026`) as the default
rather than reverting to legacy's `6/8/2026`. It is unambiguous for non-US readers, which is
the whole point of having a locale, and legacy was not internally consistent anyway (two
widgets, two formats). Make every `next-*` widget agree with itself, and let locale handle the
rest.

## 5. `next-user-label` — C77

Blocked on step 3 and worth building immediately after it: attributes `name` (required) and
`bare`, one lookup, one text node. It is the cheapest possible consumer of the label pipeline
and therefore its best end-to-end test before 25 widgets are converted onto it.

One deliberate decision: `bare="true"` exists so the string can sit inline in the host page's
own sentence, but a Shadow DOM element cannot inherit host typography. If `bare` means
"renders as if it were host-page text", this element should skip the shadow root and write to
its own light DOM — the only element in the SDK that would. Decide that explicitly; a bare
label in the wrong font is worse than no bare mode.

## Acceptance

- A church can change primary colour, font and radius on every widget by setting `--nw-*`
  on `:root`, with no stylesheet.
- `custom-css` survives a widget re-render.
- A domain stylesheet configured in MP is applied to every widget with no markup.
- Every user-visible string resolves through the label map, with the in-source literal as
  fallback; a missing key never renders blank.
- Switching locale re-renders every widget on the page, including dates and currency.
- No `"en-US"` literal remains in `packages/embed-sdk/src`.

## Depends on / unblocks

Independent of every other plan, and **blocks nothing else** — which is exactly why it needs
scheduling deliberately rather than being picked up when someone has a spare afternoon.
Unblocks C77, and turns roughly ten cosmetic items across the backlog from open questions
into default values.
