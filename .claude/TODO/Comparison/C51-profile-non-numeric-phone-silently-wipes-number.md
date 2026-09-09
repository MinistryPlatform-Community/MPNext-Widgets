# C51. `next-profile` silently deletes a stored phone number when non-numeric text is typed into the phone field

**Widget:** `next-profile` (old: contact editing lives in `mpp-household`'s "Edit Contact Info" / "Edit Household Member")
**Severity:** breaking — data loss on a real contact record, with no error shown
**Confidence:** confirmed — reproduced in the browser and verified in MP with client credentials before and after
**Found:** 2026-09-08, comparison run

## Old behaviour

Legacy has no `next-profile` equivalent for phone editing (`mpp-about-me` edits
contact *attributes*, not contact fields — see C52), but `mpp-household`'s
"Edit Contact Info" and "Edit Household Member" dialogs are where a legacy user
changes a phone number. They keep whatever the user typed in the field and
validate on submit; they do not rewrite the input as you type, so a bad value
either fails validation or round-trips visibly. Nothing in the legacy flow
converts "text I typed" into "field cleared".

## New behaviour

Type any non-numeric text into **Mobile Phone** or **Work Phone** and press
**Save Profile**:

1. `formatPhone()` runs on every `input` event and does
   `input.value.replace(/\D/g, "")`. For `ZZTEST-abc` the digit set is empty, so
   the field is rewritten to `""` while the user types.
2. The submit-time validator is
   `Mobile_Phone: (v) => v && !phoneRegex.test(v) ? "Use format: 999-999-9999" : null`.
   `v` is now `""`, which is falsy, so **no error is raised**.
3. `collectProfile()` sends `Mobile_Phone: getValue("Mobile_Phone") || null`, i.e.
   `null`.
4. `PUT /api/embed/profile` returns **200** and MP's `Contacts.Mobile_Phone` is
   set to `NULL`.

The user sees a successful save. The number they had is gone, and the widget
re-renders with an empty phone field, which reads as "I never had one".

Observed on the real test contact (MP `Contacts.Contact_ID = 98`):

| Step | `Contacts.Mobile_Phone` in MP |
|---|---|
| before | `321-794-1376` |
| typed `ZZTEST-abc`, clicked Save Profile → `PUT /api/embed/profile` **200**, zero validation messages in the shadow root | `null` |
| restored via the MP API | `321-794-1376` |

The same `formatPhone` also truncates silently in less dramatic ways: it keeps
only the first 10 digits, so a pasted `+1 (321) 794-1376 x204` becomes
`132-179-4137`. That is a wrong number saved without a warning.

## Why it matters

This is the church's contact data. A member who types a note, an extension, a
country code, or simply mistypes on a phone keyboard loses the phone number the
church uses to reach them, and neither the member nor the staff gets any signal
that it happened — the request succeeds, the toast is a success toast, and the
audit trail shows a deliberate-looking clear. Phone numbers are how a church
reaches people in an emergency, and this deletes them quietly.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/profile-new-bad-phone-accepted.png` — `ZZTEST-abc` submitted, no error, save succeeded
  - `.claude/playwright/widget/screenshots/profile-new-validation-phone.png` — the same input producing **zero** validation messages
  - `.claude/playwright/widget/screenshots/profile-new-validation-required.png` — for contrast, required-field validation works correctly
  - `.claude/playwright/widget/screenshots/profile-new-validation-email.png` — for contrast, `notanemail` correctly yields "Invalid email address"
- Network: `PUT http://localhost:3000/api/embed/profile` → **200**. No 4xx, no error body.
- Shadow-root query for `[class*=error],[role=alert]` after submit returned `[]`.
- MP verification (client credentials):
  `GET /tables/Contacts?$select=Contact_ID,Mobile_Phone&$filter=Contact_ID=98`
  returned `"Mobile_Phone":"321-794-1376"` before, `"Mobile_Phone":null` after,
  and `"321-794-1376"` again after the restore `PUT`.

## Where to fix

- `packages/embed-sdk/src/components/profile.ts:594-604` — `formatPhone()`, the
  `replace(/\D/g, "")` that empties the field
- `packages/embed-sdk/src/components/profile.ts:433-435` — the `input` listener
  that applies it on every keystroke
- `packages/embed-sdk/src/components/profile.ts:608, 620-626` — the validator
  whose `v && …` guard lets the emptied value through
- `packages/embed-sdk/src/components/profile.ts:491-492` — `… || null`, which
  turns the empty string into a delete

## Suggested fix

Two independent changes; the second is the one that prevents data loss even if
the formatter is later changed again.

1. Do not destroy input in `formatPhone`. Format only when the input is
   plausibly a phone (e.g. leave the value alone when it contains letters, and
   run the mask on `blur` rather than on every keystroke) so the user's text
   survives to the validator and gets a real error message.
2. Distinguish "cleared on purpose" from "emptied by the formatter". Keep the
   value the field had at render time; if the submitted value is empty **and**
   the stored value was not, either require an explicit confirmation or treat the
   field as untouched. Sending `null` should be reachable only when the user
   actually clears a field that was already empty-able.

Pin both with tests in a `profile.test.ts` case: typing letters must produce the
`Use format: 999-999-9999` error, and must never result in a payload whose
`Mobile_Phone` is `null` while the loaded profile had one.

Scope check, so nobody widens this further than it goes: `next-profile` is the
**only** widget with this mask. `grep -rn "data-phone\|formatPhone\|replace(/\\D/g"`
over `packages/embed-sdk/src/components` returns hits in `profile.ts` alone —
`my-household.ts`, `plan-your-visit.ts` and the rest have plain phone inputs and
are not affected. The `… || null` idiom in `collectProfile()` is worth a look
across the other editing widgets though: it is the half of this bug that turns
"empty" into "delete", independent of any mask.

## Mechanism confirmed in source (main thread, 2026-09-08)

`packages/embed-sdk/src/components/profile.ts:594-604` — `formatPhone` strips to digits
and assigns the result straight back to the live input:

```js
let digits = input.value.replace(/\D/g, "");
…
} else { input.value = digits; }   // digits === "" for any non-numeric entry
```

So the destruction happens in the **input handler**, before validation or submit ever
runs: the field is already empty by the time anything could object to it, which is why
the `v && …` validator skips it and the save writes `null`. That ordering is the reason
this presents as a silent 200 rather than a validation error, and it is what the fix has
to change — rejecting or preserving the raw text, rather than normalising it in place.
