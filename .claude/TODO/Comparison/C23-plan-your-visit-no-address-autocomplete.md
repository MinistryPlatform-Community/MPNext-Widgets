# C23. `next-plan-your-visit` has no address autocomplete, though legacy has it and this repo already ships the helper and the MP key channel it needs

**Widget:** `next-plan-your-visit` (old: Plan Your Visit — `/widgets/plan_your_visit.aspx`)
**Severity:** functional
**Confidence:** confirmed — the legacy widget's Google Maps fetch was observed in the browser; the new component's source imports nothing
**Found:** 2026-09-08, comparison run

## Old behaviour

On load, `mpp-plan-your-visit` calls
`GET /Api/ConfigurationApi/GetConfigurationSettingValue?keyName=GoogleMapsAPIKey`
(observed: `200`, a key returned) and its bundle contains
`new google.maps.places.Autocomplete(…)` wired to the address input. A visitor types a
few characters and picks their address; Address Line 1 / City / State / Postal Code
are filled from the selected place.

## New behaviour

Plain text entry only. `packages/embed-sdk/src/components/plan-your-visit.ts` imports
nothing from `../shared/google-places`, and its own class doc comment says so:

> `- Address entry is plain fields (no Google Places autocomplete in v1).`

`renderAddress()` emits four bare inputs plus a country `<select>`. The step-2 form
issues no Maps request at all (network log for the whole step-2 render:
`auth/config`, `session`, `plan-your-visit/verify`, `plan-your-visit/config`,
`plan-your-visit/age-groups` — nothing else).

## Why it matters

Plan Your Visit is a first-time visitor's very first interaction with the church, on a
phone, and the address is required (`collect-address="true"` is what the legacy sample
page sets). Hand-typing a street address on mobile is the highest-abandonment field in
the flow, and the addresses that do arrive are dirtier than the ones legacy captured —
which matters because this flow *creates* the Household and Address records rather
than just reading them.

The gap is unusually cheap to close: `packages/embed-sdk/src/shared/google-places.ts`
already exists and is used by `next-my-household` and `next-custom-form`, and the
server-side key channel already exists too — `customFormService.ts:110-137` and
`householdService.ts:398-423` both return `googleMapsApiKey` from MP config to the
widget. `planYourVisitService.getConfigurations()` is the only one of the three that
does not.

## Why it matters (caveat worth attaching to the fix)

On `http://localhost:5173` the MP-supplied key currently logs
`ApiTargetBlockedMapError`
(`https://developers.google.com/maps/documentation/javascript/error-messages#api-target-blocked-map-error`)
inside `next-custom-form`, and autocomplete silently does nothing while manual entry
keeps working. Whoever fixes this should confirm whether MP's key is
HTTP-referrer-restricted to the church's own MP domain — if it is, the same
degradation will hit every embedded customer origin, and that is a separate,
larger question than wiring the helper in.

## Evidence

- Legacy network call: `GET /Api/ConfigurationApi/GetConfigurationSettingValue?keyName=GoogleMapsAPIKey` → 200 (observed on `/widgets/plan_your_visit.aspx?mpp-verify-id=…`)
- Legacy bundle: `google.maps.places.Autocomplete`, `GoogleMapsAPIKey`, `GoogleAutoComplete` all present in `https://mpi.ministryplatform.com/widgets/dist/PlanYourVisit.js`
- `grep -rn "google-places" packages/embed-sdk/src/` → only `custom-form.ts:17` and `my-household.ts:12`
- Screenshot: `.claude/playwright/widget/screenshots/plan-your-visit-new-step2.png` (plain address fields)
- Console error text for the blocked key, seen in `next-custom-form`:
  `https://developers.google.com/maps/documentation/javascript/error-messages#api-target-blocked-map-error`

## Where to fix

- `src/services/planYourVisitService.ts:93-129` (`getConfigurations` — add
  `googleMapsApiKey`, copying `customFormService.ts:110-137`)
- `packages/embed-sdk/src/components/plan-your-visit.ts:20-21` (`Config`),
  `:167-169` (config load) and `:602-604` (`renderAddress`) — import
  `loadGoogleMaps` / the attach helper from `../shared/google-places` and bind it to
  `input[name="addressLine1"]`, exactly as `my-household.ts:989` does.

## Suggested fix

Add `googleMapsApiKey` to the PYV config payload, then call the shared
`initGooglePlaces()` pattern after the details form renders. The helper is already
written to fail closed (`loadGoogleMaps` resolves `false` on any error), so manual
entry stays intact when the key is missing or blocked — no new failure mode.
