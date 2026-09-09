# `next-user-menu` — plan

**Items:** C56 (functional) · C54 (ux, shared)
**Cutover verdict: C56 before cutover — it fails silently after deployment.**
**Owns:** `packages/embed-sdk/src/components/user-menu.ts`

## What the feedback says

This widget is the sign-in path for the entire SDK, so it is on every page of a church site
that uses any other widget. Two findings, both about the same moment: the signed-in state.

- **C56** — child markup is **silently dropped when signed in**. Signed out, the shadow root is
  `<div class="nw-user-menu"><slot></slot></div>` and a child `<a>` renders fine (measured at
  143 × 21 px). Signed in, the shadow root is replaced wholesale by the avatar button and
  **`shadowRoot.querySelectorAll("slot").length === 0`** — the same child measures 0 × 0 with
  `assignedSlot === null`. Legacy's one documented option is `userUrls`, typed `innerHTML`:
  the church authors extra menu links as child markup and MP renders them inside the signed-in
  dropdown. We have no attribute, no slot in the state where the menu exists, and no event to
  inject into it.
- **C54** — focus is dropped to `<body>` when the dropdown or the account modal closes.

## Where the new widget is already better — protect these

A lot, and C54's own item says legacy "is not a fair comparison here and should not be used to
excuse this":

- The trigger is a real `<button aria-label="User menu" aria-haspopup="true"
  aria-expanded="false">`, and `aria-expanded` flips correctly. **Legacy is an `<a href="#">`
  toggling a `div` with `display:none`, no `aria-haspopup`, no `aria-expanded`, no roles and no
  Escape handling at all.**
- Escape closes both surfaces, and `handleEscape` correctly prefers the modal over the dropdown
  when both are open.
- The account modal is a proper `role="dialog" aria-modal="true"` portalled to `document.body`,
  with six tabs (Profile / Family / Groups / Giving / Subscriptions / Invoices).
- **The modal replaces legacy's "My Profile" link out to MP's OAuth profile page with an
  in-widget account surface.** C56 records this as a clear improvement and explicitly not part
  of the finding.
- `watchMpLoginRegistration()` — the re-insert watch that works around MPWidgets.js's
  `DOMContentLoaded`-only scan — is the reference implementation `CLAUDE.md` points at and
  `my-invoices.md` C44 cites. Do not disturb it.

## Phase 1 — C56, the slot

### Why it is worse than a missing feature

The host's markup is **accepted without complaint in one state and discarded without complaint
in the other**. An integrator who tests the widget signed out will believe custom links work,
and the failure is discovered after deployment by a signed-in member seeing a menu missing half
its links. The signed-in user menu is where a church site puts account links — "Give", "My
Serving Schedule", "Contact the office", a link into their own CMS — and legacy let them author
those with no code.

### The fix

Give the dropdown a **named** slot and project the host's children into it:

```html
<div class="nw-dropdown">
  … header, divider, My Account …
  <slot name="menu-items"></slot>
  … Log out …
</div>
```

so a church writes
`<next-user-menu><a slot="menu-items" href="/give">Give</a></next-user-menu>`.

**A named slot rather than a default one is load-bearing, not stylistic.** The default light
DOM is already used for the injected `<mpp-user-login>` in `legacy` mode
(`user-menu.ts:709-712` appends it as a *child*, and the signed-out slot projects it) — so
projecting unnamed children into the dropdown would put MP's login element inside the signed-in
menu.

Style the slotted anchors with `::slotted(a)` so they inherit the `.nw-dropdown-item` look
without the host knowing class names, and **put the slot above "Log out"** so sign-out stays
last.

### And remove the silent-drop behaviour regardless

If children are present in the signed-in state and cannot be rendered, `console.warn` once —
the widget already warns when MPWidgets.js fails to register `<mpp-user-login>`, so the pattern
is right there. This is the same convention `CROSS-4` proposes for declared-but-unread
attributes.

**Pin it** with a test that appends a child in the authenticated state and asserts it is
assigned to a slot.

## Phase 2 — C54, focus

Per `CROSS-3` §4. Three parts:

1. **Return focus to the trigger on close.** In `closeDropdown()` and `closeModal()`, after the
   state update and re-render:
   `this.root.querySelector<HTMLButtonElement>(".nw-avatar-btn")?.focus();`
   **Guard it so it only runs when focus was inside the widget** — otherwise a click elsewhere
   on the page that closes the dropdown via the outside-click handler steals focus back to the
   avatar, which is its own bug.
2. **Move focus *into* the modal when it opens** (first tab, or the container with
   `tabindex="-1"`), rather than leaving it on the trigger behind the overlay.
3. **Trap Tab inside the modal** while it is open. Escape already works, so the trap is the
   only remaining piece of the `aria-modal` contract.

A test asserting `shadowRoot.activeElement?.className === "nw-avatar-btn"` after a simulated
Escape pins all of it.

**Recorded but deliberately not filed:** `.nw-dropdown` carries no `role`, and its items are
plain `<button>`s with no `role="menuitem"`. That is a legitimate choice — the disclosure
pattern does not need menu roles. **If it is ever changed to `role="menu"`, arrow-key
navigation becomes mandatory.** Worth knowing before someone "improves" it.

## Do better than parity

- **The account modal is the SDK's best idea and it is invisible.** Six widgets' worth of
  functionality behind one avatar, on every page — but nothing tells a member it is there.
  Worth a moment's design: what the dropdown says before you open the modal, and whether the
  modal deep-links (`?account=giving`) so a church can link straight to a tab.
- **A named slot is a better contract than legacy's `innerHTML`.** `userUrls` typed as raw HTML
  is a markup-injection surface; `<slot name="menu-items">` lets the host use its own elements
  in its own light DOM, styled by `::slotted()`, with no HTML parsing on our side. Say so in
  the docs — it is a case where the new design is safer as well as cleaner.
- **The signed-in and signed-out shadow roots being structurally different is what caused
  C56.** Rendering one shell with conditional content, rather than replacing the root, would
  make this class of bug impossible. Worth considering while adding the slot, since it is the
  same edit.

## Acceptance

- A child with `slot="menu-items"` renders inside the dropdown when signed in, above "Log out".
- Child markup that cannot be rendered produces exactly one console warning.
- `<mpp-user-login>` still projects correctly in `legacy` mode, signed out.
- Escape from the dropdown and from the modal returns focus to the avatar button.
- Opening the modal moves focus into it; Tab stays inside while it is open.
- An outside click that closes the dropdown does **not** move focus to the avatar.
- Tests cover the slot assignment and the focus return.

## Depends on / unblocks

C54 → `CROSS-3`'s `dialogFocus` helper. C56 is independent. **This widget is on the critical
path for `CROSS-1`**: the mode-aware sign-in helper's `legacy` branch tells visitors to use
"the sign-in link on this page", and that link is usually this widget.
