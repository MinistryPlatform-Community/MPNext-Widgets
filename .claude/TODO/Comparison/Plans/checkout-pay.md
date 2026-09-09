# `next-checkout` + `next-pay` + `next-checkout-complete` — payments plan

**Items:** C40 (breaking) · C41 (breaking) · C42 (breaking) · C43 (functional, double-charge
vector) · C47 (cosmetic) · C48 (functional) · C49 (functional) · C66 (functional)
**Cutover verdict: blocks pilot cutover. This is the worst-affected flow in the catalogue.**
**Owns:** `checkout.ts`, `pay.ts`, `checkout-complete.ts`, `paymentService.ts`,
`checkoutService.ts`, `invoiceService.ts`, `src/app/api/embed/checkout/*`,
`src/app/api/embed/pay/*`, `src/app/api/embed/payment/notify`

**Three widgets, one plan** — deliberately. C40 is one line in one shared service that
disables all three; C41 is the same response payload rendered two different ways by two of
them. Splitting this into three files would split one bug three ways.

## Product decision recorded 2026-09-09

**`next-pay` is a sandbox stand-in for a vendor-hosted payment page**, not the production
card form. A real processor will host the card entry and collect billing data. That decision
resolves C48 (below) and reshapes what the token contract has to carry, so make it before
touching anything.

## What the feedback says

The whole payment stack is currently a facade. A registrant can complete the entire flow —
mint a request token, enter the published sandbox PAN, receive a signed success response,
get a 200 back from `payment-response` — and **no `Payments` row is ever written**, because
`paymentService` selects `Invoices.Amount_Paid`, a column MP's `Invoices` table does not
have. MP 500s, a bare `catch` swallows it into `{ success: false }`, HTTP 200 throughout.
On top of that, signed-in users cannot start the flow at all (C42), and every non-success
outcome — including a declined card — is reported to the payer as *"Your payment is being
processed"* (C41).

`Payments` held exactly one row (from 2024) before the comparison run and the same single
row after two full sandbox payments and five `payment-response` posts.

## Where the new widgets are already better — protect these

- **`next-pay` uses the shared `form-validation.ts` properly.** Required-field failures set
  `aria-invalid="true"`, wire `aria-describedby` to a `role="alert"` message per field, and
  move focus to the first invalid input, with **zero** native `reportValidity` popups.
  Legacy relies on native `required` and per-field `type`. Keep this.
- **The in-page double-submit guard works.** A rapid double-click produced exactly one
  `POST /api/embed/pay/response` — `submit()` sets `submitting` and re-renders a disabled
  button. The C43 vector is navigation, not the button.
- **`next-checkout-complete` gets the decline branch right** (`else if (data.success)` →
  "Payment Not Confirmed"). It is the reference implementation for C41, not a second victim.

## Phase 1 — make a payment actually record (blocks cutover)

### C40 — drop the phantom column

`paymentService.ts:104-110` selects
`Invoice_ID, Invoice_Total, Amount_Paid, Invoice_Status_ID, Purchaser_Contact_ID, Invoice_GUID`
from the `Invoices` **table**. Confirmed against the MP schema: `Invoices` has twelve columns
and no `Amount_Paid`. This reproduces on every MP domain — it is a schema fact, not an
environment artifact.

**Fix:** drop `Amount_Paid` from the select and take the already-paid total from
`api_MPPW_GetInvoice`'s header, which really does compute one and which
`invoiceService.getCheckoutInvoiceByGuid` already maps. Summing `Payment_Detail` is the other
option; reusing the proc is smaller and keeps one definition of "amount paid" in the codebase.

**Do not "fix" the other two `Amount_Paid` declarations.** `invoiceService.ts:56` and
`eventDetailsService.ts:110` type the *proc* header, which is correct.

### C40b — stop the blanket catch hiding infrastructure faults

The `try/catch` collapsing to `{ success: false, paymentReceived: false, message }` "so the
webhook/response endpoints stay 200" is what kept this invisible for the widget's whole life.
Keep the 200 (webhooks need it) but log at `error` with the MP message, **and change the
response contract** — see C41.

### C41 — replace two booleans with one discriminant

`checkout.ts:150-171` branches on `paymentReceived` alone, so a **declined card** and an
**infrastructure failure** both render the amber *"Your payment is being processed. This
invoice will update once the payment clears."* A registrant reads that and stops, believing
the money will leave their account. The church receives nothing and no failed-payment
record.

The two-boolean payload (`success`, `paymentReceived`) is the root cause: it invites each
widget to invent its own branch, and one of the two got it wrong. Replace it with a single
discriminant:

```ts
status: "received" | "pending" | "declined" | "error"
```

Then **one shared response-to-state mapper** consumed by both `checkout.ts` and
`checkout-complete.ts`, so they cannot diverge again. `checkout.ts` gains the missing
`declined` state with the coral `#FF6D6A` treatment `nw-cc-card--failed` already uses, and —
importantly — **keeps the Pay form on screen so the payer can retry with another card**.
`error` gets its own copy: an infrastructure fault must not be indistinguishable from a
pending ACH payment.

### C42 / CROSS-2 — signed-in checkout 500s

See `CROSS-2-invoice-proc-parameter.md`. Until it lands, the only working
`next-checkout` path is the anonymous one, and nothing in this plan can be demonstrated
signed in.

## Phase 2 — close the double-charge and overpay holes

### C43 — the request token is unlimited-use for 15 minutes

`CheckoutService.decode` verifies signature and `exp` and nothing else: no nonce, no store,
no consumption. Going Back from the pay page and Forward again re-unpacks the same token and
lets you submit again, and `/api/embed/pay/response` mints a **fresh `transactionCode` per
request** — so the `Transaction_Code` idempotency guard in `createPaymentFromResponse` sees
two genuinely distinct transactions and would record both. Three POSTs of one request token
produced three distinct codes, all `transactionSuccess: true`.

There is also **no amount ceiling anywhere**: `createPaymentFromResponse` writes
`Payment_Total: token.amount` without comparing it to the balance, and the "Other amount"
field accepts `999999` on a $1.00 invoice (*"You will pay $999,999.00"*).

**This becomes breaking the moment C40 is fixed**, and back-then-resubmit is one of the two
or three most common things a real payer does when a page seems slow — encouraged, no less,
by the flow's own "Make Changes" affordance. Refunds in MP are manual.

**Fix, both halves:**

1. Give the request token a `jti` and record it spent in the KV store on the first successful
   `/api/embed/pay/response`. `src/lib/embed/session-store.ts` already exposes generic `kv*`
   helpers under `nw:kv:`, and the 60-second OAuth handoff codes in
   `src/lib/embed/embed-session.ts` are the pattern. A second unpack or submit then fails
   cleanly: *"This payment link has already been used — reload the invoice."*
2. Reject server-side any `amount` exceeding the invoice's current balance due (with a
   tolerance for the deposit case), and cap `nw-other-amount` client-side with a message.
   **The server check is the one that matters**; the client cap is courtesy.

The sandbox-stand-in decision makes single-use *more* important, not less: the request token
is the artefact that crosses to a third-party vendor and comes back.

**Use the three-reload replay in C43 as C40's acceptance test.** C43's duplicate rows, the
`Transaction_Code` guard and the checkout success state are all currently masked by C40.

### C66 — receipts

Nothing in this repo has any receipt concept: a case-insensitive grep for `receipt` across
`src/` and `packages/embed-sdk/src/` returns only `Receipted`/`Receipt_Number` columns on the
Donations model. Legacy's checkout page is live-configured with `receipttemplateid="2695"`.

**Put the send on the server, in `PaymentService.createPaymentFromResponse`, immediately
after the `Payments` row is created.** That is the one place all three entry paths converge
(`checkout/payment-response`, `checkout-complete`, and `payment/notify`, which a real vendor
calls server-to-server with no browser involved) and the only one that still works when the
payer closes the tab before the redirect completes.

Thread the template id there as `receipt-template-id` on `next-checkout` → into
`PaymentRequestToken`, so it survives the gateway round trip the way legacy does by putting it
on `mpp-checkout`. Use the existing send mechanism —
`src/services/planYourVisitService.ts` is the in-repo precedent for "read a
`dp_Communications` template, substitute `[merge_token]`s, send". **Do not invent a second
mechanism**; see also `group-details.md`, which needs the same primitive extracted.

Sequence after C40 — there is no completed payment for a receipt to be sent from until then.

## Phase 3 — the things a migrating church visibly loses

### C49 — "Make Changes" drops the event and invoice ids

Legacy renders
`…/event_details.aspx/?id=16&invoiceid=f53eb6ff-…`; ours renders the configured
`back-to-event-url` verbatim, so on the demo the registrant lands on the event *finder* — a
list of all events — with no event context and no invoice.

This is the escape hatch on a payment screen: the registrant sees a total they did not expect
and wants to fix the registration before paying. **And the receiving side already
works** — `next-event-details` has `event-id` / `id-parameter-name` and `invoice-id` /
`invoice-id-parameter-name`. The hand-off contract is implemented and unused.

Fix: add `eventId` to `CheckoutLineItem` (or to the invoice header — in practice one invoice
is one event) and populate it in `invoiceService` from the proc row that already returns it;
build the href with `URL`/`URLSearchParams` rather than string interpolation; fall back to
the bare `back-to-event-url` for a non-event invoice.

**Keep our label.** "Make Changes" is a clearer call to action than "Back to Event Details" —
this is a case where the new widget is better and the drift should stand.

### C47 — zero-total invoice says "Paid in full" under "Status: None Paid"

`renderStatusSection` decides on `balanceDue <= 0`, which is true for a free registration
nobody has paid anything toward. So the widget shows *"None Paid"* and *"Paid in full"* three
lines apart, in the success colour. Free-event invoices are not an edge case — the same
contact's list held three, and legacy `mpp-my-invoices` has a "Show Free Events" toggle for
exactly this population.

Separate "nothing to pay" from "has been paid":

- `invoiceTotal <= 0` → neutral copy. Legacy's *"Your Registration is Complete!"* answers the
  member's actual question and reads correctly whether or not there was ever a balance.
  Consider not printing a payment status at all here — MP's status vocabulary is about
  payment and there is no payment to describe.
- `amountPaid > 0 && balanceDue <= 0` → "Paid in full" (the case the string was written for).
- otherwise → the MP status text.

### C48 — resolved by the product decision, but one half still applies

With `next-pay` as a **sandbox stand-in**, legacy's payor-contact and billing-address block
and its card/bank-account choice are the *vendor's* job, not ours. Record that as a decision
rather than leaving C48 open as a gap.

Two things still need doing:

1. **The token contract must carry payor and billing through to the vendor.**
   `PaymentRequestToken` already carries them, but `payor.*` fields are all nullable and
   nothing fills the gaps when the invoice's payor record is sparse — a guest paying someone
   else's invoice sends nothing. Decide where those values come from before a real vendor is
   wired in; that is the real work hiding inside C48.
2. **Add format validation to the sandbox page anyway.** It costs little and the sandbox is
   what every demo, every developer and every E2E run exercises. `form-validation.ts` already
   supports `customValidators` (used by `next-checkout` for its "other amount") and `pay.ts`
   does not use it. Today `13/99` and CVV `abc` submit successfully. Add: card number
   (digits, 13–19, Luhn), expiry (`MM/YY`, month 01–12, not past), CVV (3–4 digits). Consider
   making expiry two `<select>`s as legacy does — that removes a class of error rather than
   reporting it. Also add `autocomplete` tokens (`cc-name`/`cc-number`/`cc-exp`/`cc-csc`)
   so browser card fill works.

## Do better than parity

- **A real "this link was used" state.** Once C43's single-use lands, the Back-button case
  becomes a *designed* screen — "you have already paid this invoice, here is the receipt" —
  rather than a silent second charge. Legacy has no equivalent because its token policy is
  server-side and invisible. This is the flow's biggest UX win.
- **One response contract, one mapper.** The `status` discriminant means a fourth widget or a
  vendor webhook cannot invent a fifth interpretation.
- **Resume by invoice GUID.** `next-checkout` already accepts `invoice-id`; make the paid and
  pending states re-enterable so a payer who closes the tab mid-flow can come back to a
  correct screen instead of a fresh checkout.

## Acceptance

- A sandbox payment writes a `Payments` row, a `Payment_Detail` allocation and moves
  `Invoice_Status_ID`.
- A declined card renders a failed state with the Pay form still on screen.
- An MP fault renders an error state distinguishable from pending.
- The C43 three-reload replay produces **one** payment.
- An amount exceeding balance due is rejected by the route, not just the form.
- A receipt is sent from `createPaymentFromResponse`, using the configured template.
- Signed-in checkout opens (needs CROSS-2).
- "Make Changes" carries `?id=<eventId>&invoiceid=<guid>`.
- A zero-total invoice never says "Paid in full".

## Depends on / unblocks

**Depends on CROSS-2** for anything signed in. C66 depends on C40. C43's acceptance test
depends on C40. **Unblocks `my-invoices.md` C44**, whose fix routes into this flow.
