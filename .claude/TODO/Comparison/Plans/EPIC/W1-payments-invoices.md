# W1 — Payments & invoices (wave 1)

**Branch:** `ws/w1-payments` · **Items:** C80 · C01 · C42 · C40 · C41 · C43 · C47 · C48 · C49 · C66 · C44 · C45 · C46 · C60
**Design source:** `Plans/checkout-pay.md`, `Plans/CROSS-2-invoice-proc-parameter.md`, `Plans/my-invoices.md`
**Owns:** `checkout.ts`, `checkout-complete.ts`, `pay.ts`, `my-invoices.ts` · `paymentService.ts`,
`checkoutService.ts`, `invoiceService.ts`, `eventDetailsService.ts` (the C80 line only) ·
`api/embed/{checkout,pay,payment,invoices}/**`, `api/embed/event-details/participants/**` ·
`packages/types/src/payment-token.ts` · the `checkout`/`pay`/`checkoutComplete` namespaces in
`locales/*/giving.ts`, and the `myInvoices` namespace in `locales/*/account.ts`.

**Status at 2026-10-11:** all open. C42 is partly fixed: `errorText` now stops raw MP text
reaching the payer, but the 500 remains and the routes still return a raw `{error: message}`.

## Order: each step unblocks the next

### 1. C80 / C01 / C42: drop `@MpLoggedInContactId` and enforce ownership ourselves
- Remove the parameter at `invoiceService.ts:412-414` and `eventDetailsService.ts:530-532`.
- Compare the header row's contact with the resolved `mpContactId` and return `404` on a
  mismatch. Copy `getInvoiceDetail`'s shape.
  - Check which column means "owner" (`Purchaser_Contact_ID` vs `Contact_ID`) on the proc
    header first.
- Callers: `checkout/invoice/route.ts:35-41`, `checkout/payment-token/route.ts:40-45`,
  `event-details/participants/[invoiceGuid]/route.ts:40-50`.
- Route catch blocks return `{ error: "mp_unavailable", message }` (the key comes from W0),
  never the raw MP message.
- **Tests:** a signed-in case for both services (mock `executeProcedure`, assert the param
  list excludes it); another contact's GUID → 404.
- **Acceptance:** `grep -rn MpLoggedInContactId src/` is empty.

### 2. C40: record the payment
- `paymentService.ts:104` selects `Invoices.Amount_Paid`, which doesn't exist, and `:185`
  adds to it.
- Take the paid total from the `api_MPPW_GetInvoice` header
  (`invoiceService.getCheckoutInvoiceByGuid` already maps it).
- Replace the inline GUID escaping at `:100`/`:122` with `sqlLiteral`.
- Keep the 200 for webhooks, but log at `error` level.
- Add `Amount_Paid` to `FORBIDDEN` in `mp-column-names.test.ts`. If that guard only checks
  record keys, extend it to scan `select:` strings for the forbidden names. That is the
  durable fix.

### 3. C41: one `status` discriminant
- Replace `success` / `paymentReceived` with `status: "received" | "pending" | "declined" | "error"`
  in `PaymentResult` and in the `checkout/payment-response` and `payment/notify` responses.
- Write one shared mapper, `components/checkout-status.ts` (it is checkout-local, so not in
  `shared/`), and have both `checkout.ts:166-190` and `checkout-complete.ts:72-81` use it.
- `declined` keeps the Pay form on screen in the coral failed treatment.
- `error` copy must not read as pending.
- Strings go in all three locales.

### 4. C43: single-use request token and an overpay guard
- Add a `jti` to `PaymentRequestToken`. Spend it with `kvGetDelete`
  (`src/lib/embed/session-store.ts:55`) on the first successful `pay/response`. The
  `consumePendingAction` pattern is in `src/lib/embed/pending-action.ts:132`.
- Server rejects `amount > balanceDue` (with a deposit tolerance) in
  `checkout/payment-token/route.ts:58-61` **and** in `createPaymentFromResponse`.
  The client cap in `checkout.ts:245-252` is a courtesy.
- A spent token renders a designed "already used" state.
- **Acceptance (doubles as C40's):** the three-reload replay in C43 yields exactly one
  `Payments` row. Prove it with a unit test that replays the same token three times.
  Do a live sandbox run only with teardown (see the epic README, rule 7).

### 5. C66: receipts
- Add `receipt-template-id` on `next-checkout` → `PaymentRequestToken` →
  `PaymentService.createPaymentFromResponse`, sent immediately after the `Payments` row via
  `MessageTemplateService`.
- Legacy `receipttemplateid` is a `dp_Communication_Templates` id, so
  `sendCommunicationTemplate` is likely right. Confirm it with `mp_schema`.
- A template fault never fails the payment; log it and continue.

### 6. C47, C48, C49
- **C47** (`checkout.ts:535-546`):
  - `invoiceTotal <= 0` → neutral "Your registration is complete";
  - `amountPaid > 0 && balanceDue <= 0` → "Paid in full";
  - otherwise the MP status.
- **C48** (`pay.ts:63-74, 264-284`): add `customValidators` for Luhn and 13–19 digits,
  expiry `MM/YY` that is not past, and CVV 3–4 digits. Add `cc-*` autocomplete tokens and
  `inputmode="numeric"`, and use W0's `field()`. Record the payor-source question as
  open-for-vendor in the C48 resolution.
- **C49**:
  - Carry `Event_ID` (`invoiceService.ts:75` is dropped at `:443-452`) into
    `CheckoutLineItemSchema` / the header.
  - Build the "Make Changes" href with `URL` / `URLSearchParams`
    (`?<id-param>=<eventId>&<invoice-param>=<guid>`).
  - Fall back to the bare URL. Keep the label "Make Changes".

### 7. my-invoices: C44, C45, C46, C60
- **C44**: take Route A from `my-invoices.md`. Pay Now becomes an `<a href>` to a
  `checkout-url` attribute with `invoice-id=<Invoice_GUID>`. Delete the `<mpp-checkout>`
  injection (`my-invoices.ts:162-194`).
- **C45**: rows become W0's `cardButton()`, and the Pay affordance is the anchor from C44.
- **C46**: adopt W0's `renderSignInRequired()` (`:257-273`).
- **C60**:
  - Add the six legacy attributes per `my-invoices.md`, kebab-case. That includes a
    "show free events" toggle, which pairs with C47.
  - Wire them through `api/embed/invoices/route.ts` → `invoiceService.ts:165-176`.
  - Use the W0 reconfigure convention.

## Protect (from `checkout-pay.md`)
- `pay.ts`'s `form-validation.ts` usage and its double-submit guard.
- `checkout-complete`'s decline branch, which becomes the mapper.
- The "Make Changes" label.

## Stale-plan corrections
- The primitive is `messageTemplateService.ts` (`sendMessageTemplate` /
  `sendCommunicationTemplate`), not "extract from planYourVisitService".
- "`loadInvoice` renders `data.error` verbatim" is already fixed client-side; only the
  route half remains.
- Line numbers in the plans are 10–60 lines off; use the ones above.
- New copy goes in all three locales; there is no hardcoded English.

## Acceptance
Everything in `checkout-pay.md` *Acceptance*, plus:
- a signed-in unit test on each invoice/participant path;
- no MP proc name or HTTP status in any widget-visible error;
- the `my-invoices` keyboard path reaches payment;
- epic gates are green.
