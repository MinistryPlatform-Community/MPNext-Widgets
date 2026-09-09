# C41. `next-checkout` tells the payer a failed or declined payment is "being processed"

**Widget:** `next-checkout` (old: `/widgets/Checkout`)
**Severity:** breaking
**Confidence:** confirmed — driven with a non-sandbox PAN and with a server-side failure; both produce the same reassuring message
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy `mpp-checkout` distinguishes its gateway-return states; a decline does not
present as an accepted payment. This was **not** driven to a submit — completing a
transaction on `mpi.ministryplatform.com/widgets/pay` is out of bounds for this run,
because MP's own gateway configuration could not be read — so the statement rests on
the legacy widget's distinct return states, not on a submitted transaction.

## New behaviour

`CheckoutWidget.processPaymentResponse` branches on **`data.paymentReceived` only**:
if it is true the payer sees "Payment received — thank you!", and in *every other
case* they see the amber

> Your payment is being processed. This invoice will update once the payment clears.

The endpoint also returns `success`, and `success: false` means the transaction was
**declined or errored** — not pending. So every negative outcome renders the
reassurance:

- card `4242 4242 4242 4242` (declined by the sandbox rule, `transactionSuccess:false`,
  response `{"success":false,"paymentReceived":false,"message":"Transaction failed"}`)
  → "Your payment is being processed…"
- the C40 infrastructure failure → the identical message.

`next-checkout-complete` handles the same payload correctly: it has the
`else if (data.success)` middle branch and shows "Payment Not Confirmed" for a
decline. Only `checkout.ts` is wrong — and `checkout.ts` is the page the payer is
actually returned to, because `next-checkout` sets the gateway `returnUrl` to its own
page rather than to a complete page.

## Why it matters

A declined card is the most common non-happy path in any payment flow, and this is
the message a registrant sees for it. They stop, believing the money will leave their
account. Nothing on the page contradicts it forcefully — the invoice below still reads
"None Paid" with the full balance, but the banner is the reassuring one. The church
receives no payment and no failed-payment record, and discovers it when the registrant
turns up expecting to be paid up. It also completely masks C40: the amber banner is
exactly what a genuinely pending ACH payment would look like.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/pay-new-declined-card-result.png`
  (declined card `4242…`); `.claude/playwright/widget/screenshots/checkout-new-payment-success-confirmation.png`
  (published test PAN `4111…`, server-side failure — same banner)
- Network: `POST /api/embed/checkout/payment-response` → `200`
  `{"invoiceId":null,"success":false,"paymentReceived":false,"message":"Transaction failed"}`
- Rendered shadow text in both cases: `Invoice Details Your payment is being processed.
  This invoice will update once the payment clears. … Status None Paid … Balance Due $1.00`
- Contrast: the same class of response token loaded by `next-checkout-complete` renders
  "Payment Not Confirmed / We were unable to confirm your payment. Please try again or
  contact us." — `.claude/playwright/widget/screenshots/checkout-complete-new-declined.png`

## Where to fix

`packages/embed-sdk/src/components/checkout.ts:150-171` (`processPaymentResponse`).
The correct three-way branch already exists at
`packages/embed-sdk/src/components/checkout-complete.ts:68-84`.

## Suggested fix

Give `checkout.ts` the same three states, adding a `"failed"` kind to
`this.confirmation` with the coral (`#FF6D6A`) treatment already used by
`nw-cc-card--failed`:

- `paymentReceived` → success, current copy
- `success && !paymentReceived` → pending, current amber copy
- `!success` → **failed**: say so plainly, and keep the Pay form on screen so the
  payer can retry with another card.

The two widgets should share one response-to-state mapper rather than each carrying
its own branch — that divergence is how one of them ended up wrong.
