# C42. `next-checkout` fails with a raw MP 500 for every signed-in user: `api_MPPW_GetInvoice` has no `@MpLoggedInContactId` parameter

**Widget:** `next-checkout` (old: `/widgets/Checkout`)
**Severity:** breaking
**Confidence:** confirmed — reproduced in the browser signed in, and isolated to the parameter by calling the proc both ways with client credentials
**Found:** 2026-09-08, comparison run

## Old behaviour

`https://mpi.ministryplatform.com/widgets/checkout/?id=<Invoice_GUID>` renders
identically whether the visitor is signed in or anonymous: "Review and Pay", the
line-item table, Total Cost / Amount Paid / Remaining Balance, the amount chooser and
a live "Pay Now". Verified in both auth states against the same invoice GUID.

## New behaviour

Signed in, `next-checkout` renders nothing but an error:

> Invoice Details
> GET /procs/api_MPPW_GetInvoice failed: 500 Internal Server Error
> [Try Again]

`GET /api/embed/checkout/invoice?guid=…` returns **500**. Anonymous, the very same URL
and invoice render perfectly. The difference is one parameter:
`invoiceService.getCheckoutInvoiceByGuid` adds `@MpLoggedInContactId` only when a
non-public contact was resolved, and **that parameter does not exist on the procedure**
in this MP instance:

    @InvoiceGuid only                          -> 200, full header + detail rows
    @InvoiceGuid + @MpLoggedInContactId = 98   -> 500 "Parameter '@MpLoggedInContactId'
                                                  does not exists in the requested procedure."

So the auth state that should be the *better* one is the only one that fails. The same
fault also breaks `GET /api/embed/checkout/payment-token`, which loads the invoice by
the identical path, so a signed-in payer cannot even reach `next-pay`.

Two secondary problems ride along:

1. **The raw MP error string is rendered to the end user.** `loadInvoice` puts
   `data.error` straight into the widget, so a church visitor sees the internal
   procedure name and HTTP status. Every route in this flow does the same
   (`{ error: message }` from the catch), so any MP fault becomes payer-facing text.
2. **"Try Again" cannot help**, because the request is deterministic — it re-fails
   every time.

## Why it matters

Any customer whose checkout page sits behind a sign-in — which is the normal case for
"pay my registration invoice", and exactly what `next-my-invoices` links into — gets a
hard error instead of an invoice. The flow cannot start. It also means the *only*
working path through `next-checkout` today is the anonymous one, where the invoice
GUID alone authorises payment, so the contact-scoping this parameter was added to
provide is not merely broken, it is absent.

## Evidence

- Screenshots: signed in, broken — `.claude/playwright/widget/screenshots/checkout-new-signed-in-500.png`
  (and `checkout-new-signed-in-500-mobile.png` at 390x844). Anonymous, working —
  `.claude/playwright/widget/screenshots/checkout-new-initial.png`. Legacy signed in —
  `.claude/playwright/widget/screenshots/checkout-old-initial.png`; legacy anonymous —
  `.claude/playwright/widget/screenshots/checkout-old-anonymous.png`.
- Network, signed in:
  `GET /api/embed/checkout/invoice?guid=bdfa3fe2-3489-4f2c-9ec8-7ae3a83ea954` → **500**,
  body `{"error":"GET /procs/api_MPPW_GetInvoice failed: 500 Internal Server Error"}`.
  Same request anonymous → **200**.
- MP verification (client credentials):
  `GET /procs/api_MPPW_GetInvoice?@InvoiceGuid=bdfa3fe2-…&@MpLoggedInContactId=98`
  → `500 {"Message":"Parameter '@MpLoggedInContactId' does not exists in the requested procedure."}`;
  dropping the second parameter → `200` with the header row and detail rows.
- Reproduce: `node .claude/playwright/widget/scripts/harness.mjs`-based script that
  `launch({ site: "new", authed: true })`, goto
  `http://localhost:5173/demo-checkout.html?id=<any Invoice_GUID>`, `assertAuthenticated`.

## Where to fix

`src/services/invoiceService.ts:398-404` — the block that conditionally adds
`@MpLoggedInContactId` to the proc params. Callers:
`src/app/api/embed/checkout/invoice/route.ts:37-42` and
`src/app/api/embed/checkout/payment-token/route.ts:40-45`, which resolve the contact id
purely to pass it here. Error passthrough: `packages/embed-sdk/src/components/checkout.ts:196-205`.

## Suggested fix

Confirm the procedure's real signature before choosing. If MP's
`api_MPPW_GetInvoice` genuinely takes only `@InvoiceGuid` on current MP versions, stop
passing the second parameter and enforce the contact check in our own code instead:
load the invoice by GUID, then compare `header.Contact_ID` with the authenticated
contact and 404 on mismatch — which is what the parameter was presumably meant to
achieve, and is the same shape `getInvoiceDetail` already uses for `next-my-invoices`.
If some MP versions do accept it, probe once and cache, or make it opt-in by config;
either way it must not be able to turn a working read into a 500.

Independently, stop rendering `data.error` verbatim. Show a fixed, human sentence and
keep the MP text in `console.error` / the server log.

---

**Shared root cause:** see `C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md`.
This defect and its counterpart (C01, next-event-details) are the same `@MpLoggedInContactId` fault in two
services, found independently by two agents on this run. Fix both call sites together.
