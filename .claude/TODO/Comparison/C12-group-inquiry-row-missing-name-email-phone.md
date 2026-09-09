# C12. Group inquiries written by `next-group-details` have NULL `First_name`, `Last_name`, `Email` and `Phone` whenever the inquirer is a known household member

**Widget:** `next-group-details` (old: `mpp-group-details`, `/widgets/group_details.aspx`)
**Severity:** functional
**Confidence:** confirmed — both widgets submitted the same inquiry on the same group as the same signed-in user, and both resulting `Group_Inquiries` rows read back with the client-credentials API
**Found:** 2026-09-08, comparison run (groups agent)

## Old behaviour

Signed in as the Playwright user (Contact 98, "Kehayias, Chris"), on
`/widgets/group_details.aspx?id=49`, with `Inquire As` = "Kehayias, Chris" and a message
typed, the legacy widget wrote:

```json
{
  "Group_Inquiry_ID": 5,
  "Group_ID": 49,
  "Contact_ID": 98,
  "First_name": "Chris",
  "Last_name": "Kehayias",
  "Email": "chris.kehayias@acst.com",
  "Phone": "321-794-1376",
  "Comments": "ZZTEST-groups-agent OLD inquiry 2026-09-08",
  "Inquiry_Date": "2026-09-08T22:16:00",
  "Placed": null
}
```

Legacy resolves the chosen contact into the four denormalised columns and stores them
alongside `Contact_ID`. That matters because those columns are what MP's own Group
Inquiries page, the inquiry email templates, and any staff-facing view read — the whole
point of the table having them is that an inquiry is a lead, and a lead needs a name and a
way to answer it without a join.

## New behaviour

The identical action through `next-group-details` (same group, same user, same picker
selection) wrote:

```json
{
  "Group_Inquiry_ID": 4,
  "Group_ID": 49,
  "Contact_ID": 98,
  "First_name": null,
  "Last_name": null,
  "Email": null,
  "Phone": null,
  "Comments": "ZZTEST-groups-agent NEW inquiry 2026-09-08",
  "Inquiry_Date": "2026-09-08T22:16:00",
  "Placed": null
}
```

The cause is in the component, not the service. When a household member is selected the
name/email/phone inputs are hidden (`showBlank` is false, `group-details.ts:619-623`), so
`new FormData(form)` returns nothing for them and the payload nulls all four
(`group-details.ts:264-271`):

```ts
firstName: String(fd.get("firstName") || "").trim() || null,
lastName: String(fd.get("lastName") || "").trim() || null,
emailAddress: String(fd.get("emailAddress") || "").trim() || null,
mobilePhoneNumber: String(fd.get("mobilePhoneNumber") || "").trim() || null,
```

`GroupsService.createInquiry` then faithfully inserts those nulls. Nothing on the server
back-fills from `Contact_ID`, even though the same request already went through
`getCurrentContact(contactId)` — which returns exactly `firstName`, `lastName`,
`emailAddress` and `mobilePhoneNumber` — to build the picker.

The "Someone else…" path is unaffected: those fields are visible, required, and land
correctly. Only the common case — a signed-in member inquiring as themselves or as a
household member — loses the data.

## Why it matters

A group leader or staff member opening Group Inquiries sees a row with a message, a date
and a blank name, email and phone. With C11 in play there is no notification email either,
so nothing else in the system carries the inquirer's contact details: the only way to
answer the person is to notice the `Contact_ID` foreign key and go look them up by hand,
and any MP email template that merges `[First_name]` or `[Email]` off the inquiry record
renders empty. Worse, it is asymmetric — inquiries from anonymous visitors *do* carry the
details, so the records that are hardest to trace are the ones from the church's own known
members. A church that migrates and then wonders why half its group inquiries have no name
will not connect it to the widget swap.

## Evidence

- MP rows read back and compared side by side (then deleted):
  `.claude/playwright/widget/scripts/groups-mp-verify3.mts`,
  `.claude/playwright/widget/scripts/groups-mp-cleanup.mts` (delete output quotes both
  rows verbatim — row 4 all-null, row 5 fully populated)
- Screenshots: `.claude/playwright/widget/screenshots/group-details-new-inquiry-submitted.png`,
  `group-details-old-inquiry-submitted.png`, and the picker state in
  `group-details-new-authed.png` / `group-details-old-authed.png`
- New request: `200 POST /api/embed/group-details/inquire` (single call, no failures)
- Script: `.claude/playwright/widget/scripts/groups-gd-write.mjs` (`SIDE=new`, then `SIDE=old`)
- Picker default confirmed as the signed-in contact:
  `NEW picker default: {"value":"98","selectedText":"Kehayias, Chris"}`

## Where to fix

Either end works; the server is the safer one.

- `src/services/groupsService.ts` — `createInquiry` (the `record` literal that feeds
  `createTableRecords("Group_Inquiries", …)`).
- or `packages/embed-sdk/src/components/group-details.ts:255-272` (`submitForm`).

## Suggested fix

Back-fill on the server, in `createInquiry`: when `form.contactId` is set and any of
`firstName` / `lastName` / `emailAddress` / `mobilePhoneNumber` is null, read the contact
and fill them in. `GroupsService` already has everything needed — `getCurrentContact`
selects those exact four columns from `Contacts` — so it is one extra read (or a
`getTableRecords` on `Contacts` filtered to `Contact_ID = form.contactId`, which also
covers household members other than the signed-in user, whose details the client never
had in the first place). Do it server-side rather than by sending the fields from the
client: the client only knows the household member's `Display_Name`, and trusting a
client-supplied email for a contact the user picked from a list would let a caller write
someone else's contact row with an address of their choosing.

Keep the client's null-coalescing as is — with the server back-fill, the anonymous and
member paths then converge on the same shape as legacy.
