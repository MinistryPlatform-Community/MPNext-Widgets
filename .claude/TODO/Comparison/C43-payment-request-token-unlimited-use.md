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

## Resolution — 2026-10-11

**Fixed (epic W1, branch `ws/w1-payments`).** Both halves.

**1. Single-use request token.**
- `PaymentRequestToken` gained `jti` (`packages/types/src/payment-token.ts`).
- `CheckoutService.issueRequestToken()` mints it and records it open in the KV store
  (`nw:kv:pay:req:<jti>`, TTL = token TTL + 60s). It throws when the store is unreachable,
  because an unrecorded token could never be spent and so must not be issued.
- `isRequestOpen()` / `spendRequest()` read and spend it. `spendRequest` uses `kvGetDelete`,
  so exactly one caller wins, including concurrent callers.
- `pay/response` **spends** the `jti` on a successful submit. A **decline only checks** that
  it is open, so the payer can try another card on the same page; that is a deliberate
  refinement of "spend on first successful submit". A spent token answers
  `409 verification_used`.
- `pay/unpack` refuses a spent token with the same code, so Back/Forward no longer repaints a
  live card form. A token with no `jti` (minted before this change, or forged without the
  ledger) is refused the same way. Store unavailable → `503 mp_unavailable`, failing closed.
- **Second replay layer, in the record path.** One request token now yields at most one
  successful response token, but that one response token can still be posted repeatedly (a
  checkout page reloaded with `?token=` still in the URL, or a vendor webhook racing the
  browser). `createPaymentFromResponse` therefore checks `Transaction_Code` first, then
  *claims* the code (`kvIncrement` on `pay:txn:<code>`, 120s) and re-checks under the claim.
  A concurrent second post answers `pending` ("being recorded") instead of writing a second
  row. A response token without a transaction code is refused (`error`), because the code is
  the idempotency key.

**2. Overpay guard.**
- `exceedsBalance(amount, balanceDue)` (`paymentService.ts`) compares in whole cents, so float
  noise cannot refuse an exact payment. That is the whole tolerance: a deposit or "other
  amount" may equal the balance, never exceed it.
- `checkout/payment-token` refuses an over-balance amount with `422 invalid_request`
  **before any processor sees it**. This is the check that matters.
- `createPaymentFromResponse` refuses it too, as the plan asks. Reaching it there means the
  balance moved between token and response (a second tab paid first). It returns `error` and
  logs `NOT recorded — reconcile manually` with the transaction code, invoice, amount and
  balance. **Decision recorded:** for the sandbox that is right. Once a real vendor is
  wired in, the money has already moved by the time this runs, so revisit whether to record
  the overpayment and flag it rather than drop it. That choice belongs with the vendor
  integration.
- Client courtesy in `next-checkout`:
  - "Other amount" is capped at the balance with `checkout.amountTooHigh`.
  - A deposit not less than the balance is no longer offered.
  - A `422` from the token route reloads the invoice and says the balance changed. The status
    is the signal; no message text is read.

**Designed "already used" state** (the plan's "biggest UX win"): `next-pay` renders a
titled panel for `verification_used` / `verification_expired`. It says nothing more was
charged, offers a "Return to invoice" link (the request's `returnUrl` without `token`) when
known, and **has no Try Again**, because it would fail identically. It emits
`paymentLinkUnavailable`.

**Wire-code decision.** The `errors.*` namespace in `core.ts` is outside W1's ownership, so no
new codes were added. A spent token reuses `verification_used` ("This link has already been
used."), an expired one `verification_expired`, and the overpay `invalid_request` with the
`422` status as the widget's cue. The widgets render their own namespaced copy for the
designed states.

Also fixed in passing: `paymentNotifyUrl` was built from the *request* origin, which is the
church site that embeds the widget, and not this host. It now uses `getPublicUrl(req)`
(`EMBED_PUBLIC_URL`, falling back to the request URL).

**Acceptance — the three-reload replay, unit:** `src/app/api/embed/pay/response/route.test.ts`
drives the real `pay/response`, `pay/unpack` and `checkout/payment-response` routes and the real
`PaymentService` against a stateful mock `Payments` table:
- three submits of one request token give `200, 409, 409`;
- three posts of the resulting response token give `received` ×3;
- exactly **one** `Payments` insert;
- a gated concurrent pair gives `received` + `pending` and still one row;
- a decline does not spend the token; a spent token cannot be unpacked; an over-balance
  response writes nothing.

`src/app/api/embed/checkout/payment-token/route.test.ts` covers 422, exact-balance float
noise, the open `jti`, and the notify URL. `checkout.test.ts` covers the cap, the deposit
hide, and the used state.

**Acceptance — live, with teardown (2026-10-11, the `.env.local` domain):**
1. Created `Invoices` 13 ($1.00, purchaser 2) and `Invoice_Detail` 18.
2. Issued a request token. Three `spendRequest` calls returned `true, false, false`.
3. Posted the one response token through `createPaymentFromResponse` three times, which
   returned `received, received, received`.
4. Result: **one** `Payments` row (3, $1.00), **one** `Payment_Detail` (4 → detail 18, $1.00),
   `Invoice_Status_ID` 1 → **3** (Paid in Full), and the proc reported `Amount_Paid: 1`. This
   is also C40's live acceptance.
5. Teardown deleted `Payment_Detail` 4, `Payments` 3, `Invoice_Detail` 18 and `Invoices` 13,
   all successfully. A follow-up query shows `Payments` back to its single 2024 row and no
   `Invoices` above id 2. **Nothing is owed for cleanup.**
6. Side finding: MP ignores a client-supplied `Invoice_GUID` on create and mints its own.
   Read it back from the created row.
