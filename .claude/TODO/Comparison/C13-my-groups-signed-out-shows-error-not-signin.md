# C13. `next-my-groups` renders an error ("Unable to Load") with a dead "Try Again" button when signed out, instead of prompting the visitor to sign in

**Widget:** `next-my-groups` (old: `mpp-my-groups`, `/widgets/my_groups.aspx`)
**Severity:** functional
**Confidence:** confirmed — both widgets loaded anonymously in a clean browser context and their shadow roots read
**Found:** 2026-09-08, comparison run (groups agent)

## Old behaviour

`/widgets/my_groups.aspx` loaded with no session renders, inside `mpp-my-groups`:

```
My Groups
Please login to view your groups.        [ Login ]
```

Measured: `#myGroupsNotLoggedIn` visible with text *"Please login to view your groups."*,
`#loginButton` visible with value *"Login"*. That button is the standard legacy login
affordance — clicking it starts the MP OAuth top-level navigation, and the visitor comes
back to the same page with their groups listed. The widget frames the state as "you are
not signed in", never as a failure.

## New behaviour

The same anonymous load of `next-my-groups` renders the widget's **error** branch, in
full:

```html
<div class="nw-groups">
  <div class="header">
    <div class="title">Unable to Load</div>
    <p class="subtitle">Authentication required. Please sign in.</p>
  </div>
  <div class="retry-section">
    <button class="retry-btn" data-action="retry">Try Again</button>
  </div>
</div>
```

There is no sign-in control. The only button, "Try Again", calls `retryLoad()`, which
re-issues the same anonymous request and fails the same way — observed on the wire as
`401 GET /api/embed/my-groups` → `200 POST /api/embed/session` → `401 GET /api/embed/my-groups`.
It is a loop with no exit.

The cause is that `my-groups.ts` has no signed-out branch at all: `loadGroups()` treats a
non-`ok` response as an exception (`my-groups.ts:66-70`), stores the server's message in
`this.error`, and `render()` (`:103-116`) paints the "Unable to Load" card for any error,
401 included. Of the auth-only widgets, only `next-online-directory` has an explicit
signed-out prompt in source, so this is likely a pattern shared with the other "my-"
widgets (CONFIG-MAP.md section 7.3 flagged the same suspicion for
`next-my-giving`, `next-my-household`, `next-my-invoices`, `next-my-pledges`,
`next-subscriptions`, `next-my-contribution-statement`, `next-profile`,
`next-statement-preferences`; the sibling agents own those).

Note the demo page hides the widget behind `#widget-container { display:none }` until the
user signs in, so this state is invisible at `http://localhost:5173/demo-my-groups.html`
as shipped — the test unhid it. A customer embedding `<next-my-groups>` on a real page has
no such guard, and the anonymous state is what every first-time visitor sees.

## Why it matters

"My Groups" is a page a signed-out visitor reaches constantly — a bookmark, a nav link, a
returning user whose 30-minute MP token has lapsed. The legacy widget turns that into a
one-click sign-in. Ours tells the visitor the page is broken ("Unable to Load") and hands
them a button that cannot succeed, with no route to the thing that would fix it. The
church's support inbox gets "your groups page is down"; the visitor never reaches their
groups. It is also a straight regression of the BRIEF's auth requirement that a signed-out
user be *prompted*, not shown an error.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/my-groups-new-signed-out.png`
  - `.claude/playwright/widget/screenshots/my-groups-old-signed-out.png`
- Measured anonymous state:
  - old: `{"notLoggedIn":{"vis":true,"text":"Please login to view your groups."},"loginBtn":{"vis":true,"text":"Login"}}`
  - new: `{"buttons":["Try Again"]}` and the error HTML quoted above
- Network on the new side: `200 /api/embed/auth/config`, `200 POST /api/embed/session`,
  `401 GET /api/embed/my-groups`, `200 POST /api/embed/session`,
  `401 GET /api/embed/my-groups`
- Script: `.claude/playwright/widget/scripts/groups-mg-compare.mjs`
- Signed-in parity is exact (2 groups, same order, same "Leader" badge, same Group Connect
  links) — see `.claude/playwright/widget/tests/my-groups.md`; this item is only about the
  anonymous state.

## Where to fix

`packages/embed-sdk/src/components/my-groups.ts` — `loadGroups()` (`:60-81`) and
`render()` (`:89-118`).

## Suggested fix

Give the widget a third state between "loading" and "error". In `loadGroups()`, branch on
`res.status === 401` and set something like `this.needsAuth = true` rather than
`this.error`; in `render()`, paint a sign-in panel for it. `MPNextWidget.requestLogin()`
is the shared affordance the base class already provides (it fires the cancelable
`loginRequired` event, then hands off to `AuthSession.login()`), and
`next-group-details` already uses exactly this shape — copy its panel
(`group-details.ts:640-646`):

```html
<div class="gd-login-panel">
  <p>Please sign in to see your groups.</p>
  <button class="gd-btn gd-btn--primary" type="button" data-action="login">Sign In</button>
</div>
```

Two things to get right while doing it: the panel must not offer "Try Again" (it cannot
work), and in `legacy` auth mode `AuthSession.login()` is not the live path — the host page
signs in through `<mpp-user-login>`/`next-user-menu` — so the `loginRequired` event needs
to remain cancelable and the copy should read as an instruction ("Please sign in above to
see your groups") rather than promising a button that does nothing. Worth fixing across
the whole "my-" family in one pass with the sibling agents' findings.

---

**Part of a cross-cutting class:** see `C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md`.
Four agents found this independently in four widget families (C13, C30, C46, C53). The
sign-in affordance already exists as `requestLogin()` in `base-widget.ts` and is used by
nine other components, so the fix is shared — do not close this item by fixing one widget.
