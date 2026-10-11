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

## Resolution — 2026-10-11

**Fixed** (W4, branch `ws/w4-serving-forms`). Both routes were built: the MP key is used
by default, and a `google-maps-api-key` attribute overrides it.

### Investigation: is MP's key usable off the church's MP domain?

The live answer could not be obtained from this environment:
- the MinistryPlatform MCP connector refuses `dp_Configuration_Settings` ("restricted by
  your organization's administrator");
- a read-only probe through the app's own `ConfigSettingsService` could not reach the
  MP host (the sandbox network blocks outbound connections).

The probe is kept out of the repo. It reads the key and calls Google's Geocoding and
Places (New) endpoints with three `Referer`s (the MP domain, a church site and localhost),
printing only verdicts, never the key.

One piece of evidence exists: the error this item recorded on `localhost:5173` is
`ApiTargetBlockedMapError`. That is Google's **API-restriction** error (the key is not
authorised for the Maps JavaScript API). It is not `RefererNotAllowedMapError`, the
referrer error. So on the reference domain the key is at least API-restricted, and it
fails on *every* origin, not just embedding ones, until the church enables Maps
JavaScript API + Places on it. A referrer restriction on top of that cannot be ruled out.

**Decision (the plan's fallback, since evidence was incomplete):** support both channels.

### What shipped

- `planYourVisitService.getConfigurations()` returns `googleMapsApiKey` (MP
  `COMMON/GoogleMapsAPIKey`, through the same `ConfigSettingsService` that `custom-form`
  and `my-household` use). `PlanYourVisitConfigSchema` declares it.
- `next-plan-your-visit` observes `google-maps-api-key`. The attribute wins over MP's key,
  so a church whose MP key is domain- or API-restricted can supply a browser key
  restricted to its own site.
- After the details form renders (with `collect-address="true"`), the shared
  `loadGoogleMaps` / `attachAddressAutocomplete` are bound to Address Line 1. A chosen
  place fills line 1, city, state, postal code and the Country select (only when MP's
  `Countries` list has that code).
- **Manual entry is untouched on every failure path:** no key, a blocked key or a script
  error. `loadGoogleMaps` resolves `false`, and nothing touches the inputs until a place
  is chosen.
- Documented in `demo-plan-your-visit.html`'s code sample.
- Tests (`plan-your-visit.test.ts`, "address autocomplete (C23)"):
  - no key loads no script;
  - the attribute key is the one loaded;
  - after a script `error`, a hand-typed address still submits.
- **Follow-up for W9 / migration notes:** churches should check that their MP
  `GoogleMapsAPIKey` allows Maps JavaScript API + Places and their embedding origins.
  The same applies to `next-custom-form` and `next-my-household`, which use the same key.
