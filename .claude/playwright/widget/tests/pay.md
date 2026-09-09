# pay — comparison test log

- **New**: `next-pay` — http://localhost:5173/demo-pay.html?token=&lt;request token&gt;
- **Old**: Pay — https://mpi.ministryplatform.com/widgets/pay
- **Tested**: 2026-09-08 by subagent PAYMENTS
- **Auth state(s) tested**: signed out (anonymous) and signed in as PLAYWRIGHT_MP_USERNAME
- **Script**: `…/scratchpad/p6-pay.mjs`, `p7-happy.mjs`, `p10-anon-misc.mjs`, `p11-replay.mjs`, `p12-old-checkout.mjs`

## A legacy baseline DOES exist — correcting the brief

My brief said there was no legacy counterpart because `/widgets/giving.aspx` carries no
payment widget. `giving.aspx` indeed carries only an `mpp-smart-link` out to
`testing.realm.dev` — but `https://mpi.ministryplatform.com/widgets/pay` exists
(200, 4373 bytes, `<mpp-pay>`), confirmed by `curl` and then driven in the browser. It is
not in the sample site's navigation dropdown, which is why it was missed. The
"no legacy behaviour to be compatible with" framing is **withdrawn**.

## Safety envelope — this is the widget where it bites

- **`next-pay` is safe to submit.** It self-declares: `packages/embed-sdk/src/components/pay.ts`
  defines `const TEST_CARD = "4111 1111 1111 1111"`, its doc comment says
  "a clearly-labeled SANDBOX payment gateway … (fake) card details", and it paints a gold
  banner reading `Sandbox payment — use test card 4111 1111 1111 1111`.
  `POST /api/embed/pay/response` succeeds only when the digits equal
  `4111111111111111` and declines everything else; nothing in the repo contacts a card
  processor. I submitted the published test PAN and nothing else.
- **Legacy `mpp-pay` was NOT submitted.** MP's gateway configuration for this domain is
  unreadable to our API user (`dp_Configuration_Settings` is restricted), so I could not
  establish the same way the scout did that no processor is reached. Applying the
  judgement my brief asked for: **enumerating its UI, fields and validation affordances
  is in scope, submitting is not.** Everything below the legacy "Pay" button is recorded
  as untested. I did not seek any card data beyond the published test PAN.

## What I tested

1. **Renders at all** on both systems, and how each behaves with no token.
2. **Field-by-field inventory** of both forms out of the shadow root: id, `name`, `type`,
   `required`, `inputmode`, `autocomplete`, placeholder, and whether a `<label>` is
   associated.
3. **Read-only summary** (`next-pay`): invoice, name, email, amount due — cross-checked
   against the request token's contents and against MP.
4. **Empty submit** with a `page.on("dialog")` trap, checking for the native
   `reportValidity` popup and for the shared-validation contract
   (`aria-invalid`, `aria-describedby`, `role="alert"`, focus movement).
5. **Bad-format submit**: expiry `13/99` (impossible month) and CVV `abc`.
6. **Declined card**: `4242 4242 4242 4242` — a published test PAN that is *not* the
   sandbox's success PAN.
7. **Happy path**: test PAN `4111 1111 1111 1111`, expiry `12/30`, CVV `123`.
8. **In-page double-submit**: rapid double-click on the Pay button, counting
   `POST /api/embed/pay/response` calls.
9. **Token reuse**: Back to checkout, Forward to pay, resubmit; then three server-side
   POSTs of one request token, comparing the `transactionCode` in each response token.
10. **Missing / malformed / expired token** handling.
11. **Responsive** at 390x844, both systems.
12. **MP verification** of what a submit wrote.

## Results

| # | Check | Old (`mpp-pay`) | New (`next-pay`) | Verdict |
|---|---|---|---|---|
| 1 | Renders | yes, full payor + billing + card form | yes, summary + 4-field card form | pass |
| 2 | Sandbox labelling | none (it is MP's real gateway page) | gold banner naming the test PAN | **new is better / safer** |
| 3 | Payor name fields | `payorContact.firstName`, `.lastName`, both required | read-only summary line, not editable | **C48** |
| 4 | Payor email | `payorContact.emailAddress`, `type=email`, required | read-only summary line | **C48** |
| 5 | Payor phone | `payorContact.mobilePhoneNumber`, `type=tel`, required | not collected, not shown | **C48** |
| 6 | Billing address | 5 fields (line 1/2, city, state, postal), 4 required | not collected at all | **C48** |
| 7 | Editable amount | `paymentAmount` input on the gateway page | fixed by the request token | pass (ours is the safer design) |
| 8 | Card number | `cardNumber` | `card-number`, required, `inputmode=numeric` | pass |
| 9 | Expiry | two `<select>`s: `cardExpirationMonth`, `cardExpirationYear` | one text input, placeholder `MM/YY` | **C48** |
| 10 | Bad expiry accepted | impossible by construction (selects) | **`13/99` accepted and submitted** | **C48** |
| 11 | Bad CVV accepted | — | **`abc` accepted and submitted** | **C48** |
| 12 | Luhn / length check on PAN | not observable without a submit | none | **C48** |
| 13 | Bank account / ACH option | offered | none, though `paymentService` maps `Payment_Type_ID` 5 | **C48** |
| 14 | `autocomplete` on card fields | none | none; form is `autocomplete="off"` | note (see below) |
| 15 | Labels associated | yes (`First Name:`, `Last Name*:`, …) | yes (`Name on Card *`, `Card Number *`, `Expiry *`, `CVV *`) | pass both |
| 16 | Empty submit → native popup | native `required` used | **no dialog** (`nativePopup: false`) | **pass — form-validation.ts confirmed** |
| 17 | Empty submit → announced | native bubble | 4x `aria-invalid="true"`, 4x `role="alert"` message, focus to `nw-pay-name` | **new is better** |
| 18 | Declined card messaging | not submitted | round-trips to checkout, which says "being processed" | **C41** (filed against `checkout.ts`) |
| 19 | Test PAN accepted | not submitted | yes, redirects back with a signed response token | pass |
| 20 | Payment recorded in MP | n/a | **nothing written** | **C40** |
| 21 | Rapid double-click | n/a | exactly **1** `pay/response` call — `submitting` re-render disables the button | pass |
| 22 | Request token reusable | not observable | **yes** — unpack 200 again after Back/Forward; 3 POSTs → 3 distinct `transactionCode`s | **C43** |
| 23 | No token | shows its own error | "No payment request was provided." | pass |
| 24 | Forged / expired token | n/a | "Invalid token signature" (403) / "Token expired" | pass |
| 25 | Invoice shown as | (MP's own reference) | the raw `Invoice_GUID`, e.g. `bdfa3fe2-3489-4f2c-9ec8-7ae3a83ea954` | cosmetic note |
| 26 | 390x844 | renders | renders, `@media (max-width:480px)` tightens padding | pass |
| 27 | Amount in summary | — | `$0.01`, matching the request token and the checkout selection | pass |

## Findings filed

- `C48-pay-collects-and-validates-far-less-than-legacy.md` — functional: four fields with required-only validation vs legacy's payor + billing block, `<select>` expiry and ACH option; expiry `13/99` and CVV `abc` are accepted.
- `C43-payment-request-token-unlimited-use.md` — functional: one request token submits any number of times, each with a fresh `transactionCode`.

Findings that surface here but belong to `checkout.ts` and are filed there:
`C40` (nothing is written to MP), `C41` (a decline is reported as "being processed").

## Where the new widget is better

- **It is honestly labelled as a sandbox.** A gold banner naming the test PAN, on every
  render, so nobody mistakes it for a live gateway. Legacy's page gives no such signal,
  which is precisely why I could not safely submit there.
- **The amount is not editable.** It comes from the signed request token, so a payer
  cannot change what they were quoted between the invoice and the gateway. Legacy exposes
  a `paymentAmount` input on the gateway page.
- **Validation is accessible.** No native `reportValidity` popup; per-field
  `aria-invalid`, `aria-describedby` to a `role="alert"` message, and focus moved to the
  first invalid field. On a payment form that is a real obligation and legacy leans on
  native bubbles.
- **Far fewer fields to fill** for the common case, because the payor block is prefilled
  from the invoice — a genuine improvement *when* the invoice payor record is complete.
  C48 is about the case where it is not.

## Observed but NOT filed

- **No `autocomplete` tokens** (`cc-name` / `cc-number` / `cc-exp` / `cc-csc`) on the card
  fields, and `autocomplete="off"` on the form, so browser card fill does not work.
  Defensible for a sandbox and legacy sets none either, so it is parity — noted for
  whoever wires a real gateway, and mentioned inside C48 rather than filed separately.
- **The summary shows the raw invoice GUID** where a payer would expect an invoice
  number. Cosmetic; the C40–C49 block was exhausted by higher-value items.

## Not tested / blocked

- **Any legacy submit**, for the safety reason above. That leaves untested: legacy's
  own validation messages, its decline handling, its receipt email
  (`receipttemplateid="2695"` — see the note appended to C66), and what it writes to MP.
- **What a successful payment writes**, because C40 prevents all writes. The
  `Payment_Detail` allocation, the `Invoice_Status_ID` transition to SomePaid/PaidInFull,
  and the `Transaction_Code` idempotency guard are all unexercised.
- **ACH / bank-account path** — no UI exists in `next-pay` to select it, so
  `PAYMENT_TYPE_ACH` (5) in `paymentService` is unreachable from the widget.
- **A real gateway's rejection of a malformed card** — by definition not reachable in
  the sandbox, whose only rule is PAN equality. This is why C48's validation half
  matters: the sandbox cannot distinguish "wrong format" from "declined", so neither can
  the payer.

## MP records created / modified

None by this widget. `POST /api/embed/pay/response` builds a signed token and writes
nothing; the write is attempted downstream by `payment-response` / `payment/notify` and
fails per C40. Verified: `Payments` held exactly one pre-existing row (`Payment_ID` 1,
dated 2024) before and after every submit in this session.

## Screenshots

- `pay-old-initial.png` — legacy `<mpp-pay>` baseline, signed in: the full payor + billing + card form.
- `pay-old-mobile.png` — legacy at 390x844.
- `pay-new-initial.png` — `next-pay` baseline with a live request token: sandbox banner, summary, four fields.
- `pay-new-mobile.png` — new at 390x844.
- `pay-new-validation-empty.png` — empty submit: four `role="alert"` messages, no native popup.
- `pay-new-filled-sandbox-card.png` — the form filled with the published test PAN, immediately before submit.
- `pay-new-declined-card-result.png` — after submitting `4242 4242 4242 4242`: the payer is returned to checkout and told the payment is "being processed" (C41).
- `pay-new-double-submit.png` — after a rapid double-click: one request only.
