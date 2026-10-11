# C05. `next-event-finder` result cards are `div role="link"` with a click-only handler — Enter and Space do nothing, so the entire result list is unreachable by keyboard

**Widget:** `next-event-finder` (old: Event Finder, `mpp-event-finder`)
**Severity:** functional
**Confidence:** confirmed — focused a card, pressed Enter, URL unchanged
**Found:** 2026-09-08, comparison run

## Old behaviour

Each legacy result card ends in a real anchor:

```html
<a id="215" class="mppw-btn primary buildDetailsButton" href="./event_details.aspx/?id=215">See Details</a>
```

So the detail link is focusable, activates on Enter, appears in the browser's link
list, can be middle-clicked or opened in a new tab, has a copyable URL, and is
crawlable. Nothing custom is needed for any of that.

## New behaviour

The whole card is a `div` with an ARIA role and a `click` listener, and no keyboard
handler:

```html
<div class="nw-ef-card" data-event-id="215" role="link" tabindex="0"> … <span class="nw-ef-card-cta">See Details →</span></div>
```

`packages/embed-sdk/src/components/event-finder.ts:348` sets `role="link"` +
`tabindex="0"`; `:207-214` attaches only `el.addEventListener("click", …)`, which calls
`window.location.href = url`. There is no `keydown` handler anywhere in the component.

Measured on `demo-event-finder.html`:

- Tab order reaches every card — 9 consecutive stops are `next-event-finder >> div.nw-ef-card`.
- With a card focused, **Enter navigates nowhere**: URL before and after is
  `http://localhost:5173/demo-event-finder.html` (asserted, not eyeballed).
- `See Details →` is a `<span>`, not an `<a>`; the card exposes no `href`.

So a keyboard or screen-reader user can tab through all 34 results and open none of
them. `role="link"` also *promises* link semantics to assistive tech — a screen reader
announces "link" and Enter then does nothing, which is worse than an unannotated div.
This is a WCAG 2.1.1 (Keyboard) failure and a WCAG 4.1.2 (Name, Role, Value) mismatch.

The same click-only pattern appears on `next-full-calendar`'s cards, but there the
interactive element is a real `<button class="nw-fc-card-learn-more">` and Enter works
(verified — it opens the detail modal), and the List view's rows are `<button>` too. So
this is specific to the event-finder card.

## Why it matters

The event finder is the entry point of the whole events flow: search → detail →
register. Making its results mouse-only closes that flow to keyboard users, screen
reader users, and anyone on a device without a pointer, and it removes
open-in-new-tab / copy-link / "back" behaviour for everyone. It is also an
accessibility-conformance regression against the legacy widget, which got this right
for free by using an anchor — relevant for any customer with a public-sector or
grant-funded accessibility obligation.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/event-finder-new-initial.png` (new cards)
- Screenshot: `.claude/playwright/widget/screenshots/event-finder-old-initial.png` (legacy `See Details` anchors)
- Measured tab order and the failed Enter activation: `…/scratchpad/events/17-a11y.mjs`
  → `Enter on card navigated? false -> http://localhost:5173/demo-event-finder.html`
- Legacy anchor confirmed: `detailIsAnchor: "A"`, `href: "./event_details.aspx/?id=215"`.
- Legacy `<label for>` bindings are all present (`Campus`→`congregationId`, `Key Word`→`keywordSearchText`,
  `Month`→`monthId`, `Ministry`→`ministryId`, `Sign-up Type`→`signUpTypeId`); the new widget's four
  advanced selects are correctly labelled too, and the keyword box carries `aria-label="Search events"`.
  The card is the only a11y gap in this widget.

## Where to fix

`packages/embed-sdk/src/components/event-finder.ts:348` (the card element and its
`role`/`tabindex`), `:337` (`hasLink`), `:207-214` (the click listener in
`attachListeners`), and `:163-176` (`buildDetailUrl`, which already produces the exact
href needed).

## Suggested fix

Render the card as a real link rather than emulating one. `buildDetailUrl(e.id)` is
already computed synchronously, so the card body can be wrapped in
`<a class="nw-ef-card-link" href="${url}">` (with `:focus-visible` styling moved to the
anchor and `role`/`tabindex` dropped entirely); keep the existing click listener only
to `emit("eventSelected", …)` and let the browser do the navigation. When no
`target-url` is configured the current `role="article"` div is correct and needs no
change. If a full anchor is not wanted for layout reasons, the minimum fix is a
`keydown` handler on the card that treats `Enter` and `Space` as a click — but that
still leaves no href to copy or open in a new tab.

## Resolution — 2026-10-11

**Fixed** (W2, branch `ws/w2-events`) on the shared W0 `cardLink()` / `bindCardSelect()`
primitives.

**What changed:**

- `renderCard` renders through
  `cardLink({ href: buildDetailUrl(e.id), className: "nw-ef-card", body, attrs: { "data-event-id": e.id } })`.
- With `target-url` set, each card is a real `<a class="nw-card-link nw-ef-card" href="…">`.
  Enter, Ctrl/Cmd-click, middle-click, open-in-new-tab, copy-link and crawlers all work with no
  script.
- With no `target-url`, the card stays the `role="article"` div. `role="link"` and
  `tabindex="0"` are gone.
- The click-only listener that set `window.location.href` is removed. `bindCardSelect` now only
  emits `eventSelected { eventId }`, and it never cancels the click.
- Card hover styling moved from `[role="link"]` to `a.nw-ef-card`. `CARD_LINK_STYLES` supplies
  the anchor reset and the `:focus-visible` ring.

**Data:** the query is untouched, so the 34/34 legacy parity is not affected.

**Tests:** new `event-finder.test.ts` covers:

- every card is an anchor whose href carries `id-parameter-name`;
- no `role="link"` or `tabindex` remains;
- the no-`target-url` fallback renders the article div;
- plain and Ctrl clicks both emit `eventSelected` and neither is `preventDefault`ed.
