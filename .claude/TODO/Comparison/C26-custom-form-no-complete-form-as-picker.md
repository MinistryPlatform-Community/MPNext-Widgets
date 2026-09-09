# C26. `next-custom-form` has no "Complete Form As" household picker — a signed-in user cannot fill a form out for their spouse or child

**Widget:** `next-custom-form` (old: `mpp-custom-form`; the sample site has no page for it, so it was placed per CONFIG-MAP §5)
**Severity:** functional
**Confidence:** confirmed — both widgets rendered the same MP form (Form 6 "Volunteer - Lead", `formguid 2bb08341-…`) signed in as the same user, and both field inventories were dumped from the shadow roots
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-custom-form` opens with a **Personal Details** block headed `Complete Form As*:`
— a `<select id="ContactId" name="ContactId">` listing the signed-in user's household:

```
Blank Form | Kehayias, Chris | Kehayias, Sarah | Kehayias, Aiden | Kehayias, Jillian
```

Choosing a member fills the contact/address block from that member's record and
submits the response against them. Two companion hidden inputs, `SaveContactInfo` and
`SaveAddressInfo`, plus the shown notice — *"Please note that any updates to your
contact information below will be reflected on your record at the church"* — carry
that block's write-back behaviour. Anonymously the select renders with no options.

## New behaviour

No picker, no Personal Details block, no `ContactId` field. The signed-in render
starts straight at **Your Information** with First Name / Last Name / Email / Mobile
Phone, and the response is always attributed to whatever is typed.

Signed in as the Playwright user, on the identical MP form:

| | old | new |
|---|---|---|
| `ContactId` select ("Complete Form As") | present, 5 options | **absent** |
| `SaveContactInfo` / `SaveAddressInfo` hidden inputs | present | absent |
| `updateMyInfo` checkbox | present (hidden) | absent |
| the 12 `mp_customform_*` fields | identical | identical |

Everything else matched exactly — same 12 fields, same order, same input types, same
option lists, same required flags (full tables in the custom-form test log). This is
the one capability that is gone.

This repo already has the pattern elsewhere: `next-opportunity-details` renders a
"Respond As" picker from `GET /api/embed/household` over the same household roster, so
both the endpoint and the UI idiom exist.

## Why it matters

Custom forms are overwhelmingly *about* someone other than the person at the keyboard
— camp registration, medical release, faith-formation enrolment, a child's allergy
form. Legacy's Personal Details block exists so a parent completes one form per child
from their own login and each response lands on the right contact. Without it, a
parent registering three children types three sets of details that MP then has to
fuzzy-match, and `Form_Responses.Contact_ID` comes back null (measured: legacy stamped
a `Contact_ID`, ours wrote `null`). That is a data-quality regression on the church's
side of the flow rather than a visible error for the visitor.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/custom-form-old-form6-authed-complete-as.png`
  vs `.claude/playwright/widget/screenshots/custom-form-new-form6-authed-no-complete-as.png`
- Signed-in field inventories from both shadow roots; legacy `ContactId` options:
  `["Blank Form","Kehayias, Chris","Kehayias, Sarah","Kehayias, Aiden","Kehayias, Jillian"]`
- MP verification of the stored responses (Form 12, one submit per side, both rows
  since deleted): legacy `Form_Response 7` had `Contact_ID 2`; new `Form_Response 8`
  had `Contact_ID null`. The `Form_Response_Answers` rows were structurally identical
  (fields 303 and 304 on both sides).
- Legacy was placed with `page.route` rewriting the one widget line of
  `/widgets/prayer_feedback_form.aspx` into
  `<mpp-custom-form formguid="2bb08341-5140-42e8-9b61-37c4950b1933">` before
  `DOMContentLoaded`, per CONFIG-MAP §5.

## Where to fix

- `packages/embed-sdk/src/components/custom-form.ts` — the "Your Information" block
  render and the submit payload assembly.
- Reference implementation to copy:
  `packages/embed-sdk/src/components/opportunity-details.ts:583+` (`renderRespondAs`)
  and `:224-230` (the `GET /api/embed/household` load).
- `src/app/api/embed/custom-form/submit/route.ts` — must accept and honour a
  `ContactId`, and should resolve that contact's own details server-side rather than
  trusting the client's (same argument as C21).

## Suggested fix

Reuse the "Respond As" pattern from `opportunity-details.ts`: load
`GET /api/embed/household` when authenticated, render a `ContactId` select with a
"Blank Form" option, prefill the contact/address block from the chosen member, and
pass `ContactId` through to the submit route so `Form_Responses.Contact_ID` is set.
Legacy's write-back behaviour (`SaveContactInfo` / `SaveAddressInfo` / `updateMyInfo`)
is a separate and larger question — confirm whether the new submit route updates the
contact record at all before deciding to port it.
