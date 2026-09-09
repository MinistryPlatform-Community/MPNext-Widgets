# checkout — comparison test log

- **New**: `next-checkout` — http://localhost:5173/demo-checkout.html?id=&lt;Invoice_GUID&gt;
- **Old**: Checkout — https://mpi.ministryplatform.com/widgets/checkout/?id=&lt;Invoice_GUID&gt; (alias `/widgets/Checkout`)
- **Tested**: 2026-09-08 by subagent PAYMENTS
- **Auth state(s) tested**: signed out (anonymous) and signed in as PLAYWRIGHT_MP_USERNAME, on both systems
- **Script**: `…/scratchpad/p5-anon-checkout.mjs`, `p6-pay.mjs`, `p7-happy.mjs`, `p10-anon-misc.mjs`, `p12-old-checkout.mjs`, `p13-old-co-text.mjs`, `pay-leak.mjs`, `pay-signedin-500.mjs`, `pay-mp.mjs` / `pay-mpw.mjs` (MP client-credentials drivers)

## A legacy baseline DOES exist — correcting the brief

My task brief said the legacy sample site has no payment widget, on the basis that
`/widgets/giving.aspx` is only an `mpp-smart-link` out to `testing.realm.dev`. That is
true of `giving.aspx`, but it is **not** the legacy payment surface. The real one is on
two pages that are absent from the sample site's navigation dropdown, and I confirmed
both by `curl` before touching a browser:

| URL | status | widget markup |
|---|---|---|
| `/widgets/Checkout` | 200, 4598 B | `<mpp-checkout paymentprocessortargeturl="…/widgets/pay?authenticated={{isAuthenticated}}" backtoeventtargeturl="…/widgets/event_details.aspx/" receipttemplateid="2695">` |
| `/widgets/checkout/` | 200, 4598 B | byte-identical to the above |
| `/widgets/pay` | 200, 4373 B | `<mpp-pay>` |
| `/widgets/giving.aspx` | 200, 4610 B | `<mpp-smart-link href="https://testing.realm.dev/…">Click Here to Give</mpp-smart-link>` — no payment widget (already filed as C74) |

So this is a genuine head-to-head and is written as one. The scope-difference framing
("our checkout has no legacy behaviour to be compatible with") is **withdrawn**: it does,
and the comparisons below are against it.

## Safety envelope actually used

- **Our chain is an in-repo labelled sandbox.** `next-pay` paints
  `Sandbox payment — use test card 4111 1111 1111 1111`; `POST /api/embed/pay/response`
  succeeds only for PAN `4111111111111111` and declines everything else. No card
  processor is contacted by any code path in this repo. Submitting was therefore safe,
  and I submitted only the published test PAN.
- **I did not submit anything on the legacy side.** MP's own gateway configuration for
  this domain is unreadable to our API user (`dp_Configuration_Settings` restricted), so
  I cannot establish that `mpp-pay` reaches no processor. Its UI, fields and validation
  affordances were enumerated read-only; the form was never submitted. Recorded as
  untested in `pay.md`.
- Amounts used: $0.01 (the "Other amount" minimum I could enter) and, for a
  no-side-effect probe, three server-side `pay/response` posts of $0.01 that write
  nothing to MP by design.

## What I tested

1. **Renders at all**, both systems, both auth states, same invoice GUIDs.
2. **Signed-in load** on `/demo-checkout.html?id=<guid>` with `assertAuthenticated`
   after every navigation → recorded status and rendered text.
3. **Anonymous load** of the same GUID on both systems (the "capability URL" question).
4. **Money math**, read against MP for invoice GUID `f53eb6ff-786c-488a-b018-ad07eb3a06d8`
   (three line items including a **negative** one): compared every line name, qty and
   line total, plus Total / Amount Paid / Balance Due, against
   `GET /procs/api_MPPW_GetInvoice` and against the legacy render.
5. **Zero total** — GUID `37165991-…`, `Invoice_Total` 0, status "None Paid".
6. **No `?id=` at all**, and a **bogus GUID** (`00000000-…`), both systems.
7. **Quantity/amount change after the total is calculated** — switched to "Other
   amount", typed values, watched `#nw-pay-total` recompute live.
8. **Validation**: "Other amount" submitted empty; then `0`; then `999999` (overpay).
   Checked for a native `reportValidity` dialog with a `page.on("dialog")` trap.
9. **Full happy path**: checkout → `next-pay` → back to checkout, with the test PAN.
10. **Declined card** (`4242 4242 4242 4242`, i.e. not the sandbox PAN).
11. **MP write verification** before and after: `Payments`, `Payment_Detail`, `Invoices`,
    and `api_MPPW_GetInvoice`'s `Amount_Paid`.
12. **Back-navigation mid-flow**, then Forward, then resubmit (double-charge probe).
13. **Double-click** on the Pay button (in-page double-submit probe).
14. **Reload after payment** (token already stripped from the URL).
15. **Cross-contact access**: `GET /api/embed/checkout/invoice?guid=` for an invoice
    belonging to Contact 2 while authenticated as Contact 98.
16. **Responsive** at 390x844 and **a11y**: labels, `aria-invalid`, `aria-describedby`,
    `role="alert"`, focus movement on validation failure, heading structure.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Renders, anonymous | "Review and Pay" + live Pay Now | full invoice + Pay | **pass** |
| 2 | Renders, **signed in** | identical to anonymous | **500** — "GET /procs/api_MPPW_GetInvoice failed: 500 Internal Server Error" | **C42 breaking** |
| 3 | Anonymous GUID access allowed | yes, Pay Now live | yes | pass (parity — capability URL by design on both) |
| 4 | Line items (3 lines, one negative) | Qty/Description/Registrant/Price table: `1 Product: Faith Formation Registration 0.00`, `1 First Child 150.00`, `1 Scholarship -150.00` | same three, same qty, `$0.00 / $150.00 / -$150.00` | **pass** — matches MP exactly |
| 5 | Total vs sum of lines | Total Cost 0.00 (= 0+150-150) | Total $0.00 | **pass** — no rounding or sign error |
| 6 | Amount Paid / Balance | "Amount Paid 0.00 / Remaining Balance 0.00" | "Amount Paid $0.00 / Balance Due $0.00" | pass (wording differs) |
| 7 | Sub-item ordering | natural detail order | base items first, then **all** sub-items | ux note, below |
| 8 | Zero-total invoice | "Your Registration is Complete!", no Pay Now | "**Paid in full**" green banner under "Status None Paid" | **C47 cosmetic** |
| 9 | No `?id=` | "Unable to find invoice or it has been removed." | "No invoice was specified." | pass (ours clearer) |
| 10 | Bogus GUID | same generic message | "Invoice not found." (404) | pass (ours clearer) |
| 11 | Deposit option | always shown, "Deposit Only - $0.00" even when there is none | hidden when `depositDue` is null/0 | **new is better** |
| 12 | Amount chooser | Deposit / Total Cost / Other Amount | Pay in full / (deposit) / Other amount | pass |
| 13 | Live total recompute | — | `#nw-pay-total` updates per keystroke | pass |
| 14 | Empty "Other amount" submit | native `required` | `aria-invalid="true"`, `aria-describedby="mpx-err-nw-other-amount"`, focus to field, **no** native popup | **pass — shared form-validation confirmed** |
| 15 | "Other amount" = 0 | — | "Please enter a valid payment amount.", submit blocked | pass |
| 16 | Overpay (999999 on a $1.00 invoice) | not probed (would need a submit) | "You will pay $999,999.00", accepted | **C43** |
| 17 | Happy path completes in the UI | not submitted (out of bounds) | yes, redirects back with a response token | pass |
| 18 | Payment recorded in MP | n/a | **nothing written** | **C40 breaking** |
| 19 | Declined card messaging | n/a | "Your payment is being processed…" | **C41 breaking** |
| 20 | Back mid-flow, Forward, resubmit | n/a | request token re-unpacks (200) and resubmits, new `transactionCode` each time | **C43** |
| 21 | Rapid double-click on Pay | n/a | exactly 1 `pay/response` call | pass |
| 22 | Reload after payment | n/a | token stripped from URL, no re-post | pass |
| 23 | Cross-contact invoice by GUID | not probed | 500 (C42), so no leak observable — and no scoping in force either | see C42 |
| 24 | "Make Changes" / back-to-event | `…/event_details.aspx/?id=16&invoiceid=<guid>` | bare `/demo-event-finder.html` | **C49 functional** |
| 25 | 390x844 | renders, form usable | renders, form usable, `@media (max-width:640px)` collapses the meta row | pass |
| 26 | Heading structure | — | no `h1`/`h2`/`h3` in the shadow root; "Invoice Details" is a `div` | ux note, below |
| 27 | Error text shown to payer | church-safe generic sentence | raw MP text, e.g. `GET /procs/api_MPPW_GetInvoice failed: 500` | folded into **C42** |
| 28 | Currency format | bare `1.00` in totals | `$1.00`, `-$150.00` | **new is better** |
| 29 | Receipt email | page sets `receipttemplateid="2695"` | no receipt concept in the repo at all | attached to **C66** |

## Findings filed

- `C40-payments-never-recorded-amount-paid-column.md` — breaking: `paymentService` selects a non-existent `Invoices.Amount_Paid`, so no payment is ever recorded and the failure is silent.
- `C41-declined-payment-reported-as-processing.md` — breaking: `next-checkout` tells the payer a declined/failed payment is "being processed".
- `C42-checkout-500s-for-every-signed-in-user.md` — breaking: `api_MPPW_GetInvoice` has no `@MpLoggedInContactId`, so signed-in checkout 500s; the raw MP error is shown to the payer.
- `C43-payment-request-token-unlimited-use.md` — functional: the request token is unlimited-use for 15 min and Back-then-resubmit mints a second distinct payment; no overpay guard.
- `C47-zero-total-invoice-labelled-paid-in-full.md` — cosmetic: a $0 unpaid invoice reads "Paid in full" under "Status None Paid".
- `C49-make-changes-link-loses-event-and-invoice-ids.md` — functional: the back-to-event link drops the ids legacy resolves into it.
- Runtime evidence appended to `C66` (receipt template).

## Where the new widget is better

- **Error copy is specific**, where legacy gives one generic string for both a missing
  id and an unknown invoice: "No invoice was specified." vs "Invoice not found." vs
  legacy's "Unable to find invoice or it has been removed." for both.
- **The deposit option is conditional.** Legacy always renders "Deposit Only - $0.00 /
  Pay the required deposit amount" even on invoices with no deposit, which is a live
  radio for an impossible amount. Ours only shows it when `depositDue > 0`.
- **Validation is announced.** The shared `form-validation.ts` gives `aria-invalid`,
  `aria-describedby` and a `role="alert"` message per field, moves focus to the first
  invalid input, and shows no native `reportValidity` popup. Legacy relies on native
  `required`.
- **Currency is formatted.** `Intl.NumberFormat` gives `$1.00` and `-$150.00`; legacy
  prints bare `1.00` / `-150.00` in its totals block.
- **The live "You will pay" line** recomputes as you type an other-amount; legacy has no
  equivalent readout.
- **Timezone-safe date parsing**: `checkout.ts:formatDate` regex-parses the MP
  `YYYY-MM-DD` prefix into a local `Date` rather than letting `new Date(string)` shift
  it — the correct handling per `.claude/references/ministryplatform.datetimehandling.md`.
  `September 8, 2026` matched MP's `2026-09-08T09:00:00` and legacy's `09/08/2026`.

## Observed but NOT filed (C40–C49 block exhausted)

Recorded here rather than dropped. Neither is a duplicate of a filed item; both are
lower value than the ten that were filed.

- **Sub-items are reordered away from their parent.** `renderInvoice` renders
  `lineItems.filter(li => !li.isSubItem)` and then *all* sub-items, so on a multi-registrant
  invoice every child option is detached from the line it belongs to. It happened to read
  correctly on the invoice tested (one parent), and legacy renders detail rows in their
  natural order. Fix would be to group sub-items under their parent.
  `packages/embed-sdk/src/components/checkout.ts:400-410`.
- **No heading elements.** The shadow root contains no `h1`/`h2`/`h3`; "Invoice Details"
  and "Payment Amount" are `div`s, so a screen-reader user gets no document structure on
  a payment page. `checkout-complete.ts` does use an `h2`.

## Not tested / blocked

- **Legacy payment submit** — out of bounds (see the safety envelope). Everything below
  the legacy "Pay Now" click is untested by design, including whether legacy sends the
  `receipttemplateid="2695"` receipt.
- **Duplicate `Payments` rows from the C43 double-submit** — blocked by C40: nothing is
  written, so the duplicate cannot be observed. C43 records the three distinct
  `transactionCode`s that *would* each post a row, and says so.
- **The `Transaction_Code` idempotency guard** in `paymentService` — unreachable while
  C40 stands, for the same reason. It is present in the source and looks correct; it is
  simply unexercised.
- **Deposit path** — no invoice in this MP instance with `Deposit_Requested` on a detail
  line was found, and I could not synthesise one: the `api_MPPW_GetInvoice` proc returns
  **no detail rows** for invoices whose `Invoice_Detail` rows I create by API (tried
  Product 4 and Product 7, with and without `Product_Option_Price_ID`; the proc appears
  to inner-join something my rows lack, probably `Event_Participants`). So
  `depositDue`/"Pay deposit" was never rendered. Related and unverified: `depositDue` is
  computed as the **sum of `Line_Total`** for rows flagged `Deposit_Requested`
  (`invoiceService.ts`), while the proc returns a per-row **`DepositPrice`** column that
  is ignored — that looks wrong, but I will not file it without a rendering to prove it.
  Unblocking it needs an event registration with a deposit-enabled product, created
  through the registration flow rather than by table insert.
- **`api_MPPW_GetUnpaidInvoiceDetails` allocation** across multiple funds/invoices —
  never reached (C40 aborts before `allocatePaymentDetails`).

## MP records created / modified

All fixtures were prefixed `ZZTEST-payments-agent` in `Notes`. See `my-invoices.md` for
the full manifest and cleanup status. **No `Payments`, `Payment_Detail` or `Invoices`
status row was created or changed by any payment attempt** — because of C40 — which was
verified before and after.

## Screenshots

- `checkout-old-initial.png` — legacy, signed in, $1.00 invoice: baseline.
- `checkout-new-initial.png` — new, anonymous, same invoice: baseline (the only working auth state).
- `checkout-new-signed-in-500.png` — new, signed in: the C42 hard error.
- `checkout-new-signed-in-500-mobile.png` — the same at 390x844.
- `checkout-old-mobile.png` / `checkout-new-mobile.png` — 390x844 baselines.
- `checkout-old-anonymous.png` — legacy anonymous: proves the GUID capability URL is parity, not a new-side defect.
- `checkout-old-invoice1-line-items.png` / `checkout-new-invoice1-line-items.png` — the three-line invoice with a negative line; the money-math comparison, and the C49 link difference.
- `checkout-old-zero-total-invoice.png` / `checkout-new-zero-total-invoice.png` — C47.
- `checkout-old-no-invoice.png` / `checkout-new-no-invoice.png` — no `?id=`.
- `checkout-old-bogus-guid.png` / `checkout-new-bogus-guid.png` — unknown GUID.
- `checkout-new-validation-empty-other-amount.png` — shared validation, no native popup.
- `checkout-new-zero-amount.png` — "Other amount" = 0 rejected.
- `checkout-new-overpay-allowed.png` — C43: $999,999.00 accepted on a $1.00 invoice.
- `checkout-new-payment-success-confirmation.png` — C41/C40: test PAN accepted, "being processed", MP unchanged.
- `checkout-new-after-reload.png` — post-payment reload: invoice still "None Paid", $1.00 due.
- `checkout-new-back-mid-flow.png` — C43: Back from pay leaves the invoice fully payable.
