# C08. `next-full-calendar`'s event modal declares `role="dialog" aria-modal="true"` but never takes focus and traps nothing

**Widget:** `next-full-calendar` (new only)
**Severity:** ux
**Confidence:** confirmed — opened the modal from the keyboard and read back `document.activeElement`
**Found:** 2026-09-08, comparison run

## Old behaviour

No legacy calendar exists. The nearest legacy analogue is `mpp-event-details`, which
is a full page rather than a dialog, so there is no focus contract to compare against.
The reference here is the ARIA specification the new widget opts into by setting
`aria-modal="true"`: content outside the dialog must be inert to assistive tech, which
only holds if focus is moved into the dialog and kept there.

## New behaviour

`renderDetailModal()` sets the right attributes —
`role="dialog"`, `aria-modal="true"`, `aria-label="<event title>"`
(`packages/embed-sdk/src/components/full-calendar-modal.ts:118-120`) — and the close
button carries `aria-label="Close"` (`:236`). Escape works
(`:267 document.addEventListener("keydown", onKeyDown)`, verified: the overlay is
removed). Clicking the overlay backdrop closes it (`:252`).

What is missing is focus. Measured: focus the card's `LEARN MORE` button, press
Enter, the modal opens with the right content, and

```
{ role: "dialog", ariaModal: "true", focusInModal: false }
```

Focus is still on the `LEARN MORE` button, which is now behind a full-screen overlay.
Nothing prevents Tab from walking straight out of the dialog into the page behind it,
and nothing returns focus to the trigger when the dialog closes. `renderDetailModal`
contains no `focus()` call and no Tab handler; compare
`packages/embed-sdk/src/components/add-to-calendar.ts:315-318`, where the same widget
family *does* move focus (`this.root.querySelector(".atc-option")?.focus()`) and
restores it on Escape (`:163-167`) — so the pattern exists in the SDK and this modal
just does not use it.

## Why it matters

A screen-reader user who opens an event from the calendar hears nothing: focus never
enters the dialog, so the event title, date, location and the **Register** button
inside it are not announced, and the reader's cursor is parked on a control that is
now visually obscured. A sighted keyboard user presses Tab and silently leaves the
dialog to tab through the page behind it, with no visible focus ring where they expect
one. Because `aria-modal="true"` tells assistive tech to ignore everything outside the
dialog, the combination is worse than having no dialog semantics at all — the user is
focused on content the AT has been told to hide. This is a WCAG 2.4.3 (Focus Order)
failure and, for the unreturned focus on close, 2.4.7 in practice. It is the
modal-shaped version of the same class of defect as C05.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/full-calendar-new-modal-keyboard.png`
  (modal opened by Enter on `LEARN MORE`; focus ring still on the button behind it)
- Screenshot: `.claude/playwright/widget/screenshots/full-calendar-new-event-modal.png`
- Measurement: `…/scratchpad/events/19-fc-kbd.mjs` →
  `LEARN MORE + Enter -> modal: { role: "dialog", ariaModal: "true", focusInModal: false }`
  and `modal closed by Escape: true`
- Verified working elsewhere for contrast: `next-add-to-calendar`'s menu is
  `role="menu"` with `aria-label="Add <title> to calendar"`, `aria-expanded` on the
  trigger, roving arrow-key focus, first option focused on open, and focus returned to
  the trigger on Escape.

## Where to fix

`packages/embed-sdk/src/components/full-calendar-modal.ts:112-273`
(`renderDetailModal` — attributes, the `onKeyDown` handler at `:260-267`, and the
`onClose` path), plus the call site
`packages/embed-sdk/src/components/full-calendar.ts:551-565` (`showEventModal`), which
is where the triggering element is known.

## Suggested fix

Three additions, all inside `renderDetailModal`:

1. After the `requestAnimationFrame` that reveals the overlay, focus the first
   focusable node in the dialog — the close button is the safe default, or the
   **Register** button when present.
2. Extend the existing `onKeyDown` to trap Tab: collect focusable descendants, and on
   `Tab`/`Shift+Tab` at either end, wrap to the other end and `preventDefault()`.
3. Have `showEventModal` pass the triggering element (or capture
   `this.root.activeElement` before rendering) and restore focus to it in `onClose`,
   the way `add-to-calendar.ts:163-167` already does.

`inert` on the sibling content would be a cleaner alternative to a hand-rolled trap if
browser support is acceptable; either satisfies the `aria-modal` contract.
