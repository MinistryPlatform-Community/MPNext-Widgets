# C21. `next-opportunity-details` writes a `Responses` row with `First_Name`/`Last_Name`/`Email`/`Phone` all NULL when the visitor responds as a household member

**Widget:** `next-opportunity-details` (old: Opportunity Details — `/widgets/opportunity_details.aspx?id=<n>`)
**Severity:** functional
**Confidence:** confirmed — both widgets submitted against the same opportunity in the same minute; the two MP rows were read back with the client-credentials API
**Found:** 2026-09-08, comparison run

## Old behaviour

Signed in as the Playwright user, "Respond As → Kehayias, Chris", message typed,
Submit Response → `POST /Api/OpportunitiesApi/Respond` → `200 "47"`. The row MP
stored:

```
Response_ID 47 | Opportunity_ID 5 | Participant_ID 10
First_Name "Chris" | Last_Name "Kehayias"
Email "chris.kehayias@acst.com" | Phone "321-794-1376"
Comments "ZZTEST legacy-widget response — comparison run, safe to delete."
```

Legacy backfills the four contact columns from the selected contact's record even
though the visible name/email/phone inputs were left blank.

## New behaviour

Same opportunity, same user, same picker selection →
`POST /api/embed/opportunity-details/respond` → `200 {"success":true,"responseId":46}`.
The row MP stored:

```
Response_ID 46 | Opportunity_ID 5 | Participant_ID 10
First_Name null | Last_Name null
Email null | Phone null
Comments "ZZTEST new-widget response — comparison run, safe to delete."
```

`Participant_ID` is correct on both. Only the denormalised contact columns differ.
The cause is the interaction of two correct-looking decisions: the widget **hides**
First/Last/Email/Phone once a "Respond As" contact is chosen (legacy keeps them
visible), so the payload carries empty strings; and `respond()` writes
`args.firstName || null` verbatim without falling back to the resolved contact.

## Why it matters

`Responses.First_Name/Last_Name/Email/Phone` is what MP's Opportunity Response views,
the "Opportunity Response Notification" email template, and any church-authored report
merge from — the columns exist precisely so a response is self-describing without a
Participant join. A volunteer coordinator working the follow-up list sees a blank name
and no way to contact the responder. It is silent: the response *is* created, the
thank-you renders, and only the row is poorer than before.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/opportunity-details-new-response-success.png`,
  `.claude/playwright/widget/screenshots/opportunity-details-old-response-success.png`
- Network: new `200 {"success":true,"responseId":46}`; old `200 "47"`
- MP verification:
  `getTableRecords({ table: "Responses", filter: "Opportunity_ID = 5", orderBy: "Response_ID DESC" })`
  returned the two rows quoted above. Both rows and the ZZTEST opportunity have since
  been deleted.

## Where to fix

`src/services/opportunityDetailsService.ts:275-285` (the `record` literal inside
`respond()`), which already has `contactId` resolved on the line above.

## Suggested fix

After `resolveContactId()` succeeds, read `First_Name, Last_Name, Email_Address,
Mobile_Phone` for that contact and use them where the submitted values are empty:

```ts
const c = args.contactId ? await this.getContactBasics(contactId) : null;
First_Name: args.firstName || c?.First_Name || null,
…
```

`householdService`/`eventDetailsService` already do this kind of read, so there is a
pattern to copy. Alternatively keep the fields visible and pre-filled the way legacy
does — but the server-side backfill is the safer fix, since it also covers the
`ContactId`-supplied-by-a-caller case.
