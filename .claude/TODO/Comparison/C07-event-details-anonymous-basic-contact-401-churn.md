# C07. Every anonymous `next-event-details` page load 401s on `basic-contact`, which triggers a pointless token refresh, a second 401 and two console errors

**Widget:** `next-event-details` (old: `/widgets/event_details.aspx`, `mpp-event-details`)
**Severity:** ux
**Confidence:** confirmed — network log from three separate anonymous loads, plus the code path
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-event-details` loaded anonymously makes no failing request. It paints the event,
keeps its registration form in the DOM but hidden, and shows `Join us! Please login to
register.` with a hidden `#loginButton`. Console output on the legacy page is limited
to MP's own standing noise (`[AUTH] No token available when making AJAX request`,
`User not authenticated.`) — no HTTP error.

## New behaviour

`init()` calls `loadBasicContact()` unconditionally
(`packages/embed-sdk/src/components/event-details.ts:356`). That route is
authenticated by design — it returns 401 when `claims.sub === "public"`
(`src/app/api/embed/event-details/basic-contact/route.ts:27-32`) — and the widget
handles the 401 correctly (`event-details.ts:391-395`: set `isAuthenticated = false`,
carry on). The problem is what happens *between* those two points:
`MPNextWidget.fetch()` treats **any** 401 as a stale token and retries after a refresh
(`packages/embed-sdk/src/shared/base-widget.ts:90-102`).

Observed request sequence on `demo-event-details.html?id=<any>`, signed out — identical
on all three events tested:

```
200 GET  /api/embed/auth/config
200 POST /api/embed/session
200 GET  /api/embed/event-details/<id>
401 GET  /api/embed/event-details/basic-contact      <- expected for a public token
200 POST /api/embed/session                          <- pointless refresh
401 GET  /api/embed/event-details/basic-contact      <- same 401 again
```

and in the console, twice:

```
Failed to load resource: the server responded with a status of 401 (Unauthorized)
```

Signed in, the sequence is clean: one `200 GET …/basic-contact`.

## Why it matters

Three costs, all on the most-visited page of the events flow. (1) It doubles
`POST /api/embed/session` traffic for every anonymous event view. That endpoint is
rate-limited to 120 requests per 60s **per IP** (`src/lib/embed/rate-limit.ts`), and a
church behind a single NAT egress — a school, an office, a conference venue — burns
that budget twice as fast, at which point the SDK's token minting starts failing for
real users. (2) Two red 401s in the console on a page that is working perfectly is the
kind of noise that makes a real fault invisible during a support call, and integrators
on customer sites will report it. (3) The refresh is a wasted round-trip on the
critical path of first paint. The legacy widget has no equivalent, so this is a new
cost introduced by the migration.

## Evidence

- Network logs above, captured on `?id=215`, `?id=762` and the anonymous registration
  run: `…/scratchpad/events/08-ed-new.mjs`, `…/11-anon-register.mjs`
- Screenshot: `.claude/playwright/widget/screenshots/event-details-new-215.png` (the page
  renders correctly despite the two 401s)
- Screenshot (legacy, same state, no failing request): `.claude/playwright/widget/screenshots/event-details-old-query.png`
- Code: `event-details.ts:356`, `:388-407`; `base-widget.ts:90-102`;
  `src/app/api/embed/event-details/basic-contact/route.ts:27-32`

## Why it is not simply "the 401 is correct"

It is correct — the route should 401 a public token. The defect is that the shared
fetch wrapper cannot tell "your token expired, retry" from "this endpoint requires a
user and you are anonymous", and the widget asks for a user-scoped resource before it
knows whether it has a user.

## Where to fix

Either side works; the first is cheaper and local:

- `packages/embed-sdk/src/components/event-details.ts:356` / `:388-407` — do not call
  `basic-contact` at all when the page has no user session. `AuthSession` already knows
  (`window.MPNextEmbed.getAuthSession()`), and the widget can decode `sub` from the
  token it is about to send, exactly as the test harness's `assertAuthenticated` does.
- `packages/embed-sdk/src/shared/base-widget.ts:90-102` — do not retry on a 401 that
  the current token cannot fix. Refresh only when the token was actually near/past
  expiry, or let callers opt out with a `fetch(path, init, { retryOn401: false })` flag.
  This also protects every other widget from the same double-request pattern.

## Suggested fix

Do both, smallest first: add the opt-out to `MPNextWidget.fetch()` and pass it from
`loadBasicContact()`, then short-circuit `loadBasicContact()` entirely for an
anonymous session so the request is never made. The 401 branch in the widget stays as
the belt-and-braces path for a token that goes stale mid-session.
