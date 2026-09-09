# checkout-complete — comparison test log

- **New**: `next-checkout-complete` — http://localhost:5173/demo-checkout-complete.html?token=&lt;response token&gt;
- **Old**: `mpp-checkout-complete` — **no sample page exists**; injected into the `/widgets/pay` shell per CONFIG-MAP section 5
- **Tested**: 2026-09-08 by subagent PAYMENTS
- **Auth state(s) tested**: signed out (anonymous) for the new widget; signed in as PLAYWRIGHT_MP_USERNAME for the legacy injection attempt
- **Script**: `…/scratchpad/p9-complete.mjs` (edge cases + replay), `pay-old-cc.mjs` (legacy injection)

## The legacy counterpart exists in the loader table but its bundle is broken

My brief said no legacy payment surface exists. That was wrong for `next-checkout` and
`next-pay` (see `checkout.md` / `pay.md`). For **this** widget the answer is more
specific, and I established it rather than assuming it:

- `mpp-checkout-complete` **is** in MPWidgets.js's tag table, mapped to
  `/widgets/dist/CheckoutComplete.js`, and takes no attributes.
- The sample site has **no page** carrying it, so I drove it the way CONFIG-MAP section 5
  prescribes: `page.route`'d `/widgets/pay`, rewrote the shell's one widget line from
  `<mpp-pay>` to `<mpp-checkout-complete></mpp-checkout-complete>` **before**
  `DOMContentLoaded` so MPWidgets.js's own scan would see it, and loaded the page signed
  in.
- **MP's own bundle then failed to register the element.** After 9 seconds:
  `customElements.get("mpp-checkout-complete")` is **false**, no shadow root exists, and
  the page throws `at.registerComponent is not a function`. `listShadowHosts` shows only
  `mpp-locale-selector` and `mpp-user-login`.

So there is **no drivable legacy baseline for this widget** — not because the page is
missing (I worked around that) but because `CheckoutComplete.js` is broken on this MP
domain. That is a fault on MP's side, not in this repo, and I am not filing it against
us. Attribute parity was already settled statically by CONFIG-MAP section 4.10: legacy
takes no attributes, ours adds `token` — parity plus one.

## What I tested

Every path into this widget, since it is the landing page for a gateway return and
therefore the one most likely to be loaded in a state nobody designed for. Response
tokens were minted locally with the dev default signing key
(`PAYMENT_JWT_SIGNING_KEY` is unset, so `checkoutService` falls back to
`development-payment-signing-key-change-me`) so I could construct each state precisely.

1. **Direct load with no `token` at all** — the "someone bookmarked the thank-you page" case.
2. **Garbage token** (`?token=not-a-jwt`).
3. **Forged signature** — a valid token with its last four signature characters replaced.
4. **Expired token** — `exp` 60 s in the past.
5. **Declined transaction** — a validly signed token with `transactionSuccess: false`.
6. **Valid success token, first load.**
7. **Replay: the same valid token reloaded three more times** — the double-write probe.
8. **Responsive** at 390x844.
9. **A11y**: heading structure, live regions, whether the retry control is a real button.
10. **MP verification** of `Payments` before and after all of the above.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Element registers | **no** — `at.registerComponent is not a function` | yes | MP-side fault, not filed |
| 2 | No `token` | n/a | "Payment Not Confirmed / No payment information was found.", no retry button offered | **pass** |
| 3 | Garbage token | n/a | failed card, 500 from `payment-response`, message shown | pass |
| 4 | Forged signature | n/a | **403** `Invalid token signature`, "Payment Not Confirmed" | **pass — signature is enforced** |
| 5 | Expired token | n/a | "Payment Not Confirmed / Token expired" | **pass** |
| 6 | Declined transaction | n/a | "Payment Not Confirmed / We were unable to confirm your payment. Please try again or contact us." | **pass — correct, unlike `next-checkout` (C41)** |
| 7 | Valid success token | n/a | "Payment Not Confirmed" — because the MP write fails | **C40** (root cause is in `paymentService`, filed against the flow) |
| 8 | Same token reloaded 3x | n/a | same message each time; 3 further `payment-response` posts, all 200 | see "Not tested" — no write to duplicate |
| 9 | Retry control | n/a | real `<button data-action="retry">`, offered only when a token is present | pass |
| 10 | Heading structure | n/a | `<h2 class="nw-cc-title">` present | **better than `next-checkout`**, which has no headings |
| 11 | Live region | n/a | none (`[aria-live]` / `role=status` count 0) | ux note, below |
| 12 | Three visual states | n/a | success (green `#86AD3F`), pending (gold `#F1BE48`), failed (coral `#FF6D6A`) top border + icon | pass |
| 13 | 390x844 | n/a | renders, `@media (max-width:480px)` reduces padding | pass |
| 14 | MP rows written | n/a | **none, ever** | **C40** |

## Findings filed

None unique to this widget. Everything wrong that this widget *surfaces* is
attributable elsewhere and filed there:

- `C40-payments-never-recorded-amount-paid-column.md` — the reason a valid success token
  still renders "Payment Not Confirmed". This widget's evidence
  (`checkout-complete-new-initial.png`) is cited in that item.

Notably, **this widget is the reference implementation for C41**: it maps the
`payment-response` payload to three states correctly (`paymentReceived` → success,
`success` → pending, otherwise → failed), which is exactly what `checkout.ts` fails to
do. C41's suggested fix points at `checkout-complete.ts:68-84`.

## Where the new widget is better

- **It exists and works.** The legacy counterpart's bundle does not load at all on this
  MP domain.
- **Correct three-way outcome mapping** — the one place in the payment stack that gets a
  decline right.
- **Signed-token discipline is visible and enforced**: a forged signature is a clean
  403 with a payer-safe message, and an expired token says so.
- **Direct load without a preceding payment is handled gracefully** — one of the two
  edge cases my brief flagged as most likely to be a real defect. It is not: no token
  produces a specific, calm message and deliberately withholds the retry button.
- **Proper heading** (`h2`), where `next-checkout` and `next-my-invoices` use `div`s.

## Observed but NOT filed

- **No live region.** The card swaps from "Confirming your payment…" to the outcome with
  no `aria-live`/`role="status"`, so a screen-reader user gets no announcement that the
  result arrived on a page whose entire content is that result. Low cost to fix
  (`role="status"` on `.nw-cc-msg`, or `aria-live="polite"` on `.nw-cc-card`), but the
  C40–C49 block was exhausted by higher-value items.

## Not tested / blocked

- **Legacy behaviour of any kind** — `CheckoutComplete.js` does not register (see above).
  Unblocking would need MP to fix that bundle; there is no workaround from our side.
- **Whether the token replay in check 8 would double-write.** Blocked by C40: nothing is
  written on the first load, so nothing can be duplicated on the fourth. The
  `Transaction_Code` idempotency guard in `paymentService.createPaymentFromResponse` is
  the mechanism that should catch it, it looks correct in source, and it is unexercised.
  **Re-run this check as the acceptance test for C40** — three reloads of one response
  token must leave exactly one `Payments` row.
- **The success rendering** ("Payment Complete", green) — never reached, for the same
  reason. Only the pending and failed states were observed live.

## MP records created / modified

None. Eight `POST /api/embed/checkout/payment-response` calls were made across these
cases; `GET /tables/Payments?$orderby=Payment_ID DESC` held exactly one pre-existing row
(`Payment_ID` 1, dated 2024) before and after, and `Invoices` 3 stayed at
`Invoice_Status_ID = 1`.

## Screenshots

- `checkout-complete-old-initial.png` — the legacy injection attempt: `mpp-checkout-complete` present in the DOM, never upgraded, nothing rendered.
- `checkout-complete-new-initial.png` — valid success token, first load: "Payment Not Confirmed" because of C40. This is the widget's baseline render.
- `checkout-complete-new-mobile.png` — 390x844.
- `checkout-complete-new-no-token.png` — direct load with no token.
- `checkout-complete-new-garbage-token.png` — `?token=not-a-jwt`.
- `checkout-complete-new-forged-token.png` — tampered signature, 403.
- `checkout-complete-new-expired-token.png` — expired `exp`.
- `checkout-complete-new-declined.png` — `transactionSuccess: false`, correctly reported as not confirmed (the contrast case for C41).
- `checkout-complete-new-replayed-token.png` — after three reloads of the same token.
