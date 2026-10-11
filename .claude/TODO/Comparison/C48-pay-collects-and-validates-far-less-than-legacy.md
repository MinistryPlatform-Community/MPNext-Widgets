# C48. `next-pay` collects four fields with required-only validation, where legacy `mpp-pay` collects payor contact + billing address and offers a bank-account option

**Widget:** `next-pay` (old: `/widgets/pay`)
**Severity:** functional
**Confidence:** confirmed — both forms enumerated field by field in the browser; the legacy form was **not submitted** (out of bounds)
**Found:** 2026-09-08, comparison run

## Old behaviour

`https://mpi.ministryplatform.com/widgets/pay` renders `<mpp-pay>` with a payor and
billing block **in addition to** the card block. Enumerated from its shadow root:

| Field | `name` | type | required |
|---|---|---|---|
| First Name | `payorContact.firstName` | text | yes |
| Last Name | `payorContact.lastName` | text | yes |
| Email Address | `payorContact.emailAddress` | **email** | yes |
| Phone Number | `payorContact.mobilePhoneNumber` | **tel** | yes |
| Address Line 1 | `billingAddress.addressLine1` | text | yes |
| Address Line 2 | `billingAddress.addressLine2` | text | no |
| City | `billingAddress.city` | text | yes |
| State / Region | `billingAddress.stateRegion` | text | yes |
| Postal Code | `billingAddress.postalCode` | text | yes |
| Payment amount | `paymentAmount` | text | — (editable on the gateway page) |
| Card number | `cardNumber` | text | — |
| Expiry month | `cardExpirationMonth` | **select** | — |
| Expiry year | `cardExpirationYear` | **select** | — |

Two things beyond the field list: the expiry is a pair of `<select>`s, so an impossible
month or a past year cannot be typed at all; and the page offers a payment-method
choice (card vs bank account) rather than card only.

## New behaviour

`next-pay` renders exactly four inputs, all `type="text"`, all validated only for
presence:

| Field | `name` | type | validation |
|---|---|---|---|
| Name on Card | `name-on-card` | text | required |
| Card Number | `card-number` | text (inputmode numeric) | required |
| Expiry | `expiry` | text, placeholder `MM/YY` | required |
| CVV | `cvv` | text (inputmode numeric) | required |

Payor name/email and the whole billing address are read-only summary lines taken from
the request token, not editable fields; the amount is fixed by the request token; there
is no bank-account/ACH option in the UI even though `paymentService` maps
`Payment_Type_ID` 5 for ACH.

**No format validation of any kind.** The form accepts and forwards expiry `13/99`
(month 13) and CVV `abc` — both submitted successfully; the request reached
`POST /api/embed/pay/response` and returned 200 with a signed response token. There is
no Luhn check on the PAN, no length check, no month range, no past-date check, no
numeric constraint on the CVV. The sandbox's only rule is "is this the test PAN", so a
wrong-format card is reported as a decline rather than as a correctable input error
(and per C41 that decline is then shown as "being processed").

The card inputs also carry no `autocomplete` tokens (`cc-name` / `cc-number` /
`cc-exp` / `cc-csc`); the form is `autocomplete="off"`, which is defensible for a
sandbox but means browser/password-manager card fill does not work.

What `next-pay` does better, for the record: it uses the shared
`form-validation.ts`, so required-field failures produce `aria-invalid="true"`,
`aria-describedby` pointing at a `role="alert"` message per field, and focus moves to
the first invalid input — with no native `reportValidity` popup. Legacy relies on
native `required` and per-field `type`.

## Why it matters

Two distinct gaps. **Data**: a real card payment normally needs a billing address for
AVS, and a payor email/phone for the receipt and for reconciliation; legacy collects
and posts them, ours can only pass through whatever the invoice's payor record already
holds — so a guest paying someone else's invoice, or a payor with no address on file
(the `payor.*` fields are all nullable), sends nothing. **Validation**: a mistyped
expiry or CVV is the most common payer error there is, and ours cannot tell the payer
what they got wrong; it round-trips to the gateway and comes back as a generic
failure. When a real processor replaces the sandbox, malformed input becomes a real
declined authorisation with a real cost.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/pay-new-initial.png`,
  `.claude/playwright/widget/screenshots/pay-new-mobile.png`,
  `.claude/playwright/widget/screenshots/pay-new-validation-empty.png`,
  `.claude/playwright/widget/screenshots/pay-old-initial.png`,
  `.claude/playwright/widget/screenshots/pay-old-mobile.png`
- New field inventory, read from the shadow root: four inputs, all
  `type: "text"`, `required: true`, `autocomplete: null`; form `novalidate: true`,
  `autocomplete: "off"`.
- Bad-format submit accepted: name `ZZTEST Payments Agent`, card
  `4242 4242 4242 4242`, **expiry `13/99`**, **CVV `abc`** →
  `POST /api/embed/pay/response` **200**, redirect back to the checkout page with a
  response token. No field was rejected client-side.
- Empty submit (the good half): all four inputs got `aria-invalid="true"`, four
  `role="alert"` messages appeared (`mpx-err-name-on-card`, `mpx-err-card-number`,
  `mpx-err-expiry`, `mpx-err-cvv`), focus landed on `nw-pay-name`, and no browser
  dialog fired (`nativePopup: false`).
- Legacy field inventory as tabulated above, read from `mpp-pay`'s shadow root while
  signed in. **The legacy form was never submitted** — MP's gateway configuration for
  this domain could not be read, so completing a transaction there stays out of bounds.

## Where to fix

`packages/embed-sdk/src/components/pay.ts:220-270` (`renderForm`) and the validation
options at `:9-16` (`PAY_VALIDATION_OPTS`).
`packages/embed-sdk/src/shared/form-validation.ts` already supports
`customValidators`, which is how `next-checkout` validates its "other amount"
(`checkout.ts:212-224`) — the mechanism is there and unused here.

## Suggested fix

Take the validation half first; it is cheap and self-contained. Add
`customValidators` for `card-number` (digits only, 13-19 length, Luhn), `expiry`
(`MM/YY`, month 01-12, not in the past) and `cvv` (3-4 digits), with messages that name
the problem. Consider making the expiry two `<select>`s as legacy does, which removes
a whole class of error rather than reporting it.

The collection half is a product decision, not a bug fix, and should be recorded as
such: does `next-pay` intend to be a stand-in for a hosted vendor page (in which case
the vendor collects billing data and the gap is only in the sandbox's fidelity), or the
real form? If the former, `PaymentRequestToken` should still carry the payor's address
through to `PaymentResponseToken` — it currently does, but with nothing able to fill the
gaps when the invoice payor record is sparse. If the latter, the billing block and the
ACH option both need building, and `Payment_Type_ID` 5 needs a UI to select it.

## Resolution — 2026-10-11

**Product half: decided (2026-09-09, recorded in `Plans/checkout-pay.md`).** `next-pay` is a
**sandbox stand-in** for a vendor-hosted payment page, not the production card form. Legacy's
payor-contact block, billing-address block and card / bank-account choice are the
**vendor's** job. They are therefore not a gap in `next-pay`, and this item does not port
them.

**Format half: fixed (epic W1, branch `ws/w1-payments`).** The sandbox is what every demo,
developer and E2E run exercises, so it now validates like a processor's hosted page.
`13/99` and CVV `abc` no longer submit:

- **Card number:** digits, with spaces or dashes allowed as separators; 13–19 digits; Luhn
  checksum (`isValidCardNumber`).
- **Expiry:** `MM/YY` or `MM/YYYY`, month 01–12, and not past (`checkExpiry`). A card is good
  through its expiry month, so the current month passes. Malformed and expired get different
  messages.
- **CVV:** 3–4 digits (`isValidCvv`).
- Wired as `customValidators` in the existing `form-validation.ts` usage, so the protected
  behaviour stays intact: `aria-invalid`, a `role="alert"` message per field, focus to the
  first invalid field, no native popup, and the double-submit guard. An empty field is left to
  `required`, so it keeps its "please enter…" message.
- The controls now come from W0's `field()`. Each has a real `<label for>`, the
  `cc-name` / `cc-number` / `cc-exp` / `cc-csc` autocomplete tokens, `inputmode="numeric"` on
  the numeric fields, and `maxlength` limits. The form-level `autocomplete="off"`, which
  defeated browser card fill, is gone.
- **Decision:** expiry stays one `MM/YY` text field rather than legacy's two `<select>`s. With
  `cc-exp` autofill and the format check, the class of error the selects remove is now
  reported precisely, and one field is what processors' hosted pages use.
- Copy (`pay.invalidCard`, `invalidExpiry`, `expiredCard`, `invalidCvv`) is in en / es /
  pt-BR.
- **Tests:** `packages/embed-sdk/src/components/pay.test.ts` (new) covers the pure checks
  (Luhn, lengths, separators, the expiry boundary month, malformed months) and the widget
  wiring (labels, autocomplete tokens, and `13/99` + `abc` marked `aria-invalid` with no
  `/pay/response` request sent).

**Open, for the vendor integration (not this epic):** *where payor and billing data come from.*
`PaymentRequestToken` carries `firstName`…`addressZip` from the invoice purchaser's MP record,
and all of them are nullable. When that record is sparse, or a guest pays someone else's
invoice, nothing fills the gaps. Before a real processor is wired in, decide whether the
vendor page collects billing details itself (most hosted pages do), or whether `next-checkout`
should collect and pass them. The vendor also has to echo `receiptTemplateId` (C66) and keep
the request `jti` single-use semantics (C43) in its own flow.
