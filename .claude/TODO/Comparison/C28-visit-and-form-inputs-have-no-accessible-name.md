# C28. `next-plan-your-visit` and `next-custom-form` render labels that are not associated with their inputs — 13 of 14 and 20 of 27 fields have no accessible name, where legacy names nearly all of them

**Widget:** `next-plan-your-visit`, `next-custom-form` (old: Plan Your Visit, `mpp-custom-form`)
**Severity:** ux
**Confidence:** confirmed — measured with `element.labels`, `aria-label`/`aria-labelledby` and `closest("label")` on every non-hidden control on both sides
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy's shared `FormFieldBuilder` emits an explicit association for every field —
e.g. `<label class="mppw-form-field__label" for="HeadOfHousehold.Contact.CongregationId">`
— so a screen reader announces the field name and clicking the label focuses the
input. Measured (unnamed = no `labels`, no `aria-label`/`aria-labelledby`, no wrapping
`<label>`):

| legacy widget | controls | unnamed | what was unnamed |
|---|---|---|---|
| `mpp-plan-your-visit` step 1 | 5 | 2 | only the two buttons |
| `mpp-custom-form` (Form 6, signed in) | 31 | 8 | Country, City, StateRegion, PostalCode, 3 form fields, the submit button |

## New behaviour

Both widgets render the label as a **sibling** of the input, with no `for` on the
label and no `id` on the input:

```html
<div class="pyv-field"><label>First Name<span…>*</span></label><input class="pyv-input" name="headFirstName" required></div>
```

Measured on the same MP data:

| new widget | controls | unnamed | notes |
|---|---|---|---|
| `next-plan-your-visit` step 2 | 14 | **13** | only `#pyv-congregation` is associated (it is the one field with an `id`) |
| `next-custom-form` (Form 6, signed in) | 27 | **20** | the 7 named ones are the radio/checkbox groups, which happen to wrap |

Unnamed on plan-your-visit: `whenCanWeExpectYou`, `headFirstName`, `headLastName`, the
read-only email, `headMobilePhone`, `addressLine1`, `addressCity`, `addressState`,
`addressPostal`, `addressCountry`, `spouseFirstName`, `spouseEmail`, `spousePhone`.
Unnamed on custom-form: the whole contact/address block plus every text, textarea and
dropdown form field (`mp_customform_234`, `_237`, `_239`, `_240`, `_241`, `_244`–`_249`).

## Why it matters

WCAG 3.3.2 (Labels or Instructions) and 4.1.2 (Name, Role, Value) both fail. A screen
reader on `next-plan-your-visit` step 2 announces "edit text" nine times in a row with
no indication of which field is the address and which is the postal code — on the form
that creates the visitor's Household, Address and family records in MP. It also breaks
click-the-label-to-focus, which is what makes these forms usable on a phone with small
targets. Legacy did this correctly, so a church moving to the new widgets loses
accessibility it already had, which is the version of this problem that gets reported.

`next-opportunity-details` has the same defect (4 of 5 unnamed) but so does its legacy
counterpart (6 of 7 unnamed), so that pair is parity rather than regression — worth
fixing in the same pass, not worth a separate item.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/plan-your-visit-new-labels-unassociated.png`
- Probe run over every `input:not([type=hidden]), select, textarea` in each shadow
  root, recording `(e.labels||[]).length`, `aria-label`/`aria-labelledby` and
  `e.closest("label")`. Raw output:
  - `NEW plan-your-visit step2: {"total":14,"unnamed":13,…}`
  - `NEW custom-form: {"total":27,"unnamed":20,…}`
  - `OLD plan-your-visit step1: {"total":5,"unnamed":2,"unnamedFields":["loginButton(button)","verificationButton(submit)"]}`
  - `OLD custom-form: {"total":31,"unnamed":8,…}`
- Legacy association proven in its bundle: `BuildLabel` emits
  `<label class="mppw-form-field__label" for="…">`.

## Where to fix

- `packages/embed-sdk/src/components/plan-your-visit.ts:455-458` (`renderInitialPhase`),
  `:497-520` (`renderDetailsForm`), `:527-536` (`renderSpouse`),
  `:539-555` (`renderChild`), `:594-616` (`renderAddress`).
- `packages/embed-sdk/src/components/custom-form.ts` — the contact/address block and
  the per-field render.
- Same pattern, same fix, lower priority: `packages/embed-sdk/src/components/opportunity-details.ts:554-575`.

## Suggested fix

Give each control a stable `id` and point the label at it. The field names are already
unique per form, so `id="pyv-headFirstName"` / `id="cf-mp_customform_234"` derived from
the existing `name` is enough, and `requiredStar()` can keep rendering inside the
label. Cheaper alternative if ids are awkward for the dynamically-built custom-form
fields: wrap the input in the `<label>` element, which associates implicitly with no id
at all. A shared `field()` helper in `shared/form-validation.ts` — which already owns
the required-star and error-message markup — would fix all three widgets at once and
stop the next form from regressing.
