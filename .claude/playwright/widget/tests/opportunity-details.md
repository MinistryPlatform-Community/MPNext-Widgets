# opportunity-details — comparison test log

- **New**: `next-opportunity-details` — http://localhost:5173/demo-opportunity-details.html?id=3
- **Old**: Opportunity Details — https://mpi.ministryplatform.com/widgets/opportunity_details.aspx?id=3
- **Tested**: 2026-09-08 by subagent *serving & visit* (block C20–C29)
- **Auth state(s) tested**: signed out and signed in as `PLAYWRIGHT_MP_USERNAME`, both sides
- **Script**: scratchpad `od.mjs`, `od2.mjs`, `od3.mjs`, `od4.mjs`, `od-write.mjs`, `od-oldval.mjs`, `od-forge.mjs`, `od-closed.mjs`; MP verification via `.claude/playwright/widget/scripts/serve-mp-probe.mts`

This pair is a genuine head-to-head — the BRIEF called `next-opportunity-details`
"new only", which is wrong (CONFIG-MAP §2.16 / §4.6). Configuration is like-for-like:
the legacy page sets only `returnurl`, the demo page only `return-url`.

**Note for anyone reproducing this:** `/widgets/opportunity_details.aspx/3` (the
trailing-path-segment form CONFIG-MAP §2.21 suggests) returns an **empty body** on
this instance — no markup, no widget, and `assertAuthenticated` fails with "no
`<mpp-user-login>` on this page". The working legacy URL is
`/widgets/opportunity_details.aspx?id=3`, which is also what the legacy finder itself
navigates to (`./Opportunities/?id=4`).

## What I tested

1. Baseline render, both sides, signed out and signed in.
2. Enumerated every control (name, type, required, visibility, option list) and diffed the two response forms.
3. Measured accessible names (`element.labels`, `aria-label`, wrapping `<label>`) on both sides.
4. "Respond As" household picker: option list, order, labels, and what happens to the personal-detail fields when a member is chosen.
5. Has-responded notice: computed visibility on both sides, cross-checked against the `/has-responded` call.
6. Validation, signed out: empty submit; then bad email (`not-an-email`), bad phone (`abc`), and a 3,000-character message. Watched for a native `reportValidity` dialog on both sides.
7. Full response submit, signed in, both sides, against a purpose-made MP opportunity — then read both `Responses` rows back from MP and diffed every column.
8. Whether MP's `Opportunities.Close_Responses` flag suppresses the form: created the opportunity, flipped the flag via the API, re-loaded both sides.
9. Anonymous `ContactId` forgery: as an anonymous visitor, set the hidden/`respondAs` contact id to another person's (98) and submitted on both sides, then checked which `Participant_ID` MP recorded.
10. `show-full-address` (C65) confirmation at runtime.
11. Responsive at 390×844, both sides.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Renders signed out | title, date, contact, location, respond form | same | **pass** |
| 1 | Renders signed in | same + populated Respond As | same + populated Respond As | **pass** |
| 2 | Response form fields | `FirstName`, `LastName`, `EmailAddress` (email), `MobilePhoneNumber` (tel), `Message` (textarea), submit | identical names/order; `MobilePhoneNumber` is **`type="text"`** | **fail (minor) → C29** |
| 2 | Hidden fields | `OpportunityId`, `UseEmailTemplate`, `ContactId` | `OpportunityId`, `UseEmailTemplate`, `ContactId` | **pass** |
| 3 | Accessible names | 6 of 7 controls unnamed | 4 of 5 unnamed | parity — legacy is equally bad here, so not filed against this widget (noted in C28) |
| 4 | Respond As options | `Blank Form`, `Kehayias, Chris`, `Kehayias, Sarah`, `Kehayias, Aiden`, `Kehayias, Jillian` | `Chris Kehayias`, `Sarah Kehayias`, `Aiden Kehayias`, `Jillian Kehayias`, `Someone Else (Blank Form)` | pass — same 5 entries, different name format and blank-form position |
| 4 | Personal fields when a member is selected | stay visible, blank, not required | **hidden** | new is better UX, but it is the direct cause of C21 |
| 5 | Has-responded notice | shown when a prior response exists (legacy correctly warned after the new widget's submit) | `#od-has-responded` toggled from `/has-responded?opportunityId=&contactId=` | **pass** — cross-system: legacy showed the warning for the response our widget had just created |
| 6 | Empty submit | top alert "Some field values are incorrect or missing…" + 4 per-field messages ("First Name is required") | 4 per-field `.mpx-field-error` "This field is required." | **pass** — different copy, same behaviour |
| 6 | Bad email | "Invalid format" | "Enter a valid email address." | **pass** |
| 6 | Bad phone (`abc`) | **accepted** | **accepted** | parity — neither validates phone format; not filed |
| 6 | 3,000-char message | accepted | accepted | parity — no `maxlength` on either |
| 6 | Native `reportValidity` popup | none | none | **pass** — shared `form-validation.ts` behaves as required |
| 7 | Submit succeeds | `200 "47"` | `200 {"success":true,"responseId":46}` | **pass** |
| 7 | Stored row: `Participant_ID` | 10 | 10 | **pass** |
| 7 | Stored row: `Opportunity_ID`, `Comments`, `Closed` | correct | correct | **pass** |
| 7 | Stored row: `First_Name`/`Last_Name`/`Email`/`Phone` | `Chris` / `Kehayias` / `chris.kehayias@acst.com` / `321-794-1376` | **all `null`** | **fail → C21** |
| 7 | Response notification email | `dp_Communications` "Opportunity Response Notification" row created | same | **pass** |
| 8 | `Close_Responses = 1` | respond form still rendered and submittable | respond form still rendered and submittable | parity — **neither** honours the flag; not filed as a regression, but see "Not a finding" below |
| 9 | Anonymous forged `ContactId` | accepted, `200 "49"`, `Participant_ID 10` | accepted, `200 {"responseId":48}`, `Participant_ID 10` | parity — see "Not a finding" |
| 10 | Full street address (C65) | `showfulladdress` attribute exists | no such attribute | **C65 confirmed as a config gap, but could not be observed** — see Blocked |
| 11 | 390×844 | usable | usable | **pass** |

## Findings filed

- `C21-opportunity-response-row-missing-contact-fields.md` — the stored `Responses` row leaves name/email/phone NULL when responding as a household member.
- `C29-phone-inputs-are-text-not-tel.md` — `MobilePhoneNumber` is `type="text"` where legacy uses `type="tel"` (shared with `next-custom-form`).

## Where the new widget is better

- Hiding the personal-detail fields once a household member is selected is a real improvement — legacy leaves four blank, non-required inputs on screen that do nothing.
- Names read naturally ("Chris Kehayias") rather than "Kehayias, Chris", and "Someone Else (Blank Form)" is clearer than a bare "Blank Form" placed first.
- The success message names the responder ("Thank you, Chris Kehayias!") and offers "Submit Another Response" without a page reload.
- Date formatting: "Friday, December 31, 2027" against legacy's "Fri, Dec 31, 2027 12:00 AM", where the `12:00 AM` is spurious.
- The confirmed-response tally used to enforce `Maximum_Needed` is one batched query, not the legacy N+1.

## Not a finding (checked, and it is parity)

Two things looked like breaking defects and turned out to be shared with legacy. Both
are worth knowing about; neither is a regression, so neither is filed:

1. **`Opportunities.Close_Responses` is ignored by both widgets.** With the flag set to
   `1` on Opportunity 5, both sides still rendered a fully working Respond form. The
   new detail service never reads the column (`grep Close_Responses src/services/opportunityDetailsService.ts` →
   nothing) and neither does the legacy bundle. A church that closes responses in MP
   gets responses anyway, on both stacks.
2. **An anonymous visitor can forge `ContactId` and have the response attributed to
   someone else.** Setting the contact id to 98 as an anonymous visitor produced, on
   **both** sides, a `Responses` row with `Participant_ID 10` — the real person's
   participant record — carrying the attacker's typed name and email. Legacy's
   `OpportunitiesApi/Respond` and ours (`src/app/api/embed/opportunity-details/respond/route.ts`,
   which comments that "ContactId comes from the form only") behave identically. Ours
   is not a new hole, but it is the kind of thing worth closing while C21 is being
   fixed: an authenticated caller's `ContactId` could be checked against
   `GET /api/embed/household`, and an anonymous caller's ignored.

## Not tested / blocked

- **C65 (`show-full-address`) could not be observed.** None of the five opportunities in this MP instance has an `Address_ID` — `api_MPPW_SearchOpportunities` returns `AddressId: null` for every row, and both detail pages render only `Location: Main Congregation`. The config gap is real and already filed by the cartographer; the *privacy consequence* (a legacy site that relied on hiding a host's home address would start exposing it) is therefore argued rather than demonstrated. Creating an Opportunity with an Address requires an `Addresses` row plus a `Group` or `Event` placement I did not want to fabricate. **Setup that would unblock it:** an opportunity whose `Add_to_Group`'s or contact's address is populated.
- **`response-email-template`** was left unset on both sides (neither page configures it), so the "response confirmation to the responder" path is untested. Both sides did send the church-side notification.
- **The depends-on custom form** (`Opportunities.Custom_Form`) is null on every opportunity here, so the nested-custom-form branch of `next-opportunity-details` never rendered.

## Fixture data

`ZZTEST-Serve-Compare` (Opportunity 5) and Responses 46, 47, 48, 49 were created and
then **deleted**; `getTableRecords({ table: "Responses", filter: "Opportunity_ID = 5" })`
returned empty before the opportunity itself was deleted. The four
`dp_Communications` "Opportunity Response Notification" rows the submits generated
(4134–4136 and one more) were left in place — MP communication history is not
deletable through this API and is harmless.

## Screenshots

- `opportunity-details-old-public.png` / `opportunity-details-new-public.png` — baseline pair, signed out.
- `opportunity-details-old-authed.png` / `opportunity-details-new-authed.png` — signed in, Respond As populated.
- `opportunity-details-old-response-success.png` / `opportunity-details-new-response-success.png` — C21: the two submits whose stored rows differ.
- `opportunity-details-old-validation-empty.png` / `opportunity-details-new-validation-empty.png` — empty submit.
- `opportunity-details-old-validation-bad.png` / `opportunity-details-new-validation-bad.png` — bad email, bad phone, over-long message.
- `opportunity-details-old-close-responses.png` / `opportunity-details-new-close-responses.png` — `Close_Responses = 1` ignored by both.
- `opportunity-details-old-anon-contactid-forgery.png` / `opportunity-details-new-anon-contactid-forgery.png` — the parity security note.
- `opportunity-details-old-mobile.png` / `opportunity-details-new-mobile.png` — 390×844 pair.
- `opportunity-details-old-after-see-details.png` — legacy finder → detail navigation, showing the `?id=` query-param convention.
