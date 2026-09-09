# CROSS-2 — `@MpLoggedInContactId` breaks every signed-in invoice read

**Items:** C80 (parent) · C01 event-details · C42 checkout
**Severity:** breaking · **Cutover verdict: blocks pilot cutover**
**Owns:** `src/services/eventDetailsService.ts:531`, `src/services/invoiceService.ts:413`

## The finding in one paragraph

`api_MPPW_GetInvoice` has no `@MpLoggedInContactId` parameter. Both call sites add it
**only when a contact id resolves** — that is, only for a signed-in user — so MP answers
`500 Parameter '@MpLoggedInContactId' does not exists in the requested procedure.` and the
authenticated path is the only one that fails. Anonymous works. That inversion is why an
anonymous smoke test never caught it, and it takes down the two highest-value authenticated
flows in the catalogue from one line copied into two services: a registrant cannot see who
they just registered (C01), and a signed-in payer cannot open their invoice at all (C42).

## Course of action

This is a small fix with one judgement call, and the judgement call is worth making
properly because the parameter was reaching for something real.

### 1. Establish the proc's actual signature first

The legacy widgets call the same proc successfully, so the parameter list it *does* accept
is readable out of `mpi.ministryplatform.com/widgets/dist/Checkout.js` and
`/dist/EventDetails.js`. Do that before editing — it is ten minutes and it settles whether
the parameter exists under another name on some MP versions.

### 2. Drop the parameter and enforce ownership in our own code

The parameter was presumably meant to scope the read to the caller. Delegating that to a
proc parameter is the weaker design anyway: we cannot see what the proc does with it, and
its absence turns a working read into a 500. Call the proc with `@InvoiceGuid` only, then
compare the header row's `Contact_ID` against the resolved `mpContactId` and answer
`404` on mismatch.

That is **strictly stronger than what was intended**, and it closes a gap the items name
explicitly: today the only working `next-checkout` path is the anonymous one, where the
invoice GUID alone authorises payment. The contact-scoping this parameter was added to
provide is not merely broken — it is absent. `getInvoiceDetail` (behind
`next-my-invoices`) already uses this shape; copy it.

### 3. Do not let a proc-signature difference 500 a route again

If the parameter is believed to exist on some MP deployments, probe once and cache the
answer, or gate it behind an env flag. Either way an unknown parameter must degrade to
"call without it", never to a 500 rendered at the visitor.

### 4. Stop rendering raw MP errors to end users

C42's secondary finding: `loadInvoice` puts `data.error` straight into the widget, so a
church visitor reads `GET /procs/api_MPPW_GetInvoice failed: 500 Internal Server Error`.
Every route in the checkout flow returns `{ error: message }` from its catch, so *any* MP
fault becomes payer-facing text. Return a fixed human sentence to the client and keep the
MP text in `console.error` and the server log. This is a one-file change in
`checkout.ts:196-205` plus a convention for the routes.

## Acceptance

- `grep -rn "MpLoggedInContactId" src/` returns nothing.
- Signed in: the event-details participant list renders after Register & Add Another, and
  `next-checkout` opens an invoice.
- A signed-in user requesting *another contact's* invoice GUID gets a 404, not the invoice.
- Widget-visible error text contains no MP procedure name or HTTP status.
- **A signed-in case is added to the tests covering both paths.** The defect's whole
  character is that it is invisible anonymously; an anonymous-only test asserts the working
  half. Same class of harness blindness as `.claude/TODO/37-*`.

## Fix both sites in one change

They are independent lines in independent services. Fixing only the one whose symptom was
reported leaves the other broken.

## Depends on / unblocks

Independent — start now. **Unblocks C66 and the whole signed-in half of `checkout-pay.md`**,
which cannot be demonstrated until this lands.
