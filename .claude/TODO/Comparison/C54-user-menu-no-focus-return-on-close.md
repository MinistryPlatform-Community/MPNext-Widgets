# C54. `next-user-menu` does not return focus to the avatar trigger when its dropdown or account modal closes

**Widget:** `next-user-menu` (old: `mpp-user-login`)
**Severity:** ux
**Confidence:** confirmed — measured `document.activeElement` and the shadow root's `activeElement` immediately after Escape
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-user-login` is not a fair comparison here and should not be used to excuse
this: its menu is an `<a href="#" id="userNameContainer">` toggling a
`div#userMenu` with `display:none`, no `aria-haspopup`, no `aria-expanded`, no
roles, and no Escape handling at all. Legacy is worse in every other respect.
What it does do, by accident of being an anchor with no re-render, is leave focus
on the anchor the user clicked, so keyboard traversal continues from the trigger.

## New behaviour

`next-user-menu` gets the hard parts right and misses the last step.

Correct:

- trigger is a real `<button class="nw-avatar-btn" aria-label="User menu"
  aria-haspopup="true" aria-expanded="false">`, and `aria-expanded` flips to
  `true`/`false` as the dropdown opens and closes
- **Escape closes the dropdown** (`handleEscape`, `user-menu.ts:1167-1175`)
- the account modal is a proper dialog:
  `role="dialog" aria-modal="true" aria-label="My Account"`, portalled to
  `document.body`, with the tab set Profile / Family / Groups / Giving /
  Subscriptions / Invoices
- **Escape closes the modal** too, and `handleEscape` correctly prefers the modal
  over the dropdown when both are open

Missing: focus is dropped on the floor. After opening the dropdown and pressing
Escape:

```
{ dropdownOpen: false, expanded: "false", shadowActive: null, docActive: "body" }
```

`document.activeElement` is `<body>`. The same happens after Escape closes the
account modal. A keyboard user who opens the menu, changes their mind, and
presses Escape is returned to the top of the document and has to Tab all the way
back to where they were. For the modal this is the more serious half: it is
declared `aria-modal="true"`, so a screen-reader user's focus was inside a dialog
that has just been removed from the DOM, leaving them with no announced position
at all.

The cause is that `closeDropdown()` / `closeModal()` re-render and remove the
node that held focus without moving focus first.

## Why it matters

This is the widget every other widget's sign-in path runs through, so it is the
one component on a church site guaranteed to be in the keyboard tab order on
every page. Dropping focus to `<body>` on close is the specific failure APG calls
out for both the disclosure and the modal-dialog patterns, and for the modal it
is a WCAG 2.4.3 (Focus Order) problem rather than a nicety. It is also the one
finding of this set that is a few lines of code: everything else the widget needs
for the pattern is already there.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/user-menu-new-authed-dropdown.png` — dropdown open, showing name, email, "My Account", "Log out"
  - `.claude/playwright/widget/screenshots/user-menu-new-authed-modal.png` — the account modal with its six tabs
  - `.claude/playwright/widget/screenshots/user-menu-old-authed-dropdown.png` — the legacy menu for comparison
- Measured in-page, signed in as the test user:
  - trigger attributes: `class=nw-avatar-btn`, `aria-label=User menu`,
    `aria-haspopup=true`, `aria-expanded=false` → `true` on open
  - after `Escape` with the dropdown open:
    `{ dropdownOpen: false, expanded: "false", shadowActive: null, docActive: "body" }`
  - modal, before Escape:
    `{ host: "document", role: "dialog", ariaModal: "true", label: "My Account",
       tabs: ["Profile","Family","Groups","Giving","Subscriptions","Invoices"] }`
  - after `Escape`: no `[role=dialog]` anywhere in the document or in any shadow
    root, and focus again on `<body>`
- Also observed while measuring: the dropdown container `.nw-dropdown` carries no
  `role`, and its two items are plain `<button>`s with no `role="menuitem"`.
  That is a legitimate choice (the disclosure pattern does not need menu roles),
  so it is recorded here rather than filed — but if it is ever changed to
  `role="menu"`, arrow-key navigation becomes mandatory too.

## Where to fix

- `packages/embed-sdk/src/components/user-menu.ts:1167-1175` — `handleEscape()`
- `closeDropdown()` and `closeModal()` in the same file — the two places that
  re-render after removing the focused node
- `packages/embed-sdk/src/components/user-menu.ts:1060-1063` — `renderAvatar()`,
  the button that focus should return to

## Suggested fix

In `closeDropdown()` and `closeModal()`, after the state update and re-render,
focus the avatar trigger:

```ts
this.root.querySelector<HTMLButtonElement>(".nw-avatar-btn")?.focus();
```

Guard it so it only runs when focus was inside the widget (or inside the modal)
when the close happened — otherwise a click elsewhere on the page that
closes the dropdown via the outside-click handler would steal focus back to the
avatar, which is its own bug.

Two things worth doing in the same pass, since the modal is declared
`aria-modal="true"` and therefore takes on the full dialog contract:

- move focus *into* the modal when it opens (first tab, or the dialog container
  with `tabindex="-1"`), rather than leaving it on the trigger behind the overlay;
- trap Tab inside the modal while it is open. Escape already works, so the trap
  is the only remaining piece.

A test in `user-menu.test.ts` that asserts
`shadowRoot.activeElement?.className === "nw-avatar-btn"` after a simulated
Escape would pin all of it.
