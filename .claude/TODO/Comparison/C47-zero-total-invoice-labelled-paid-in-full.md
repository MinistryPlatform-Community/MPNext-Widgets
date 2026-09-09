# C47. `next-checkout` labels an unpaid zero-total invoice "Paid in full", contradicting the "None Paid" status two lines above it

**Widget:** `next-checkout` (old: `/widgets/Checkout`)
**Severity:** cosmetic
**Confidence:** confirmed — same invoice GUID rendered on both systems
**Found:** 2026-09-08, comparison run

## Old behaviour

A zero-total invoice on `https://mpi.ministryplatform.com/widgets/checkout/?id=<GUID>`
is framed as a completed *registration*, not as a payment:

> **Your Registration is Complete!**
> Review the details of your registration below.
> … Total Cost 0.00 Amount Paid 0.00 Remaining Balance 0.00

and the Pay Now button is not rendered. Legacy uses the same wording for the paid-off
case; the point is that it never claims money changed hands.

## New behaviour

The same invoice renders:

> Invoice Details
> Invoice Date September 7, 2026 · **Status None Paid**
> No line items.
> Total $0.00 · Amount Paid $0.00 · Balance Due $0.00
> **Paid in full**   ← green success banner

The banner comes from `renderStatusSection`, which decides purely on
`paid = inv.balanceDue <= 0`, and `balanceDue` is `max(0, total - amountPaid)` — zero
for a free registration that nobody has paid anything toward. So the widget shows
"None Paid" and "Paid in full" simultaneously, three lines apart, in the
success colour.

Free-event invoices are not an edge case in MP — the same MP contact's invoice list
contains three of them, and legacy `mpp-my-invoices` has a whole "Show Free Events"
toggle for exactly this population.

## Why it matters

It is only wording, but it is wording about money on the screen where a member checks
whether they owe anything, and it is self-contradictory on its face — the kind of thing
that generates a call to the church office. Legacy's copy ("Your Registration is
Complete!") answers the member's actual question; ours answers a question about
payment that was never asked and answers it in a way the line above denies.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/checkout-new-zero-total-invoice.png`,
  `.claude/playwright/widget/screenshots/checkout-old-zero-total-invoice.png`
- New, rendered shadow text (invoice GUID `37165991-ab0b-4694-94b8-38e774001685`,
  `Invoice_Total` 0, `Invoice_Status_ID` 1):
  `Invoice Details Invoice Date September 7, 2026 Status None Paid No line items.
  Total $0.00 Amount Paid $0.00 Balance Due $0.00 Paid in full`
- Old, same GUID: `Your Registration is Complete!Review the details of your
  registration below.Invoice DetailsQtyDescriptionRegistrantPriceTotal Cost0.00Amount
  Paid0.00Remaining Balance0.00…` with no Pay Now button rendered.
- MP verification: `GET /tables/Invoices?$filter=Invoice_ID = 4` →
  `Invoice_Total: 0, Invoice_Status_ID: 1` (Invoice_Statuses 1 = "None Paid"), so
  "None Paid" is the correct status and "Paid in full" is the invented claim.

## Where to fix

`packages/embed-sdk/src/components/checkout.ts:483-492` (`renderStatusSection`), which
maps `balanceDue <= 0` to the string "Paid in full" and the `nw-co-status--paid` class.

## Suggested fix

Separate "nothing to pay" from "has been paid". `renderStatusSection` already has
`inv.statusId` and `inv.amountPaid` available:

- `invoiceTotal <= 0` → neutral copy in the church's voice; legacy's "Your registration
  is complete" is a reasonable model, and it reads correctly whether or not the invoice
  ever had a balance.
- `amountPaid > 0 && balanceDue <= 0` → "Paid in full" (the case the string was written
  for).
- otherwise → the MP status text, as now.

While there: consider not printing "Status: None Paid" at all on a zero-total invoice,
since MP's status vocabulary is about payment and there is no payment to describe.
