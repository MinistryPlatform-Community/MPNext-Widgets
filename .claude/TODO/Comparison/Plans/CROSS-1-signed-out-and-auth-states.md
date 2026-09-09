# CROSS-1 — Signed-out is a state, not a failure

**Items:** C81 (parent) · C13 my-groups · C30 my-giving / my-pledges / my-contribution-statement / statement-preferences · C46 my-invoices · C53 profile / my-household / subscriptions · C15 group-finder (the `legacy`-mode half)
**Severity:** functional · **Cutover verdict: blocks pilot cutover**
**Owns:** `packages/embed-sdk/src/shared/base-widget.ts`, ten components

## The finding in one paragraph

Ten auth-only widgets collapse a `401` into their generic error branch and paint
**"Unable to Load" / "Authentication required" / [Try Again]**. "Try Again" re-issues the
same anonymous request and fails identically — a loop with no exit — and there is no
sign-in control anywhere in the widget. Every legacy counterpart showed a warning plus a
working Login button. Four agents found this independently in four widget families, which
is what makes it a class rather than four bugs. `requestLogin()` already exists on
`MPNextWidget` and nine other components call it; `next-online-directory` is in *both*
lists, so a working reference implementation is already in the tree.

## Why the obvious fix is not good enough

"Add a Sign In button to ten widgets" fixes the symptom and re-creates the cause: nothing
stops the eleventh widget doing it again, and it papers over two real problems the items
surfaced.

**First, in `legacy` auth mode a Sign In button is a lie.** `AuthSession.login()` is not
the live path there — the host page signs in through `<mpp-user-login>` / `next-user-menu`
— so a button that calls it does nothing visible. C15 hit exactly this on group-finder.
Ten new buttons that silently no-op on every current customer is a worse outcome than the
dead "Try Again" we have now, because it looks like it should work.

**Second, the widget has no vocabulary for this.** Components today model
`loading | error | data`. "You are not signed in" is none of those. Until the state exists,
every widget will keep spelling it as an error.

## Course of action

### Phase 1 — give `MPNextWidget` the state (blocks cutover)

1. **Add a fifth state to the base class.** `loading | needs-auth | error | empty | ready`.
   `needs-auth` is set by a shared `handleResponse()`/`fetch()` path when the status is
   `401` and the current token's `sub` is `public` — never inferred from the message string.
2. **Add `renderSignInRequired({ message, subject })` to `MPNextWidget`.** It emits the
   panel and binds `[data-action="login"]` to `requestLogin(subject)`. One implementation,
   ten call sites.
3. **Make it mode-aware — this is the part that matters.** `AuthSession` already knows the
   resolved mode from `GET /api/embed/auth/config`. The helper reads it and renders:
   - `dual` / `hardened` → a real **Sign In** button (top-level redirect works).
   - `legacy` → instructional copy with no button: *"Please sign in using the sign-in link
     on this page to see your giving."* Optionally still fire the cancelable `loginRequired`
     event so a host page that *does* know how to sign the user in can intercept it.

   This is strictly better than legacy, which always drew a button whether or not it could
   work, and it is the only version that is honest on every customer we have today.
4. **Never render "Try Again" in `needs-auth`.** Reserve it for 5xx and network faults.
5. **Convert the ten widgets** to call the helper. Delete their bespoke error copy for 401.

### Phase 2 — make the signed-out state worth looking at

Legacy's my-giving rendered its chrome plus a `$0,000` placeholder behind the prompt, which
is oddly better UX than a bare panel: the visitor can see what the page *is*. Take that
further than either system did:

- Render the widget's own heading and a **muted skeleton** of its real layout behind the
  prompt, so a signed-out my-giving reads as "your giving lives here, sign in" rather than
  "something went wrong".
- Where the widget has a genuinely public half, show it. `next-my-invoices` and
  `next-my-groups` have none; `next-my-contribution-statement` has none either. But
  `next-group-finder` (C15) does — the finder itself is public and only *Suggest a Group*
  needs a session, so gate the button, not the page.

### Phase 3 — stop it coming back

- **Playwright spec: `auth-only-widgets-signed-out.spec.ts`.** Load every auth-only demo
  page in a never-authenticated context and assert, per widget: no `"Unable to Load"`, no
  `[data-action="retry"]`, and either a `[data-action="login"]` control or instructional
  copy naming the sign-in path. The whole class survived because nothing checked the
  signed-out case — this is the durable fix, and it is cheap.
- The spec must run in both `legacy` and `dual` mode, since the correct answer differs.

## Also fix while you are in here

**C15 — group-finder's Suggest-a-Group dead end.** Ordering, not wording: the visitor types
a group name, a description and a campus, presses Submit, and *then* learns it will not be
accepted. Gate at the click on "Suggest a Group", not at submit. Keep the 401 handler as a
backstop for a token that goes stale mid-form, and make it non-destructive (it already
preserves the entered values — keep that).

## Widgets to convert

`my-groups` · `my-giving` · `my-pledges` · `my-contribution-statement` ·
`statement-preferences` · `my-invoices` · `profile` · `my-household` · `subscriptions` ·
and `online-directory` should adopt the shared helper too so there is one implementation
rather than a reference implementation plus ten copies.

## Acceptance

- Anonymous load of all ten widgets renders a prompt, never `"Unable to Load"`.
- In `dual`, clicking Sign In starts a top-level MP redirect and returns to the same page.
- In `legacy`, no button is drawn and the copy names the page's own sign-in path.
- `[data-action="retry"]` appears only for a simulated 500.
- The new Playwright spec passes in both modes.

## Depends on / unblocks

Independent — start now. Unblocks nothing, but it is the single most visible
"the new widgets are broken" impression a pilot church will form, and it is one change to
one base class.
