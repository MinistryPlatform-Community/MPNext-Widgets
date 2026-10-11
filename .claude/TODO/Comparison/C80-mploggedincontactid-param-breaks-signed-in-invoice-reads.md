# C80. `@MpLoggedInContactId` breaks every signed-in `api_MPPW_GetInvoice` read — one root cause, two widgets

**Widget:** `next-event-details` and `next-checkout` (cross-cutting)
**Severity:** breaking
**Confidence:** confirmed — found independently by two agents on this run, in two
different widgets, with the same MP error; the two call sites were then traced in the
repo by the main thread.
**Found:** 2026-09-08, comparison run

## The relationship

This item exists because **C01** and **C42** are the same defect seen from two
directions, and fixing one without the other would leave half the damage in place:

- **C01** — `next-event-details` 500s when building a signed-in user's participant list.
- **C42** — `next-checkout` 500s for every signed-in user (anonymous checkout works,
  which is why an anonymous smoke test would never catch it).

Both were filed on their own merits by their owning agents. Read them for the
per-widget evidence and screenshots; read this one for the shared cause.

## Behaviour

`api_MPPW_GetInvoice` does not accept a `@MpLoggedInContactId` parameter. Both call
sites add it **only when an MP contact id is available** — i.e. only for a signed-in
user — so the proc call fails exactly in the authenticated case and succeeds anonymously:

- `src/services/eventDetailsService.ts:531` → executed at `:534`
- `src/services/invoiceService.ts:413` → executed at `:417`

The raw MP error reaches the payer/visitor in the checkout case.

## Why it matters

Every signed-in user is the common case on both surfaces. An event's own registrants
cannot see their participant list, and a signed-in donor cannot check out at all — while
an anonymous visitor can, which inverts the expected reliability and hides the fault from
any unauthenticated test. It also means the two most valuable authenticated flows in the
catalogue fail together, from one line repeated in two services.

## Evidence

- C01 and C42 carry the request URLs, the MP error text, and screenshots.
- Repo trace: `grep -rn "MpLoggedInContactId" src/` returns exactly the two lines above —
  there is no third caller, so the blast radius is fully enumerated.

## Where to fix

`src/services/eventDetailsService.ts:531` and `src/services/invoiceService.ts:413`.

## Suggested fix

Establish the proc's real signature first (the legacy widgets call the same proc
successfully, so the parameter list it *does* accept is discoverable from
`mpi.ministryplatform.com/widgets/dist/*.js` — see
`.claude/playwright/widget/CONFIG-MAP.md` for how those bundles were read). Then either
drop the parameter at both sites, or pass the contact id through whatever parameter the
proc actually exposes for it.

Two things to get right while fixing:

1. **Fix both call sites in the same change.** They are independent lines in independent
   services; fixing only the one whose symptom was reported leaves the other broken.
2. **Add a signed-in case to whatever test covers these paths.** The defect's whole
   character is that it is invisible anonymously, so an anonymous-only test asserts the
   working half. This is the same class of harness blindness as `.claude/TODO/37-*`,
   where specs passed against a silently de-authenticated SDK.

## Resolution — 2026-10-11

**Fixed (epic W1, branch `ws/w1-payments`).** Both call sites, in one change.

- **The proc's real signature, verified against the live domain 2026-10-11:**
  `api_MPPW_GetInvoice` takes `@InvoiceGuid` only. Result set 0 is the header
  (`Invoice_ID, Invoice_GUID, First_Name, Contact_ID, Last_Name, Display_Name, Email_Address,
  Mobile_Phone, Address_ID, Address_Line_1, Address_Line_2, City, State, Country, Postal_Code,
  Invoice_Status_ID, Invoice_Total, Invoice_Date, Notes, Amount_Paid`); result set 1 holds the
  detail rows. Header `Contact_ID` equals `Invoices.Purchaser_Contact_ID` on every invoice
  probed, so it is the owner column.
- `src/services/invoiceService.ts` `getCheckoutInvoiceByGuid(guid, ownerContactId?)` and
  `src/services/eventDetailsService.ts` `getEventParticipantsByInvoice(guid, ownerContactId?)`
  call the proc with `@InvoiceGuid` only. When an owner is supplied, a header whose
  `Contact_ID` differs reads as **not found** (`null` → route 404), the same shape as
  `getInvoiceDetail`.
- `resolveInvoiceOwner(service, claims.sub)` (exported from `invoiceService.ts`) is the one
  place the rule lives: `public` → no check (the GUID is the capability, legacy parity);
  signed in → the user's `Contact_ID`; signed in with **no `dp_Users` row → `0`**, which fails
  closed rather than degrading to the unscoped anonymous read.
- **Decision: no probe, no env flag.** CROSS-2 §3 allowed "probe once and cache" if the
  parameter existed on some MP versions. Nothing suggests it does, and the in-code ownership
  check is strictly stronger than anything the proc could do with it, so there is nothing to
  probe for.
- `grep -rn MpLoggedInContactId src/` is empty.

**Tests (signed-in cases, the half the defect hid in):** `src/services/invoiceService.test.ts`
(proc param list, foreign contact → null, anonymous unscoped, fail-closed owner),
`src/services/eventDetailsService.test.ts` (new), and
`src/app/api/embed/checkout/invoice/route.test.ts` (new: own invoice → 200, foreign → 404, MP
fault → `mp_unavailable` with no MP text, no token → `auth_required`).

**Left open, deliberately:** a signed-in visitor can still sign out and open the same GUID
anonymously. The GUID remains a bearer capability on the guest path, as in legacy. The check
stops a signed-in session from being used to read someone else's invoice; it is not a reason to
make guest checkout require sign-in.
