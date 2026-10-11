# C40. Every checkout payment fails to record: `paymentService` selects a column `Invoices.Amount_Paid` that does not exist

**Widget:** `next-checkout` / `next-pay` / `next-checkout-complete` (old: `/widgets/Checkout`, `/widgets/pay`)
**Severity:** breaking
**Confidence:** confirmed — root cause isolated to a single MP query, reproduced three ways, and verified against the `Payments` table before and after
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy `mpp-checkout` on `https://mpi.ministryplatform.com/widgets/checkout/?id=<Invoice_GUID>`
renders "Review and Pay", a Total Cost / Amount Paid / Remaining Balance block, a
deposit/total/other amount chooser and a live "Pay Now" that hands off to
`/widgets/pay`. Its write path is MP's own server code and is unaffected by this.

## New behaviour

**No payment is ever written to MinistryPlatform.** The full sandbox flow completes in
the browser — `next-checkout` mints a request token, `next-pay` accepts the published
test PAN `4111 1111 1111 1111` and returns a signed response token with
`transactionSuccess: true`, and `POST /api/embed/checkout/payment-response` answers
`200` — but the `Payments` row is never created.

`PaymentService.createPaymentFromResponse` resolves the invoice with the select

    Invoice_ID,Invoice_Total,Amount_Paid,Invoice_Status_ID,Purchaser_Contact_ID,Invoice_GUID

`Invoices` **has no `Amount_Paid` column** on this MP instance, so MP answers
`500 Invalid column name`, `MPHelper` throws, and the outer `try/catch` swallows it
into `{ success: false, paymentReceived: false, message }` — deliberately, "so the
webhook/response endpoints stay 200". The failure is therefore completely silent:
HTTP 200 all the way, nothing in the browser console, and (per C41) the payer is told
the payment is "being processed".

`Amount_Paid` *does* exist on the `api_MPPW_GetInvoice` proc result, which is why
`invoiceService.getCheckoutInvoiceByGuid` reads it correctly. Only the `Invoices`
**table** lacks it.

## Why it matters

This is the entire purpose of the payment stack. A church deploying `next-checkout`
today would collect card details from a registrant, show them a message implying the
payment went through, and record nothing: no `Payments` row, no `Payment_Detail`
allocation, no `Invoice_Status_ID` change. The invoice stays "None Paid" forever and
the registrant believes they have paid. Every downstream payment item (C41, C43) is
masked by this one, and the `Transaction_Code` idempotency guard cannot even be
exercised while it stands.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/checkout-new-payment-success-confirmation.png`,
  `.claude/playwright/widget/screenshots/checkout-new-after-reload.png`,
  `.claude/playwright/widget/screenshots/checkout-complete-new-initial.png`
- MP verification — the exact select the service issues:
  `GET /tables/Invoices?$select=Invoice_ID,Invoice_Total,Amount_Paid,Invoice_Status_ID,Purchaser_Contact_ID,Invoice_GUID`
  returns `500` with message `Invalid column name 'Amount_Paid'.`
  The same select minus `Amount_Paid` returns `200`. The full `Invoices` column list
  (`GET /tables/Invoices?$top=1`) is `Invoice_ID, Purchaser_Contact_ID,
  Invoice_Status_ID, Invoice_Total, Invoice_Date, Notes, Currency, Congregation_ID,
  Invoice_GUID, Invoice_Source, Cancel_Reason, Form_Response_ID` — no `Amount_Paid`.
- Direct reproduction of the write path, bypassing the browser: a correctly signed
  `PaymentResponseToken` POSTed to `/api/embed/payment/notify` returns `200` with body
  `{"invoiceId":null,"success":false,"paymentReceived":false,"message":"GET /tables/Invoices failed: 500 Internal Server Error"}`.
- Before/after: `GET /tables/Payments?$orderby=Payment_ID DESC` held exactly one row
  (`Payment_ID` 1, dated 2024) before the run and the same single row after two full
  sandbox payments plus five `payment-response` posts. `Invoices` 3 stayed at
  `Invoice_Status_ID = 1` and `api_MPPW_GetInvoice` kept reporting `Amount_Paid: 0`.

## Where to fix

`src/services/paymentService.ts:106-110` (the `select`) and `:170-176`, which computes
`newAmountPaid` from the column it cannot read.

## Suggested fix

Drop `Amount_Paid` from the `Invoices` select. The value it is wanted for — the
already-paid total, needed to choose between `SomePaid` (2) and `PaidInFull` (3) — is
available two other ways: `api_MPPW_GetInvoice`'s header returns `Amount_Paid` (and
`invoiceService.getCheckoutInvoiceByGuid` already maps it), or it can be summed from
`Payment_Detail` across the invoice's detail lines. Reusing the proc is the smaller
change and keeps one definition of "amount paid" in the codebase.

Separately, the blanket `try/catch` to `success:false` is what kept this invisible.
Worth logging at `error` with the MP message, and surfacing an infrastructure fault to
the widget as something distinguishable from a routine pending payment (see C41).

## Independently confirmed against the MP schema (main thread, 2026-09-08)

`mp_lookup` on `Invoices` returns **12 columns and no `Amount_Paid`**:

```
Invoice_ID, Purchaser_Contact_ID, Invoice_Status_ID, Invoice_Total, Invoice_Date,
Notes, Currency, Congregation_ID, Invoice_GUID, Invoice_Source, Cancel_Reason,
Form_Response_ID
```

So the `select` at `paymentService.ts:104` names a column that does not exist on the
table, which is why MP answers the whole request `500` and why no payment is ever
written. This is a schema fact, not an environment artifact — it will reproduce on
every MP domain.

Note that the other two declarations of `Amount_Paid` in this repo are **fine** and
must not be "fixed" alongside this: `invoiceService.ts:56` and
`eventDetailsService.ts:110` type the header returned by `api_MPPW_GetInvoice`, which
really does compute an `Amount_Paid`. The defect is specific to reading it off the
`Invoices` **table**, which is also why the suggested fix above (reuse the proc) is
the right shape.

## Resolution — 2026-10-11

**Fixed (epic W1, branch `ws/w1-payments`).**

- `PaymentService.createPaymentFromResponse` no longer reads the `Invoices` table at all. It
  resolves the invoice through `InvoiceService.getCheckoutInvoiceByGuid` (the
  `api_MPPW_GetInvoice` wrapper), which supplies `invoiceId`, `invoiceTotal`, `amountPaid`,
  `balanceDue` and the purchaser. That keeps one definition of "amount paid" in the codebase,
  as recommended above. The new status is `amountPaid + amount` against `invoiceTotal`.
- The inline `replace(/'/g, "''")` GUID / transaction-code escaping is gone: the GUID now goes
  to the proc as a parameter, and the `Transaction_Code` filter uses `sqlLiteral` from
  `services/_shared/mp-lookup.ts`.
- **Second defect found while verifying:** `api_MPPW_GetUnpaidInvoiceDetails` (probed live,
  read-only, 2026-10-11) returns `Invoice_Detail_ID, Deposit_Total, Line_Total,
  Payment_Amount`, where `Payment_Amount` is what is already allocated to the line. The
  allocator treated `Line_Total` as the open amount, so a second payment on a part-paid
  invoice would have over-allocated the first line. It now allocates
  `Line_Total - Payment_Amount`.
- **C40b:** the blanket catch still answers 200, so a vendor webhook does not retry and
  double-post. It now logs at `console.error`, never echoes the MP message to the caller, and
  (with C41) reports `status: "error"`, which no widget can render as "pending". The
  status-update failure after a recorded payment is now `console.error` too, not `warn`.
- **Durable guard:** `src/services/mp-column-names.test.ts` gained a table-scoped
  `FORBIDDEN_SELECT` scan, with `Invoices.Amount_Paid` as its first entry. The existing guard
  only checked record keys, and a `$select` column is a string. The scan is table-scoped
  because `Amount_Paid` is legitimate on the *proc* header interfaces in `invoiceService.ts`
  and `eventDetailsService.ts`, which were deliberately left alone. A paired assertion keeps
  the scan from passing vacuously.
- **Tests:** `src/services/paymentService.test.ts` (new) covers the following: no `Invoices`
  select names `Amount_Paid`; the `Payments` row is written; allocation covers only the open
  part of each line; the status moves from the proc paid total (Some Paid, then Paid In Full);
  the transaction code is escaped; and an MP fault is logged and writes nothing.

The live acceptance (a sandbox payment writes `Payments` + `Payment_Detail` and moves
`Invoice_Status_ID`, and the three-reload replay writes one row) is recorded under C43, where
the replay protection that the acceptance depends on landed.
