# CROSS-3 — Accessibility: four defect classes, four shared primitives

**Items:** C05 event-finder · C10 group-finder · C22 opportunity-finder · C45 my-invoices
(keyboard-dead result cards) · C28 plan-your-visit + custom-form + opportunity-details
(no accessible names) · C35 four giving widgets (no headings) · C29 opportunity-details +
custom-form (`type="text"` phones) · C08 full-calendar modal · C54 user-menu ·
C19 row 13 group-details tabs
**Severity:** functional (cards) / ux (the rest) · **Cutover verdict: cards block cutover; the rest is Phase 2**
**Owns:** `packages/embed-sdk/src/shared/`, ~10 components

## The finding in one paragraph

The new widgets regressed accessibility that the legacy widgets had for free, and they did
it by **hand-rolling controls the platform already provides**. Legacy used `<a href>` for
"See Details", `<label for>` from a shared `FormFieldBuilder`, `<input type="tel">` for
phones and real `h1`/`h3`/`h4` elements; ours use `div role="link"` with a click-only
listener, sibling `<label>` with no `for`, `type="text"`, and `<div class="title">`. Every
one of these is more code than the correct version, which is the argument for fixing them
properly rather than patching each site.

## The four classes, and the primitive each needs

### 1. Result cards announce "link" and do nothing — C05, C10, C22, C45

Four finders, one bug. Each card is `div role="link" tabindex="0"` with a `click` listener
and **no keydown handler and no anchor**. A keyboard or screen-reader user can tab through
all 34 event results and open none of them; on `next-my-invoices` the rows are not even
focusable, so the *entire route to payment* has no keyboard path. `role="link"` makes it
worse than plain markup: assistive tech announces a link, Enter does nothing, and the page
reads as broken rather than inaccessible. WCAG 2.1.1 and 4.1.2 both fail.

**Do not add four keydown handlers.** Every one of these widgets already computes the
destination URL synchronously (`buildDetailUrl(id)`), so:

> **Add a `cardLink()` primitive to `packages/embed-sdk/src/shared/`** that renders the card
> body inside a real `<a href>`, moves `:focus-visible` styling to the anchor, and drops
> `role`/`tabindex` from the wrapper. Keep the existing click listener purely to `emit()`
> the `*Selected` event and let the browser navigate.

That restores Enter, middle-click, Ctrl-click, "copy link address", the hover status bar
and crawlability **for every visitor, mouse users included** — none of which a keydown
handler gives back. Where no `target-url` is configured the current `role="article"` div is
correct and needs no change.

`next-my-invoices` is the one exception: its rows open an in-widget detail view rather than
navigating, so the row becomes `<button type="button" class="table-row">`, not an anchor.
If C44 is resolved by the link-out route, the payable affordance becomes an `<a href>` and
most of C45 resolves with it.

### 2. Form fields have no accessible name — C28

13 of 14 controls on `next-plan-your-visit` step 2 and 20 of 27 on `next-custom-form` have
no `labels`, no `aria-label`, no wrapping `<label>`. A screen reader announces "edit text"
nine times in a row on the form that creates a visitor's Household, Address and family
records. It also breaks click-the-label-to-focus, which is what makes these forms usable on
a phone. Legacy got this right; this is a regression, which is the version that gets
reported.

> **Add a `field()` helper to `packages/embed-sdk/src/shared/form-validation.ts`** — the
> file that already owns the required-star and error-message markup. It emits
> `<label for=id>` plus the input, with a stable id derived from the existing unique `name`,
> wires `aria-describedby` to the error node, and keeps `requiredStar()` inside the label.

One helper fixes plan-your-visit, custom-form and opportunity-details at once and stops the
next form regressing. `next-opportunity-details` is at *parity* with its legacy counterpart
here (both bad) — fix it in the same pass anyway; it is the same helper.

### 3. No heading outline — C35

`next-my-giving`, `next-my-pledges`, `next-my-contribution-statement` and
`next-statement-preferences` emit **zero** heading elements. Legacy emitted a full
`h1`/`h3`/`h4` outline, so a screen-reader user could list headings and jump to a pledge.
These are the pages a donor uses to do their taxes.

Mechanical: swap the tag, keep the class (`<h1 class="title">`, `<h2 class="chart-title">`,
`<h3 class="pledge-name">`), and add `h1,h2,h3,h4 { font: inherit; margin: 0 }` to each
style block so nothing moves visually. `next-pledge-campaign` already does this correctly —
copy it.

**Better than both systems:** add a `heading-level` attribute (default `2`) so a widget
embedded under the host page's own `<h1>` emits `h2`/`h3` and slots into the page outline
instead of starting a second one. Legacy hardcoded `h1` in every widget, which is wrong on
any page carrying more than one.

While in `my-pledges`: `.progress-track` needs `role="progressbar"` plus
`aria-valuenow`/`aria-valuemin`/`aria-valuemax`. While in `statement-preferences`: the
checkbox is `opacity:0; width:0`, so it takes focus with nothing to draw a ring around —
give the paired `.slider` a `:focus-visible` outline.

### 4. Focus is dropped — C08, C54

Two dialogs that declare the contract and do not honour it.

- **C08 full-calendar modal** sets `role="dialog" aria-modal="true"` and never moves focus
  into it. Focus stays on the `LEARN MORE` button now hidden behind a full-screen overlay,
  Tab walks straight out into the page the AT has been told to ignore, and focus is not
  restored on close. `aria-modal` with no focus management is *worse* than no dialog
  semantics at all.
- **C54 user-menu** gets everything else right — real button, `aria-haspopup`,
  `aria-expanded` flipping, Escape on both the dropdown and the modal, correct precedence —
  and then drops focus to `<body>` on close. This is the one component guaranteed to be in
  the tab order on every page of a church site.

`next-add-to-calendar` already implements the whole pattern (focus first option on open,
roving arrow keys, restore to trigger on Escape). Lift it into a shared
`dialogFocus(container, trigger)` helper covering: focus in on open, Tab trap while open
(or `inert` on siblings), focus back to trigger on close — guarded so an outside-click
close does not steal focus back to the trigger.

## Also in scope, cheap

- **C29 — phones are `type="text"`** in `opportunity-details` and `custom-form`, so mobile
  users get a QWERTY keyboard on the two forms most likely to be filled on a phone.
  `type="tel"` plus `autocomplete="tel"`. `next-plan-your-visit` already gets this right, so
  these two are outliers, not a house style. Do **not** guess phone-ness from an MP form
  field's label — MP's `Form_Field_Types` has no phone type and legacy renders those as
  text too; that half is parity.
- **C19 row 13 — group-details tabs** are `<button class="gd-tab">` with no `role="tab"`,
  no `role="tablist"`, no `aria-selected`, no `aria-controls`. They are keyboard-operable,
  so this is not a blocker, but fix it before another widget copies the markup. Legacy's
  radio group conveyed all three for free.

## Phase 3 — stop the class returning

Add an accessibility probe to the Playwright suite that walks every demo page and asserts,
per widget: every focusable element has an accessible name; nothing carries `role="link"`
without an `href`; every `[role=dialog][aria-modal=true]` contains `document.activeElement`
after open; every widget emits at least one heading. Either axe or a ~60-line custom probe —
the README notes this whole class survived because nothing checked, and that is the part
worth fixing permanently.

## Acceptance

- No `role="link"` without a real `href` anywhere in `packages/embed-sdk/src`.
- Enter opens a result from every finder; Ctrl-click opens it in a new tab.
- Every non-hidden control in plan-your-visit, custom-form and opportunity-details reports
  a non-empty accessible name.
- All four giving widgets emit a heading outline and honour `heading-level`.
- Escape from the calendar modal and from the user menu returns focus to the trigger.

## Depends on / unblocks

Class 1 is independent and blocks cutover. Classes 2–4 want the shared helpers landing
first, which is roughly a day's work in `shared/`. C45 is partly resolved by whichever route
`my-invoices.md` takes for C44.
