# C16. `next-group-details` no longer requires a phone number on a group inquiry, so leaders lose the callback number legacy always captured

**Widget:** `next-group-details` (old: `mpp-group-details`, `/widgets/group_details.aspx`)
**Severity:** ux
**Confidence:** confirmed — both inquiry forms submitted empty and with bad values, and the `required` attribute set read off both shadow roots
**Found:** 2026-09-08, comparison run (groups agent)

## Old behaviour

The legacy inquiry form ("Contact This Group") requires **four** identity fields. Labels
carry the asterisk, the inputs carry `required`, and an empty submit produces one message
per field:

```
required: ["FirstName", "LastName", "EmailAddress", "MobilePhoneNumber"]

First Name*:      First Name is required
Last Name*:       Last Name is required
Email Address*:   Email Address is required
Phone Number*:    Phone Number is required
+ mppw-alert__warning "Some field values are incorrect or missing. Please correct and try
                       to submit the form again."
```

A bad email is caught with a distinct message (`Invalid format`), so the field-level
messages are specific to both the field and the failure. The phone is required but not
format-checked — `"abc"` passes format, it just cannot be blank. The same four are
required on the sign-up tab's Blank Form path.

Result: every legacy `Group_Inquiries` row carries a phone number.

## New behaviour

Only **three** are required. Measured on the new form after an empty submit with
"Someone else…" selected:

```
required: ["firstName", "lastName", "emailAddress"]
aria-invalid: ["firstName", "lastName", "emailAddress"]
errors:   ["This field is required.", "This field is required.", "This field is required."]
summary:  "Please complete the required fields."
```

`mobilePhoneNumber` has no `required` attribute and its label is `Mobile Phone` with no
asterisk (`group-details.ts` blank-fields block). A visitor can submit an inquiry with no
phone number at all, and it is accepted (`200 POST /api/embed/group-details/inquire`).

Everything else about the new validation is correct and in some ways better: it uses the
shared `packages/embed-sdk/src/shared/form-validation.ts`, sets `aria-invalid="true"` on
each offending control, renders inline `.mpx-field-error` text, and — verified by
monkey-patching `HTMLFormElement.prototype.reportValidity` and
`HTMLInputElement.prototype.reportValidity` before submitting — **never** calls the native
API (`nativeReportValidity calls: 0`). Bad email is caught with a specific message
(`Enter a valid email address.`). So this item is narrowly about the phone field, not the
validation mechanism.

Two smaller differences in the same area, recorded here rather than filed separately:

- Field-level copy is generic — `This field is required.` where legacy says
  `First Name is required`. Legacy's is friendlier when several fields fail at once.
- The summary message renders at the **top of the widget**, above the group's title and
  image, rather than next to the form the visitor just submitted. On a tall group page
  with an image the message can be off-screen, so a visitor pressing Send Message may see
  nothing change. The inline field errors do appear next to the fields, which mitigates it.

## Why it matters

A phone number is how a small-group leader actually follows up — text or call, not another
email. Legacy guaranteed one on every inquiry; ours makes it optional, so a share of
inquiries arrive with an email address only. Combined with C11 (no notification email is
sent at all) and C12 (member inquiries store no name, email *or* phone), the practical
outcome is that a group leader may end up with an inquiry they cannot answer by any
channel. Independently of those two, dropping a required field silently changes the data
contract for anyone reporting on `Group_Inquiries.Phone` after migration.

Worth a deliberate decision rather than a reflex fix: requiring a phone number is real
friction on a public form, and some churches would rather have the inquiry than the phone
number. But it should be a choice — legacy made it, we changed it by omission.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/group-details-old-inquiry-validation.png`
    (four field errors)
  - `.claude/playwright/widget/screenshots/group-details-new-inquiry-validation.png`
    (three field errors)
  - `.claude/playwright/widget/screenshots/group-details-old-inquiry-bad-email.png`,
    `group-details-new-inquiry-bad-email.png`
- Measured `required` sets, quoted above, from `#inquiryForm` and `#gd-inquire-form`
- Native-popup check: `rv: 0` after every new-side submit (empty, and bad email/phone)
- Script: `.claude/playwright/widget/scripts/groups-gd-validate.mjs`

## Where to fix

`packages/embed-sdk/src/components/group-details.ts` — `renderBlankFields()` (the
Mobile Phone field), and `renderInquireForm()` / `setMessage` placement for the two
secondary notes.

## Suggested fix

Add `required` to the mobile-phone input on the inquiry blank-form path (and on the
sign-up blank form if C14 restores it), with `requiredStar()` on the label so the shared
validator and the visible marker stay in step — `form-validation.ts` already drives both
off the same attribute, so it is a one-line change per field.

If the friction is judged unacceptable, the honest alternative is to make it configurable
rather than silently optional, and to say so in the migration notes; do not leave the
difference undocumented.

Separately, and cheaply: pass the failing field's label into the required-field message
(`${label} is required.`), and render the form-level summary inside `.gd-form-wrap` next to
the submit button instead of at the top of the shadow root.
