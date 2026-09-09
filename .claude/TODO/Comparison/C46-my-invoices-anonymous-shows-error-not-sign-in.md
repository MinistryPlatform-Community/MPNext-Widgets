# C46. Anonymous `next-my-invoices` renders "Unable to Load" with a dead "Try Again" instead of a sign-in prompt

**Widget:** `next-my-invoices` (old: `/widgets/my_invoices.aspx`)
**Severity:** functional
**Confidence:** confirmed — loaded both widgets anonymously in a clean browser context and read the rendered nodes and their computed visibility
**Found:** 2026-09-08, comparison run (the check CONFIG-MAP section 7 item 3 asked for)

## Old behaviour

Legacy `mpp-my-invoices` loaded anonymously renders its full search form plus a warning
alert and a working Login button:

    <div class="mppw-alert mppw-alert__warning">
      <span class="mppw-alert__icon"></span>
      <span class="mppw-alert__text">Please login to view your invoices.</span>
    </div>
    <input id="loginButton" type="button" value="Login">      // visible: true

The button is the widget's own affordance and it starts the MP login. The framing is
"you need to sign in", and there is a way to do it in place.

## New behaviour

`next-my-invoices` loaded anonymously renders an error card:

    title:    "Unable to Load"
    subtitle: "Authentication required. Please sign in."
    buttons:  ["Try Again"]
    sign-in affordance: none

`GET /api/embed/invoices` returns `401 {"error":"Authentication required. Please sign
in."}` (correctly — the route rejects `sub === "public"`), and the widget funnels that
into the same generic `this.error` path it uses for a 500. Consequences:

- The heading is wrong: "Unable to Load" reads as a fault in the widget, not as
  "you are not signed in".
- "Try Again" is a dead end. It re-runs `loadInvoices()`, which 401s again, forever.
- There is **no way to sign in from the widget.** `MPNextWidget` provides
  `requestLogin()` (which fires the cancelable `loginRequired` event and then calls
  `authSession.login`) and `next-my-invoices` never calls it — the string
  `requestLogin` does not appear in the file.

## Why it matters

An anonymous visitor is the *normal* first state for an embedded "My Invoices" block on
a church website — a member arrives from an email link before signing in. Legacy told
them what to do and gave them the button. Ours tells them the widget is broken and
offers a button that cannot help, so the visitor's only recovery is to find some other
sign-in entry point on the page. It is also a straight regression in an auth state the
legacy widget deliberately designed for.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-invoices-new-anonymous.png`,
  `.claude/playwright/widget/screenshots/my-invoices-old-anonymous.png`
- New, in-page read of the shadow root at anonymous load
  (`launch({ site: "new", authed: false })`, 6 s settle):

      { title: "Unable to Load",
        subtitle: "Authentication required. Please sign in.",
        buttons: ["Try Again"],
        signInBtn: false }

  Network: `POST /api/embed/session` → `200` (public token), then
  `GET /api/embed/invoices` → **401**.
- Old, in-page read (`launch({ site: "old", authed: false })`, 6 s settle):

      alerts:   [{ c: "mppw-alert mppw-alert__warning",
                   t: "Please login to view your invoices." }]
      loginBtn: { value: "Login", visible: true }

  The search form (Campus / Key Word / Month / Invoice Status / Show Free Events)
  renders alongside it.
- Source: `grep -c requestLogin packages/embed-sdk/src/components/my-invoices.ts` → 0.
  The helper exists at `packages/embed-sdk/src/shared/base-widget.ts` (`requestLogin()`
  → cancelable `loginRequired` → `authSession.login`).

## Where to fix

`packages/embed-sdk/src/components/my-invoices.ts:62-81` (`loadInvoices`, which
collapses every failure into `this.error`) and `:246-265` (the error branch of
`render()`, which owns the "Unable to Load" / "Try Again" markup).

## Suggested fix

Split the 401 out of the generic error path. Track an `unauthenticated` state alongside
`error`, set it when `res.status === 401`, and render a distinct card: a neutral
heading ("Sign in to view your invoices"), the explanatory sentence, and a **Sign In**
button wired to `this.requestLogin()`. Keep "Try Again" only for genuine failures.

Worth doing once and sharing: the same shape is needed by every auth-only widget, and
`next-online-directory` is currently the only one in the SDK with a signed-out prompt
at all (`online-directory.ts:367-368`, "Please sign in to view the directory." + a
"Sign In" button) — that is the pattern to lift into a shared helper on
`MPNextWidget`, so the other auth-only widgets inherit it rather than each inventing
one.

---

**Part of a cross-cutting class:** see `C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md`.
Four agents found this independently in four widget families (C13, C30, C46, C53). The
sign-in affordance already exists as `requestLogin()` in `base-widget.ts` and is used by
nine other components, so the fix is shared — do not close this item by fixing one widget.
