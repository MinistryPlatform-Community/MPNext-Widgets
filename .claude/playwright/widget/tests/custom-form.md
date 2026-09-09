# custom-form — comparison test log

- **New**: `next-custom-form` — http://localhost:5173/demo-custom-form.html?id=&lt;form guid&gt;
- **Old**: `mpp-custom-form` — **the sample site has no page for it**, so it was placed by rewriting the shell of `https://mpi.ministryplatform.com/widgets/prayer_feedback_form.aspx` (CONFIG-MAP §5)
- **Tested**: 2026-09-08 by subagent *serving & visit* (block C20–C29)
- **Auth state(s) tested**: signed out and signed in as `PLAYWRIGHT_MP_USERNAME`, both sides
- **Script**: scratchpad `cf.mjs`, `cf-submit.mjs`, `cf-old2.mjs`, `cf-new2.mjs`, `a11y.mjs`, `final-shots.mjs`; MP verification via `.claude/playwright/widget/scripts/serve-mp-probe2.mts`

**Pairing correction applied.** The BRIEF pointed me at
`/widgets/prayer_feedback_form.aspx`, but that page hosts
`mpp-prayer-feedback-form` — a **different** legacy widget writing
`Feedback_Entries`, with no `next-*` counterpart (already filed as **C69**). The true
counterpart of `next-custom-form` is `mpp-custom-form` (`formguid`). I used the prayer
page only as a host shell and separately recorded what that legacy-only widget does
(below).

**How the legacy widget was placed.** MPWidgets.js only fetches bundles for tags
present during its own `DOMContentLoaded` scan, so the tag has to exist before the
document loads. `page.route` intercepts the `.aspx`, replaces the one
`<mpp-prayer-feedback-form>` line with `<mpp-custom-form formguid="…">`, and fulfils.
That worked first time and is the cheapest of the three routes CONFIG-MAP §5 lists.

## Forms used

No single MP form in this instance exercises all nine `Form_Field_Types`, so three
were used to cover them:

| Form | GUID | Field types present | Why |
|---|---|---|---|
| 9 — Faith Formation Registration | `48606387-ad56-40ec-8192-219841c18b3e` | 1, 2, 4, 5, 6, **9 (File Upload)** | file upload; `Get_Contact_Info = 0` |
| 6 — Volunteer - Lead | `2bb08341-5140-42e8-9b61-37c4950b1933` | 1, 2, 4, 5, 6, **8 (Checkbox)** | checkbox; `Get_Contact_Info/Address_Info = 1`; 12 fields |
| 10 — Family Registration Form Template | `42727d76-e55f-46d2-8647-39f9262e3db5` | 1, **3 (Date)**, 5, 6, **7 (Radio Horizontal)** | date + horizontal radios; 5 date fields, 17 radios |
| 12 — All Fields Form | `8caeb976-bc49-42fa-9579-aceea82a4f00` | 1, 2, 6 | small enough to submit end to end on both sides |

Between them: Text Box, Memo, Date, Radio Vertical, Drop-down, Instructions, Radio
Horizontal, Checkbox, File Upload — all nine types.

## What I tested

1. Render on all three multi-type forms, both sides, signed out: element upgraded, shadow root populated, console/network captured.
2. Field-type census per form on both sides: counts of `text`, `textarea`, `select`, `radio`, `checkbox`, `date`, `file`, `hidden`, `email`, `tel`.
3. Full field inventory on Form 6, **signed in**, both sides: name, type, required, visibility, option list, and accessible name — then diffed field by field.
4. Accessible names on every non-hidden control, both sides.
5. Validation on Form 12, both sides: empty submit, then a malformed email. Watched for a native `reportValidity` dialog.
6. Full submit on Form 12, both sides, then read the `Form_Responses` and `Form_Response_Answers` rows out of MP and diffed every column.
7. Google Places autocomplete on the address block: present? working? degrades?
8. Responsive at 390×844 on Form 9, both sides.
9. The legacy-only `mpp-prayer-feedback-form` on its own page, for the C69 record.

## Results

### Field-type census

| Type | Form 9 old → new | Form 6 old → new | Form 10 old → new |
|---|---|---|---|
| text | 10 → 10 | 15 → 8 | 9 → 2 |
| textarea | 1 → 1 | 1 → 1 | 0 → 0 |
| select | 3 → **2** | 4 → **2** | 3 → **1** |
| radio | 6 → 6 | 6 → 6 | 17 → 17 |
| checkbox | 1 → **0** | 2 → **1** | 1 → **0** |
| date | 0 → 0 | 0 → 0 | 5 → 5 |
| **file** | **2 → 2** | 0 → 0 | 0 → 0 |
| email | 0 → 0 | 1 → 1 | 1 → 1 |
| tel | 0 → 0 | **1 → 0** | **1 → 0** |
| hidden | 4 → 1 | 4 → 1 | 4 → 1 |

Every residual difference was traced to the contact/address block, never to an MP form
field. The signed-in Form 6 inventory resolves all of them:

| Field | Old | New | Verdict |
|---|---|---|---|
| all 12 `mp_customform_*` fields | present | present, **identical** names, order, types, option lists and required flags | **pass — no MP field type is dropped or mis-rendered** |
| `mp_customform_235/236/238` (Radio Vertical) | radio, values `["Yes ","No"]` | radio, values `["Yes","No"]` | **pass** (legacy leaks a trailing space) |
| `mp_customform_240/241` (Drop-down) | select, `["-- Select --","Yes","No"]` | identical | **pass** |
| `mp_customform_242` (Checkbox) | checkbox, required, value `Yes` | checkbox, required, value `true` | **pass** |
| Form 9 File Upload ×2 | `input[type=file]` ×2 | `input[type=file]` ×2 | **pass** |
| Form 10 Date ×5, Radio Horizontal ×17 | 5 / 17 | 5 / 17 | **pass** |
| Instructions (type 6) | rendered as body copy | rendered as body copy | **pass** |
| `ContactId` "Complete Form As" select | 5 household options | **absent** | **fail → C26** |
| `Country` select | required, defaults United States of America | **absent** | **fail → C27** |
| `MobilePhoneNumber` | `type="tel"` | `type="text"` | **fail → C29** |
| `SaveContactInfo` / `SaveAddressInfo` / `updateMyInfo` | present | absent | see "Not tested" |

### Everything else

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Renders on all three forms | renders | renders | **pass** |
| 4 | Accessible names (Form 6, signed in) | 31 controls, 8 unnamed | 27 controls, **20 unnamed** | **fail → C28** |
| 5 | Empty submit (Form 12) | top alert + per-field "First Name is required" / "Phone or Email is required" / "Address Line 1 is required" | 9 per-field `.mpx-field-error` "This field is required." | **pass** |
| 5 | Bad email | "Invalid format" | "Enter a valid email address." | **pass** |
| 5 | Native `reportValidity` popup | none | none | **pass** |
| 5 | Required-field semantics | legacy treats phone **or** email as satisfying either ("Phone or Email is required") | requires each independently | pass — new is stricter, not weaker |
| 6 | Submit (Form 12) | `POST /Api/CustomFormApi/PostFormData` → 200 | `POST /api/embed/custom-form/submit` → `200 {"success":true,"formResponseId":8}` | **pass** |
| 6 | Completion message | "Congrats this is the complete message" (the form's `Complete_Message`) | **identical** | **pass** |
| 6 | `Form_Responses` row | `First_Name ZZTEST`, `Last_Name CfOld`, email, `Phone_Number 321-555-0102`, `Address_Line_1 1 ZZTEST Way`, `Address_City Melbourne`, `Address_State FL`, `Address_Zip 32904`, `Contact_ID 2` | identical on every column **except** `Contact_ID null` | pass with one note — see below |
| 6 | `Form_Response_Answers` | fields 303 + 304 with the typed values | fields 303 + 304 with the typed values | **pass — answers stored identically** |
| 7 | Address autocomplete | present (same MP Maps key) | **present** — `google-places.ts` is wired here, unlike `next-plan-your-visit` | pass, with a caveat below |
| 8 | 390×844 (Form 9) | usable | usable | **pass** |

## Findings filed

- `C26-custom-form-no-complete-form-as-picker.md` — no household picker; a signed-in user cannot complete a form for their spouse or child.
- `C27-custom-form-address-has-no-country.md` — the address block has no Country field.
- `C28-visit-and-form-inputs-have-no-accessible-name.md` — 20 of 27 controls have no accessible name (shared item with `next-plan-your-visit`).
- `C29-phone-inputs-are-text-not-tel.md` — `MobilePhoneNumber` is `type="text"` (shared item with `next-opportunity-details`).

## Where the new widget is better

- **No MP form field type is dropped or mis-rendered.** All nine `Form_Field_Types` — including File Upload, Date, both radio orientations, Checkbox and Instructions — render with matching types, order, option lists and required flags. This was the highest-risk check in my brief (a dropped field type silently loses submitted data) and it passes cleanly.
- Radio values are clean (`"Yes"`), where legacy carries a trailing space (`"Yes "`) straight from `Form_Fields.Field_Values` into the submitted value.
- `Form_Responses.Contact_ID` is left `null` for an anonymous submission. Legacy stamped `Contact_ID 2` — a contact that is **not** the submitter (I submitted anonymously as "ZZTEST CfOld / zztest.cf.old@example.invalid"). Ours is the more honest row; legacy's looks like a service-account attribution artefact. (This is *not* an argument against C26, which is about a deliberate, user-chosen contact.)
- Required-field logic is per-field rather than legacy's "Phone or Email is required" pair, which produces a clearer error.
- The demo page reloads the widget when the MP token appears in `localStorage`, so signing in re-runs the auth detection without a page reload.

## Not tested / blocked

- **The Google Maps key is API-target-blocked on `localhost:5173`.** `next-custom-form` correctly wires `shared/google-places.ts`, but the console logs
  `https://developers.google.com/maps/documentation/javascript/error-messages#api-target-blocked-map-error`
  and the autocomplete never appears. It **degrades gracefully** — I typed the whole
  address by hand and the submit stored it correctly — so this is not a defect in the
  widget. What I could not determine is *why* the key is blocked: MP's key is fetched
  from `ConfigurationApi/GetConfigurationSettingValue?keyName=GoogleMapsAPIKey` and is
  plausibly HTTP-referrer-restricted to the church's own MP domain, in which case
  autocomplete will be dead on **every** embedded customer origin, not just localhost.
  That is a deployment question I have no way to answer from here (it needs the key's
  Google Cloud restrictions), so it is recorded rather than filed. Whoever picks up
  C23 should settle it.
- **`SaveContactInfo` / `SaveAddressInfo` / `updateMyInfo` write-back.** Legacy shows
  the notice *"any updates to your contact information below will be reflected on your
  record at the church"* and carries three fields to drive it. `next-custom-form` has
  none of them, and I did not establish whether `POST /api/embed/custom-form/submit`
  updates the contact record anyway. Deliberately **not filed** — it needs a
  signed-in submit with a deliberately changed phone number and a before/after read of
  the `Contacts` row, and I did not want to mutate the Playwright user's own contact
  record. Named in C26's suggested fix so it is not lost.
- **File upload was not exercised end to end.** Form 9's two `input[type=file]`
  controls render on both sides (that is the parity claim), but I did not upload a file
  and compare the resulting `dp_Files` rows. Setup to unblock: a throwaway file plus a
  willingness to leave a `dp_Files` row behind, since file rows are not deletable
  through this API user (the `Contacts` deletes already failed the same way).
- **`Force_Login` forms.** Every form in this instance has `Force_Login = false`, so
  the new widget's force-login gate and legacy's equivalent are both untested.
- **`checkout-url`** (a new-only attribute) was not exercised; no form here has a `Product_ID`.

## The legacy-only widget on the host page (`mpp-prayer-feedback-form`, C69)

Recorded while the prayer page was open, since it is the page my brief named and it
has no counterpart at all. Signed out, it renders: *"Prayer & Feedback — Please
complete the form below to request prayer, share a praise report, or provide other
comments and feedback."* and these controls:

```
ContactId (select, "Provide Feedback As*") | FirstName* | LastName* | EmailAddress* (email)
MobilePhoneNumber (tel) | FeedbackType* (select: Comments, Praise Report, Prayer Request,
Raving Fan, User Removal Request) | FeedbackSummary* | FeedbackDetails (textarea)
FeedbackPrivate (checkbox) | submit
hidden: VerificationEmailTemplateID, ProgramId, ReturnUrl
```

The distinguishing capability is the **Feedback Type** dropdown, sourced from MP's
Feedback Types for the configured `programid` (the sample page sets `programid="12"`,
`verificationemailtemplate="5125"`), plus the **Private** flag — neither of which has
any equivalent in `next-custom-form`, because the widget writes `Feedback_Entries`
rather than `Form_Responses`. This is runtime confirmation of **C69**; no new item
filed. Screenshot: `prayer-feedback-old-legacy-only.png`.

## Fixture data

`Form_Responses 7` (legacy) and `8` (new) plus `Form_Response_Answers 23–26` were
created and **deleted** — all six deletes confirmed. No forms or fields were modified.

## Screenshots

- `custom-form-old-form9.png` / `custom-form-new-form9.png` — baseline pair (file upload, radios, dropdowns).
- `custom-form-old-form6.png` / `custom-form-new-form6.png` — signed out.
- `custom-form-old-form6-authed-complete-as.png` / `custom-form-new-form6-authed-no-complete-as.png` — C26 and C27: the "Complete Form As" picker and the Country select, present vs absent.
- `custom-form-old-form10.png` / `custom-form-new-form10.png` — dates and horizontal radios.
- `custom-form-old-validation-empty.png` / `custom-form-new-validation-empty.png` — empty submit.
- `custom-form-new-validation-bad.png` — bad email.
- `custom-form-old-submitted.png` / `custom-form-new-submitted.png` — the two submits whose MP rows were diffed; both show the same `Complete_Message`.
- `custom-form-old-form9-mobile.png` / `custom-form-new-form9-mobile.png` — 390×844 pair.
- `prayer-feedback-old-legacy-only.png` — the legacy-only prayer/feedback widget (C69).
