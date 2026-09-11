# C52. `mpp-about-me` (self-service contact attributes — skills, talents, spiritual gifts) has no `next-*` counterpart; `next-profile` is a different widget

**Widget:** none (old: About Me — `/widgets/AboutMe`, tag `mpp-about-me`)
**Severity:** functional
**Confidence:** confirmed — legacy widget driven signed in and signed out; the absence in this repo verified by grep across `packages/embed-sdk/src` and `src`
**Found:** 2026-09-08, comparison run

## Old behaviour

`/widgets/AboutMe` carries `<mpp-about-me>`. Signed in, it renders:

> **About me** — Let us know which attributes apply to you! Review your current
> selections and update as needed. **Edit**
>
> **Occupation**: Carpenter · Doctor · Electrician · General Contractor ·
> Grief Counselor · Nurse · Social Worker
>
> **Spiritual Gifts**: Administration · Evangelism · Exhortation · Faith ·
> Hospitality · Leadership · Mercy · Serving · Shepherding · Teaching · Wisdom
>
> **Submit** · **Cancel**

18 checkboxes, named `category_<AttributeCategoryId>_attribute_<AttributeId>`
(categories 2 and 3 on this instance), i.e. it reads and writes MP
`Contact_Attributes` for the signed-in contact, grouped by
`Attribute_Categories`. Signed out it shows
*"Please login to view your skills and talents."*

It is a **plain widget page** — the same server-rendered shell as the `.aspx`
pages, not an SPA (CONFIG-MAP §1) — with `observedAttributes` `[]`.

## New behaviour

There is no such widget, and no such capability anywhere in the repo.

- `packages/embed-sdk/src/components/` has no attributes/skills/gifts component.
- `grep -rin "contact_attribute\|spiritual gift\|skills\|talents"` over
  `packages/embed-sdk/src`, `src/services` and `src/app/api/embed` returns
  **nothing** relevant; the only `Attribute_ID` hits are in
  `src/services/opportunityFinderService.ts`, which reads `Attributes` to build
  opportunity *filters* — a different table use and not a contact-editing surface.
- There is no `src/app/api/embed/attributes` route and no `attributeService.ts`.

The BRIEF pairs `next-profile` with About Me. That mapping is wrong and worth
correcting: `next-profile` edits `Contacts` scalar fields (prefix, names,
nickname, suffix, gender, date of birth, marital status, mobile/work phone,
email, SMS opt-in, bulk-email opt-out, photo, password). It touches no
`Contact_Attributes` row. `mpp-about-me` edits *only* `Contact_Attributes` and
touches none of those fields. They do not overlap at all — CONFIG-MAP §4.15 was
right that their *attribute surfaces* both have zero options, but that is a
coincidence, not parity. The legacy surface that edits a contact's own scalar
fields is `mpp-household` ("Edit Contact Info" / "Edit Household Member"), which
`next-my-household` does mirror.

## Why it matters

Self-declared attributes are how a church finds the electrician in the
congregation when the fellowship hall lighting fails, and how it staffs teams
from declared spiritual gifts. A church migrating off the legacy widgets loses
the only member-facing way to maintain those declarations: staff would have to
key every change into the Platform by hand, and members lose the "review your
current selections and update as needed" self-service loop entirely. It also
means the widget catalogue has no answer at all for `Contact_Attributes`, a
first-class MP concept.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/about-me-old-authed.png` — the legacy widget signed in, both categories expanded with all 18 checkboxes
  - `.claude/playwright/widget/screenshots/about-me-old-anon.png` — signed out, *"Please login to view your skills and talents."*
  - `.claude/playwright/widget/screenshots/profile-new-authed.png` — `next-profile` for the same user, for the side-by-side: entirely different fields
- DOM enumeration of `mpp-about-me`'s shadow root, signed in: 18 visible
  `input[type=checkbox]` named `category_2_attribute_{2,3,4,5,6,7,8}` and
  `category_3_attribute_{9…19}`, plus a hidden `#loginButton`.
- MP verification (client credentials):
  `GET /tables/Contact_Attributes?$filter=Contact_ID=98` → `[]` (the test contact
  has declared none), confirming the widget writes that table.
  `Attribute_Categories` is *"restricted by your organization's administrator"*
  for our API user, so the category list could not be dumped from the API — the
  category ids come from the legacy widget's own checkbox names.

## Where to fix

New work, so there is no file to point at yet. The shape it would take:

- `packages/embed-sdk/src/components/contact-attributes.ts` — a new
  `next-contact-attributes` element (view + Edit → checkbox grid → Submit /
  Cancel), following `next-subscriptions` for the "checkbox list with immediate
  or batched save" pattern
- `src/app/api/embed/contact-attributes/route.ts` — `GET` the available
  categories/attributes plus the signed-in contact's current rows; `PUT` the
  new set
- `src/services/contactAttributeService.ts` — `Attribute_Categories` filtered to
  the online-available ones, `Attributes` within them, and the contact's
  `Contact_Attributes` rows
- `packages/types/src/` — the Zod schema and interfaces
- `packages/embed-sdk/demo-contact-attributes.html` — the demo page

## Suggested fix

Build `next-contact-attributes` as its own widget rather than bolting a tab onto
`next-profile`: the legacy surface is a separate page, a church may want it on a
different site page, and its data model (rows per attribute, with start/end
dates) is nothing like the flat field set `next-profile` posts.

Two things to settle with MP before implementing, both of which the API user
could not read here: which `Attribute_Categories` are meant to be member-visible
(the legacy widget shows only 2 of them, so there is a flag it honours —
probably `Available_Online`), and whether `Contact_Attributes` writes should set
`Start_Date` / `End_Date` (end-dating a removed attribute) or hard-delete the
row. Match whichever the legacy widget does, since both systems will run against
the same instance during a migration.

Marking this **functional** rather than breaking: nothing in the new catalogue
is broken by it, but a documented legacy capability has no replacement.

## Resolution — BUILT, 2026-09-11

`next-contact-attributes` ships on `feature/tier2-about-me-mission-trips`. Plan:
`Plans/contact-attributes.md`. The catalogue went 30 → 33 elements (this plus the two
mission-trip widgets from C76).

- `packages/embed-sdk/src/components/contact-attributes.ts` — view / edit modes, the
  `next-subscriptions` shape this finding predicted
- `src/services/contactAttributeService.ts`, `src/app/api/embed/contact-attributes/route.ts`
  (`GET` + `PUT`), `packages/types/src/contact-attributes.ts`
- `packages/embed-sdk/demo-contact-attributes.html`, complete `en` / `es` / `pt-BR` copy
- 42 tests across the service and the component

### Both open questions are answered — and one of them was mis-framed

This finding closed with two things "to settle with MP". The legacy server at
`S:\MP\mp-Widgets` settled both, and the live schema confirmed them.

1. **Member visibility is `Attribute_Types.Available_Online = 1`.** The guess in
   *Suggested fix* was right about the flag name.
2. **Writes end-date; they do not delete** — and re-selecting a removed attribute
   **reactivates the existing row** (`Start_Date` = now, `End_Date` = null) rather than
   inserting a second one. `AttributeManager.UpdateContactAttributes`.

**The correction: there is no `Attribute_Categories` table in MinistryPlatform.** The
grouping entity is `Attribute_Types`. This finding says "categories" throughout, and the
`Where to fix` section proposes filtering "`Attribute_Categories` … to the online-available
ones" — a table that does not exist.

The error is traceable and worth recording, because the evidence was sound and the
inference was not. This finding read the ids out of the legacy DOM — `category_2_attribute_3`
— because the API user could not read the table. That checkbox name interpolates
`category.attributeTypeId`: the legacy author's own local variable is named `category` while
it holds an attribute **type**. So the ids (2 and 3) were correct and the table name was
invented from a variable name. The live schema shows types 2 (Occupation, 7 attributes) and
3 (Spiritual Gifts, 11) with `Available_Online = true`, and 1, 4 and 5 false — exactly the
"2 of 5" this finding observed, which independently confirms the flag is the gate.

`Attributes` carries **no** online flag of its own, so visibility is type-level only: a
church cannot hide one attribute inside a visible type.

### The legacy defect this finding did not look for

`UpdateContactAttributes` reads the contact's existing rows through the `Available_Online`
filter but **never validates the incoming ids against it**. A signed-in congregant could
POST any attribute id — including `Attribute_ID = 1`, *"Allergies & Special Needs"*, in a
type the church deliberately kept offline, or any `Group Tags` value used for segmentation
and check-in. The reads then hide the row again, so the user can neither see nor undo what
they wrote and staff have no idea where it came from.

Not privilege escalation — the row is on the caller's own contact — but an unaudited write
into a staff-owned field, reachable with `curl` and a valid token. The new service rejects
any id outside the visible universe **before any MP call**, and four tests hold that line,
including one asserting zero MP reads on rejection so the guard cannot become an enumeration
oracle for offline types.

Two other legacy behaviours were deliberately not ported: the client-computed add/remove
delta (two tabs silently clobbered each other) is replaced by a full-set `PUT` the server
diffs, and `Online_Sort_Order` — which legacy ignored entirely — is now honoured.

### One hazard found in live data, not in either source tree

`Contact_Attributes` has no uniqueness constraint on `(Contact_ID, Attribute_ID)`, and the
reference domain already violates the assumption: contacts 5 and 13 each hold **two** active
rows for attribute 1. Legacy's own writes kept one row per pair; conversions and imports do
not. Keying existing rows by attribute id alone end-dates one row and leaves the other
active, so a member's deselection appears to do nothing. The service groups as
`Map<attributeId, row[]>`, end-dates every active row on removal, and reactivates exactly
one — the lowest `Contact_Attribute_ID` — so an imported duplicate never becomes one this
widget authored.

The same read also has a live canary for the "never touch offline types" rule: every
`Contact_Attributes` row on the reference domain sits in an offline type, and contact 3 is
MPTrainer (`User_Account` 3), a signable account holding an active Allergies row. A wrong
scoping filter would end-date real data on a shared domain on that user's first save.

### Severity as filed stands

`functional` was right: nothing was broken, a documented legacy capability had no
replacement. It has one now, and the BRIEF's `next-profile` ↔ About Me pairing should be
struck — this finding was correct that they do not overlap at all.
