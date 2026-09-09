# `next-custom-form` — plan

**Items:** C26 (functional) · C27 (functional) · C28 (ux, shared) · C29 (ux, shared)
**Cutover verdict: C26 and C27 land before cutover — both are data-quality regressions in MP.**
**Owns:** `packages/embed-sdk/src/components/custom-form.ts`,
`src/services/customFormService.ts`, `src/app/api/embed/custom-form/submit/route.ts`

## What the feedback says

The form rendering itself is **exact**. All nine MP `Form_Field_Types` — including File
Upload, Date and Checkbox — render identically and store identical `Form_Response_Answers`;
the twelve fields on the test form matched in order, input type, option lists and required
flags. What is missing is the block *around* the form.

- **C26** — no **"Complete Form As"** household picker. Legacy opens with a Personal Details
  block listing the signed-in user's household (`Blank Form` + four members); choosing a member
  fills the contact block from their record and submits the response **against them**. Ours
  starts straight at "Your Information" and attributes the response to whatever is typed.
  Measured: legacy stamped `Form_Responses.Contact_ID = 2`; **ours wrote `null`**.
- **C27** — the address block has **no Country field**. Legacy renders five controls with
  Country first and required, defaulting to United States of America; ours renders four.
- **C28 / C29** — 20 of 27 controls have no accessible name; the phone is `type="text"`.

## Why C26 matters more than a missing dropdown

Custom forms are overwhelmingly *about someone other than the person at the keyboard* — camp
registration, medical release, faith-formation enrolment, a child's allergy form. Legacy's
Personal Details block exists so a parent completes one form per child from their own login and
each response lands on the right contact. Without it, a parent registering three children types
three sets of details that MP then has to fuzzy-match, and `Contact_ID` comes back null on all
three. That is a data-quality regression on the *church's* side of the flow, invisible to the
visitor, and it is exactly the kind of thing a church discovers six months later when the
records will not reconcile.

## Where the new widget is already better — protect these

- **`next-custom-form` is a superset of `mpp-custom-form` on configuration.** Legacy observes
  `["formguid"]` and nothing else; ours observes `form-guid` / `form-id` / `id-parameter-name`
  / `checkout-url`.
- **All nine field types are at exact parity, storage included.** Do not disturb the field
  renderer while adding the blocks around it.
- The shared `form-validation.ts` is in use with no native popups.

## Phase 1 — C26, the household picker

**The pattern already exists in this repo.** `next-opportunity-details` renders a "Respond As"
picker from `GET /api/embed/household` over the same household roster —
`opportunity-details.ts:583+` (`renderRespondAs`) and `:224-230` (the household load). Copy it,
do not invent a second shape.

1. Load `GET /api/embed/household` when authenticated; render nothing when anonymous (legacy
   renders the select with no options, which is worse).
2. Render a `ContactId` select with a **"Blank Form"** option — or better, `Someone else…`,
   matching the clearer wording `next-group-details` already uses.
3. Prefill the contact/address block from the chosen member.
4. Pass `ContactId` through to the submit route so `Form_Responses.Contact_ID` is set.

**Resolve the chosen contact's details server-side rather than trusting the client's** — same
argument as C21 and C12: the client only knows a display name, and accepting a client-supplied
email for a contact picked from a list lets a caller write someone else's details. See
`opportunity-details.md` Phase 1 for the shape.

### The write-back question — decide it, do not port it by reflex

Legacy also carries `SaveContactInfo`, `SaveAddressInfo` and an `updateMyInfo` checkbox, with
the notice *"any updates to your contact information below will be reflected on your record at
the church"*. That is a **separate and larger capability**: a form submission that also mutates
the contact record.

**Confirm whether the new submit route updates the contact record at all before deciding to
port it.** My recommendation: do *not* port silent write-back in v1. A form that quietly
rewrites a member's address because they typed a delivery address into a camp form is a support
problem, and MP already has better surfaces for editing a contact (`next-profile`,
`next-my-household`). If it is wanted, make it an explicit, opt-in, clearly-labelled checkbox —
which is what legacy's `updateMyInfo` is, and it is currently hidden.

## Phase 2 — C27, Country

Every address a custom form captures is currently country-less, which breaks address
standardisation and mail merges for any church with international members, and silently
downgrades data the same form collected correctly the day before on the legacy widget.
Churches notice this when a mailing goes out wrong.

**The lookup already exists in this repo** — `planYourVisitService.ts:106-111` has the exact
query (`Country_Code AS Code, Country AS Name`, ordered by `Country`, top 300) and
`plan-your-visit.ts:602-616` renders it. `next-custom-form` is the outlier.

Add `countries` to the custom-form header payload (`customFormService.ts:110-137`), render a
Country select above Address Line 1 defaulting to the United States entry, make it required
only when the rest of the address block is (matching legacy), and persist it in the submit
route.

**One caution found while verifying, do not "fix" it:** MP's own `Countries.Country` value for
`CW` is stored double-UTF-8-encoded — verified against the raw bytes. It is MP's stored data,
not a client bug, and both widgets show the same mangled name.

## Phase 3 — the shared a11y items

Both handled by `CROSS-3`:

- **C28** — 20 of 27 controls unnamed; the 7 named ones are the radio/checkbox groups that
  happen to wrap. The whole contact/address block plus every text, textarea and dropdown field
  is unnamed. The `field()` helper in `form-validation.ts` fixes it — **and for the
  dynamically-built `mp_customform_*` fields, wrapping the input in the `<label>` element
  associates implicitly with no id at all**, which is the cheaper route here.
- **C29** — `MobilePhoneNumber` → `type="tel"` + `autocomplete="tel"`. **Do not extend this to
  MP form fields whose label reads like a phone number** (Form 6 has three "Reference N: Phone
  Number" fields): MP's `Form_Field_Types` has no phone type and legacy renders them as text
  too. That half is parity and must not be guessed from a label.

## The Google Maps question, shared with plan-your-visit

`next-custom-form` already imports `shared/google-places`, and on `localhost:5173` the
MP-supplied key logs `ApiTargetBlockedMapError` — autocomplete silently does nothing while
manual entry keeps working. **If MP's key is HTTP-referrer-restricted to the church's own MP
domain, the same degradation hits every embedded customer origin.** That question gates C23 in
`plan-your-visit.md` and affects `my-household` too. It is one question with three consumers —
answer it once, and answer it before promising address autocomplete to anyone.

## Do better than parity

- **"Complete Form As" is the wrong mental model, and legacy's wording shows it.**
  `Blank Form` first in the list means the *default* for a signed-in parent is the anonymous
  path. Put the signed-in user first (as `next-group-details` already does) and label the
  escape hatch `Someone else…`. For a child-focused form, "Who is this form for?" is clearer
  than "Complete Form As".
- **A parent filling three forms should not fill three forms.** Once the picker exists, the
  obvious next step is "submit and start another for a different household member", carrying
  the shared fields forward. Neither system does this; it is the actual job.
- **Surface which contact the response was filed against** on the confirmation screen. Silent
  attribution is how C26 went unnoticed in the first place.

## Acceptance

- A signed-in user can complete a form for a household member; `Form_Responses.Contact_ID` is
  set to that member.
- The contact details stored come from the server's read of that contact, not from the client.
- The address block includes Country, defaulting to the United States entry, and persists it.
- Every control reports an accessible name; the phone input is `type="tel"`.
- All nine `Form_Field_Types` still render and store identically (regression guard).

## Depends on / unblocks

C26 depends on `next-opportunity-details`'s picker as its reference implementation and shares
the server-side back-fill shape with C21/C12. C28 and C29 follow `CROSS-3`. The Google Maps
key question is shared with `plan-your-visit.md`.
