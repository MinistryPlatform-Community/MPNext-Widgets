# C81. Every auth-only widget shows a dead error instead of the sign-in affordance the base class already provides

**Widget:** cross-cutting — at least nine `next-*` elements
**Severity:** functional
**Confidence:** confirmed — found independently by four agents on this run, in four
separate widget families, then scoped repo-wide by the main thread.
**Found:** 2026-09-08, comparison run

## The relationship

Four agents each hit this in their own territory and filed it against the widgets they
owned. Those items hold the per-widget evidence and screenshots:

- **C13** — `next-my-groups` (groups agent)
- **C30** — the four auth-only giving widgets (giving agent)
- **C46** — `next-my-invoices` (payments agent)
- **C53** — `next-profile`, `next-my-household`, `next-subscriptions` (people agent)

Independent discovery in four families is what makes this a class rather than four
coincidences. This item records the shared cause and the shared fix; do not close it
without closing those four, and do not close those four by fixing only one widget each.

## Behaviour

Signed out, these widgets render a red "Unable to Load" / "Authentication required"
panel with a **"Try Again" button that cannot succeed** — retrying an anonymous request
produces the same 401 — and **no way to sign in**.

Every legacy counterpart instead renders an `mppw-alert__warning` plus a working
`value="Login"` button, on all of them.

## Why this is worse than a missing feature

The failure is indistinguishable from a broken widget. A visitor who is simply not
signed in is told the widget is broken, handed a control that reliably does nothing, and
given no path forward. On a church's live site that reads as an outage, and the "Try
Again" button actively invites the one action guaranteed not to work. Several of these
widgets — my-giving, my-pledges, my-invoices, contribution statements — are precisely the
surfaces a signed-out visitor lands on from an emailed link.

## Evidence

- The four items above, with screenshots of each widget signed out on both systems.
- CONFIG-MAP §7.3 established the legacy side statically (warning + `Login` button in
  every auth-only legacy widget) and routed it to three agents for runtime confirmation;
  all three confirmed it.
- Repo scope, `packages/embed-sdk/src/`:

  ```
  "Unable to Load" present : my-contribution-statement, my-giving, my-groups,
                             my-invoices, my-pledges, online-directory,
                             statement-preferences, subscriptions
  requestLogin() called    : custom-form, event-details, group-details, group-finder,
                             online-directory, opportunity-details, plan-your-visit,
                             pledge-campaign, user-menu
  ```

## The part that makes this cheap to fix

**The affordance already exists and is already used by nine other widgets.**
`MPNextWidget.requestLogin()` in `packages/embed-sdk/src/shared/base-widget.ts` fires a
cancelable `loginRequired` event and then calls `authSession.login` — and nine
components call it today.

`next-online-directory` appears in **both** lists above: it has the error panel *and*
calls `requestLogin()`. So one widget in the affected family already does the right
thing, which means this is an internal inconsistency with a working in-repo reference
implementation, not a missing capability. (Note that `next-online-directory`'s own
signed-out path cannot currently be exercised end to end because of **C50**.)

## Where to fix

The eight components listed above with "Unable to Load", plus `next-profile` and
`next-my-household` as reported in C53. `base-widget.ts` needs no change.

## Suggested fix

Branch on the failure: a 401/`Authentication required` should render the sign-in prompt
via `requestLogin()`, following `online-directory.ts`; only a genuine transport or server
error should render "Unable to Load" with "Try Again". Doing it in the base class — a
shared "signed out" state the subclasses opt into — would prevent the next widget from
re-introducing it, and would be the smaller change overall than ten separate edits.

Worth pairing with a test that asserts the anonymous render of every auth-only widget
offers a login path, since this whole class survived because nothing checked the
signed-out case.
