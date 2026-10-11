# C27. `next-custom-form`'s address block has no Country field; legacy's is a required select defaulting to United States of America

**Widget:** `next-custom-form` (old: `mpp-custom-form`, placed per CONFIG-MAP §5)
**Severity:** functional
**Confidence:** confirmed — same MP forms, same signed-in user, both field inventories dumped from the shadow roots
**Found:** 2026-09-08, comparison run

## Old behaviour

When a form has `Get_Address_Info = 1`, `mpp-custom-form` renders five address
controls, Country first and required:

```
Country*        <select name="Country">  → United States of America (default), Afghanistan, Albania, … (full list)
Address Line 1* <input name="AddressLine1">
Address Line 2  <input name="AddressLine2">
City*           <input name="City">
State/Region*   <input name="StateRegion">
Postal Code*    <input name="PostalCode">
```

## New behaviour

Four controls, no Country:

```
Address Line 1* / Address Line 2 / City* / State / Region* / Postal Code*
```

Measured on Form 6 ("Volunteer - Lead", `Get_Address_Info = 1`), signed in: legacy
rendered four `<select>` elements (Complete Form As, Country, and the form's own two
dropdowns), new rendered two (the form's dropdowns only). Confirmed again on Form 10
("Family Registration Form Template"): legacy three selects, new one.

`next-plan-your-visit` **does** collect country (`addressCountry`, from `Countries`
via its own config route), so the lookup already exists in this repo —
`next-custom-form` is the outlier.

## Why it matters

Custom forms with `Get_Address_Info` populate `Form_Responses.Address_*` and feed MP's
address records. A missing country means every address a custom form captures is
country-less, which breaks address standardisation and mail merges for any church with
international members, and silently downgrades data that the same form collected
correctly on the legacy widget the day before. Churches notice this only when a
mailing goes out wrong.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/custom-form-old-form6-authed-complete-as.png`
  (Country select above Address Line 1) vs
  `.claude/playwright/widget/screenshots/custom-form-new-form6-authed-no-complete-as.png`
- Signed-in inventory, legacy: `Country (select-one, required)` with options
  `["United States of America","Afghanistan","Albania","Algeria","American Samoa", …]`;
  new: no such element.
- Select counts: form 6 old 4 / new 2; form 10 old 3 / new 1; form 9
  (`Get_Address_Info = 0`) old 3 / new 2 — the residual difference on form 9 is the
  "Complete Form As" picker (C26), which confirms Country accounts for exactly one of
  the two missing selects on the address-collecting forms.
- Precedent in this repo: `plan-your-visit.ts:602-616` renders `addressCountry` from
  `config.countries`, fed by `planYourVisitService.getConfigurations()`.

## Where to fix

- `packages/embed-sdk/src/components/custom-form.ts` — the address block render and
  the submit payload.
- `src/services/customFormService.ts:110-137` — add the `Countries` read;
  `src/services/planYourVisitService.ts:106-111` has the exact query
  (`Country_Code AS Code, Country AS Name`, ordered by `Country`, top 300).
- `src/app/api/embed/custom-form/submit/route.ts` — persist the country.

## Suggested fix

Add `countries` to the custom-form header payload and render a Country select above
Address Line 1, defaulting to the United States entry the way `plan-your-visit.ts`
does. Make it required only when the rest of the address block is, matching legacy.
One caution found while verifying: MP's own `Countries.Country` value for `CW` is
stored double-UTF-8-encoded (verified against the raw bytes via the client-credentials
API — it is MP's stored data, not a client bug), so both widgets show the same mangled
name. Do not try to fix that in the client.

## Resolution — 2026-10-11

**Won't port** (W4, branch `ws/w4-serving-forms`). It is decided under the epic's C27 rule:
"add Country only if MP's custom-form address block writes back to `Addresses`;
otherwise record it as won't port."

- **No column to store it in.** `Form_Responses` was checked live (MinistryPlatform MCP
  `mp_lookup`, 2026-10-11) and against `FormResponsesSchema.ts`. It has `Address_Line_1`,
  `Address_Line_2`, `Address_City`, `Address_State` and `Address_Zip`, and **no country
  column**. A Country select here would collect a value the submit route can only throw
  away. That is worse than not asking, because it implies the church has it. This item's
  "persist it in the submit route" was impossible as written (the epic's stale-plan
  corrections say so).
- **No write-back to `Addresses`.** `custom-form/submit/route.ts` creates only
  `Form_Responses` and `Form_Response_Answers`. It never touches `Contacts`, `Households`
  or `Addresses`, and C26 decided **not** to port legacy's `SaveAddressInfo` /
  `updateMyInfo` write-back. So no country path exists. Legacy's Country select fed that
  write-back, which this stack deliberately does not have.
- **If write-back is ever added** (as an explicit, opt-in checkbox, per C26), Country
  should return with it, taking its values from MP `Countries` the way
  `planYourVisitService.getConfigurations()` reads them. Until then, the address data a
  custom form captures is the five columns above, exactly as on `Form_Responses` today.
- For W9's migration notes: *custom forms no longer ask for Country; MP's
  `Form_Responses` has no country column, and the form does not update the contact's
  address record.*
