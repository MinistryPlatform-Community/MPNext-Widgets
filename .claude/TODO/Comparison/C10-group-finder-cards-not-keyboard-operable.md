# C10. `next-group-finder` result cards are keyboard-focusable but cannot be activated by keyboard, and carry no link at all

**Widget:** `next-group-finder` (old: Group Finder, `/widgets/group_finder.aspx`)
**Severity:** functional
**Confidence:** confirmed — driven in Playwright on both sites; Enter and Space observed to do nothing on the new card, Enter observed to navigate on the legacy one
**Found:** 2026-09-08, comparison run (groups agent)

## Old behaviour

Each legacy result card is a `div` with an `onclick`, **plus a real anchor in the card
footer**:

```html
<div class="mpp-card" onclick="window.location.href='./group_details.aspx/?id=49'">
  …
  <div class="mpp-card--footer">
    <a href="./group_details.aspx/?id=49" id="49" class="mppw-btn primary buildDetailsButton">See Details</a>
  </div>
</div>
```

Because the affordance is an `<a href>`, a keyboard user tabs to "See Details" and presses
Enter to open the group; middle-click / Ctrl-click opens it in a new tab; the status bar
shows the destination on hover; and a screen reader announces a link with a destination.

## New behaviour

The card is a `div` that is made focusable and *claims* to be a link, but has no keydown
handler and contains no anchor (`group-finder.ts:560-569`):

```html
<div class="nw-gf-card" data-group-id="49" role="link" tabindex="0">
  …
  <span class="nw-gf-card-cta">See Details →</span>
</div>
```

Navigation is wired only to `click` (`group-finder.ts:284-292`):

```ts
this.root.querySelectorAll<HTMLElement>("[data-group-id]").forEach((el) => {
  el.addEventListener("click", () => { … window.location.href = url; });
});
```

Measured in the browser:

| Check | Old | New |
|---|---|---|
| Tab reaches the card / CTA | yes (`a.buildDetailsButton`) | yes (`div.nw-gf-card`, `tabindex="0"`) |
| Enter activates | **yes** — navigates to `group_details.aspx?id=49` | **no** — URL unchanged |
| Space activates | n/a (anchor) | **no** — URL unchanged |
| `a[href]` inside the card | 1 | **0** (`ctaTag: "SPAN"`) |
| Focus ring | yes | yes (`outline: solid 2px #004C97`) |

Tab order through the new widget is otherwise sane:
`#gf-keyword → Search → Advanced Search → card → card → card → card → Suggest a Group`.
Every one of those four card stops is a focus trap in the everyday sense: focus lands
there and there is nothing the keyboard can do with it.

## Why it matters

The finder's only job is to get a visitor from the result list into a group's detail page,
and for a keyboard-only or screen-reader visitor that path does not exist in the new
widget. `role="link"` makes it worse than plain unstyled markup: assistive technology
announces "link", the user presses Enter, and nothing happens — which reads as a broken
page rather than an inaccessible one. The lost anchor also removes open-in-new-tab,
copy-link-address, and hover preview for *every* visitor, mouse users included, and means
the result list is not crawlable. Any church with a public accessibility commitment
(and any US church large enough to attract an ADA complaint) regresses on migration.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/group-finder-new-card-keyboard.png`
  (first card focused, still on the finder page after Enter and Space)
- Baselines: `group-finder-old-initial.png`, `group-finder-new-initial.png`
- Script: `.claude/playwright/widget/scripts/groups-gf-a11y.mjs`, `.claude/playwright/widget/scripts/groups-gf-suggest-anon.mjs` (both listed in
  `.claude/playwright/widget/tests/group-finder.md`)
- Observed output:
  - `NEW focused: {"host":"NEXT-GROUP-FINDER","inner":"nw-gf-card","role":"link","tabindex":"0"}`
  - `NEW after Enter, url changed: false` / `NEW after Space, url changed: false`
  - `card anchors: { anchorsInCard: 0, ctaTag: 'SPAN', cardTag: 'DIV', role: 'link' }`
- No console errors or failed requests on either side; this is not an error path.

## Where to fix

`packages/embed-sdk/src/components/group-finder.ts:560-569` (`renderCard`) and
`:284-292` (`attachListeners`).

## Suggested fix

Render the real thing instead of simulating it. `buildDetailUrl(g.id)` already produces the
href, so wrap the card body in `<a href="${url}" class="nw-gf-card-link">` (or make the
`See Details →` CTA the anchor and keep the card `onclick` as a convenience), and drop
`role="link"`/`tabindex="0"` from the wrapper so the anchor is the single focus stop. Keep
the click handler for the `groupSelected` event but let the browser do the navigation —
that restores Enter, middle-click, Ctrl-click and the hover status bar in one change.

If the whole-card click target must stay, the minimum patch is to add a keydown handler
that treats `Enter` (and `Space`, with `preventDefault`) as a click; but that still leaves
the card unlinked, so the anchor version is the better fix. `next-event-finder`'s card
markup is worth checking at the same time — it is likely the same pattern (events agent
owns C01–C09).
