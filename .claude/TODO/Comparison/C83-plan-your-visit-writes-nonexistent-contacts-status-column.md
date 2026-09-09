# C83. `planYourVisitService` writes `Contacts.Status`, a column MinistryPlatform does not have — every contact it creates gets a defaulted status

**Widget:** plan-your-visit (`next-plan-your-visit`)
**Severity:** functional
**Confidence:** confirmed — `mp_lookup` against the live domain returns the full `Contacts` column list and there is no `Status` column; the write is at `src/services/planYourVisitService.ts:396`. No browser used.
**Found:** 2026-09-09, while building the Tier 1 missing widgets (C70's plan flagged it; verified against MP)

## The defect

`planYourVisitService` resolves the Active contact status correctly:

```ts
// src/services/planYourVisitService.ts:255-256
const [activeStatusId, headPositionId, minorPositionId] = await Promise.all([
  this.getIdByValue("Contact_Statuses", "Contact_Status", "Active", "Contact_Status_ID"),
```

carries it through as `statusId`, and then writes it to the wrong column name:

```ts
// src/services/planYourVisitService.ts:394-396
const record: Record<string, unknown> = {
  Company: false,
  Status: c.statusId,        // ← no such column
```

`Contacts` has **`Contact_Status_ID`** (`Integer32`, required, FK to
`Contact_Statuses.Contact_Status_ID`). It has no column named `Status` — confirmed
against the live domain; the full column list includes `Contact_Status_ID` and nothing
resembling `Status`.

So the correct id is computed on every registration and then sent under a key MP has no
column for.

### One thing this item does not settle: which way MP fails

I did not test the write, because confirming it means creating a `Contacts` row on a live
domain. There are two possibilities and **both are bugs**, but they differ in severity:

- **MP ignores the unknown key.** The insert succeeds, `Contact_Status_ID` takes the
  database default, and the contact's status is silently not the one the code resolved.
  Latent on a stock domain (the default is Active), wrong on any domain whose default
  differs.
- **MP rejects the record.** Contact creation 500s and Plan Your Visit's registration step
  cannot complete at all — which would make this `breaking`, not `functional`, and would
  mean the step has never worked.

**Whoever fixes this should determine which**, because it decides whether C83 is a quiet
data-quality problem or a second reason (alongside C24) that the flow has never completed.
The fix is the same either way. A single `createTableRecords` against a scratch contact on a
non-production domain answers it.

## Why it has stayed invisible

Two things hid it, and they compound:

1. **The default happens to be right.** `Contact_Status_ID` defaults to Active on a stock
   domain, which is the same value the code intended to write. The records look correct on
   inspection, so nothing draws attention to the column that was never set.
2. **This code path may never have completed in production.** [C24](C24-plan-your-visit-phone-mask-blocks-submit.md)
   records that the required phone field uses MP's *display* mask as an HTML `pattern` and
   therefore rejects every real phone number — "the flow can never complete". Contact
   creation is downstream of that submit. If C24 has been live for the widget's whole
   life, no contact has ever been created by this service on a real site, which is the most
   likely reason a wrong column name has gone unremarked.

That makes this a latent defect rather than an observed one — but it is a defect that
becomes live on the day C24 is fixed, which is why it should be fixed first or alongside.

## Why it matters

A domain whose `Contact_Status_ID` default is not Active gets contacts created in the wrong
state, and contact status drives visibility in nearly everything downstream — directories,
statements, bulk email selections, whether staff see the person at all. On a stock domain the
resulting row looks plausible, which is why nothing has drawn attention to a column that was
never set.

It is also a *class* of bug worth noting rather than a one-off: nothing in the repo validates
that a record written to MP uses real column names, so a typo in any `createTableRecords` /
`updateTableRecords` payload fails exactly this quietly. `MPHelper.createTableRecords` accepts
an optional `{ schema: ZodSchema }`; this call site passes none.

## Evidence

- `mp_lookup` on `Contacts` (live domain): `Contact_Status_ID` `Integer32` required, FK
  `Contact_Statuses.Contact_Status_ID`. No `Status` column in the 50-column list.
- `src/services/planYourVisitService.ts:256` — resolves `Contact_Status_ID` by name, correctly
- `src/services/planYourVisitService.ts:396` — writes it as `Status`
- **The defect was ported verbatim from legacy.**
  `S:\MP\mp-Widgets\PortalComponents\DataManagers\ContactManager.cs:625-639`
  (`CreateContact`) builds `{"Company", false}, {"Status", contact.ContactStatusId},
  {"Household_Position_ID", …}, {"Mobile_Phone", …}, {"Email_Address", …}, {"Gender_ID", …},
  {"First_Name", …}, {"Last_Name", …}, {"Nickname", …}, {"Display_Name", "<Last>, <First>"}`
  plus a conditional `Date_of_Birth` — the same ten keys in the same order as
  `planYourVisitService.createContact`, `Status` included. So this is inherited, not
  introduced here.
  **Two consequences.** In legacy it is one shared `CreateContact` used by *every* widget that
  creates a contact, so the same defaulted status affects all of them; and on our side, any
  new widget that ports contact creation from this method will reproduce it — which is
  exactly what C69 (`next-prayer-feedback`) and C70 (`next-subscribe-to-publication`) both
  do. They must use `Contact_Status_ID`.
- Interaction: [C24](C24-plan-your-visit-phone-mask-blocks-submit.md) (why it is latent),
  [C82](C82-plan-your-visit-syncchildren-discards-child-fields.md) (same service, same
  never-exercised path)

## Where to fix

- `src/services/planYourVisitService.ts:396` — `Contact_Status_ID: c.statusId`
- `src/services/planYourVisitService.test.ts` — assert the created payload carries
  `Contact_Status_ID`, so the fix cannot be undone by a copy-paste from legacy

## Suggested fix

One line. Then consider the class: pass a Zod schema to the `createTableRecords` calls in
this service, which is the mechanism `MPHelper` already offers for exactly this and which
would have turned a silent no-op into a build-time or request-time error.

**Do not fix by renaming the column in MP.** `Status` is not a legacy alias that MP resolves;
it is simply not a column, and the write is being ignored.

---

## Resolved — 2026-09-09

`src/services/planYourVisitService.ts` now writes `Contact_Status_ID: c.statusId`, with a
comment naming the legacy source of the mistake so a future port does not reintroduce it.

**Which way MP fails is still not settled**, and deliberately so: answering it means
creating a `Contacts` row on a live domain, which was out of scope for this branch. The
question stays open above, and it decides only the severity label — the fix is the same
either way, and is now in.

**A guard came with it, because the fix alone protects one line and the defect is a
class.** `src/services/mp-column-names.test.ts` scans every service source for record-literal
keys that MP has disproved, anchored so it does not match `Contact_Status_ID:`,
`Participation_Status_ID:`, a comment, or the word inside a `$select`. It carries a paired
assertion that the *right* column is still written, so deleting the line rather than fixing
it does not satisfy the scan. Verified by reintroducing the bug: the guard fails and names
the file and the correct column.

`FORBIDDEN` in that file is the place to record the next one. It is a source scan rather
than a behavioural test because `createContact` is private behind `saveVisitDetails` — a
flow that writes a household, an address, several contacts, participants and milestones —
and because the scan catches how the defect actually arrives: a record literal copied out
of the legacy .NET source, which is wrong about this column and may be wrong about others.

**Three services create contacts now** — `planYourVisitService`, `prayerFeedbackService` and
`subscriptionService` (C70). The latter two were written against `mp_lookup` rather than
against the legacy port and use the real column; the scan covers all three from here.
