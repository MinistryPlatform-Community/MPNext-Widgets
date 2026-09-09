# `next-opportunity-details` — plan

**Items:** C21 (functional) · C65 (functional — a privacy default flipped open) ·
C29 (ux, shared) · C28 (ux, shared)
**Cutover verdict: C21 and C65 should land before cutover.**
**Owns:** `packages/embed-sdk/src/components/opportunity-details.ts`,
`src/services/opportunityDetailsService.ts`, `src/app/api/embed/opportunity-details/*`

## What the feedback says

- **C21** — responding as a household member writes a `Responses` row with
  `First_Name`, `Last_Name`, `Email`, `Phone` **all NULL**. `Participant_ID` is correct on both
  sides; only the denormalised contact columns differ. Legacy backfills them from the selected
  contact's record even though the visible inputs were left blank. The cause is two
  correct-looking decisions interacting: the widget *hides* those inputs once a "Respond As"
  contact is chosen (legacy keeps them visible), so the payload carries empty strings, and
  `respond()` writes `args.firstName || null` verbatim without falling back to the resolved
  contact.
- **C65** — legacy's `showfulladdress` is a **privacy switch, off by default**, withholding the
  street address of a serving location. Ours has no such attribute and **renders the address
  unconditionally** (`:513-514`), on a page reachable by an anonymous visitor from the finder.
  Migration flips a privacy default from closed to open, silently.
- **C29** — `MobilePhoneNumber` is `type="text"` where legacy is `type="tel"`.
- **C28** — 4 of 5 controls have no accessible name. **This one is at parity** (legacy: 6 of 7
  unnamed), so it is not a regression — but it is the same `field()` helper, so fix it in the
  same pass.

## Where the new widget is already better — protect these

- The response write itself works and returns a clean `200 {"success":true,"responseId":46}`;
  legacy returns a bare `"47"`.
- `Participant_ID` resolution is correct.
- The **"Respond As" picker is the reference implementation** the rest of the SDK should copy
  — `custom-form.md` (C26) explicitly points at `renderRespondAs` (`:583+`) and the
  `GET /api/embed/household` load (`:224-230`) as the pattern for its missing household
  picker. Do not restructure it without noticing that dependency.

## Phase 1 — C21, back-fill on the server

`Responses.First_Name/Last_Name/Email/Phone` is what MP's Opportunity Response views, the
"Opportunity Response Notification" template, and any church-authored report merge from. The
columns exist precisely so a response is self-describing without a Participant join. A
volunteer coordinator working the follow-up list sees a blank name and no way to contact the
responder — and it is silent: the response *is* created and the thank-you renders.

Fix in `opportunityDetailsService.ts:275-285`, after `resolveContactId()` succeeds:

```ts
const c = args.contactId ? await this.getContactBasics(contactId) : null;
First_Name: args.firstName || c?.First_Name || null,
…
```

`householdService` and `eventDetailsService` already do this kind of read — copy the pattern.

**Server-side back-fill, not client-side pre-fill.** The alternative — keeping the fields
visible and pre-filled the way legacy does — leaves the client authoritative for a contact the
user merely *selected* from a list, which is the same argument as C12 in `group-details.md`:
a caller could then write someone else's contact details of their choosing. The server
back-fill also covers the case where `contactId` is supplied by a caller rather than picked.

**This is the same defect as C12 in two different services.** Fix them with the same shape and
in the same week, or the second one will be re-derived from scratch.

## Phase 2 — C65, restore the privacy switch

Serving opportunities are frequently hosted at a volunteer's home, a partner ministry's office,
or a shelter with a deliberately unpublished address. Legacy hides the address unless a staff
member opts in per embed; we always show it, to anyone.

**The sibling already implements this.** `next-group-details` has `"show-full-address"` at
`:100`, forwarded as `params.set("showFullAddress", "true")` at `:166`. Copy it exactly — the
omission here looks like an oversight, not a decision.

**One important refinement over a straight copy: withhold the address in the *service*, not in
the client.** A Shadow DOM widget that fetches the full address and declines to paint it still
ships it to the browser, where it is one network-tab click away. Check what
`mpp-opportunity-details` does — if legacy filters server-side, match it; **if legacy only
hides client-side, this is a chance to do better than parity**, and we should take it. Worth
checking `next-group-details` at the same time, since it may have inherited the weaker shape.

Note for whoever re-measures: `showfulladdress` and `responseemailtemplate` are **not** in
`WidgetConfigurator.js`'s `configurationItems` for this widget — the vendor metadata is
incomplete here. `observedAttributes` plus the `getAttribute` call sites are the real surface.

## Phase 3 — the shared a11y items

Both handled by `CROSS-3`:

- **C29** — `type="tel"` plus `autocomplete="tel"` on `MobilePhoneNumber` (`~:556-570`). A
  volunteer sign-up is one of the two forms most likely to be filled on a phone, and
  `type="tel"` is what produces a keypad instead of a QWERTY keyboard.
- **C28** — the `field()` helper from `form-validation.ts` (`~:554-575`). Lower priority than
  plan-your-visit and custom-form because this pair is at parity, but it is the same edit.

Neither system validates phone format (both accept the literal `abc`) and neither shows a
native `reportValidity` popup — that part is parity and needs no work.

## Do better than parity

- **The address question is bigger than an attribute.** "Show the full address" is really
  "who is allowed to know where this is". A single boolean set by whoever pasted the tag is a
  weak control. Consider deriving it from the opportunity's own data — MP has visibility
  concepts — or at minimum defaulting to **hidden** and showing a coarse form (neighbourhood,
  campus) with "full address provided after you respond". That is better than either system
  and it matches how a volunteer coordinator actually works.
- **A response is a handoff.** C21 fixes the row; the next question is whether anyone is told.
  `response-email-template` exists as an attribute here — verify it is actually honoured, since
  `group-details` (C11) declared three such attributes and read none of them. If it is not,
  it is the same fix and the same shared `sendTemplateMessage` primitive.
- **`RibbonText`** (`"1 hour"` in the fixture) is returned by the proc and rendered by neither
  system. Commitment size is the single most decision-relevant fact for a volunteer.

## Acceptance

- A response from a signed-in household member writes name, email and phone into `Responses`.
- `show-full-address` is honoured, defaults to hidden, and the address is **absent from the API
  payload** when hidden.
- The phone input is `type="tel"` with `autocomplete="tel"`.
- Every control reports an accessible name.
- `Participant_ID` resolution is unchanged (regression guard).

## Depends on / unblocks

C21 shares its shape with C12 (`group-details.md`). C28 and C29 follow `CROSS-3`. C65 should
be settled together with `next-group-details`'s implementation of the same attribute.
**`custom-form.md` depends on this widget's "Respond As" picker as its reference
implementation.**
