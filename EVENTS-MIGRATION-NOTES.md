# Migration Notes: `next-event-finder` + `next-event-details`

> Post-migration handoff for the legacy `mpp-event-finder` and `mpp-event-details`
> portal widgets, ported to this repo's embed SDK on branch `feature/legacy_widgets`.
> Mirrors the pattern in `PLEDGES-MIGRATION-PLAN.md`. **Nothing here has been run
> against a live MP tenant** — it compiles, type-checks, lints, and builds; the MP
> read/write behavior still needs live verification (see §4).

## 1. What shipped

| Commit | Scope |
|---|---|
| `6b3a763` | `feat(embed-sdk): add next-event-finder public widget` |
| `5ba6a9f` | `feat(embed-sdk): add next-event-details registration widget` |
| `8118c08` | `refactor(demo): unify the two widget registries on one source of truth` |
| `e1fa852` | `fix(demo): restore access-level card badge` |

### `next-event-finder` (Public)
- `src/services/eventFinderService.ts` — `getConfigurations` (Congregations/Ministries
  lookups) + `searchEvents` via the legacy two-step procs `api_MPPW_SearchEvents` →
  `api_MPPW_GetEvents` (keyword, congregation, ministry, month, sign-up type, event
  type, featured, program, series-reduction filters).
- Routes: `GET /api/embed/event-finder` and `/event-finder/config`.
- `packages/embed-sdk/src/components/event-finder.ts` — keyword + advanced-search
  filters, result cards (featured badge / date range / location), deep-link to a
  `target-url` details page. Events: `eventsLoaded`, `eventSelected`, `eventFinderError`.

### `next-event-details` (Public, full registration)
- Services:
  - `src/services/eventDetailsService.ts` — `getEventById` (proc + rooms/address/
    contacts/options-full enrichment), `getEventParticipantsByInvoice` (Notes parsing,
    form responses, selected options), `hasRegistered`, `checkPendingEventAvailability`,
    `checkAvailability`, `getBasicContact`, `getBaseInvoiceDetailId`, `getUserByGuid`.
  - `src/services/productsService.ts` — `getProduct` (`api_MPPW_GetProduct`, 3 result
    sets; drops promo/empty groups; days-out hiding) + `validPromoCode`.
  - `src/services/registrationService.ts` — `saveRegistration` orchestration and
    `deleteEventRegistration`.
  - `src/services/customFormService.ts` — `Form_Fields` definitions for rendering.
- Routes under `/api/embed/event-details/*` (detail `[id]`, `participants/[invoiceGuid]`,
  `has-registered`, `pending-availability`, `availability`, `basic-contact`,
  `invoice-detail`, `custom-form`, `register`, `delete-registration`) and
  `/api/embed/event-products/[productId]` (+ `/promo`).
- `packages/embed-sdk/src/components/event-details.ts` — event display (image, date
  range, map, rooms, contacts, ICS, external/volunteer links), visibility gating,
  registration (product options + qty/notes, promo codes, custom forms, participant
  list/remove, live total), checkout redirect. Events: `eventDetailLoaded`,
  `registrationSaved`, `registrationError`, `participantRemoved`, `loginRequired`,
  `emailRequested`, `eventDetailError`.

### Shared types & demo
- `packages/types/src/events.ts` — Zod schemas/types for finder, detail, product,
  promo, existing-invoice/participant, basic-contact, availability, registration.
- `packages/types/src/widgets.ts` — framework-neutral `widgetRegistry` (single source
  of truth for the `/demo` catalog **and** the embed-sdk Vite landing) +
  `widgetAccessLevel()`.

## 2. Backend approach

Both widgets call the **`api_MPPW_*` stored procedures** the MP tenant already exposes
(the same family the pledges widget uses), via `MPHelper.executeProcedure`. Reads use
procs; the registration write path uses direct `Invoices`/`Invoice_Detail`/
`Event_Participants`/`Form_Responses` table writes through `MPHelper`. Contact + address
are serialized into the `Invoices.Notes` / `Event_Participants.Notes` `Label: value`
block (legacy format) and parsed back on reload.

## 3. Scope decision: payment is OUT

`mpp-event-details` never collected payment itself — it builds the invoice and
**redirects** to a separate checkout widget via `checkout-url`. The payment-token /
gateway / `/payment/notify` webhook flow depends on external payment-vendor
infrastructure (shared JWT signing key, vendor endpoint) **not present in this repo**.
So registration here ends at "invoice created → redirect to checkout-url". A
`next-invoice-checkout` widget is a separate future migration.

## 4. Needs live-tenant verification

These were implemented from the authoritative legacy .NET source but could not be
executed here:

1. **`Form_Responses` table name** — standardized on the plural `Form_Responses` keyed
   by `Event_Participant_ID` for both the read (eventDetailsService) and the write
   (registrationService). Confirm the table/column names on the tenant.
2. **`isHidden` days-out logic** for product options (`Days_Out_To_Hide`) — best-effort
   day-boundary math; spot-check against legacy behavior.
3. **`Addresses."State/Region"`** column used unquoted in `$select` — confirm MP accepts it.
4. **Proc result-set column names** — all mappings follow the legacy managers; verify
   `api_MPPW_GetEventById` / `GetEvents` / `GetProduct` / `GetInvoice` / `SearchEvents`
   return the expected columns on this tenant.
5. **The full registration write path** (contact/participant resolve-or-create →
   Event_Participants → Invoices → Invoice_Detail → Form_Responses) — run end-to-end on
   the tenant; check status IDs (Registered=2, AwaitingPayment=21, Invoice NonePaid=1 /
   PaidInFull=3 / Cancelled=7) and the Notes round-trip.

## 5. Config

- **`MPPW_DEFAULT_PARTICIPANT_TYPE_ID`** (new, optional; default `1`) — used when
  creating a `Participants` record during anonymous/new-contact registration. Set to the
  tenant's web-registration participant type (legacy config `defaultParticipantType`).

## 6. Widget simplifications (in-code TODOs)

- **"Register As" list** shows only the signed-in contact + "Blank Form" — there is no
  household-members endpoint yet, so the legacy family-member picker (and minor/parent
  auto-fill from household positions) is not wired.
- **Custom-form FileUpload (type 9)** renders an input but is not submitted in v1.
- **"Email a Friend"** emits `emailRequested` + shows a "not available" note (no send
  endpoint).
- **Participant in-place edit** simplified to remove-and-re-register (the most arcane
  legacy branch); Save&* button variants folded into the Register actions.

## 7. Suggested follow-ups

1. Add a household-members endpoint and wire the full "Register As" family picker +
   minor/parent auto-fill.
2. Wire `next-event-finder` detail links (and the user-menu, if desired) to
   `next-event-details`.
3. Build the `next-invoice-checkout` widget to complete the registration → payment loop.
4. Pre-submit availability gate (the `availability` endpoint exists but the widget
   currently relies on the server's `register` 409 path).
