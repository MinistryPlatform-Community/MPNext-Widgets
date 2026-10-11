# `next-contact-attributes` — plan

**Closes:** `C52-about-me-contact-attributes-no-counterpart.md`
**Legacy tag:** `mpp-about-me` (`/widgets/AboutMe`)
**New element:** `next-contact-attributes`
**Tier:** 2, item 5 in `ROADMAP-missing-widgets.md`
**Written:** 2026-09-11, from the legacy server at `S:\MP\mp-Widgets` and the live MP schema

> **Both of C52's open questions are answered — from source, not inference.** C52 could
> not read `Attribute_Categories` with its API user and left two things "to settle with
> MP". The legacy server on disk settles both, and the live schema confirms them:
>
> 1. **Member visibility is `Attribute_Types.Available_Online = 1`.** Not a category flag —
>    and *not `Attribute_Categories` at all*. See "The naming correction" below.
> 2. **Removal end-dates; it does not delete.** And re-selecting a previously removed
>    attribute **reactivates the existing row** (`Start_Date` = now, `End_Date` = null)
>    rather than inserting a second one.
>
> Evidence: `PortalComponents/DataManagers/AttributeManager.cs`, methods
> `GetActiveAttributes`, `GetRelatedActiveContactAttributes`, `UpdateContactAttributes`,
> `UpdateAttributesEndDate`, `ReactivateAttributes`, `CreateAttributes`.

## The naming correction — C52 and the roadmap both say "categories", and MP has no such table

C52 describes the grouping as `Attribute_Categories` and the roadmap repeats it. There is
no `Attribute_Categories` table in MinistryPlatform. The grouping entity is
**`Attribute_Types`**.

The mistake is understandable and worth recording so nobody re-derives it: the legacy
widget names its checkboxes `category_<n>_attribute_<m>` (`mpp-about-me.js`,
`DrawAttributesEditMode`), and C52 read the ids out of the DOM because the API user could
not read the table. But the value interpolated into that `category_` segment is
`category.attributeTypeId` — the widget's own local variable is named `category` while
holding an attribute **type**. So the DOM evidence was right about the ids (2 and 3) and
wrong about the table.

C52's "which `Attribute_Categories` are member-visible" therefore has no answer as asked.
The real question — which attribute **types** are member-visible — is answered by
`Available_Online`.

**Correct C52 and the ROADMAP Tier 2 row in the same commit as this build.**

## MP schema — verified live, 2026-09-11

```
Attribute_Types
  Attribute_Type_ID   int      PK
  Attribute_Type      nvarchar(50)   required
  Description         nvarchar(255)
  Available_Online    bit      required     <- the visibility gate
  Online_Sort_Order   int                   <- legacy ignores this; we will not

Attributes
  Attribute_ID        int      PK
  Attribute_Name      nvarchar(50)   required
  Description         nvarchar(255)
  Attribute_Type_ID   int      FK -> Attribute_Types
  Icon                nvarchar(50)
  -- note: NO Available_Online, NO End_Date

Contact_Attributes
  Contact_Attribute_ID int     PK
  Contact_ID           int     FK -> Contacts     required
  Attribute_ID         int     FK -> Attributes   required
  Start_Date           datetime                   required
  End_Date             datetime
  Notes                nvarchar(2000)
```

Three consequences that shape the build:

- **Visibility is type-level only.** There is no per-attribute online flag, so a church
  cannot hide one attribute within a visible type. If they need that, the attribute must
  move to a different type. Say so in the customer docs — it is the first thing a church
  will ask when they want "Occupation, but not that one".
- **`Online_Sort_Order` exists and legacy never reads it.** Legacy sorts attributes
  alphabetically client-side and renders types in whatever order the API returned. We sort
  types by `Online_Sort_Order` (nulls last, then `Attribute_Type`) and attributes by name.
  A deliberate, small improvement, not a parity break.
- **`Contact_Attributes.Notes` (2000 chars) is never surfaced by legacy** and will not be
  by us. A free-text field a congregant can write into is a moderation surface nobody asked
  for, and staff use it for their own annotations.

On the reference domain today: types 2 (Occupation) and 3 (Spiritual Gifts) are
`Available_Online = true`; 1 (Personal Characteristics), 4 (Group Tags) and 5
(Persona (Synthetic)) are false. That is exactly the "2 of 5" C52 observed in the browser,
which independently confirms the flag is the gate.

## What legacy does

### Server — three endpoints, one manager

`PortalComponents/Controllers/Api/AttributesApiController.cs`:

| Route | Verb | Returns |
|---|---|---|
| `api/Attributes/Available` | GET | every attribute in every `Available_Online` type — flat, with `attributeTypeId` / `attributeTypeName` on each row |
| `api/Attributes/ContactAttributes` | GET | the signed-in contact's **active** rows (`End_Date > GETDATE() OR End_Date IS NULL`), also filtered to `Available_Online` types |
| `api/Attributes` | POST | `{ attributesToAdd: int[], attributesToRemove: int[] }` |

Both reads filter through the same FK traversal:
`Attribute_ID_Table_Attribute_Type_ID_Table.Available_Online = 1`. That is a two-hop
traversal from `Contact_Attributes`, and it is the same syntax our `MPHelper` uses — see
`.claude/references/ministryplatform.query-syntax.md`.

### The write, precisely

`AttributeManager.UpdateContactAttributes(contactId, model)`:

1. Read **all** the contact's rows in visible types — active *and* end-dated
   (`GetAllRelatedContactAttributes`).
2. For every id in `attributesToAdd` that already has a row → `ReactivateAttributes`:
   update in place with `Start_Date` = domain now, `End_Date` = null.
3. For every id in `attributesToAdd` with no row at all → `CreateAttributes`: insert with
   `Start_Date` = domain now, no `End_Date`.
4. For every id in `attributesToRemove` that has a row → `UpdateAttributesEndDate`: update
   in place with `End_Date` = domain now.

So *legacy's own writes* hold at most one row per (contact, attribute) pair, and history is a
`Start_Date`/`End_Date` pair overwritten on each toggle rather than an append-only log. We
match that on write.

> **But do not assume it on read — measured 2026-09-11.** `Contact_Attributes` has no
> uniqueness constraint and the reference domain already breaks the assumption: contact 5
> holds rows 2 *and* 3 for `Attribute_ID` 1, contact 13 holds rows 6 *and* 7, all four
> active. Conversion, import and staff edits all produce these; only the legacy widget's
> write path is disciplined.
>
> The consequence is a real bug if missed: keying existing rows as
> `Map<attributeId, row>` silently keeps the last one, so deselecting a duplicated
> attribute end-dates one row and leaves the other active — the attribute does not go
> away and the user's change appears to do nothing. Group as
> `Map<attributeId, row[]>`; end-date **every** active row on removal; on reactivation
> revive one deterministically (lowest `Contact_Attribute_ID`) and leave the rest
> end-dated; `selected` is true if **any** active row exists.

> **Not a defect, so nobody files one:** the third positional argument in
> `UpdateRecordsAsync("Contact_Attributes", recordSet, "Attribute_ID")` is the
> **returned-field list**, not a key column — compare
> `CreateRecordsAsync("Invoices", …, "Invoice_ID, Invoice_GUID", …)` and
> `UpdateRecordsAsync("Households", …, "Congregation_ID_Table.Congregation_Name", …)` in
> the same codebase. It reads like a dangerous key override and is not one.

### Client — `mpp-about-me.js`, 396 lines, `observedAttributes: []`

Two modes over one shadow root:

- **View** — only the attributes the contact *has*, grouped by type, each type a heading and
  a plain list. An `Edit` button.
- **Edit** — every visible attribute as a checkbox, pre-checked from the contact's set.
  `Submit` / `Cancel`. Submit disabled until the delta is non-empty.

Two behaviours worth keeping:

- **A contact with no attributes lands straight in edit mode**, with `Cancel` hidden — there
  is nothing to cancel back to (`DisplayAttributes` branches on
  `_userGroupedAttributes.length <= 0`).
- Signed out: *"Please login to view your skills and talents."*

And the copy, from `DatabaseScripts/ApplicationLabels/mpp-about-me.json` — 9 labels,
**every one with `spanish: null` and `portuguese: null`**. Unlike the mission-trip widgets,
About Me was never translated by MP. We author all three locales ourselves; there is nothing
to import.

## Legacy defects — do not port these

### D1 — the write never checks that an attribute is member-visible

`UpdateContactAttributes` takes `attributesToAdd` straight off the request body and writes
it. It reads the contact's *existing* rows through the `Available_Online` filter, but never
validates the **incoming** ids against that same set. Nothing stops a signed-in user POSTing
an attribute id belonging to a type the church deliberately kept offline.

On the reference domain that means a congregant can give themselves `Attribute_ID = 1`,
*"Allergies & Special Needs"* (type 1, `Available_Online = false`), or any `Group Tags`
value — attributes staff use for segmentation and check-in. The reads then hide the row
again, so the user cannot see or undo what they wrote and staff have no idea where it came
from.

Not a privilege escalation — the row is on the caller's own contact — but an unaudited write
into a staff-owned field, trivially reachable with `curl` and a valid token.

**Fix:** the server recomputes the visible attribute universe on every write and rejects any
id outside it. See "The write contract". This is the single most important difference
between this plan and a faithful port.

### D2 — the delta is computed on the client, and it is lossy under concurrency

The client tracks `_addedAttributes` / `_removedAttributes` from click events and posts the
difference. Two consequences:

- Open the page in two tabs, toggle in each, and the second submit is computed against a
  snapshot taken before the first — the later write silently reinstates what the earlier one
  removed. No version, no conflict, no error.
- The server cannot tell an intentional "leave this alone" from "the client forgot about
  it", because absence from both arrays is the only encoding for both.

**Fix:** the client PUTs the **complete set** of visible attribute ids it wants. The server
diffs against the database, so the diff is computed where the truth is. Idempotent, and a
replay is a no-op rather than a resurrection.

### D3 — `Online_Sort_Order` is ignored

Covered above. Types render in API order; a church that set a sort order sees it disregarded.

### D4 — dead code that will mislead the next reader

`AttributeManager.SaveAttributes(contactId, List<int>)` and `GetRelatedContactAttributes`
implement a *second*, subtly different write path (end-dating by set-difference rather than
by an explicit remove list) and nothing calls either. `GetAttributes(int)` builds an
`AttributeDetailResult` tree from an `api_Portal_GetAttributes` stored procedure, and nothing
calls that either — the controller uses the two flat table reads. Do not port any of the
three, and do not treat `api_Portal_GetAttributes` as a dependency: this widget needs **no
stored procedure at all**, unlike most of the catalogue.

### D5 — the empty-state edit mode cannot be escaped

When a contact has no attributes, edit mode renders with `Cancel` hidden and `Submit`
disabled (nothing has changed yet). The widget is a wall of unchecked boxes with two dead
buttons and no explanation. Keep the "start in edit mode" behaviour — it is right — but give
it a heading and an intro line rather than presenting it as a form the user already failed.

## Design decisions

### The read contract

`GET /api/embed/contact-attributes` returns the universe and the selection in one response,
already grouped and sorted. One round trip instead of legacy's two, and the grouping happens
server-side where the sort order lives:

```jsonc
{
  "types": [
    {
      "attributeTypeId": 2,
      "attributeTypeName": "Occupation",
      "attributes": [
        { "attributeId": 6, "attributeName": "Carpenter", "selected": true },
        { "attributeId": 8, "attributeName": "Doctor",    "selected": false }
      ]
    }
  ]
}
```

`selected` is true when an **active** row exists (`End_Date` null or in the future) — the
legacy `GetRelatedActiveContactAttributes` rule.

A type with no attributes is dropped (legacy does this too:
`results.Where(r => r.Attributes.SafeAny())`). If *every* type is filtered out, `types` is
`[]` and the widget renders the "not set up" state rather than an empty form — that is the
signal that the church has no `Available_Online` type, which is the default on a fresh
domain.

### The write contract

`PUT /api/embed/contact-attributes` with the complete desired set:

```jsonc
{ "attributeIds": [6, 11, 14] }
```

Server algorithm, in order:

1. Load the visible universe (the same query the GET uses). Call it `visible`.
2. **Reject if `attributeIds` is not a subset of `visible`** → `400 invalid_attribute`.
   This is D1's fix and it must come before any write. Reject rather than silently drop: a
   silent drop makes a client bug invisible, and the only legitimate way to hit it is a
   stale page whose catalogue changed, which deserves a visible "reload and try again".
3. Load the contact's rows in `visible` types — active **and** end-dated.
4. `toReactivate` = requested ∩ existing-but-end-dated → update `Start_Date` = now,
   `End_Date` = null.
5. `toCreate` = requested with no row → insert `Start_Date` = now.
6. `toEnd` = existing-and-active − requested → update `End_Date` = now.
7. Return the recomputed read payload, so the widget re-renders from the server's truth
   rather than from what it hoped it wrote.

Steps 4–6 are exactly legacy's three operations; only the source of the diff changed.

**Rows in non-visible types are never read, never written, never end-dated.** Step 3's
filter is what guarantees a church can flip `Available_Online` off on a type without the
next member save wiping every row in it.

That rule has **live canaries on the reference domain**, which makes it testable against
real data rather than only against fixtures: *every* `Contact_Attributes` row on the domain
sits in a non-online type — "Personal Characteristics" or "Persona (Synthetic)" — and
contact 3 is MPTrainer (`User_Account` 3), a user who can actually sign in, holding an
active *"Allergies & Special Needs"* row. Get step 3's filter wrong and that user's first
save silently end-dates real medical-flag data on a shared domain. The test to write is a
contact holding a hidden-type row, a full-set PUT of the **empty** set, and an assertion of
zero writes touching that row.

### Dates go through `DomainTimezoneService`

`Start_Date` and `End_Date` are MP wall-clock datetimes. Legacy uses
`TimeZoneHelper.GetCurrentDomainDateTime()`; our equivalent is
`DomainTimezoneService.getInstance().toMpSqlDatetime(...)` — never `new Date().toISOString()`.
See `.claude/references/ministryplatform.datetimehandling.md`. This is the one place in the
widget where the boundary rule bites, and getting it wrong end-dates an attribute several
hours early or late, which nobody notices until a report is off.

### Authentication

Signed-in only. `sub === "public"` gets the sign-in prompt, not an error — the
`C13`/`C30`/`C46` lesson the catalogue already applies elsewhere.
`requireWidgetAuth(req, { widget: "contact-attributes" })`, and the contact id comes from
the token, never from the request body. No anonymous path, no `anonymous-write.ts`
involvement.

### One thing the church must be told

`Available_Online` is the only gate, and it is a per-type switch a staff user can flip in
the Platform without touching this widget. If a church turns it on for *Personal
Characteristics* — which on a stock domain contains *"Allergies & Special Needs"* — this
widget becomes a place where congregants self-declare medical information, with the storage
and access implications that carries. That is the church's decision to make, but they should
make it knowingly. It goes in the README section, not in a code comment.

## Attribute surface

Legacy has none (`observedAttributes: []`). Ours has the two the SDK gives every widget and
nothing else — resist adding a type filter. A church that wants one type on one page and
another elsewhere is asking for per-attribute visibility, which MP does not model; the
answer is `Available_Online`, not a widget attribute that would diverge from what the server
enforces.

| Attribute | Required | Default | Notes |
|---|---|---|---|
| `api-host` | no | current origin | SDK-wide |
| `lang` | no | resolution ladder | SDK-wide, watched by `MutationObserver` |

## Files

### New

| Path | What |
|---|---|
| `src/services/contactAttributeService.ts` | singleton over `MPHelper`; the two reads, the visible-universe computation, the four-way diff write |
| `src/app/api/embed/contact-attributes/route.ts` | `GET` + `PUT` |
| `packages/types/src/contact-attributes.ts` | Zod schemas + interfaces |
| `packages/embed-sdk/src/components/contact-attributes.ts` | the `next-contact-attributes` element |
| `packages/embed-sdk/demo-contact-attributes.html` | demo page |
| `src/services/contactAttributeService.test.ts` | see Tests |
| `packages/embed-sdk/src/components/contact-attributes.test.ts` | see Tests |

### Modified

| Path | What |
|---|---|
| `packages/embed-sdk/src/index.ts` | register the element |
| `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/people.ts` | the `contactAttributes.*` namespace |
| `packages/types/src/index.ts` | re-export |
| `CLAUDE.md` | element roster 30 → 31, service count, route-dir count, and the MP-authored-content list |
| `README.md` | customer section |
| `.claude/TODO/Comparison/C52-*.md` | resolution section + the `Attribute_Categories` correction |
| `.claude/TODO/Comparison/Plans/ROADMAP-missing-widgets.md` | Tier 2 row → built |

`contactAttributeService.ts` is a **new** service, not an extension: the CLAUDE.md rule is
"add a new service unless the domain already has one", and no existing service touches
`Contact_Attributes`. `opportunityFinderService.ts` reads `Attributes` to build *filters*,
which is a different table use and not a domain overlap — C52 already made this point and it
holds.

## Service

```ts
export class ContactAttributeService {
  static async getInstance(): Promise<ContactAttributeService>;

  /** Types with Available_Online = 1, their attributes, and the contact's active set. */
  getForContact(contactId: number): Promise<ContactAttributeGroup[]>;

  /** Full-set replace, scoped to visible types. Throws InvalidAttributeError. */
  setForContact(contactId: number, attributeIds: number[]): Promise<ContactAttributeGroup[]>;
}
```

Two MP reads back the universe. `getIdByValue` from `src/services/_shared/mp-lookup.ts` is
**not** wanted here (nothing resolves a lookup id from a human string), but `toNumberOrNull`
and `cap` are. No `sqlLiteral` either — every value in these filters is a number we have
already coerced, and the filters must be built from coerced numbers rather than interpolated
strings so there is no injection surface to escape in the first place.

The visible-universe read, for reference:

```
table:  "Attributes"
select: "Attributes.Attribute_ID, Attributes.Attribute_Name,
         Attribute_Type_ID_Table.Attribute_Type_ID,
         Attribute_Type_ID_Table.Attribute_Type,
         Attribute_Type_ID_Table.Online_Sort_Order"
filter: "Attribute_Type_ID_Table.Available_Online = 1"
```

and the contact's rows:

```
table:  "Contact_Attributes"
select: "Contact_Attributes.Contact_Attribute_ID,
         Contact_Attributes.Attribute_ID,
         Contact_Attributes.End_Date"
filter: "Contact_Attributes.Contact_ID = <n>
         AND Attribute_ID_Table_Attribute_Type_ID_Table.Available_Online = 1"
```

Base columns are qualified because the filter traverses — the same "MP 500s on ambiguous
columns" rule `myPledgesService` and `pledgeCampaignService` already carry a comment about.

## Error codes

Machine codes; the English `message` is logged and never rendered — the CLAUDE.md contract.

| Code | HTTP | When |
|---|---|---|
| `invalid_attribute` | 400 | a requested id is not in a member-visible type (D1's guard) |
| `invalid_request` | 400 | body is not `{ attributeIds: number[] }` |
| `auth_required` | 401 | `sub === "public"` — the existing shared code |
| `internal_error` | 500 | the catch-all; `WIRE_CODE_KEYS` already maps it to `errors.generic` |

> **Corrected during the build.** An earlier draft of this table listed `unauthorized` and
> `mp_unavailable` as "existing shared codes". Neither exists — anywhere in the repo or in
> any catalogue. The real spellings are `auth_required` and `internal_error`, and inventing
> the other two would have shipped codes with no sentence in three languages, degrading to
> "Something went wrong" for every visitor who hit them. Exactly the failure mode
> `error-codes.test.ts` exists to catch.

There is deliberately **no** `not_configured` error. A fresh domain has no online attribute
type, and answering 4xx would make the demo page look broken on day one. The GET returns
`{ types: [] }` with a 200 and the widget renders the explanatory state.

## Widget states

1. **Loading** — skeleton, painted after `await this.initLocale()` and before the fetch, per
   the base-class ordering rule.
2. **Signed out** — heading + intro + Sign In button via `this.requestLogin()`.
3. **Not configured** — `types` empty. *"Your church has not made any attributes available
   online yet."*
4. **View** — the contact's attributes grouped by type, plus `Edit`. Types with no selected
   attribute are omitted (legacy parity).
5. **Empty + edit** — no attributes at all: heading, intro, the full checkbox grid, `Submit`
   disabled until something is ticked, no `Cancel`. D5's fix is the heading and intro, not a
   behaviour change.
6. **Edit** — full grid, `Submit` enabled on any diff from the loaded set, `Cancel` returns
   to view.
7. **Saving** — buttons disabled, spinner.
8. **Saved** — inline success, auto-dismiss after 5s (legacy parity), re-rendered from the
   PUT's returned payload.
9. **Error** — `this.errorText(payload)`, retry available, edits preserved.

Accessibility, because finder and card items in this catalogue have a history of missing it
(`C05`, `C10`, `C22`, `C28`, `C45`): each type is a `<fieldset>` with a `<legend>`, not a
`<div>` with a bold `<div>`. Every checkbox has a real `<label for>`. Success and error
notifications are `role="status"` / `role="alert"`. The widget emits an `<h2>` (`C35`).

## i18n

New namespace `contactAttributes.*` in `people.ts` (where `profile.*` lives). `en` first,
then `es` and `pt-BR` `satisfies Messages`.

Reuse before adding — `common.edit`, `common.cancel`, `common.submit`, `common.tryAgain`,
`common.signIn` and `errors.generic` all exist. The genuinely new keys:

| Key | English |
|---|---|
| `contactAttributes.title` | About Me |
| `contactAttributes.intro` | Let us know which attributes apply to you. Review your current selections and update as needed. |
| `contactAttributes.signedOut` | Please sign in to view your skills and talents. |
| `contactAttributes.notConfigured` | Your church has not made any attributes available online yet. |
| `contactAttributes.emptyIntro` | You have not selected any attributes yet. Tick the ones that apply to you. |
| `contactAttributes.saved` | Your changes have been saved. |
| `contactAttributes.saveFailed` | We could not save your changes. |
| `errors.invalidAttribute` | Some of those options are no longer available. Please reload the page and try again. |

Type names and attribute names are **MP-authored content and are not translated** — a
Spanish page shows "Spiritual Gifts" exactly as staff typed it. This is the documented limit
in CLAUDE.md's "MP-authored content is not translated" list, and `Attribute_Types` /
`Attributes` should be **added to that list** in the same commit, because they are not there
now and this is exactly the kind of thing a customer reports as a bug.

The ratchet table (`no-english-literals.test.ts` `BUDGET`) is **empty and must stay empty** —
this widget ships fully localised from the first commit. Do not add an entry.

## Tests

### `src/services/contactAttributeService.test.ts`

- visible universe filters on `Available_Online`, and the FK traversal is two hops
- types sort by `Online_Sort_Order` then name; nulls last
- attributes sort by name, case-insensitively (legacy uses `sensitivity: "base"`)
- a type whose attributes are all filtered out is dropped
- `selected` is true for `End_Date` null, true for `End_Date` in the future, false for past
- **write: an id outside the visible universe throws `InvalidAttributeError` and performs
  zero MP writes** — the D1 regression test, and the one that matters most
- write: reactivate path updates in place, does not insert a duplicate
- write: create path inserts with `Start_Date` and no `End_Date`
- write: removal sets `End_Date`, does not delete
- write: an attribute in a *hidden* type that the contact already has is untouched by any
  operation
- write with the identical set is a no-op — zero create, zero update
- dates are produced by `toMpSqlDatetime`, not `toISOString`

### `packages/embed-sdk/src/components/contact-attributes.test.ts`

- signed out renders the sign-in prompt, not an error (`C13`/`C30`/`C46` family)
- `types: []` renders the not-configured state
- zero selected attributes opens in edit mode with no Cancel
- Submit is disabled until the set differs from the loaded set, and re-disables when the
  user toggles back to the original
- Cancel restores the loaded set, discarding edits
- each type is a `fieldset`/`legend`; every checkbox has an associated label
- an `invalid_attribute` payload renders `errors.invalidAttribute`, never the English
  `message`

### Existing guard tests this must satisfy

`catalogue-parity.test.ts`, `error-codes.test.ts` (every new code has a message in all three
locales), `no-english-literals.test.ts` (0, no budget entry), `widget-locale.test.ts`,
`src/lib/no-template-concat.test.ts`.

## Security

- Contact id from `claims.sub` only. The route never accepts a contact id, so there is no
  IDOR to write a test for — which is the point.
- D1's subset check is the authorization boundary for *which* rows may be written, and it is
  server-side. The widget's rendering of only visible types is a UI convenience, not a
  control.
- Filters are built from numbers coerced with `toNumberOrNull`, so there is no string
  interpolation into `$filter` and nothing for `sqlLiteral` to escape.
- No new npm dependency, no CDN asset, no token material logged.
- Rate limiting: not required. An authenticated, self-scoped write with no email send and no
  enumeration surface — the `anonymous-write.ts` machinery would be cargo cult here.

## Demo page

`demo-contact-attributes.html`, following the house pattern: the canonical setup snippet
injected by `vite.config.ts`, the auth-mode banner, and a sign-in prompt because this widget
is signed-in-only. Nothing to pin — unlike `demo-pre-check.html` there is no date or
household that only works on one row of the reference domain; any signed-in contact
exercises the whole path, including the empty state (reference contact 98 has no
`Contact_Attributes` rows at all, per C52's own MP check).

## Estimate

Small. The service is two reads and a four-way diff, the route is two verbs, and the widget
is a two-mode checkbox grid — the `next-subscriptions` shape, which is the in-repo precedent
C52 already identified. No stored procedure, no email, no anonymous flow, no CDN asset, no
new shared primitive. The two things that historically cost time on this catalogue — an
undocumented MP write convention and an unanswered visibility rule — are both settled above
before a line is written.
