# C22. `next-opportunity-finder` result cards are focusable and announced as links but cannot be activated by keyboard — there is no way to reach an opportunity's detail page without a mouse

**Widget:** `next-opportunity-finder` (old: Opportunity Finder — `/widgets/opportunity_finder.aspx`)
**Severity:** functional
**Confidence:** confirmed — focused the card and pressed Enter, then Space; the URL did not change
**Found:** 2026-09-08, comparison run

## Old behaviour

Each legacy result card is a `<div class="mpp-card" onclick="window.location.href='./Opportunities/?id=5'">`
— not focusable, no `tabindex`, no `role` — **but its footer contains a real anchor**:

```html
<div class="mpp-card--footer">
  <a href="./Opportunities/?id=5" id="5" class="mppw-btn primary buildDetailsButton">See Details</a>
</div>
```

So the card is reachable in the tab order via that `<a href>`, Enter opens the detail
page, and the link exposes its destination to a screen reader and to
open-in-new-tab.

## New behaviour

The whole card is the control:

```html
<div class="nw-of-card" data-opportunity-id="3" role="link" tabindex="0">
  … <span class="nw-of-card-cta">See Details →</span>
</div>
```

`attachListeners()` binds **only** `click`. There is no `keydown` handler and no
anchor anywhere in the card (`card.querySelector("a")` → `null`). Measured with a
keyboard:

- Tab order reaches the three cards (they are in it, between "Advanced Search" and the demo page's own buttons).
- With a card focused, `Enter` → URL unchanged. `Space` → URL unchanged.

So the card announces itself as a link, takes focus, and then does nothing —
WCAG 2.1.1 (Keyboard) and 4.1.2 (Name, Role, Value) both fail, and a keyboard or
screen-reader user has no route to `demo-opportunity-details.html` at all.

## Why it matters

Volunteer recruitment is exactly the surface a church is most likely to be asked
about for accessibility, and this is a dead end rather than a degradation: there is no
second path to the detail page from the finder. It is also worse than legacy, which is
unusual on this run — legacy's card is un-focusable but its "See Details" anchor works
perfectly by keyboard.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/opportunity-finder-new-card-focus-enter.png` (card focused, outline visible, still on the finder page)
- Measured tab order (new): `← All Widgets` → `Login` → `#of-keyword` → `Search` → `Advanced Search` → card *Embracing AI* → card *Innovation Volunteer* → card *MyChurch Test Opportunity* → demo-page buttons
- Card probe: `{"role":"link","tabindex":"0","hasHref":false}`
- Legacy card markup quoted above, read from `mpp-opportunity-finder`'s shadow root

## Where to fix

`packages/embed-sdk/src/components/opportunity-finder.ts:227-236` (the
`[data-opportunity-id]` click binding) and `:377-389` (`renderCard`).

## Suggested fix

Render the CTA as a real anchor whose `href` is `buildDetailUrl(o.id)` and let the
card's click handler stay as a mouse convenience — that fixes keyboard, screen-reader
naming, middle-click and "copy link address" in one change, and drops the need for
`role="link"`/`tabindex` on the wrapper. If the wrapper must stay the control, also
bind `keydown` for `Enter` and `" "` (and `preventDefault()` on Space so the page does
not scroll). Worth checking `next-event-finder` and `next-group-finder` for the same
card pattern — this file says it was built on the `next-event-finder` model.
