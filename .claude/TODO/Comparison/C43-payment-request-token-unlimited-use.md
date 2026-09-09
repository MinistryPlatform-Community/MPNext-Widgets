# C43. The payment request token is unlimited-use for 15 minutes: Back-then-resubmit mints a second, distinct payment for the same invoice, and no overpayment guard exists

**Widget:** `next-pay` / `next-checkout` (old: `/widgets/pay`)
**Severity:** functional (a double-charge vector; becomes breaking the moment C40 is fixed)
**Confidence:** confirmed for the token reuse and the distinct transaction codes; the duplicate `Payments` rows themselves are **unverified** because C40 stops all writes
**Found:** 2026-09-08, comparison run

## Old behaviour

Not established. Submitting a payment on `mpi.ministryplatform.com/widgets/pay` is out
of bounds for this run — MP's own gateway configuration could not be read, so we cannot
prove no processor is reached there — and MP's request-token single-use policy is
server-side and not observable from the outside. **Do not read this item as "legacy is
better"; read it as "our side has no guard and the legacy side was not tested".**

## New behaviour

`next-checkout` calls `/api/embed/checkout/payment-token` once and puts the signed
request token in the URL of the processor page (`/demo-pay.html?token=…`). That token:

- has a **15-minute TTL** and **no single-use marker** —
  `CheckoutService.decode` verifies signature and `exp` and nothing else; no nonce,
  no store, no consumption;
- survives browser navigation. Going Back from the pay page to checkout and Forward
  again re-runs `GET /api/embed/pay/unpack` on the same token (200), repaints the card
  form and lets you submit again;
- yields a **fresh `transactionCode`** on every submit, because
  `/api/embed/pay/response` calls `crypto.randomUUID()` per request. Three POSTs with
  one request token returned three response tokens with three different codes, each
  `transactionSuccess: true, amount: 0.01`.

That last point is what makes it a double-charge rather than a replay: the
`Transaction_Code` idempotency guard in `PaymentService.createPaymentFromResponse`
deduplicates a *re-posted* response token, but two submits of the same **request**
token are two genuinely distinct transactions to that guard, so both would be recorded.

Nor is there an amount ceiling anywhere. `createPaymentFromResponse` writes
`Payment_Total: token.amount` without comparing it to the invoice balance, and
`next-checkout`'s "Other amount" field accepts any positive number — entering `999999`
on a $1.00 invoice shows "You will pay $999,999.00" and posts it happily. So a second
submit overpays the invoice with nothing to stop it, and `Invoice_Status_ID` just lands
on `PaidInFull`.

Within a single page the widget *is* safe: a rapid double-click produced exactly one
`POST /api/embed/pay/response`, because `submit()` sets `submitting` and re-renders a
disabled button. The vector is navigation, not the button.

## Why it matters

Back-button-then-resubmit is one of the two or three most common things a real payer
does when a payment page seems slow, and it is exactly what the flow's own "Make
Changes" affordance encourages. Once C40 is fixed, that gesture takes a second payment
for the same invoice with no dedupe and no overpay check, and neither the payer nor the
church is warned. Refunds in MP are manual.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/checkout-new-back-mid-flow.png`
  (Back from pay → checkout still fully payable),
  `.claude/playwright/widget/screenshots/pay-new-double-submit.png`,
  `.claude/playwright/widget/screenshots/checkout-new-overpay-allowed.png`
  ("You will pay $999,999.00" on a $1.00 invoice)
- Network, token reuse: `GET /api/embed/pay/unpack?token=<same token>` → `200` on the
  first visit and `200` again after `goBack()` + `goForward()`.
- Three POSTs of the identical request token to `/api/embed/pay/response`, card
  `4111111111111111`:

      1  200  transactionSuccess:true  amount:0.01  transactionCode 1f8ff7c4-…
      2  200  transactionSuccess:true  amount:0.01  transactionCode cf7068fc-…
      3  200  transactionSuccess:true  amount:0.01  transactionCode 972a0d43-…

  distinct transaction codes: 3 of 3.
- Rapid double-click on the pay button: `pay/response` call count = **1** (the
  in-page guard works).
- **Not verified:** that two duplicate `Payments` rows actually land, because C40
  prevents any row from being written. `Payments` still holds one pre-existing row.

## Where to fix

- Single-use: `src/services/checkoutService.ts` (`decode` / `decodeRequestToken`) plus
  a consumption record — `src/lib/embed/session-store.ts` already exposes generic
  `kv*` helpers under `nw:kv:`, which is where the one-time OAuth handoff codes live
  (`src/lib/embed/embed-session.ts`), so the pattern exists.
- Amount ceiling: `src/services/paymentService.ts:createPaymentFromResponse`, and the
  client-side cap in `packages/embed-sdk/src/components/checkout.ts:230-240`
  (`selectedAmount` / the `nw-other-amount` validator).

## Suggested fix

Give the request token a `jti` and record it as spent in the KV store on the first
successful `/api/embed/pay/response`, mirroring the 60-second handoff codes; a second
unpack or submit then fails cleanly with "this payment link has already been used —
reload the invoice". Independently, reject in `paymentService` any `amount` that
exceeds the invoice's current balance due (a small tolerance for the deposit case),
and cap `nw-other-amount` at `balanceDue` client-side with a message. The server check
is the one that matters; the client cap is courtesy.
