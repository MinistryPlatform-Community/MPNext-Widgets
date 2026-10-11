# W4 — Serving, Plan Your Visit, custom forms (wave 1)

**Branch:** `ws/w4-serving-forms`
**Items:** C20 · C21 · C22 · C23 · C24 · C25 · C26 · C27 · C28 · C29 · C63 · C65 · C82
**Also does:** C39 for `opportunity-details`, `custom-form` and `plan-your-visit`
**Design sources:** `Plans/opportunity-finder.md`, `Plans/opportunity-details.md`, `Plans/plan-your-visit.md`, `Plans/custom-form.md`

**Owns:**
- Components: `opportunity-finder.ts`, `opportunity-details.ts`, `plan-your-visit.ts`, `custom-form.ts`
- Services: `opportunityFinderService.ts`, `opportunityDetailsService.ts`, `planYourVisitService.ts`, `customFormService.ts`
- Routes: `api/embed/{opportunity-finder,opportunity-details,plan-your-visit,custom-form}/**`
- Matching types
- Locale namespaces: `opportunityFinder` / `opportunityDetails` in `locales/*/groups.ts`, and the PYV / custom-form namespaces wherever they live
- Matching demo pages

**Not owned:** `shared/custom-form.ts`. It is in `shared/`, so it is W0's. W0 does not convert it,
though, so **W4 may edit `shared/custom-form.ts` for C28 only**. This is the one recorded
exception to the shared-is-read-only rule; nobody else touches that file in wave 1.

**Status at 2026-10-11:** C26 is partly fixed. The submit route stamps the signed-in contact,
but nobody can fill the form for someone else. Everything else is open.

## Order

1. **C24 — breaking, do first.** Delete `phonePattern()` (`plan-your-visit.ts:637-640`) and its
   uses (`:528`, `:551`). Use W0 `field({ type: "tel" })` with a digit-count validator. Stop
   reading `PhoneMask` in the service (`:97`), or keep it for display formatting only. Add a
   unit test proving a real number submits.
2. **C82** — `syncChildren()` (`:342-347`) copies back only DOB. Keep the full `ChildState`
   for every field, and stop the full re-render on add/delete (`:362-365`), or snapshot every
   input before it. Add a test: type → add child → values survive.
3. **C21** — back-fill contact columns on the response row server-side
   (`opportunityDetailsService.ts:280-283`, after `resolveContactId` `:272`). Same rule as
   W3's C12.
4. **C20** — `opportunityFinderService.ts:142-175` filters on a nonexistent
   `Attributes.Available_Online`. Check the schema: the C52 work established that the flag is
   `Attribute_Types.Available_Online`. Rewrite the filter accordingly, and replace the bare
   `catch { return []; }` with a logged error. W8 adds the "catch that returns empty must
   log" guard.
5. **C28 / C29 — `field()` everywhere.**
   - `plan-your-visit.ts` (`:474-625`), `custom-form.ts` (`:385-404`),
     `shared/custom-form.ts` (`:105-141`), `opportunity-details.ts` (`:651-656`).
   - Phones become `type="tel"` (`opportunity-details.ts:656`, `custom-form.ts:390`).
   - Do not guess phone-ness from MP form-field labels.
6. **C22 — cards.** `opportunity-finder.ts:413` → W0 `cardLink()`.
7. **C25** — a one-time opportunity shows "Fridays".
   - `formatMeetingDay` (`:438-443`): a dated one-time opportunity renders its date via
     `this.fmt.date`.
   - Restore the time at midnight-boundary values (`:455`).
   - Remove or wire the unreachable Featured badge (`:394`).
   - Fix the `everyDay: "{day}s"` pluraliser key in all three locales: a string-append plural
     is wrong in es/pt-BR anyway.
8. **C65** — add a `show-full-address` attribute. Withhold the address **server-side** when it
   is false, modelled on `group-details`'s `@ShowFullAddress` (`groupsService.ts:208`).
   Read-only reference only; do not edit `groupsService`.
9. **C63** — add a `user-notification-email-template` attribute on `plan-your-visit.ts`
   (`:69-80`) and send it in the payload (`:295-296`). The schema and server already support
   it, so this is widget-only.
10. **C23 — address autocomplete.**
    - First, investigate: does the MP Maps key `planYourVisitService.getConfigurations` could
      expose work off the church's own domain (HTTP-referrer restriction)?
    - If yes: return `googleMapsApiKey` in config and use `shared/google-places`.
    - If no: add a `google-maps-api-key` attribute so the church supplies its own key, and
      document it.
    - Either way, manual entry must keep working when Places fails.
11. **C26 — "Complete Form As" picker.** Add the household picker per `custom-form.md`.
    `custom-form/submit/route.ts` resolves the selected contact **server-side** against the
    caller's household, never trusting a client contact id.
12. **C27 — Country.** `Form_Responses` has **no country column**. Check whether the address
    block writes back to `Addresses` anywhere.
    - If it does: add Country there, with values from MP `Countries`.
    - If not: record it as won't port, with the reason, in the C27 resolution.
13. **C39** — `opportunity-details` (`opportunity-id && this.opportunity`), `custom-form`
    (`&& !this.loading`), and `plan-your-visit` (no callback at all) move to W0
    `reconfigure()`.
14. **Bonus, same class as C11:** `response-email-template` on `opportunity-details` goes into
    a hidden input nobody reads (`:598-601`). Wire it through `MessageTemplateService`, or
    record it in C65's file as a known gap. Prefer wiring it, because it is cheap now.

## Protect

- Opportunity attribute and result-set parity.
- All nine `Form_Field_Types` render identically and store identical answers.
- No native `reportValidity` anywhere.
- The C83 `Contact_Status_ID` fix stays in place, and the `mp-column-names` guard stays green.

## Stale-plan corrections

- C63's "check `packages/types` first" is answered: the field is already declared.
- C27's "persist in the submit route" is impossible (no column).
- C26 "wrote Contact_ID null" was measured with a public token.
- C25 should use `this.fmt` (CROSS-5 has landed).
- Use the line numbers above.

## Acceptance

- Plan Your Visit completes end-to-end with a real phone number.
- Child fields survive add/remove.
- Every control on the three forms has an accessible name.
- The opportunity Attributes filter renders.
- Response rows carry contact fields.
- Each design source plan's acceptance criteria are met.
- Epic gates pass.
