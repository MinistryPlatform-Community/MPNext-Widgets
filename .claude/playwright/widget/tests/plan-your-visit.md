# plan-your-visit — comparison test log

- **New**: `next-plan-your-visit` — http://localhost:5173/demo-plan-your-visit.html
- **Old**: Plan Your Visit — https://mpi.ministryplatform.com/widgets/plan_your_visit.aspx
- **Tested**: 2026-09-08 by subagent *serving & visit* (block C20–C29)
- **Auth state(s) tested**: signed out (this is an anonymous first-time-visitor flow on both sides; neither widget requires or benefits from a session)
- **Script**: scratchpad `pyv1.mjs`, `pyv-step1submit.mjs`, `pyv2.mjs`, `pyv-submit.mjs`, `pyv-phone.mjs`, `pyv-old-step2.mjs`, `pyv-exists.mjs`, `a11y.mjs`; token minting via `.claude/playwright/widget/scripts/serve-mint-pyv-token.mts`; MP verification via `serve-mp-probe.mts`

The new widget was reconfigured to mirror the legacy page exactly, per CONFIG-MAP
§2.17 — the demo page defaults to blank template ids, which is not a defect but does
make the flow refuse to send. Every run replaced the element wholesale (`api-host`
is captured in the constructor, so a late `setAttribute` is too late):

```
<next-plan-your-visit api-host="http://localhost:3000"
  return-url="http://localhost:5173/demo-plan-your-visit.html"
  verification-email-template-id="122"
  church-notification-email-template-id="132"
  collect-address="true" milestone-to-assign-id="2" milestone-program-id="3">
```

`user-notification-email-template-id` is deliberately absent — that is C63, already
filed.

## What I tested

1. Step 1 render, both sides: fields, types, required flags, labels, copy.
2. Step 1 validation, both sides: empty submit; then a malformed email. Watched for a native `reportValidity` dialog.
3. Step 1 submit, both sides, with a `@example.invalid` address → recorded the API call and the confirmation copy.
4. Existing-contact branch, both sides: submitted step 1 with an email that *is* an MP contact.
5. Whether the legacy step-2 form is reachable without a mailbox (attempted three routes; see Blocked).
6. Step 2, new side, reached by minting a `pyv-verify` token locally with the repo's own `createVerifyToken`: full field inventory, types, required flags, option lists.
7. Step 2 field-for-field against legacy, derived from the vendor bundle's own form-builder calls (`BuildTextInput("HeadOfHousehold.Contact.FirstName")` etc.) — the only way to enumerate a form I cannot render.
8. Campus (congregation) selection → does the age/grade group list reload?
9. Children: add two, add a third, remove one — and whether typed values survive each re-render.
10. Age-or-grade picker: option list with no DOB, then after setting a DOB (the legacy "nearest promote-age first" sort).
11. Step 2 validation: empty submit across all required fields, and whether the phone field accepts a real number.
12. Step 2 submit end to end, then verified every MP record it created (Households, Addresses, Contacts, Participants, Participant_Milestones, dp_Communications).
13. Google Places address autocomplete: is it present, and does it degrade gracefully?
14. Accessible names on every control, both sides.
15. Responsive at 390×844, both sides, both steps.
16. Multi-step navigation: can you go back without losing input?

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Step 1 fields | `FirstName`, `LastName`, `EmailAddress` (email), all required, + submit | `firstName`, `lastName`, `email` (email), all required, + submit | **pass** |
| 1 | Step 1 copy | "We are looking forward to meeting you on your first Sunday…" / "Let Us Know You're Coming" / button **Send** | "Tell us a little about you and we'll email you a link…" / button **Send Verification Email** | pass (copy differs — see C67) |
| 1 | Embedded sign-in affordance | hidden `#loginButton` in the widget | `contactExists`-gated Sign In button | pass |
| 2 | Empty submit | top alert + "Required" per field | per-field `.mpx-field-error` "This field is required." | **pass** |
| 2 | Bad email | "Invalid format" | "Enter a valid email address." | **pass** |
| 2 | Native `reportValidity` popup | none | none | **pass** |
| 3 | Step 1 submit | `200 {"success":true,…"verificationSuccessMessage"}` → "Please check your email and follow the link to verify and continue planning your visit!" | `200` → "Check your email — we've sent you a link to finish planning your visit." | **pass** |
| 4 | Email belongs to an existing contact | still sends the verification email, no sign-in prompt | still sends the verification email, no sign-in prompt | **pass** — parity; neither gates on an existing contact |
| 6/7 | **Step 2 field set** | `HeadOfHousehold.Contact.FirstName`, `.LastName`, `.MobilePhoneNumber`, read-only email, `WhenCanWeExpectYou` (**free text**, required), congregation select, `HouseholdAddress.AddressLine1`/`City`/`StateOrProvince`/`PostalCode` + country select, `Spouse.Contact.FirstName`/`.EmailAddress`/`.MobilePhoneNumber`, children: 2 text + date + gender select + age/grade select | `headFirstName`, `headLastName`, `headMobilePhone`, read-only email, `whenCanWeExpectYou` (**free text**, required), `#pyv-congregation`, `addressLine1`/`addressCity`/`addressState`/`addressPostal` + `addressCountry`, `spouseFirstName`/`spouseEmail`/`spousePhone`, children: `child-N-firstName`/`lastName`/`dob`(date)/`gender`(select)/`ageGroup`(select) | **pass — complete field-for-field parity**, including that "When can we expect you?" is free text on both sides rather than a service-time picker |
| 8 | Campus → age-group reload | (unreachable) | `GET /api/embed/plan-your-visit/age-groups?congregationId=1` fires on change | **pass** |
| 9 | **Add / remove a child preserves typed input** | (unreachable) | **no** — adding or removing a child wipes every previously typed child name, gender and age-group; only DOB survives | **fail → part of the C24 fix area; see "Second defect" below** |
| 10 | Age-or-grade options | (unreachable) | `["Select a group"]` — empty | **not a defect** (data condition, see Blocked) |
| 11 | Step 2 empty submit | (unreachable) | 9 per-field messages + "Please complete the required fields.", no native popup | **pass** |
| 11 | **Phone field accepts a real number** | `type="tel"`, mask used as a formatter | **`pattern="xxx-xxx-xxxx"`; `321-555-0100`, `3215550100`, `(321) 555-0100`, `+13215550100` all fail `checkValidity()`** | **fail → C24 (breaking)** |
| 12 | Step 2 submit (after removing the bogus `pattern`) | (unreachable) | `200 {"success":true}` | **pass** |
| 12 | MP records created | (unreachable) | Household 450 (+ Address 499, Congregation 1), Contacts 943 head / 944 spouse / 945 child (DOB + Gender + `Household_Position_ID 2`), Participants 827–829, Participant_Milestones 12–13 (Milestone 2 for head **and** spouse), `dp_Communications` 4141 (template 132) | **pass — the write is complete and correct** |
| 13 | Address autocomplete | `GET /Api/ConfigurationApi/GetConfigurationSettingValue?keyName=GoogleMapsAPIKey` → 200, `google.maps.places.Autocomplete` bound to the address input | **no Maps request at all**; source comment says "no Google Places autocomplete in v1" | **fail → C23** |
| 14 | Accessible names | step 1: 3 of 3 named | step 2: **13 of 14 unnamed** | **fail → C28** |
| 15 | 390×844 | usable | usable | **pass** |
| 16 | Back without losing input | n/a — legacy step 2 is a single page reached by an emailed link | same shape: one page per step, no in-widget back button; the email link is the only way back into step 2 | **pass** — there is no multi-step back navigation to lose input in, on either side |

## Second defect found in step 2 (folded into C24's file? no — see below)

`renderChildren()` rebuilds `#pyv-children` with `innerHTML`, and `syncChildren()`
preserves **only** `dob`:

```ts
private syncChildren() {
  for (const c of this.childRows) {
    const dob = this.root.querySelector<HTMLInputElement>(`[name="child-${c.key}-dob"]`);
    if (dob) c.dob = dob.value;
  }
}
```

Measured: typed `ZZKidOne` into child 0's first name and `ZZKidTwo` into child 1's,
clicked "+ Add child" → both first names were empty; child 0's DOB (`2019-04-15`)
survived. Removing a child does the same. A family with three children loses each
child's name as they add the next one.

I did **not** file this separately — my reserved block C20–C29 is fully used and this
is the same file, the same function area and the same fix session as C24
(`plan-your-visit.ts`). It is recorded here and named in C24's "Where to fix" so it
cannot be lost: **`plan-your-visit.ts:326-331` (`syncChildren`) must capture
`firstName`, `lastName`, `gender` and `ageGroup` alongside `dob`, or `renderChild`
must stop being re-rendered from scratch.** If a spare number frees up at
consolidation, this deserves its own item at `functional`.

## Findings filed

- `C24-plan-your-visit-phone-mask-blocks-submit.md` — **breaking**: MP's display phone mask is used as an HTML `pattern`, so the required Mobile Phone field rejects every real number and the flow can never be completed.
- `C23-plan-your-visit-no-address-autocomplete.md` — no Google Places autocomplete, though legacy has it and this repo already ships the helper and the MP key channel.
- `C28-visit-and-form-inputs-have-no-accessible-name.md` — 13 of 14 step-2 controls have no accessible name; legacy associates every label.
- (already filed by the cartographer, confirmed here: `C63` — no `user-notification-email-template-id`.)

## Where the new widget is better

- The verify token is a **signed, 24-hour HS256 JWT carrying the visitor's name and email** (`src/lib/embed/verify-token.ts`), so step 2 can pre-fill and the server can trust those values without a DB round trip. Legacy's is also a JWT but is minted and read entirely server-side.
- Children get a real `<input type="date">` and the age/grade options are re-sorted by proximity to the child's age (a faithful port of the legacy sort) as soon as a DOB is entered — the sort fires client-side on `change`, with no request.
- The details form is hidden after a successful submit, so the visitor cannot double-submit; legacy leaves the form in place.
- The write is transactional-looking and complete: one submit produced the Household, Address, three Contacts, three Participants and two Milestone assignments in the right shapes, with `Household_Position_ID 2` correctly applied to the child.

## Not tested / blocked

- **The legacy step-2 form could not be rendered.** Three routes were tried:
  1. Reading the verification email — the message does **not** appear in `dp_Communications` (legacy PYV sends via a path that leaves no row I can read), and I have no mailbox.
  2. Deriving the token — `GET /Api/PlanYourVisitApi/VerifyEmailLink?mppVerifyId=<guid>` answers `500 {"Details":"Error decoding jwt"}`, i.e. the legacy token is a JWT signed with MP's server secret. Not obtainable.
  3. Checking whether step 1 creates a Contact whose GUID is the token — it does not; no contact was created for `zztest.pyv.old@example.invalid`.

  So checks 8–13 have no legacy column. **The field-for-field comparison in row 6/7 is
  therefore derived from the legacy bundle's own `BuildTextInput` / `BuildDateInput` /
  `BuildPhoneInput` / `BuildSelect` call sites and its `*Label` i18n keys** — a
  vendor-source enumeration, not a rendered observation. It is complete for *which
  fields exist*; it cannot speak to their rendered copy, layout or client-side
  behaviour. **Setup that would unblock it:** an inbox on a domain MP will send to, or
  read access to whatever table legacy logs `SendVerificationEmail` into.
- **The Age-or-Grade Group dropdown is empty, and that is correct here.** The only
  `Group_Type_ID = 4` ("Age or Grade Group") row in this MP instance is
  *Babies (Sample)* with `Available_Online = false`, so
  `getAgeOrGradeGroups()`'s `Available_Online = 1` filter correctly excludes it.
  Verified by querying `Groups` for `Group_Type_ID = 4` directly. Not a finding — but
  it means the age/grade **sort** logic (check 10) has never been exercised against
  real options on either stack. Setup to unblock: an online-available age/grade group
  with `Age_in_Months_to_Promote` set.
- **`verify-param-name`** was left at its `mpp-verify-id` default, matching legacy.
- **The `contactExists` sign-in branch** never triggered, because neither widget gates on an existing contact (row 4) — so `next-plan-your-visit`'s "An account already exists… Please sign in instead." copy and its Sign In button are unexercised.

## Fixture data left behind

`Contacts 943`, `944`, `945`, `Participants 827–829`, `Household 450` and
`Address 499` **could not be deleted** — `DELETE /tables/Contacts` and the rest return
`500` for this API user (FK-protected). `Participant_Milestones 12` and `13` were
deleted successfully. The three contacts were instead renamed
**`ZZTEST-DELETE-ME`** (with `Nickname` `ZZTEST`) so they are unmistakable and
findable; someone with MP Platform access should delete household 450 and its members.
`dp_Communications 4141` (the church notification) was left in place.

## Screenshots

- `plan-your-visit-old-step1.png` / `plan-your-visit-new-step1.png` — baseline pair.
- `plan-your-visit-old-step1-validation.png` / `plan-your-visit-new-step1-validation.png` — step-1 validation.
- `plan-your-visit-old-step1-sent.png` / `plan-your-visit-new-step1-contact-exists.png` — post-submit confirmation copy on both sides.
- `plan-your-visit-new-step2.png` — step 2 in full (reached with a locally minted token).
- `plan-your-visit-new-phone-mask-blocks-submit.png` — C24: `pattern="xxx-xxx-xxxx"` rejecting a real number.
- `plan-your-visit-new-step2-validation.png` — C24: the blocked submit, "Please match the requested format." under Mobile Phone.
- `plan-your-visit-new-step2-submitted.png` — the same form completing once `pattern` is removed.
- `plan-your-visit-new-labels-unassociated.png` — C28.
- `plan-your-visit-old-bogus-token.png` — legacy's invalid-token state ("Unable to verify your information, please try again.") and the evidence that its token is a server-signed JWT.
- `plan-your-visit-old-step1-mobile.png` / `plan-your-visit-new-step1-mobile.png` / `plan-your-visit-new-step2-mobile.png` — 390×844.
