# C30. The four auth-only giving widgets render a red "Unable to Load" error with a dead "Try Again" when signed out, instead of a sign-in prompt

**Widget:** `next-my-giving`, `next-my-contribution-statement`, `next-statement-preferences`, `next-my-pledges` (old: My Giving, My Contribution Statement, My Pledges)
**Severity:** functional
**Confidence:** confirmed — loaded all four demo pages in a clean, never-authenticated browser context and read the visible shadow text plus every `/api/embed/*` status; did the same on the three legacy pages.
**Found:** 2026-09-08, comparison run

## Old behaviour

Every legacy auth-only widget renders its normal chrome plus a
`mppw-alert mppw-alert__warning` and an `<input type="button" id="loginButton"
value="Login">` that starts the MP login:

- `my_giving.aspx` → *"My Giving | Please login to view your giving information. | [Login] | … Total Giving | $0,000 | … No donations"*
- `my_contribution_statement.aspx` → *"Please login to view your contribution statements. | [Login] | Go Paperless! … | See My Giving Page >"*
- `my_pledges.aspx` → *"My Pledges | Please login to view your pledges | [Login]"*

The message is an *invitation*, and the affordance to act on it is right there.

## New behaviour

All four render the error state, identically:

> **Unable to Load**
> Authentication required. Please sign in.
> **[ Try Again ]**

Network: `POST /api/embed/session` → 200 (a **public** token), then the widget's own
read → **401**, twice (the base widget retries once). `[data-action="retry"]` simply
re-runs the same request, so the button can never succeed while the visitor is
anonymous. Count of Sign In controls inside each element: **0**.

The SDK already has the plumbing: `MPNextWidget.requestLogin()`
(`packages/embed-sdk/src/shared/base-widget.ts`) fires a cancelable `loginRequired`
event and then calls `authSession.login()`. `next-online-directory` and
`next-pledge-campaign` both use it. These four do not.

## Why it matters

The single most common state for a giving widget on a church website is *anonymous* —
a visitor lands on `/giving` before signing in. Legacy tells them what to do and gives
them the button. Ours shows a red failure panel that reads like the site is broken, and
the only control offered is one that is guaranteed to fail. On `next-my-giving` that is
worse still: the panel is indistinguishable from a real outage, so a donor who *is*
signed in but whose token expired cannot tell "sign in again" from "the giving system
is down".

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-giving-new-signedout.png`,
  `my-contribution-statement-new-signedout.png`, `statement-preferences-new-signedout.png`,
  `my-pledges-new-signedout.png`, and the legacy pair
  `my-giving-old-signedout.png`, `my-contribution-statement-old-signedout.png`,
  `my-pledges-old-signedout.png`
- Network (new, anonymous): `200 GET /api/embed/auth/config` → `200 POST /api/embed/session`
  → `401 GET /api/embed/my-giving?year=2026` → `200 POST /api/embed/session` →
  `401 GET /api/embed/my-giving?year=2026`. Same shape for
  `/api/embed/contribution-statements`, `/api/embed/statement-preferences`,
  `/api/embed/my-pledges`.
- The 401 body is `{"error":"Authentication required. Please sign in."}` from the
  `claims.sub === "public"` branch of each route — the widget is printing the server's
  string into its generic error panel.
- Script: `.claude/playwright/widget/scripts/giving/signedout.mjs`

## Where to fix

- `packages/embed-sdk/src/components/my-giving.ts:74-101` (`loadDonations` catch) and
  `:166-177` (the error render)
- `packages/embed-sdk/src/components/my-contribution-statement.ts:38-66`, `:129-141`
- `packages/embed-sdk/src/components/statement-preferences.ts:32-60`, `:135-147`
- `packages/embed-sdk/src/components/my-pledges.ts:69-90`, `:180-192`
- Reference implementation of the wanted state:
  `packages/embed-sdk/src/components/online-directory.ts:367-368`

## Suggested fix

In each `load*()` catch, branch on `res.status === 401` before falling into the generic
error: set an `authRequired` flag and render a neutral (not red) prompt — legacy's
wording is *"Please login to view your giving information."* — with a **Sign In** button
wired to `this.requestLogin("<widget>")`. Keep "Try Again" only for genuine 5xx /
network failures. Worth doing as one shared helper on `MPNextWidget` since at least
these four (plus `next-my-groups`, `next-my-household`, `next-my-invoices`,
`next-subscriptions`, `next-profile` — other agents' widgets) need the same branch.

---

**Part of a cross-cutting class:** see `C81-auth-only-widgets-show-dead-error-instead-of-sign-in.md`.
Four agents found this independently in four widget families (C13, C30, C46, C53). The
sign-in affordance already exists as `requestLogin()` in `base-widget.ts` and is used by
nine other components, so the fix is shared — do not close this item by fixing one widget.

## Resolution — 2026-10-11

**Fixed** (W5, branch `ws/w5-giving`). All four widgets now branch on W0's
`isNeedsAuth(res)` before the generic error path and render W0's shared, mode-aware
`renderSignInRequired()` — no widget hand-rolls a panel or binds `[data-action="login"]`.

- `dual` / `hardened`: the prompt plus a **Sign In** button → `requestLogin("<widget>")`.
- `legacy`: the prompt plus *"Use the sign-in link on this page."*, **no button** (a button
  there would silently no-op), and a passive `loginRequired` event the host can intercept.
- "Try Again" now appears only for genuine faults (5xx / network). A 401 reaching a
  *signed-in* visitor still renders as an error, by W0's design, so nobody is offered
  sign-in in a loop.
- CROSS-1 Phase 2 is in: each widget keeps its own header/title and lays the panel over
  an `aria-hidden`, muted skeleton of its layout (`components/giving-shared.ts` —
  `givingSignedOut()` + `GIVING_SIGNED_OUT_STYLES`; giving-family only, not `shared/`).
- Per-widget prompts in en / es / pt-BR, worded after legacy:
  `myGiving.signInPrompt`, `myPledges.signInPrompt`, `contributionStatement.signInPrompt`,
  `statementPreferences.signInPrompt`.
- Tests: `components/giving-widgets.test.ts` asserts, for each of the four widgets, the
  heading + skeleton + prompt with no "Unable to Load", no retry; no button in `legacy`;
  the button's `loginRequired` `wid` in `dual`; and that a 500 still shows Try Again.
