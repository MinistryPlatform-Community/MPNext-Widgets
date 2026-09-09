# `next-event-details` — plan

**Items:** C01 (breaking — see CROSS-2) · C07 (ux) · C49 (receiving side, owned by
`checkout-pay.md`)
**Cutover verdict: blocks pilot cutover. Signed-in registration loses its whole second half.**
**Owns:** `packages/embed-sdk/src/components/event-details.ts`,
`src/services/eventDetailsService.ts`,
`src/app/api/embed/event-details/*`

## What the feedback says

Two problems, both on the most-visited page of the events flow, and both specific to the
authenticated case.

**C01 (breaking).** A signed-in user presses **Register & Add Another**. The write lands
(`POST …/register` → `200`, guid returned), then `GET …/participants/<guid>` → **500**, and
the widget prints *"Saved. Add another person below."* with **no participant list at all** —
no name, no Registered badge, no edit or remove control, no Checkout button. The registration
row exists and the user is told nothing about it: the worst of both outcomes. It also breaks
the resume path, so returning with `?invoiceid=<guid>` can never repopulate a pending invoice
for a signed-in user. Signed **out**, the identical flow works. Root cause is
`@MpLoggedInContactId` — see `CROSS-2-invoice-proc-parameter.md`.

**C07 (ux).** Every anonymous page load 401s on `basic-contact`, which triggers a pointless
token refresh, a second identical 401, and two red console errors:

```
200 GET  /api/embed/event-details/<id>
401 GET  /api/embed/event-details/basic-contact   <- correct for a public token
200 POST /api/embed/session                       <- pointless refresh
401 GET  /api/embed/event-details/basic-contact   <- same 401 again
```

The 401 is *correct* — the route should reject a public token. The defect is that
`init()` asks for a user-scoped resource before it knows whether it has a user, and the
shared fetch wrapper cannot tell "your token expired, retry" from "this endpoint needs a user
and you are anonymous".

## Where the new widget is already better — protect these

- The registration write path itself is correct in both auth states; only the read-back
  breaks.
- `next-event-details` **already implements the hand-off contract** C49 needs —
  `event-id` / `id-parameter-name` and `invoice-id` / `invoice-id-parameter-name`. The
  receiving side is built and unused; the sender (`next-checkout`) is what needs fixing. Do
  not change anything here for C49.
- Anonymous registration works end to end, including the participant list and Checkout button
  — which is what makes C01's inversion so easy to miss.

## Phase 1 — C01, via CROSS-2

`eventDetailsService.ts:527-534` (`getEventParticipantsByInvoice`) adds `@MpLoggedInContactId`
whenever a contact id resolves; the caller supplying it is
`src/app/api/embed/event-details/participants/[invoiceGuid]/route.ts:41-49`.

Drop the parameter, call the proc with `@InvoiceGuid` only, and **enforce ownership in our own
code**: the header row already returns `Contact_ID`, so compare it to the resolved
`mpContactId` and 403/404 on mismatch. That is strictly stronger than delegating to a
parameter the proc does not accept.

Fix this in the same change as `invoiceService.ts:413` (C42). They are two lines in two
services and fixing one leaves the other broken.

## Phase 2 — C07, and the base-class lesson inside it

Two fixes; do both, smallest first. The second protects every other widget.

1. **`MPNextWidget.fetch()` should not retry a 401 the current token cannot fix**
   (`base-widget.ts:90-102`). Add an opt-out — `fetch(path, init, { retryOn401: false })` —
   or, better, refresh only when the token was actually near or past expiry. Today *any* 401
   triggers a refresh-and-retry, which is why one expected rejection becomes two requests and
   two console errors.
2. **Do not call `basic-contact` at all for an anonymous session**
   (`event-details.ts:356`, `:388-407`). `AuthSession` already knows
   (`window.MPNextEmbed.getAuthSession()`), and the widget can decode `sub` from the token it
   is about to send. Keep the existing 401 branch as the belt-and-braces path for a token that
   goes stale mid-session.

**Why this is more than console tidiness.** `POST /api/embed/session` is rate-limited to 120
requests per 60s **per IP**. A church behind a single NAT egress — a school, an office, a
conference venue — burns that budget twice as fast on every anonymous event view, and when it
runs out, token minting starts failing for real users. The refresh is also a wasted
round-trip on the critical path of first paint, and two red 401s on a working page is exactly
the noise that makes a real fault invisible during a support call.

Fix (1) once and every widget stops double-requesting on any legitimately-401ing endpoint.
That is the same shape as `CROSS-1`: the base class does not currently distinguish
"unauthorised" from "unauthenticated", and several symptoms trace back to that.

## Do better than parity

- **Legacy makes no failing request when anonymous** — it paints the event, keeps the
  registration form hidden, and shows *"Join us! Please login to register."* with a hidden
  login button. Once C07's fix lands we match that, and we can do better: the anonymous state
  should show the registration form *disabled with a sign-in prompt* rather than hidden, so a
  visitor can see what registering involves before committing to an account. Coordinate the
  prompt with `CROSS-1`'s mode-aware helper.
- **Make the resume path visible.** `?invoiceid=<guid>` re-entry is a genuinely good feature
  (it is what C49 restores from checkout) and nothing tells a registrant it exists. Once C01
  unblocks it, the saved-registration state should say so: *"You have a registration in
  progress for this event."*
- **The participant panel is the flow's confirmation.** C01 makes it disappear silently. Once
  it is back, consider a defensive render: if the participant read fails for any reason, say
  *"Your registration was saved, but we could not load the list"* rather than printing a
  success line with an empty panel underneath.

## Acceptance

- Signed in, Register & Add Another renders the participant list, Registered badge,
  edit/remove controls and the Checkout button.
- Returning with `?invoiceid=<guid>` repopulates a pending invoice for a signed-in user.
- A signed-in user requesting another contact's invoice GUID gets a 404.
- An anonymous page load issues **one** `POST /api/embed/session` and **zero** console errors.
- A signed-in case is added to the tests covering this path (see `CROSS-2`).

## Depends on / unblocks

**Depends on CROSS-2** for Phase 1. Phase 2 is independent but its base-class half is shared
with `CROSS-1`. Nothing depends on this file, but C49 in `checkout-pay.md` targets this widget
as its destination.
