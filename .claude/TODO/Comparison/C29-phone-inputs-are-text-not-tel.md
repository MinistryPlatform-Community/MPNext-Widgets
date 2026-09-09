# C29. Phone inputs in `next-opportunity-details` and `next-custom-form` are `type="text"` where legacy uses `type="tel"` — no numeric keypad on mobile

**Widget:** `next-opportunity-details`, `next-custom-form` (old: Opportunity Details, `mpp-custom-form`)
**Severity:** ux
**Confidence:** confirmed — `input.type` read from both shadow roots on the same MP records
**Found:** 2026-09-08, comparison run

## Old behaviour

Every legacy phone field is built by `FormFieldBuilder.BuildPhoneInput(…)`, which
emits `<input type="tel">`. Measured:

- `mpp-opportunity-details` → `MobilePhoneNumber` is `type="tel"`
- `mpp-custom-form` (Form 6, signed in) → `MobilePhoneNumber` is `type="tel"`
  (the shadow root reported `tel: 1`)
- `mpp-mission-trip`, `mpp-plan-your-visit` → also `tel`

## New behaviour

- `next-opportunity-details` → `MobilePhoneNumber` is `type="text"`
- `next-custom-form` → `MobilePhoneNumber` is `type="text"` (shadow root reported
  `tel: 0`)

`next-plan-your-visit` already gets this right (`headMobilePhone` and `spousePhone`
are both `type="tel"`), so the two above are the outliers rather than a house style.

## Why it matters

`type="tel"` is what makes a phone keypad appear instead of a full QWERTY keyboard on
iOS and Android, and these are exactly the two forms a visitor fills in on a phone —
a volunteer sign-up and a church custom form. It also gives the browser the
`autocomplete="tel"` hint it needs to offer the saved number. The consequence is more
typos and more abandonment on mobile, not a hard failure, which is why it is filed at
`ux`.

Nothing else about the phone fields differs: neither system validates phone format
(both accept the literal string `abc` — measured on both sides), and neither shows a
native `reportValidity` popup.

## Evidence

- Field inventories from both shadow roots, on the same records:
  - opportunity 3 detail, anonymous — old: `{"name":"MobilePhoneNumber","type":"tel"}`;
    new: `{"name":"MobilePhoneNumber","type":"text"}`
  - Form 6 custom form, signed in — old shadow-root counts `{"tel":1}`; new `{"tel":0}`
- Screenshots: `.claude/playwright/widget/screenshots/opportunity-details-old-public.png`
  and `.claude/playwright/widget/screenshots/opportunity-details-new-public.png`;
  `.claude/playwright/widget/screenshots/custom-form-old-form6-authed-complete-as.png`
  and `.claude/playwright/widget/screenshots/custom-form-new-form6-authed-no-complete-as.png`
- Mobile renders at 390×844: `.claude/playwright/widget/screenshots/opportunity-details-new-mobile.png`,
  `.claude/playwright/widget/screenshots/custom-form-new-form9-mobile.png`

## Where to fix

- `packages/embed-sdk/src/components/opportunity-details.ts` — the `MobilePhoneNumber`
  input in the "Your Information" block (around `:556-570`).
- `packages/embed-sdk/src/components/custom-form.ts` — the `MobilePhoneNumber` input in
  the contact block.

## Suggested fix

Change `type="text"` to `type="tel"` on both and add `autocomplete="tel"`; add
`inputmode="tel"` if any phone field is ever rendered as something other than an
`<input type="tel">`. While in `custom-form.ts`, the same reasoning applies to MP form
fields whose label reads like a phone number (Form 6 has three: *Reference 1/2/3:
Phone Number*, all `type="text"` on both sides) — but MP's `Form_Field_Types` has no
phone type, so legacy renders those as text too; that half is parity and should not be
guessed at from the label.
