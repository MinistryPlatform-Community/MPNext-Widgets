# `next-plan-your-visit` — plan

**Items:** C24 (breaking) · C82 (functional) · C23 (functional) · C63 (functional) ·
C28 (ux, shared) · C29 (ux — already correct here)
**Cutover verdict: blocks pilot cutover. The widget cannot be submitted at all.**
**Owns:** `packages/embed-sdk/src/components/plan-your-visit.ts`,
`src/services/planYourVisitService.ts`, `src/app/api/embed/plan-your-visit/*`

## What the feedback says

This is a first-time visitor's very first interaction with the church, on a phone, and it is
**completely broken**: MP's *display* phone mask `xxx-xxx-xxxx` is injected as an HTML
`pattern`, which is an anchored regex matching exactly one string — the literal text
`xxx-xxx-xxxx`. The field is `required`, so no real phone number validates, the shared
validator paints *"Please match the requested format"*, and
`POST /api/embed/plan-your-visit/register` **is never sent**. Nothing is logged server-side
because no request is made. `xxx-xxx-xxxx` is MP's stock `PhoneMask` value, so this is the
default case, not an edge case.

Remove the two `pattern` attributes and the identical form submits `200` with a complete and
correct set of MP records — Household, Address, head, spouse, child, three Participants, two
Participant_Milestones and the church notification email. **Only the pattern is broken;
everything behind it works.** That is the good news in this plan.

The moment C24 unblocks submission, the visitor hits C82: adding a second child wipes every
field of every existing child except the date of birth.

## Where the new widget is already better — protect these

- Phone inputs are correctly `type="tel"` here (`headMobilePhone`, `spousePhone`) — the two
  widgets that get this wrong are opportunity-details and custom-form (C29). Do not
  "normalise" these to match them.
- The whole server-side write path is correct and verified end to end.
- It already collects Country, which `next-custom-form` does not (C27).

## Phase 1 — unbreak submission

### C24 — stop using a display mask as a regex

**Cheapest correct change: delete `phonePattern()`** (`plan-your-visit.ts:611-615`) and rely
on `type="tel"` plus `required`, which is effectively what legacy enforces — legacy applies
the mask as an *input formatter*, not a validation regex.

**Better than both, if a format check is genuinely wanted:** MP carries two separate keys for
the two jobs, and we are reading the wrong one.

```
PhoneMask           = "xxx-xxx-xxxx"     ← display mask   (what we use as a pattern)
PhoneValidationMask = "999-000-0000"     ← validation mask (what we should use)
```

Read `PhoneValidationMask`, translate MP's notation (`9` → required digit `[0-9]`, `0` →
optional digit `[0-9]?`, escape everything else), and keep `PhoneMask` for the
**`placeholder`** — which is what `xxx-xxx-xxxx` was authored to be. That is strictly better
than legacy, which masks but never validates.

Also fix `planYourVisitService.ts:112`, which reads `PhoneMask` and hands it over as if it
were a validation rule.

**Add a unit test asserting a plain `321-555-0100` validates.** This failure is invisible
until someone actually types a phone number, which is exactly why it shipped.

### C82 — `syncChildren()` discards everything but the date of birth

```ts
private syncChildren() {
  for (const c of this.childRows) {
    const dob = this.root.querySelector(`[name="child-${c.key}-dob"]`);
    if (dob) c.dob = dob.value;
  }
}
```

`addChild()` calls this and then re-renders from `this.childRows`, so name, gender and age
group — never copied back — are gone. Multiple children is the *normal* case for this widget,
and the loss fires precisely when a parent does the expected thing.

Immediate fix: widen the row type and copy back every field. The `name="child-<key>-*"`
convention already makes them addressable.

**The underlying shape is the real lesson, and worth fixing properly while in here:**
re-rendering from an in-memory array that only partially mirrors the DOM will keep producing
this bug as fields are added. Read the row back by **iterating the rendered inputs for that
child** rather than by naming each field to preserve. Then the next field added to the form
cannot regress it.

Fix C24 and C82 together — C82 is what the visitor hits next.

## Phase 2 — what a migrating church loses

### C23 — no address autocomplete

Legacy fetches `GoogleMapsAPIKey` from MP config and wires
`new google.maps.places.Autocomplete(…)` to the address input. Ours emits four bare inputs.
Hand-typing a street address on mobile is the highest-abandonment field in this flow, and
**this flow creates the Household and Address records** rather than just reading them, so the
addresses that do arrive are dirtier than the ones legacy captured.

This is unusually cheap to close: `packages/embed-sdk/src/shared/google-places.ts` already
exists and is used by `next-my-household` and `next-custom-form`, and the server key channel
already exists in two of three services — `customFormService.ts:110-137` and
`householdService.ts:398-423` both return `googleMapsApiKey`.
`planYourVisitService.getConfigurations()` is the only one that does not.

**Blocking unknown, settle it before sizing the work:** on `http://localhost:5173` the
MP-supplied key logs `ApiTargetBlockedMapError` inside `next-custom-form`, and autocomplete
silently does nothing while manual entry keeps working. If MP's key is HTTP-referrer-restricted
to the church's own MP domain, **the same degradation hits every embedded customer origin** —
which is a much larger question than wiring the helper in, and affects `my-household` and
`custom-form` too. Answer that first; the helper is a two-hour job once it is answered.

The helper already fails closed (`loadGoogleMaps` resolves `false` on any error), so manual
entry stays intact when the key is missing or blocked. No new failure mode.

### C63 — the visitor's confirmation email cannot be configured

Legacy exposes three distinct templates: `verificationEmailTemplateId` (the confirm link),
`userNotificationEmailTemplateId` (the visitor's confirmation) and
`churchNotificationEmailTemplateId` (the staff heads-up). We ship the first and third and
dropped the middle one — **which is the wrong way round**: the visitor-facing email is the
one a church actually wants to tailor per page (a Christmas Eve page, a campus launch, a
Spanish-language page).

Narrow fix, because the server already implements it —
`planYourVisitService.ts:495-498` reads `model.userNotificationEmailTemplate` and falls back
to the congregation's `Plan_A_Visit_Template`. The widget simply never populates it.

Add `user-notification-email-template-id` to `observedAttributes` and to the register payload
as `userNotificationEmailTemplate`. **Check `packages/types` first** — Zod strips an undeclared
key before it reaches the service, so if `PyvRegisterRequest` does not declare the field the
three-line widget change silently does nothing. Keep the `??` fallback chain; explicit
attribute wins, congregation default otherwise.

### C28 — 13 of 14 fields have no accessible name

Handled by `CROSS-3-accessibility.md` §2 — a `field()` helper in `form-validation.ts` fixes
this widget, `custom-form` and `opportunity-details` in one change. Worth stressing the stake
here specifically: a screen reader announces "edit text" nine times in a row on the form that
creates a visitor's household records.

## Do better than parity

- **Legacy's step 2 is unreachable for testing** (its verify link is a JWT signed with MP's
  secret), so step-2 parity in the comparison run is derived from the vendor bundle's call
  sites, not observed. We are not constrained by legacy's step-2 design — we can make it
  better without a parity argument.
- **The child rows are the flow's real friction.** Once C82 is fixed, consider not
  re-rendering the whole form on add/remove at all: append a row node and leave existing ones
  untouched. That eliminates the class of bug rather than the instance.
- **Placeholder from `PhoneMask`, validation from `PhoneValidationMask`** uses both MP keys
  for what each was authored for. Legacy uses one and ignores the other.

## Cleanup owed from the comparison run

`Contacts` 943–945 (renamed `ZZTEST-DELETE-ME`), `Participants` 827–829, `Households` 450 and
`Addresses` 499 are left in MP — the REST API refuses these deletes. Needs a Platform user.

## Acceptance

- `321-555-0100`, `3215550100` and `(321) 555-0100` all validate; submission reaches the
  route and writes the full record set.
- Adding a third child preserves the first two children's name, gender and age group.
- A unit test covers the phone case.
- Address autocomplete fills line 1 / city / state / postal, or degrades silently to manual
  entry when the key is blocked.
- `user-notification-email-template-id` overrides the congregation default.
- Every control reports an accessible name.

## Depends on / unblocks

C28 depends on the `CROSS-3` helper. C23 depends on answering the Google Maps key-restriction
question, which also gates `custom-form.md` and `my-household`. Everything else is
independent — **C24 should be one of the first things fixed in this whole backlog**: it is a
one-line deletion that turns a completely dead widget into a working one.
