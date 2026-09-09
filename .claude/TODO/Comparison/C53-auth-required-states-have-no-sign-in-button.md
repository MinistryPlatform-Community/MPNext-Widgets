# C53. Signed-out `next-profile`, `next-my-household` and `next-subscriptions` show an error with a "Try Again" button and no way to sign in

**Widget:** `next-profile`, `next-my-household`, `next-subscriptions` (old: `mpp-about-me`, `mpp-household`, `mpp-subscriptions`)
**Severity:** ux
**Confidence:** confirmed — all three widgets loaded anonymously in a clean browser context on both sites and the rendered affordances enumerated from the shadow roots
**Found:** 2026-09-08, comparison run

This is the runtime answer to CONFIG-MAP §7.3.

## Old behaviour

Every legacy auth-only widget paints the *same* signed-out shape: a
`div.mppw-alert.mppw-alert__warning` with widget-specific copy, plus a **visible
`<input type="button" value="Login">`** that starts the MP login. Measured
anonymously on all four pages I own:

| Page | Warning text | Login button |
|---|---|---|
| `/widgets/AboutMe` | "Please login to view your skills and talents." | visible, `value="Login"` |
| `/widgets/my_household.aspx` | "Please login to see your Household details" | visible, `value="Login"` |
| `/widgets/subscriptions.aspx` | "Please login to view your subscriptions." | visible, `value="Login"` |
| `/widgets/online_directory.aspx` | "Please login to view the online directory." | visible, `value="Login"` |

The wording is a prompt, not an error, and the fix is one click inside the
widget.

## New behaviour

Only `next-online-directory` does this. The other three offer a retry, not a
sign-in:

| Widget | Rendered shadow text, anonymous | Buttons in the shadow root |
|---|---|---|
| `next-profile` | `Authentication required  Try Again` | `Try Again` (`data-action="retry"`) |
| `next-my-household` | `My Household  Authentication required. Please sign in.  Try Again` | `Try Again` (`data-action="retry"`) |
| `next-subscriptions` | `Unable to Load  Authentication required  Try Again` | `Try Again` (`data-action="retry"`) |
| `next-online-directory` | `Please sign in to view the directory.  Sign In` | **`Sign In`** (`data-action="login"`) — correct |

`next-online-directory` already has the right pattern: `attachShellListeners()`
binds `[data-action="login"]` to `this.requestLogin("online-directory")`, which
fires the cancelable `loginRequired` event and then `authSession.login()`. The
other three widgets have no `data-action="login"` anywhere.

Two of the three are also *framed* as failures rather than as a signed-out state.
`next-subscriptions` heads its panel **"Unable to Load"** and `next-profile`
shows a bare **"Authentication required"** with no explanatory sentence — both
read as "this widget is broken", which is how a member will report it.

Underlying cause: all three treat the `401` from their data route as a generic
load error. The routes answer correctly —
`GET /api/embed/profile` → 401, `GET /api/embed/household` → 401,
`GET /api/embed/subscriptions` → 401 — but the widget's catch block renders the
error message through its generic error state instead of branching on 401 into a
sign-in prompt.

## Why it matters

On a church site these widgets sit on a "My Account" page that a member may
reach from a bookmark or an email link, unauthenticated. Legacy handed them a
Login button in place. Ours hands them "Unable to Load" and a button that
re-runs the same failing request, so clicking it produces the identical error
forever. The only way forward is to find a `next-user-menu` elsewhere on the page
— which the host site may not have placed — or to know to go and sign in
somewhere else and come back. It also generates false "the widget is down"
support traffic, because the copy says the widget failed rather than that the
visitor is signed out.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/profile-new-anon.png`
  - `.claude/playwright/widget/screenshots/my-household-new-anon.png`
  - `.claude/playwright/widget/screenshots/subscriptions-new-anon.png`
  - `.claude/playwright/widget/screenshots/online-directory-new-anon.png` — the one that gets it right
  - `.claude/playwright/widget/screenshots/about-me-old-anon.png`, `my-household-old-anon.png`, `subscriptions-old-anon.png`, `online-directory-old-anon.png` — the legacy warning + Login button
- Network, new side, anonymous: `GET /api/embed/auth/config` 200 →
  `POST /api/embed/session` 200 (public token) →
  `GET /api/embed/profile` **401** / `GET /api/embed/household` **401** /
  `GET /api/embed/subscriptions` **401**. So the 401 is available to branch on.
- Shadow-root button enumeration, new side, anonymous, is the table above; old
  side, the `#loginButton` visibility/`value` table above.

## Where to fix

- `packages/embed-sdk/src/components/online-directory.ts:130-155, 245-249` — the
  reference implementation (`access === "denied"` → sign-in prompt;
  `[data-action="login"]` → `requestLogin()`)
- `packages/embed-sdk/src/components/profile.ts` — the load catch and its error
  render
- `packages/embed-sdk/src/components/my-household.ts` — same
- `packages/embed-sdk/src/components/subscriptions.ts:37-52` — `loadSubscriptions()`,
  whose catch sets `this.error` and whose render heads it "Unable to Load"
- `packages/embed-sdk/src/shared/base-widget.ts` — `requestLogin()` already
  exists on the base class, so nothing new is needed

## Suggested fix

Branch on the status, not just the message. In each of the three widgets, when
the data fetch returns `401`, render the signed-out state rather than the error
state: the widget's own one-line prompt plus a **Sign In** button wired to
`this.requestLogin("<widget>")`, exactly as `online-directory.ts` does. Keep
"Try Again" for genuine failures (5xx, network) — the two states should not share
a template.

Since this is the same three-line change in three components, the cleanest form
is a small helper on `MPNextWidget` (say `renderSignInRequired(message)`) that
emits the markup and binds the action, so a fourth auth-only widget cannot get it
wrong. If that helper lands, `next-online-directory` should adopt it too so
there is one implementation.

Worth checking the other auth-only widgets while in here — CONFIG-MAP §7.3 lists
`next-my-giving`, `next-my-groups`, `next-my-invoices`, `next-my-pledges`,
`next-my-contribution-statement` and `next-statement-preferences` as the same
class, owned by other agents on this run; if they report the same shape, this
becomes one cross-cutting fix rather than three.

---

**Part of a cross-cutting class:** see `C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md`.
Four agents found this independently in four widget families (C13, C30, C46, C53). The
sign-in affordance already exists as `requestLogin()` in `base-widget.ts` and is used by
nine other components, so the fix is shared — do not close this item by fixing one widget.
