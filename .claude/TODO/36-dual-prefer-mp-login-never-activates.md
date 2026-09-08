# 36. `dual` + `prefer-mp-login` silently never uses MP's login widget

**Depends on:** nothing (item 35's fix is in; this is the same MPWidgets.js
loader behaviour on the *other* branch of `user-menu.ts`, which item 35 did not
touch).
**Risk:** low, and it fails safe — the widget renders its own Sign In button
instead, which authenticates correctly. But the documented attribute does
nothing, so a customer who sets it to keep MP's own login UI during their
cutover gets the SDK's button anyway and has no way to tell why.
**Size:** ~1 hour including a browser check in `dual` mode.

> Found on 2026-09-08 while fixing item 35. Not a regression from that fix —
> the getter below predates it.

## The problem

`shouldUseMpLoginInDual` (`packages/embed-sdk/src/components/user-menu.ts`)
gates the whole `prefer-mp-login` path on `<mpp-user-login>` being registered
*already*, at the moment the widget renders:

```ts
private get shouldUseMpLoginInDual(): boolean {
  return (
    this.authMode === "dual" &&
    this.hasAttribute("prefer-mp-login") &&
    typeof customElements !== "undefined" &&
    !!customElements.get("mpp-user-login")
  );
}
```

Item 35 established (measured, three runs) that MPWidgets.js only fetches
`/widgets/dist/UserLogin.js` — the script that calls
`customElements.define("mpp-user-login", …)` — for the widget tags it finds
when it scans the document. On a page that does not already carry an
`<mpp-user-login>` tag of its own, nothing is registered until something puts
one in the DOM. So:

- the getter is false because the element is not registered;
- the element is not registered because nobody appended one;
- nobody appended one because the getter is false.

The widget therefore renders `renderSignInButton()` and `prefer-mp-login` is a
no-op on exactly the pages it exists for. It only "works" when the host page
happens to have its own `<mpp-user-login>` elsewhere in the markup.

`user-menu.test.ts`'s *"dual mode with prefer-mp-login and MPWidgets.js present
uses `<mpp-user-login>`"* case masks this: it calls
`customElements.define("mpp-user-login", …)` itself before mounting, which is
the one state the real page never reaches on its own.

## Fix sketch

Decide first whether `prefer-mp-login` should bootstrap MP's widget or only
*adopt* one the host already has — the attribute's docs
(README "Widget attributes") read like the former:

1. **Bootstrap (matches the docs).** Drop `customElements.get(...)` from the
   getter, keying it on the attribute plus some evidence MPWidgets.js is on the
   page (`document.querySelector('script#MPWidgets, script[src*="MPWidgets.js"]')`),
   and let `ensureLightDOMLogin()` + `watchMpLoginRegistration()` — already
   written for item 35 — drive registration exactly as `legacy` now does. Needs
   a decision about what to render *while* the watch is pending: MP's element is
   0 × 0 until it upgrades, so rendering the bare slot means an empty menu for
   ~300ms, and falling back to the SDK button means it may swap under the user.
   Rendering the existing `.nw-placeholder` until either the element upgrades or
   the watch gives up is probably right.
2. **Adopt only.** Keep the getter, and document that `prefer-mp-login`
   requires the host page to carry its own `<mpp-user-login>` (or another
   `mpp-*` widget MP will register from). Cheaper, but it makes the attribute
   nearly pointless.

Whichever way it goes, the behaviour must be observable: a host that sets
`prefer-mp-login` and gets the SDK button instead should see one `console.warn`
saying why.

## Testing

- Change the existing dual + `prefer-mp-login` test so it does **not** pre-define
  `mpp-user-login`, and assert the chosen behaviour from a virgin registry (a
  separate test file, as `user-menu-mp-login.test.ts` does — `customElements`
  cannot be un-defined within a file).
- Browser check in `dual` with `prefer-mp-login` on `demo-user-menu.html`
  (`EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual` on the dev server's
  process env, never in `.env.local`): confirm which login UI renders, that
  `UserLogin.js` is fetched if option 1 is taken, and that signing in still
  yields a `sid` (the silent upgrade) rather than a v1 token.
- Standard verification gate.

## Done when

`prefer-mp-login` either demonstrably renders MP's `<mpp-user-login>` on a page
that carries no `mpp-*` tag of its own, or is documented as adopt-only and warns
when it declines — and a test drives that from an unregistered starting state.
