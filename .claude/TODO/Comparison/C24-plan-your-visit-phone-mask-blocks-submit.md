# C24. `next-plan-your-visit` cannot be submitted at all: MP's display phone mask is used as an HTML `pattern`, so the required Mobile Phone field rejects every real number

**Widget:** `next-plan-your-visit` (old: Plan Your Visit — `/widgets/plan_your_visit.aspx`)
**Severity:** breaking
**Confidence:** confirmed — `checkValidity()` measured against five phone formats in the live widget; the flow completed only after the attribute was removed from the DOM
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-plan-your-visit` builds its phone field with `BuildPhoneInput(…)` — an
`<input type="tel">` with the mask applied as an **input mask / formatter**, not as a
validation regex. MP's own config carries two separate keys for the two jobs:

```
PhoneMask           = "xxx-xxx-xxxx"     ← display mask
PhoneValidationMask = "999-000-0000"     ← validation mask (MP's 9=required digit, 0=optional)
```

## New behaviour

`plan-your-visit.ts` reads **`PhoneMask`** and injects it straight into the markup:

```ts
private phonePattern(): string {
  const mask = this.config.phoneMask;
  return mask ? `pattern="${this.escapeAttr(mask)}"` : "";
}
```

The rendered field is therefore
`<input type="tel" name="headMobilePhone" pattern="xxx-xxx-xxxx" required>`, and
`pattern` is an anchored **regular expression**. `xxx-xxx-xxxx` matches exactly one
string: the literal text `xxx-xxx-xxxx`. Measured in the live widget:

| typed value | `input.checkValidity()` |
|---|---|
| `321-555-0100` | **false** |
| `3215550100` | **false** |
| `(321) 555-0100` | **false** |
| `+13215550100` | **false** |
| `xxx-xxx-xxxx` | true |

The field is `required`, so `validateForm()` fails, the shared validator paints
*"Please match the requested format."* under Mobile Phone, and **`POST
/api/embed/plan-your-visit/register` is never sent**. No visitor can complete Plan
Your Visit. The same `pattern` is also applied to the optional spouse phone
(`spousePhone`), so filling it in blocks submission too.

Removing the two `pattern` attributes from the DOM and re-submitting the identical
form produced `200 {"success":true}` and a complete, correct set of MP records
(Household + Address + head + spouse + child + 3 Participants + 2
Participant_Milestones + the church notification email). So *only* the pattern is
broken; everything behind it works.

## Why it matters

This is the whole widget, on the church's highest-intent page, for every tenant whose
MP has `PhoneMask` set — and `xxx-xxx-xxxx` is MP's stock value, so that is the default
rather than an edge case. The failure is quiet and self-blaming: the visitor sees
"Please match the requested format" against a phone number that is obviously correct,
with no hint of what format is wanted, and gives up. Nothing is logged server-side
because no request is made.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/plan-your-visit-new-phone-mask-blocks-submit.png`
- Screenshot of the blocked submit: `.claude/playwright/widget/screenshots/plan-your-visit-new-step2-validation.png`
- Screenshot after removing `pattern` (successful submit): `.claude/playwright/widget/screenshots/plan-your-visit-new-step2-submitted.png`
- Rendered attribute, read from the shadow root: `pattern="xxx-xxx-xxxx"`
- MP verification of the two config keys:
  `getTableRecords({ table: "dp_Configuration_Settings", select: "Key_Name, Value", filter: "Key_Name LIKE '%Phone%' OR Key_Name LIKE '%Mask%'" })`
  → `[{"Key_Name":"PhoneValidationMask","Value":"999-000-0000"},{"Key_Name":"PhoneMask","Value":"xxx-xxx-xxxx"}]`
- Post-fix write verified in MP (records since removed / renamed `ZZTEST-DELETE-ME`):
  Household 450, Address 499, Contacts 943 (head) / 944 (spouse) / 945 (child, DOB + Gender),
  Participants 827-829, Participant_Milestones 12-13 (Milestone 2), `dp_Communications` 4141

## Where to fix

- `packages/embed-sdk/src/components/plan-your-visit.ts:611-615` (`phonePattern`) —
  the two call sites are `:511` (`headMobilePhone`) and `:533` (`spousePhone`).
- `src/services/planYourVisitService.ts:112` — the `getConfigValue("PhoneMask")` read.

## Suggested fix

Stop using an MP mask as a regex. Cheapest correct change: delete `phonePattern()`
and rely on `type="tel"` plus `required` (which is what legacy effectively enforces).
If a format check is genuinely wanted, translate MP's validation mask rather than the
display mask — read `PhoneValidationMask`, then map `9`→`[0-9]`, `0`→`[0-9]?` and
escape everything else — and keep the mask itself for a `placeholder`, which is what
`xxx-xxx-xxxx` was authored to be. Whichever route, add a unit test that asserts a
plain `321-555-0100` validates, because this failure is invisible until someone
actually types a phone number.

---

**Companion defect:** `C82-plan-your-visit-syncchildren-discards-child-fields.md` — filed at
consolidation from this item's "Where to fix" note. Once this item unblocks submission, C82
is the next thing a visitor hits. Fix both together.
