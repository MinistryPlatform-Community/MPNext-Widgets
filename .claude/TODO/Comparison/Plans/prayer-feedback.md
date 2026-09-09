# `next-prayer-feedback` — plan

**Items:** C69 (functional, no counterpart) · touches C79 / `CROSS-4` (attribute naming)
**Cutover verdict: blocks cutover for any church whose site has a prayer form — which is
most of them. Tier 1, rank 4 in `ROADMAP-missing-widgets.md`.** There is no host-page
workaround: a hand-built `next-custom-form` writes `Form_Responses`, not `Feedback_Entries`,
so submissions never reach the prayer queue staff actually work.

**Owns — created:**

| File | Purpose |
|---|---|
| `packages/embed-sdk/src/components/prayer-feedback.ts` | the `next-prayer-feedback` element |
| `packages/embed-sdk/src/components/prayer-feedback.test.ts` | component tests (jsdom) |
| `packages/embed-sdk/demo-prayer-feedback.html` | demo page |
| `src/services/prayerFeedbackService.ts` | MP data access (singleton) |
| `src/services/prayerFeedbackService.test.ts` | service tests |
| `src/app/api/embed/prayer-feedback/types/route.ts` | `GET` feedback-type list |
| `src/app/api/embed/prayer-feedback/submit/route.ts` | `POST` submit |
| `src/app/api/embed/prayer-feedback/verify/route.ts` | `POST` redeem the emailed link |
| `src/app/api/embed/prayer-feedback/submit/route.test.ts` | route tests |
| `src/app/api/embed/prayer-feedback/verify/route.test.ts` | route tests |
| `packages/types/src/prayer-feedback.ts` | Zod schemas + TS types |

**Owns — touched:**

| File | Change |
|---|---|
| `packages/embed-sdk/src/index.ts` | `export {}` (`:54` block), `import` (`:99` block), the tag list at `:145`, and `detectFirstWidgetId`'s `widgetMap` at `:172` — **all four**, or the widget gets no token |
| `packages/types/src/index.ts` | `export * from "./prayer-feedback"` |
| `packages/types/src/widgets.ts` | registry entry (drives both demo surfaces) |
| `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/people.ts` | the `prayerFeedback` namespace |
| `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/core.ts` | 9 new `errors.*` codes |
| `packages/embed-sdk/i18n-sources/` | re-record via `pnpm i18n:sync` |
| `CLAUDE.md` | roster line + the "26 as of" counts in Overview and Widget Architecture |
| `.claude/playwright/widget/BRIEF.md` | correct the pair table: `next-custom-form` ↔ `mpp-custom-form`; this widget ↔ `mpp-prayer-feedback-form` (C69's own closing instruction) |
| `.claude/TODO/Comparison/Plans/ROADMAP-missing-widgets.md` | mark Tier 1 #4 taken |

**Depends on:** the three shared primitives below — of which **`messageTemplateService.ts` has
already landed** (`d05d3e5`); it still owes escape-by-default and distinct error classes.
Nothing else. `vercel.json` needs no entry — it only carries static-asset CORS; the routes set
their own headers.

---

## What legacy does

**Correction to the brief: the legacy server *is* on disk.** `PrayerFeedbackApiService.js`
calls `/Api/PrayerFeedbackApi/*`, and that controller and its whole stack are in the same
repo:

- `PortalComponents/Controllers/Api/PrayerFeedbackApiController.cs`
- `PortalComponents/Services/PrayerFeedbackService.cs`
- `PortalComponents/DataManagers/PrayerFeedbackManager.cs`
- `PortalComponents/Models/PrayerFeedbackModel.cs`
- labels: `DatabaseScripts/ApplicationLabels/mpp-prayer-feedback-form.json`

So none of the record shape below is inferred. It is read off the writes.

### The flow, off the source

1. **Load** (`mpp-prayer-feedback-form.js:117-144`). If the URL carries `?mpp-verify-id=…`,
   hide the form and go straight to redeeming the link. Otherwise populate the Feedback Type
   dropdown (`GetFeedbackTypes?feedbackTypeIds=…`), bind listeners, and try
   `UserService.GetCurrentUser()`.
2. **Signed in** (`:241-290`) — show a *"Provide Feedback As"* `<select>` populated from
   `HouseholdApiService.GetHouseholdMembers()`, defaulted to the current user, and hide
   first/last/email/phone. The email field is re-shown only when the selected member has no
   email on file (`ShowHideEmailContainer`, `:367-385`). Choosing the blank option
   (*"Blank Form"*) re-shows all four and re-applies `required`.
3. **Signed out** — the blank form: first name, last name, email (all `required`), mobile
   phone (optional).
4. **Submit** (`:193-211`) → **`SendVerificationEmail`, always**. Note this: legacy sends the
   email round-trip **even for a signed-in user**, and **writes no MP record at submit time**.
   `SubmitPrayerFeedback` exists on the client service (`PrayerFeedbackApiService.js:17`) and
   the controller (`:33`) but the component never calls it — dead code.
5. **Server, step 1** (`PrayerFeedbackService.cs:60-146`). If a `ContactId` was posted, it
   overwrites the posted name/email/phone from that contact. Then it packs the *entire
   submission* into a 24-hour HS256 JWT — `contactId`, `firstName`, `lastName`, `email`,
   `mobilePhone`, `feedbackTypeId`, `feedbackSummary`, `feedbackDetails` (truncated to 1000),
   `feedbackPrivate`, `programId` — appends it to `{returnUrl}?mpp-verify-id=`, and sends the
   `verificationemailtemplate` with merge tokens `mpp_verify_email_url`,
   `mpp_contact_first_name`, `mpp_contact_last_name`.
6. **Server, step 2** (`:148-198`, `:200-260`). The link decodes the JWT and *now* writes.
   `Contact_ID` resolution: use the JWT's `contactId` if > 0; else `FindContact(first, last,
   email)`; else **create a Household (`Name = LastName`) and a Contact (status Active,
   `Nickname = FirstName`, `Display_Name = "Last, First"`) and associate them**. Then a
   duplicate guard, then the insert. On success, if a contactId was present, it **overwrites
   that contact's `Email_Address`** with the form value (`:189`).
7. **The insert** (`PrayerFeedbackManager.cs:22-45`) — exactly:

   | Column | Value |
   |---|---|
   | `Contact_ID` | resolved above |
   | `Entry_Title` | `FeedbackSummary` (form maxlength 50) |
   | `Feedback_Type_ID` | dropdown |
   | `Program_ID` | `programid` attribute, `NULL` when `<= 0` |
   | `Date_Submitted` | `TimeZoneHelper.GetCurrentDomainDateTime()` — domain wall clock |
   | `Visibility_Level_ID` | **`2` when Private ticked, else `4`** |
   | `Description` | `FeedbackDetails`, truncated to 1000 |
   | `Ongoing_Need` | `false`, always |
   | `Approved` | `false`, always |

   `Assigned_To`, `Care_Outcome_ID`, `Outcome_Date`, `Care_Case_ID` are never written.

### Four legacy defects to fix rather than port

1. **`SendVerificationEmail` is an unauthenticated email cannon.** The route is
   `[AllowAnonymous]` and takes `ContactId` straight off the form. Post `ContactId=41234`
   and the server looks that contact up, harvests their real name and email, and mails them
   a link that will file a prayer entry against them. No auth, no household check, no rate
   limit. **We must never accept a `Contact_ID` from an unauthenticated caller.**
2. **The duplicate guard is broken and interpolates user text into SQL.**
   `PrayerFeedbackManager.cs:47-64` builds a filter from `Entry_Title` and `Description`
   with `.Clean()` string interpolation, and `var description = prayerFeedbackModel
   .FeedbackDetails ?? ""[..Math.Min(…)]` binds the range operator to the `""` literal —
   so `description` is the *untruncated* details whenever they are non-null, compared
   against a column the writer truncated at 1000. Entries over 1000 characters never match
   their own guard. Replace the whole thing with a single-use token (below).
3. **The description limit disagrees with itself.** The textarea says `maxlength="2000"`,
   the column allows 2000, and both the JWT and the insert cut at 1000. A congregant's last
   1000 characters vanish silently. Ship 2000 end to end.
4. **Merge values are not escaped.** `Entry_Title` and the names go into the template `Body`
   raw, so a submission is a stored-XSS vector into a staff mailbox and into any Platform
   surface that renders the email. See primitive 1.

### Two legacy behaviours worth keeping and one worth dropping

Keep: the double opt-in for anonymous submitters, and *"Provide Feedback As"*.
Drop: the email round-trip **for signed-in users**. We already hold a verified identity in
the encrypted server session; making a signed-in member go to their inbox to confirm a
prayer request is friction legacy paid because it had no better identity signal at
`[AllowAnonymous]`. See "The design decision" below.

**What "drop the round-trip" does not mean.** The signed-in path still sends the
acknowledgement email. Removing the *verification* step must not remove the church's only
confirmation to the submitter — that would be a regression dressed as a simplification. Ruled
explicitly, 2026-09-09.

### Legacy copy (already translated — reuse it)

`DatabaseScripts/ApplicationLabels/mpp-prayer-feedback-form.json` carries all 24 labels in
English, Spanish, Chinese and Portuguese. The Spanish and Portuguese strings there are the
starting point for our `es` / `pt-BR` catalogues — free, and already the wording churches
have seen. (Two are visibly machine-translated — `verificationEmailFailedMessage` →
*"E-mail de verificação de envio de erro"* is word-salad; do not copy those two verbatim.)

---

## The design decision on `Contact_ID`

`Feedback_Entries.Contact_ID` is `NOT NULL` (confirmed against the live domain via
`mp_lookup`). A signed-out visitor has no contact. Four options:

| Option | Verdict |
|---|---|
| **A. A configured "anonymous" contact** — one shared Contact all public submissions hang off | **No.** Every prayer request collapses onto one row in the staff queue with no way to reply, and the contact's Feedback tab becomes a landfill. It also destroys the one thing the record is for: knowing who to pray for. |
| **B. Require sign-in** | **No.** It converts the single most-embedded public form into a registration funnel, and is the exact failure mode `ROADMAP` cites for C70. |
| **C. Match an existing contact only; reject when not found** | **No.** Rejecting a first-time visitor's prayer request because MP has never heard of them is the worst possible outcome, and "we could not find you" on a public form is an existence oracle. |
| **D. Match, else create — but only after the email is proven** | **Yes. This is what legacy does, and it is right.** |

**Recommendation: D, unchanged in shape from legacy, with the writes gated differently.**

```
anonymous submit  →  no MP write at all  →  email a one-time link
                                          →  link redeemed  →  match-or-create Contact
                                                            →  insert Feedback_Entry

signed-in submit  →  resolve Contact from claims.sub (dp_Users → Contact_ID)
                  →  optional "as" target, household-verified
                  →  insert Feedback_Entry immediately   (no email round-trip)
```

**Why the double opt-in carries the whole design.** It is what makes "create a Contact" safe.
Without it, an unauthenticated `POST` mints Household + Contact rows in a church's CRM at
whatever rate a script can manage, and MP has no good bulk-undo for that. With it, a row is
only ever created by someone who demonstrably controls the mailbox. That is also why
`returnurl` + `verificationemailtemplate` are on the legacy attribute surface — the brief
guessed a Plan-Your-Visit-shaped bounce, and the source confirms it (`PrayerFeedbackService
.cs:70`, `formData.VerifyEmailUrl = $"{formData.ReturnUrl}?mpp-verify-id="`).

**Match rule.** Reuse `planYourVisitService.findContact`'s exact predicate — last name AND
(first name OR nickname) AND email, all `LIKE` on the literal — rather than inventing a
second one. It is deliberately narrow: an email match alone would let anyone file against a
known address, and a name match alone would collide constantly.

**Create rule.** Legacy's, plus two corrections:

- `Households`: `Household_Name = <LastName>` (fall back to the local part of the email if
  empty), and **add `Household_Source_ID`** resolved by name through
  `getIdByValue("Household_Sources", "Household_Source", "Website", …)`. Legacy sets none,
  which makes widget-created households indistinguishable from staff-entered ones. `Website`
  (id 19 on the reference domain) is the honest existing value — do **not** require a new
  `Household_Sources` row, and treat a `null` lookup as "omit the column", the way
  `planYourVisitService` already does.
- `Contacts`: `Company: false`, `Status: <Active>` (by name, not the literal `1`),
  `Household_ID`, `Household_Position_ID: <Head of Household>` (by name — legacy sets no
  position at all, which leaves the new contact orphaned from household tooling),
  `First_Name`, `Last_Name`, `Nickname = First_Name`,
  `Display_Name = "<Last>, <First>"`, `Email_Address`, `Mobile_Phone`.

**Do not port the email overwrite** (`PrayerFeedbackService.cs:189`) as written. Legacy
unconditionally rewrites the target contact's `Email_Address` with the form value. Write it
**only when the contact's `Email_Address` is currently null or empty** — which is the case
legacy's UI was actually built for (the email field only appears when the selected member has
none). Otherwise a typo in a prayer form silently breaks a member's giving statements.

### The other defaults, settled against the live domain

`mp_lookup` on `Visibility_Levels` returns `1 - Private`, `2 - Staff Only`,
`3 - Staff & Church`, `4 - Public`, `5 - Hidden: URL Required`.

| Column | Value | Why |
|---|---|---|
| `Visibility_Level_ID` | `2` (Staff Only) when Private is ticked, else `4` (Public) | Legacy's mapping, and correct. |
| `Approved` | **`false`, always. Not configurable.** | This is the safety interlock behind `Visibility_Level_ID = 4`: a public-visibility entry is still unapproved, so nothing a stranger typed is publishable until staff look at it. An `auto-approve` attribute would be a one-attribute path to putting unmoderated text on a church's prayer wall. Refuse the request if it comes. |
| `Ongoing_Need` | `false`, always | Legacy never exposes it; it is a staff triage field. |
| `Program_ID` | `program-id` attribute, omitted when absent or `<= 0` | Optional FK. `Programs` on the reference domain has 7 rows and an `Available_Online` flag, but the widget takes a fixed id from the host page, so no lookup and no validation beyond "positive integer" — an unknown id will be rejected by MP's own FK, which is the right error. |
| `Date_Submitted` | `DomainTimezoneService.getInstance().toMpSqlDatetime(new Date().toISOString())` | Legacy uses domain wall clock. `.toISOString()` alone would shift the day for evening submissions in negative-offset zones. |
| `Assigned_To`, `Care_*`, `Outcome_Date` | never written | Staff fields. |

### The safe default for `feedback-type-ids` — ruled 2026-09-09

`Feedback_Types` has no `Available_Online` flag, so the attribute is the only filter, and with
it absent **legacy offers all five types — including `User Removal Request`**, which is a
GDPR/erasure workflow wearing a prayer-form costume. Shipping that default is indefensible.

The fix is **not** a hardcoded `1,2,3`. Two things break it: a church that adds its own type
(`Testimony`, id 6) would silently never see it, and the literal ids assume the stock lookup
table exists unmodified on every domain. Neither assumption is safe on a per-tenant lookup.

**Default = every `Feedback_Types` row except the removal type**, excluded by **both**
predicates so the guard survives a domain where the id differs:

```
Feedback_Type_ID <> 5  AND  Feedback_Type does not match /removal/i
```

The id check is exact and cheap; the name check is the belt-and-braces that still works when a
church has renumbered or re-seeded the table. Filter on the id in the MP query and apply the
`/removal/i` test in TypeScript over the returned rows — MP's `$filter` has no regex, and
`NOT LIKE '%removal%'` would need the same literal-escaping care for no extra safety.

**An explicit list is honoured, including the removal type.** If a church writes
`feedback-type-ids="1,2,5"`, ship type 5 and `console.warn` once naming it. An explicit
configuration is a deliberate choice and not ours to override; it is only the *default* that
has to be safe. The warning is there so a copy-pasted snippet gets noticed.

**This is a deliberate divergence from legacy on a defaulted attribute** — a church that
omitted `feedbacktypeids` and relied on all five appearing will see four. Say so in the
migration notes, alongside the reason.

---

## Attribute surface

kebab-case per `CROSS-4` / C79 — and matching the existing `verification-email-template-id`
spelling on `next-plan-your-visit` (the repo has both `-template` and `-template-id`; `-id`
is what the two newest and closest widgets use, so use `-id`). No legacy aliases: the tag
name is new, so no customer markup carries over and there is nothing to deprecate.

| New | Legacy | Required | Meaning |
|---|---|---|---|
| `feedback-type-ids` | `feedbacktypeids` | no | Comma-separated `Feedback_Type_ID` allowlist for the dropdown. Absent ⇒ **every `Feedback_Types` row except the removal type** — see "The safe default" below. Also enforced **server-side** — see Security. |
| `program-id` | `programid` | no | `Feedback_Entries.Program_ID`. Positive integer. |
| `verification-email-template-id` | `verificationemailtemplate` | **yes, for anonymous submissions** | `dp_Communications.Communication_ID`. Must contain `[mpp_verify_email_url]`. Absent ⇒ the anonymous form renders a configuration notice instead of a submit button, rather than failing at submit. |
| `return-url` | `returnurl` | no | Where the emailed link lands. Defaults to the current page URL with its query string stripped, exactly as `plan-your-visit.ts` does — so the commonest case needs no attribute. |
| `acknowledgement-email-template-id` | — | no | **New.** Sent once the entry is written, on both paths. Merge tokens below. Absent ⇒ no acknowledgement mail. |
| `verify-param-name` | — | no | Defaults to `mpp-verify-id`, so a legacy email template and a legacy bookmark keep working. |
| `default-private` | — | no | `"true"` pre-ticks Private. For a page whose whole framing is confidential pastoral care. |
| `hide-private-option` | — | no | `"true"` hides the checkbox and forces the value from `default-private`. A church that treats every prayer request as staff-only should not have to explain a checkbox. |
| `api-host` | — | no | Standard across the SDK. |

`lang` is **not** listed and must not be added to `observedAttributes` — the base class
watches it with a `MutationObserver`.

### Why `acknowledgement-email-template-id` is separate from the verification one

The vendor blurb for `verificationemailtemplate` says *"will be sent to the individual who
submits"*, which reads like an acknowledgement, but the merge contract proves it is a
verification mail: the template must render `[mpp_verify_email_url]`. A signed-in submission
skips verification, so reusing that template there would email a dead link. Two attributes,
two contracts:

| Template | Merge tokens |
|---|---|
| `verification-email-template-id` | `mpp_verify_email_url`, `mpp_contact_first_name`, `mpp_contact_last_name` (legacy's exact three — keep the names so an existing MP template drops straight in) |
| `acknowledgement-email-template-id` | `mpp_contact_first_name`, `mpp_contact_last_name`, `mpp_feedback_type`, `mpp_feedback_summary`, `mpp_date_submitted` |

The acknowledgement deliberately does **not** merge the description. A prayer request echoed
back into an unencrypted mailbox is a disclosure the submitter did not ask for, and the
summary is enough to identify which request it confirms.

---

## Server

### `src/services/prayerFeedbackService.ts`

Singleton, `MPHelper`-wrapping, same shape as `planYourVisitService.ts`. Never called
except from the three routes.

```ts
export interface FeedbackTypeOption { id: number; name: string; description: string | null }

export interface PendingFeedback {
  contactId: number | null;      // signed-in path only; null for anonymous
  firstName: string;
  lastName: string;
  email: string;
  mobilePhone: string | null;
  feedbackTypeId: number;
  summary: string;               // → Entry_Title, ≤ 50
  description: string | null;    // → Description, ≤ 2000
  isPrivate: boolean;
  programId: number | null;
}

export class PrayerFeedbackService {
  static getInstance(): Promise<PrayerFeedbackService>;

  /**
   * `Feedback_Types` for the dropdown.
   *
   * `allowedIds` empty/absent ⇒ the safe default: every row except the removal
   * type (`Feedback_Type_ID <> 5` in the query, plus a `/removal/i` test on
   * `Feedback_Type` in TS, because MP `$filter` has no regex).
   * `allowedIds` non-empty ⇒ exactly those ids, **removal type included if
   * listed**, with a single `console.warn` naming it. Cached.
   */
  getFeedbackTypes(allowedIds?: number[]): Promise<FeedbackTypeOption[]>;

  /** True when the id exists in `Feedback_Types`. Cached alongside the list. */
  isKnownFeedbackType(id: number): Promise<boolean>;

  /** The removal-type ids on this domain — id 5 plus any `/removal/i` name match. */
  getRemovalTypeIds(): Promise<number[]>;

  /** Reuses planYourVisit's predicate: last AND (first OR nickname) AND email. */
  findContact(firstName: string, lastName: string, email: string): Promise<number | null>;

  /** dp_Users.User_GUID → Contacts.Contact_ID. */
  getContactIdByUserGuid(guid: string): Promise<number | null>;

  /** Contact + household + email, for prefilling "Provide Feedback As". */
  getSubmitterOptions(contactId: number): Promise<{
    self: { contactId: number; displayName: string; email: string | null };
    household: { contactId: number; displayName: string; email: string | null }[];
  }>;

  /** Server-side guard for a posted "as" target. */
  isInSameHousehold(callerContactId: number, targetContactId: number): Promise<boolean>;

  /**
   * Match-or-create the Contact, then insert exactly one Feedback_Entries row.
   * The only method in this file that writes. Returns the new entry id.
   */
  createFeedbackEntry(input: PendingFeedback): Promise<{
    feedbackEntryId: number;
    contactId: number;
    contactCreated: boolean;
  }>;

  /** Only when the contact currently has no email. Best-effort; never throws. */
  backfillContactEmail(contactId: number, email: string): Promise<void>;
}
```

Household lookup goes through `HouseholdService.getMembers(householdId)`, which already
returns `contactId` / `displayName` / `emailAddress` and already excludes deceased
(`Contact_Status_ID <> 3`). Do not write a second member query.

**Exact `Feedback_Entries` column set written:**

```
Contact_ID, Entry_Title, Feedback_Type_ID, Program_ID (omitted when null),
Date_Submitted, Visibility_Level_ID, Description (omitted when null),
Ongoing_Need = false, Approved = false
```

Nine columns, nothing else. Any `Assigned_To` / `Care_Case_ID` write is out of scope.

### Routes

All three: `resolveRequestOrigin` → `requireWidgetAuth(req, { widget: ["prayer-feedback", "*"] })`
→ `getCorsHeaders(origin)`, plus `OPTIONS` via `buildOptionsResponse`, exactly as the
plan-your-visit routes do. Errors answer `{ error: "<snake_case_code>", message: "<English>" }`
— **not** the `{ success: false, message }` shape the plan-your-visit routes still use, which
dodges `error-codes.test.ts` only because it has no `error:` property to match. Do not copy
that.

#### `GET /api/embed/prayer-feedback/types?ids=1,2,3`

Response `200`: `{ types: [{ id, name, description }] }`, `Cache-Control: public, max-age=600`.
Public — the type list is not sensitive. Invalid `ids` (non-numeric) ⇒ `invalid_request` /
`400`. `ids` absent or empty ⇒ the safe default (removal type excluded); `ids` present ⇒
honoured verbatim. **The `Cache-Control` must vary with `ids`** — it is in the query string,
so a shared cache keys on it correctly, but do not "simplify" the route to ignore `ids` and
filter client-side, or one church's allowlist gets served to another from an edge cache.

#### `POST /api/embed/prayer-feedback/submit`

```ts
{
  feedbackTypeId: number;
  summary: string;                 // 1..50
  description?: string;            // 0..2000
  isPrivate?: boolean;
  programId?: number | null;
  allowedTypeIds?: number[];       // echo of feedback-type-ids; enforced, see Security
  // anonymous path only:
  firstName?: string; lastName?: string; email?: string; mobilePhone?: string;
  returnUrl?: string;
  verificationEmailTemplateId?: number;
  // signed-in path only:
  onBehalfOfContactId?: number;
  // both:
  acknowledgementEmailTemplateId?: number | null;
}
```

Branch on `claims.sub === "public"`.

**Signed in.** Resolve contact from `claims.sub`. If `onBehalfOfContactId` is present and
differs, `isInSameHousehold` must pass. Write the entry. **Send the acknowledgement email if
configured — this path is not exempt.** The verification round-trip is what skipping
verification removes; the church's touchpoint with the submitter stays. Best effort
(`.catch(console.warn)`): the row is already saved and a mail failure must not report failure
to the congregant. Respond `200 { status: "submitted", feedbackEntryId }`.

Note which address it goes to: the acknowledgement is sent to the resolved contact's own
`Email_Address` — the `onBehalfOfContactId` target's, when one was used — not to whatever the
form's email field held. A member filing on behalf of a spouse should not have the
confirmation land in their own inbox, and if the target has no email on file the widget
already collected one (the `ShowHideEmailContainer` branch), which is also the value
`backfillContactEmail` writes.

**Anonymous.** `firstName`, `lastName`, `email` required; `returnUrl` must be same-origin
with the request `Origin`; `verificationEmailTemplateId` required. **No MP write.** Build a
`PendingFeedback` with `contactId: null`, hand it to `createPendingAction("prayer-feedback",
…, 86_400)`, compose `{returnUrl}{?|&}{verifyParam}={token}`, send the verification template.
Respond `200 { status: "verification_sent" }` — **with the same body and timing whether or
not the email matches an existing contact.** (This is where we deliberately diverge from
plan-your-visit, which answers `contactExists: true` and is an email-existence oracle on a
public endpoint. Prayer intake must not have one.)

#### `POST /api/embed/prayer-feedback/verify`

Body `{ token: string }`. `POST`, not `GET`, so the token never lands in a server access log
or a `Referer`. `consumePendingAction` → on `ok`, `createFeedbackEntry`, then
`backfillContactEmail` if a `contactId` was carried, then the acknowledgement (best effort).
Respond `200 { status: "verified", feedbackEntryId }`.

### Error codes

Existing (already in all three catalogues — reuse, do not re-add):
`auth_required`, `invalid_request`, `validation_failed`, `rate_limited`, `internal_error`,
`contact_not_found`, `not_household_member`.

**New — 9 codes, needing an `errors.*` entry in `en`, `es` and `pt-BR` or
`error-codes.test.ts` fails:**

| Code | Status | When | English |
|---|---|---|---|
| `feedback_type_not_allowed` | 422 | posted type is outside the widget's allowlist | "That option is not available on this form." |
| `feedback_type_not_found` | 422 | posted type is not in `Feedback_Types` | "That option is no longer available. Please choose another." |
| `template_not_configured` | 422 | anonymous submit with no verification template | "This form is not fully configured. Please contact the church." |
| `invalid_return_url` | 400 | `returnUrl` not same-origin with `Origin` | "That request was not valid. Please try again." |
| `email_send_failed` | 502 | template missing, no `From_Contact`, or send threw | "We could not send the confirmation email. Please try again." |
| `verification_invalid` | 400 | envelope signature bad, `kind` wrong, or malformed | "This link is not valid. Please submit the form again." |
| `verification_expired` | 410 | envelope `exp` in the past — proved from the signature, no store read | "This link has expired. Please submit the form again." |
| `verification_used` | 409 | envelope valid, store key absent (legacy `feedbackAlreadyVerified`) | "This request has already been submitted. Thank you!" |
| `feedback_save_failed` | 502 | the MP insert failed | "We could not submit your request. Please try again." |

All nine are named identically to their catalogue key, so `WIRE_CODE_KEYS` needs no entry.

---

## Widget

`packages/embed-sdk/src/components/prayer-feedback.ts`, extending `MPNextWidget`.

```ts
connectedCallback() {
  this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
  void this.initLocale().then(() => { this.render(); this.init(); });
}
```

`initLocale()` before the first `render()` — non-negotiable, and free here because the widget
paints a loading state while it fetches the type list. It defines **no** `disconnectedCallback`
in v1; if one is added later it must call `super.disconnectedCallback()`.

### States

| State | Renders |
|---|---|
| `loading` | spinner + `common.loading` — while `GET /types` and (when signed in) the submitter options resolve |
| `form-anonymous` | first / last / email / mobile phone + type / summary / details / private + submit |
| `form-signed-in` | "Provide Feedback As" `<select>` (self default, household members, then a blank-form option) + type / summary / details / private. Name/email/phone hidden; **email shown and `required` only when the selected member has no email on file** (legacy's `ShowHideEmailContainer`) |
| `submitting` | submit disabled, label `common.submitting`. Disable via the `disabled` property, not `pointerEvents: none` + grey background the way legacy does — that leaves a keyboard user able to submit twice |
| `verification-sent` | `prayerFeedback.verificationSent`, form hidden (legacy hides both form and description) |
| `submitted` | `prayerFeedback.submitted` (signed-in path) |
| `verified` | `prayerFeedback.verified` — page loaded with `?mpp-verify-id=` and the redeem succeeded; the form never renders in this mode |
| `error` | `this.errorText(payload)` in an alert region, with `common.retry`. **Never** renders the server's English `message` |
| `unconfigured` | anonymous + no `verification-email-template-id`: `prayerFeedback.notConfigured` and no submit button, so a misconfigured page fails visibly at load rather than after a visitor has typed 2000 characters |

There is **no signed-out dead end** — the whole point of the widget is that a stranger can
use it. `CROSS-1` does not apply; do not add a sign-in gate. A sign-in *affordance* is fine
and useful (it turns the round-trip off), so render `common.signIn` via `requestLogin()` as
an aside above the anonymous form, not as a replacement for it.

Events emitted (mirror the registry entry): `feedbackSubmitted`, `verificationSent`,
`feedbackVerified`, `feedbackError`, `loginRequired`.

### i18n

**Namespace `prayerFeedback`, in `people.ts`.** Justification: `Feedback_Entries` is a
contact-keyed care record, and this widget's copy is field labels that already live in
`fields.*` / `validation.*` — the same profile as the three widgets `people.ts` already holds
(`myHousehold`, `profile`, `onlineDirectory`), whose header says exactly that. A seventh
domain file (`care.ts`) would need creating in three locales plus an `index.ts` edit in each,
for one namespace with no sibling coming. Precedent for loose grouping: `planYourVisit` and
`customForm` live in `groups.ts`.

**Reuse before adding** — these already exist and must not be duplicated:
`common.loading`, `common.submit`, `common.submitting`, `common.retry`, `common.signIn`,
`common.optional`, `common.dismiss`, `fields.firstName`, `fields.lastName`, `fields.email`,
`fields.mobilePhone`, `validation.required`, `validation.email`, `validation.phone`,
`validation.tooLong`, `validation.formIncomplete`.

New keys (`en` shown; `es` / `pt-BR` seeded from
`DatabaseScripts/ApplicationLabels/mpp-prayer-feedback-form.json`, both `satisfies Messages`):

```ts
prayerFeedback: {
  title: "Prayer & Feedback",
  lead: "Complete the form below to request prayer, share a praise report, or send us other comments and feedback.",
  feedbackType: "Feedback Type",
  selectType: "Select…",
  summary: "Summary",
  summaryHint: "A short title for your request.",
  details: "Details",
  private: "Keep this private",
  privateHint: "Only church staff will see this request.",
  provideFeedbackAs: "Provide Feedback As",
  blankForm: "Someone else",
  signInHint: "Signed in? We'll skip the email confirmation step.",
  notConfigured: "This form is not fully configured. Please contact the church.",
  verificationSent: "Check your email and follow the link to confirm your request.",
  submitted: "Your request has been submitted. Thank you!",
  verified: "Your request has been submitted. Thank you!",
  charactersLeft: { one: "{count} character left", other: "{count} characters left" },
}
```

`submitted` and `verified` share their English wording but stay two keys: they are two
distinct moments a church may want to word differently (and `MPNextEmbed.setMessages` is
per-key), and collapsing them would force a rename the first time one changes.

**`charactersLeft` is the one plural, and `es` / `pt-BR` must supply `many`.**
`Intl.PluralRules("es").resolvedOptions().pluralCategories` includes `many` (whole millions),
so a two-branch plural fails `catalogue-parity.test.ts` for both locales. Copy the shape of
`account.myInvoices.invoiceCount`, which already does this:

```ts
charactersLeft: { one: "queda {count} carácter", many: "quedan {count} caracteres", other: "quedan {count} caracteres" }
```

### Form validation

Through `shared/form-validation.ts` only — `validateForm(form, { t: this.t, … })` and
`bindLiveValidation`. No `reportValidity()`, ever.

| Field | Control | Rule |
|---|---|---|
| First name | `text` | required (anonymous, or blank-form) |
| Last name | `text` | required (anonymous, or blank-form) |
| Email | `type="email"` | required when visible; native + `validation.email` |
| Mobile phone | **`type="tel"`** | optional. No `pattern` — C24 is the cautionary tale: MP's display mask `xxx-xxx-xxxx` used as a regex made `next-plan-your-visit` unsubmittable |
| Feedback type | `select` | required |
| Summary | `text maxlength="50"` | required; `validation.tooLong` at 50 |
| Details | `textarea maxlength="2000"` | optional; live `charactersLeft` counter |
| Private | `checkbox` | never required |
| Provide Feedback As | `select` | required when rendered (legacy marks it so) |

Every control gets a programmatic name via a real `<label for>` — C28 is open against
`next-plan-your-visit` and `next-custom-form` for exactly this; do not add a third.

---

## Shared primitives needed

Consume, do not build. Precise asks:

### 1. `MessageTemplateService` — **already built; consume it as it exists**

Landed as `src/services/messageTemplateService.ts` in `d05d3e5`, extracted from
`planYourVisitService.ts:574-676` with all three of its call sites delegating. The four
requirements I asked for (escape-by-default, distinct error classes, `[token]` bracket form,
both table sources) are being folded in by the integration owner. The API this plan consumes:

```ts
import { MessageTemplateService } from "@/services/messageTemplateService";

export interface TemplateRecipient { email: string; name: string }
export type TemplateMergeData = Record<string, string>;

const templates = await MessageTemplateService.getInstance();

// dp_Communications ids — what this widget's two attributes hold.
await templates.sendMessageTemplate(templateId, { email, name }, merge);

// dp_Communication_Templates ids — not used here, listed so nobody adds a `source` flag.
await templates.sendCommunicationTemplate(templateId, { email, name }, merge);

/** Exported for tests: substitute without sending. */
renderTemplate({ subject, body }, merge): { subject: string; body: string };
```

**Two shape notes, so the plan matches reality rather than my sketch.** The two template
tables stay **two named methods**, not one call with a `source` flag — the caller always knows
which kind of id it was handed, and a flag only creates a way to get it wrong (the committed
doc comment makes this argument and it is correct). And the recipient is `{ email, name }`, in
that field order.

**Both calls in this widget are `sendMessageTemplate`.** `verification-email-template-id` and
`acknowledgement-email-template-id` are both documented to churches as `dp_Communications`
ids, matching legacy's `verificationemailtemplate` (whose configurator entry declares
`fkTable: "dp_Communications"`, `mpp-prayer-feedback-form.js:37`).

**What this widget needs from the pending revision:**

1. **HTML-escaped merge values, by default, no opt-out.** This is the one requirement I
   genuinely depend on: `mpp_feedback_summary` is congregant-authored free text going into a
   template `Body` that lands in a staff mailbox. Escape-by-default is safe for
   `mpp_verify_email_url` too — `&` → `&amp;` is correct inside an `href`.
2. **Distinct error classes**, so `/submit` can answer `template_not_configured` (template id
   not found) vs `email_send_failed` (send threw, or no usable From contact) without
   string-matching a message. Today both surface as bare `Error`.

**I am dropping my `fromContactId` fallback request.** `resolveFromAddress` refuses a fallback
*on purpose*, and its committed rationale — "an email that appears to come from the wrong
person is worse than an email that does not send, and the failure points straight at the
template the church needs to fix" — is exactly right for a prayer acknowledgement. A pastoral
email apparently from the wrong staff member is worse than a missing one. Leave it as it is;
the loud failure maps cleanly onto `email_send_failed`, which is what the widget renders.

**Other consumers:** C70 (verification), C11 `group-details.md` (inquiry/signup),
C66 `checkout-pay.md` (receipt).

### 2. A pending action: **signed envelope + payload sealed in the store** — ruled 2026-09-09

Not a generalised `verify-token.ts`. That module puts the payload in the JWT, which works for
plan-your-visit's three short strings and does not work here: our payload carries up to 2000
characters of description plus a title, so the token runs to roughly 3KB and the emailed URL
with it — through mail clients, link rewriters and Outlook Safe Links, none of which are
reliable at that length. A self-contained JWT is also *replayable for its full 24 hours*,
which is the hole legacy tried to plug with its broken content-comparison duplicate guard.

Nor is it the pure opaque-handle store I first proposed. **That design cannot honestly produce
`verification_expired`**: an absent key conflates expired with never-existed, and a used-token
tombstone only separates `used` from "absent" — it does not separate expired from bogus. The
ruling is the hybrid, and it is better than either half:

```ts
// src/lib/embed/pending-action.ts
export type PendingActionKind = "prayer-feedback" | "publication-verify" | "unsubscribe";

/**
 * Seals `data` (AES-256-GCM) into the store under `jti`, and returns a signed
 * envelope carrying only `{ kind, jti, exp }` — so the URL stays short.
 */
export function createPendingAction<T>(
  kind: PendingActionKind,
  data: T,
  ttlSeconds: number,
): Promise<{ token: string }>;

export function consumePendingAction<T>(
  kind: PendingActionKind,
  token: string,
  schema: ZodType<T>,
): Promise<
  | { ok: true; data: T }
  | { ok: false; reason: "invalid" | "expired" | "used" }
>;
```

**Four outcomes, each with a real producer — which is the whole point:**

| Check | Result | Route answers |
|---|---|---|
| bad signature, wrong `kind`, malformed | `invalid` | `verification_invalid` |
| `exp` in the past — **proved from the signature alone, no store read** | `expired` | `verification_expired` |
| signature and `exp` good, store key absent | `used` | `verification_used` |
| store hit | atomic `kvGetDelete` → consume | `200 { status: "verified" }` |

The second row is the one that earns its keep twice over: it produces the third code honestly,
**and an expired link costs neither a store round-trip nor a rate-limit slot** — the cheapest
possible answer to the most likely bogus request. Verify the envelope, then rate-limit, then
touch the store, in that order.

Notes for whoever builds it:

- `EmbedSessionStore.kvGetDelete(key)` (`session-store.ts:55`) is the atomic burn; single-use
  is by construction, not by a tombstone. Store under `nw:kv:pending:<sha256Hex(jti)>` so the
  raw `jti` never appears as a Redis key.
- Sign with the existing `EMBED_JWT_SECRET` / `JWT_ALGORITHM` from `lib/embed/jwt.ts`. `jose`
  and WebCrypto only — no new dependency.
- **`kind` is checked on consume**, and belongs in *both* the signed envelope and the sealed
  record, so neither a swapped envelope nor a swapped store key can redeem a token at the
  wrong route.
- **Fail closed.** `rate-limit.ts` deliberately fails open when the store is unreachable; this
  must not. A store error on consume is `internal_error`, never a successful write — the
  failure mode of getting this backwards is a duplicate prayer entry on every retry.
- `verify-token.ts` **stays untouched**, accepting `typ: "pyv-verify"`. Links already in
  people's inboxes must keep working, and there is no reason to migrate plan-your-visit.
- The store record's TTL and the envelope's `exp` are set from the same `ttlSeconds`. If they
  ever drift, the envelope must be the shorter of the two, or `expired` becomes unreachable
  and `used` starts absorbing genuinely expired links.

### 3. The anonymous-write route convention

I need it to settle exactly four things, and I will follow whatever it says:

1. **Rate limiting**, on every unauthenticated write, before any MP call:
   `checkRateLimit(key, N)` with the key `pf:ip:<getClientIp(req)>` built as a single template
   literal. I want a **much lower N than the 120/min
   default** for endpoints that send email — 5/min is my proposal — and a second bucket keyed
   on the submitted email (key `pf:email:<sha256Hex(email)>`, 3/hour) so one address cannot be
   mail-bombed from rotating IPs. The convention should name the standard buckets and limits;
   if `checkRateLimit`'s fixed 60s window cannot express "3/hour", say so and I will use a
   `nw:kv:` counter.
2. **No existence disclosure.** Identical response body and comparable timing whether the
   email is known to MP or not.
3. **Same-origin `returnUrl`** validation, shared. Both this widget and C70 email a link back
   to a caller-supplied URL, and both must reject anything not same-origin with the request
   `Origin`. One helper, not two.
4. **The response envelope.** `{ error: "<code>", message }` on failure; a `status` discriminant
   on success. Please **do not** bless plan-your-visit's `{ success: false, message }` — it is
   untranslatable at the widget and invisible to `error-codes.test.ts`.

---

## Tests

**New files:**

`src/services/prayerFeedbackService.test.ts` — `vi.mock("@/lib/providers/ministry-platform")`
with a fake `MPHelper`, in the shape of `subscriptionService.test.ts` (including the
`(PrayerFeedbackService as any).instance = undefined` singleton reset in `beforeEach`).
Asserts:

- `createFeedbackEntry` writes **exactly** the nine columns, with `Ongoing_Need: false` and
  `Approved: false` present and false;
- `Visibility_Level_ID` is `2` when `isPrivate`, `4` otherwise;
- `Program_ID` is omitted (not `0`, not `null`) when `programId` is null or `<= 0`;
- `Date_Submitted` goes through `DomainTimezoneService.toMpSqlDatetime` — assert the value is
  `YYYY-MM-DD HH:mm:ss` with no `T` and no `Z`, which is the regression that catches a
  reviewer "simplifying" it back to `.toISOString()`;
- `Description` accepts 2000 characters unmodified (the legacy 1000-char truncation is gone)
  and `Entry_Title` is capped at 50;
- match-then-create: an existing contact ⇒ no `Households` and no `Contacts` write; no match
  ⇒ Household then Contact then the entry, in that order, with `Display_Name` = `"Last, First"`;
- `backfillContactEmail` writes when `Email_Address` is null/empty and **does not** when it
  is populated;
- `isInSameHousehold` returns false across households;
- `getFeedbackTypes([1,2])` filters and caches (one MP call for two invocations);
- **`getFeedbackTypes()` with no argument excludes the removal type by id** — feed the fake
  five stock rows and assert 4 back, with 5 absent;
- **and excludes it by name when the id differs** — feed a row `{ id: 9, name: "User Removal
  Request" }` and assert it is gone. This is the assertion that proves the `/removal/i` half
  is wired, and it is the one a refactor would quietly drop;
- **`getFeedbackTypes([1,2,5])` returns type 5** and warns once — the explicit-configuration
  ruling, and the counterpart to the two above;
- a name/email containing `'` does not corrupt the `findContact` filter.

`packages/embed-sdk/src/components/prayer-feedback.test.ts` — jsdom, in the shape of
`user-menu.test.ts`. Asserts:

- the element registers as `next-prayer-feedback`;
- `initLocale()` resolves before the first paint: mount inside `<div lang="es">` and assert
  the rendered heading is never the English string at any tick;
- anonymous mount renders first/last/email as `required` and the phone as `type="tel"` with
  **no** `pattern` attribute (the C24 regression guard);
- submit with an empty required field renders an inline error and sends **no** `fetch`;
- `hide-private-option="true"` removes the checkbox and the posted body still carries the
  `default-private` value;
- an unknown `feedback-type-ids` value never appears as an `<option>`;
- with `feedback-type-ids` absent, no option whose label matches `/removal/i` renders;
- an error body `{ error: "verification_used", message: "…" }` renders the catalogue sentence
  and the English `message` appears nowhere in the shadow root — the single most important
  assertion in the file;
- with `default-private` absent and no verification template, the anonymous form renders
  `notConfigured` and no submit button;
- the character counter uses `charactersLeft` and pluralises at 1.

`src/app/api/embed/prayer-feedback/{submit,verify}/route.test.ts` — route tests do exist in
this repo (13 under `src/app`, including `src/app/api/embed/auth/exchange/route.test.ts`,
which is the closest precedent: single-use, origin-bound, rate-limited). Model on it. These
carry the security assertions, because none of them are visible from the service or the
component:

- **anonymous `/submit` performs no MP write** — assert the fake `createTableRecords` was
  never called. The single most important assertion in the plan;
- the response body and status are **byte-identical** for an email that matches a contact and
  one that does not (the no-enumeration property, and the deliberate divergence from
  plan-your-visit's `contactExists: true`);
- a `returnUrl` on another origin ⇒ `invalid_return_url`, no email sent;
- an unauthenticated caller supplying `onBehalfOfContactId` is ignored — the entry is never
  written against it (the legacy email-cannon defect, asserted as a regression guard);
- a signed-in caller supplying an `onBehalfOfContactId` outside their household ⇒
  `not_household_member`, no write;
- `/verify` returns each of the three envelope outcomes for the three token shapes —
  tampered signature ⇒ `verification_invalid`; a token minted with a past `exp` ⇒
  `verification_expired` **with the fake store never read**; a valid token whose store key was
  deleted ⇒ `verification_used`;
- a token minted for a different `kind` ⇒ `verification_invalid`;
- a store error on consume ⇒ `internal_error` and **no** write (fail-closed; getting this
  backwards means a duplicate entry on every retry);
- rate limit exhausted ⇒ `rate_limited`, no email, no write.

**Existing guard tests that fail if the work is incomplete** — all four are live gates, not
advisory:

| Test | Fails when |
|---|---|
| `packages/embed-sdk/src/i18n/no-english-literals.test.ts` | **immediately, on the first commit that adds the component.** `BUDGET` is `{}`, and the "introduces no hardcoded English in a file with no budget" case lists any unbudgeted file with a non-zero count. There is no partial landing: the widget ships fully localised or not at all. Do **not** add a budget entry to buy time. |
| `packages/embed-sdk/src/i18n/catalogue-parity.test.ts` | any `prayerFeedback` key missing from `es` or `pt-BR`, a kind mismatch, a placeholder that differs, or `charactersLeft` missing `many` in either. `tsc --noEmit` catches the keyset via `satisfies Messages`; this catches the rest. |
| `packages/embed-sdk/src/i18n/error-codes.test.ts` | any of the 9 new codes lacks an `en`/`es`/`pt-BR` `errors.*` entry, **or** a route answers with English prose in `error` (it regex-scans `src/app/api/embed/**/route.ts` for `error: "…"` and asserts `/^[a-z][a-z0-9_]*$/`) |
| `src/lib/no-template-concat.test.ts` | any `` `…` + `…` `` in the new files. Relevant twice here: composing the verify URL (`{returnUrl}{sep}{param}={token}`) and any MP filter string. Write one literal or `[…].join("")` — never `+`. The MP-filter case is the exact shape of the incident this test exists for. |

Also: `pnpm i18n:check` must be clean and `pnpm i18n:sync` run in the same commit as the
catalogue additions, or the staleness baselines under `packages/embed-sdk/i18n-sources/` drift.
`pnpm lint` and `pnpm test:run` before the PR.

**E2E** is out of scope for v1 and should stay out: the flow needs a real mailbox.
`e2e/widget/login-hardened.spec.ts` is the precedent for gating a spec behind credentials —
if a mail-capture endpoint appears later, a `prayer-feedback.spec.ts` follows the same shape.

---

## Security

**What an unauthenticated caller can cause.** Exactly two things: one templated email to an
address they supplied, and — only after proving they control that address — one
`Feedback_Entries` row plus, at most, one `Households` + `Contacts` pair.

**What they cannot cause.**

- **No MP write before the email is proven.** `POST /submit` on the anonymous path performs
  zero writes. This is the single most important property of the design and the reason
  option D is safe: unverified traffic cannot create Contacts.
- **No entry against another person.** `Contact_ID` is never accepted from an unauthenticated
  caller — the legacy hole (`PrayerFeedbackApiController.cs:66` `[AllowAnonymous]` +
  `formData.ContactId`). Signed-in callers may target a household member, and only after
  `isInSameHousehold` passes server-side.
- **No email cannon.** Legacy would mail any contact chosen by numeric id. Ours mails only an
  address the caller typed, so the worst case is mailing an address the attacker already
  knows — and the rate limits above cap the volume.
- **No `feedback-type-ids` bypass — and no pretence that there is a boundary.** The allowlist
  is a host-page attribute, so the widget echoes it and the server **must not trust it** as a
  security boundary: a caller can send any `allowedTypeIds`. It is enforced as a *correctness*
  check (a stale form posting a removed type gets `feedback_type_not_allowed`), while
  `isKnownFeedbackType` is the real guard against a bogus FK. Anyone wanting a hard
  restriction is asking for server-side tenant config, which is out of scope — say that
  plainly rather than implying the attribute restricts anything.
  **The removal-type default is a safety default, not a control.** A determined caller can
  post the removal type directly, because MP's own FK accepts it and it is a legitimate value
  in the table. What the default buys is that no church accidentally *offers* a data-deletion
  request channel to visitors, which is the realistic failure — not that the id is unreachable.
- **An expired link is answered without touching the store or a rate-limit slot** — the
  envelope's `exp` is checked from the signature first. The cheapest possible reply to the
  most common bogus request, and it means link-scanning traffic cannot exhaust either budget.
- **No unmoderated publication.** `Approved = false`, always, with no attribute to change it.
- **No enumeration or existence disclosure.** `POST /submit` answers
  `{ status: "verification_sent" }` regardless of whether the email matches a contact.
  `POST /verify` returns `verification_invalid` / `verification_used` for a token, never
  anything about a person. There is no endpoint that takes an email and reports a fact about
  it. This is a deliberate divergence from plan-your-visit's `contactExists: true`.
- **No token in a log.** `/verify` is `POST`, so the handle is in a body, not a query string,
  a `Referer`, or an access log.
- **No stored XSS into staff mailboxes**, given primitive 1's escaping.
- **No SQL string injection.** Every MP filter built from user input goes through
  `sqlLiteral()`-style escaping, as `planYourVisitService` already does. Legacy interpolated
  `Entry_Title` and `Description` into its filter; that code is not being ported.

**Rate limits** (subject to the convention in primitive 3): `pf:ip:<ip>` at 5/min on `/submit`
and `/verify`; `pf:email:<sha256>` at 3/hour on `/submit`. `/types` inherits the default.

**One thing to write down for churches, not solve in code.** `Visibility_Level_ID = 4`
(Public) is legacy's default for a non-private submission, and this widget keeps it. Combined
with `Approved = false` nothing publishes automatically — but a church that later builds a
prayer-wall page filtering on visibility alone would expose them. The migration note should
say: filter on `Approved = 1 AND Visibility_Level_ID = 4`, not visibility alone.

---

## Settled by ruling — 2026-09-09

Recorded here so nobody reopens them, and because two of the three changed the design.

1. **`feedback-type-ids` default: every `Feedback_Types` row except the removal type**, by
   `Feedback_Type_ID <> 5` **and** a `/removal/i` name match, so the guard survives a domain
   where the id differs. Not the hardcoded `1,2,3` I proposed — that would hide a church's own
   custom type (`Testimony`, id 6) and assumes the stock lookup table on every domain. An
   explicit `feedback-type-ids` listing the removal type **is honoured**, with a
   `console.warn`: only the default has to be safe. Divergence from legacy, documented. Full
   detail under "The safe default" above.
2. **The signed-in path skips verification: approved** — with the acknowledgement email still
   sending on that path. The round-trip is what is being removed, not the church's touchpoint
   with the submitter.
3. **All three verification codes stay**, via the hybrid in primitive 2: a signed envelope
   carrying `{ kind, jti, exp }` with the payload sealed in the store under `jti`. My
   tombstone proposal was rejected and rightly — it separates `used` from "absent" but still
   conflates expired with bogus, so `verification_expired` would have had no honest producer.
   The envelope proves expiry from the signature with no store read, which also makes an
   expired link free of a rate-limit slot.

## Open questions

1. **Which `Household_Sources` row for a widget-created household?** The reference domain has
   no prayer-specific value; the nearest existing ones are `Website` (19) and `Plan a Visit
   Widget` (36). I propose `Website`, resolved **by name** through `getIdByValue` so a domain
   without it simply omits the column (legacy sets no source at all). If churches want
   widget-level attribution that is a new `Household_Sources` row plus a data migration, which
   is theirs to decide, not ours. *Proceeding with `Website`, omitted when absent.*
2. **`Feedback_Entries.Care_Case_ID` — for whoever works a prayer queue, not for us to guess.**
   The column exists and MP presumably has staff tooling that promotes a prayer request into a
   Care Case. Legacy never writes it (`PrayerFeedbackManager.cs:22-45` writes nine columns and
   this is not one), and neither will we. **The open question is whether MP expects the
   *submitting widget* to open the case, or whether staff do it from the Platform.** Nobody on
   this side of the port can answer that from the schema — it is a workflow question, and it
   should go to a church staffer or an MP implementation consultant who works a prayer queue,
   not be resolved by reading the table. Not blocking: writing nothing is what legacy does and
   is the reversible choice. If the answer is "the widget should", it is one extra column and a
   new attribute, not a redesign.

---

## Sequenced phases

Each phase is independently committable and leaves the suite green.

**Phase 0 — the primitives (not this widget's commit).** Partly landed already:

- ✅ `src/services/messageTemplateService.ts` — extracted in `d05d3e5`, `planYourVisitService`
  delegating at three call sites. **Still owed: escape-by-default and the distinct error
  classes**, which the integration owner is adding. Phase 4 needs the escaping; Phase 3 needs
  the error classes to distinguish `template_not_configured` from `email_send_failed`.
- ⬜ `src/lib/embed/pending-action.ts` — the signed envelope + sealed store record, with its
  own `src/lib/embed/pending-action.test.ts` asserting the four outcomes (the neighbouring
  `verify-token.test.ts` and `embed-session.test.ts` are the pattern).
- ⬜ the shared same-origin `returnUrl` helper, and the named rate-limit buckets.

**Blocks Phases 3 and 4.**

**Phase 1 — types + service + the read route.** `packages/types/src/prayer-feedback.ts`,
`prayerFeedbackService.ts` (all methods including `createFeedbackEntry`), its test file, and
`GET /types`. No widget yet, so no i18n gate. Three things get proved here:

1. the nine-column `Feedback_Entries` write, with `Approved: false` and `Ongoing_Need: false`;
2. match-then-create, including the `Household_Position_ID` and `Household_Source_ID`
   corrections legacy omits;
3. **the `Email_Address` narrowing.** `backfillContactEmail` writes **only when the contact's
   `Email_Address` is currently null or empty** — legacy overwrites unconditionally
   (`PrayerFeedbackService.cs:189`), so a typo in a prayer form silently breaks a member's
   giving statements and every other email MP sends them. Two tests, one each way. This is a
   deliberate, named divergence and not an oversight to be "fixed" back later;
4. the removal-type default, both predicates (see the three `getFeedbackTypes` assertions).

**Phase 2 — catalogue.** The `prayerFeedback` namespace and the 9 `errors.*` codes in all
three locales, `pnpm i18n:sync`. Lands *before* the component so that when the component
appears, `no-english-literals` has something to route through. Independently green:
`catalogue-parity` and `tsc` cover it, and `error-codes` will not see the codes until the
routes exist.

**Phase 3 — the signed-in path, end to end.** `POST /submit`'s authenticated branch **including
the acknowledgement email** (it is not deferred to Phase 4 — the signed-in path is the one
that has no verification mail, so the acknowledgement is its *only* touchpoint), the component
with `loading` / `form-signed-in` / `submitting` / `submitted` / `error`, the `index.ts`
four-place registration, `widgets.ts`, the demo page. Fully localised from the first line —
`BUDGET` is empty and there is no partial landing. A signed-in demo submission writes a real
`Feedback_Entries` row at the end of this phase.

**Phase 4 — the anonymous path.** `/submit`'s public branch, `POST /verify` with the three
envelope outcomes, the `form-anonymous` / `verification-sent` / `verified` / `unconfigured`
states, the verification template, the rate limits. Needs Phase 0's `pending-action.ts` and
the escaping. This is the phase whose route tests carry every security property above — the
no-write, no-enumeration and fail-closed assertions in particular.

**Phase 5 — the paperwork C69 asks for.** `CLAUDE.md` roster and counts; the `BRIEF.md` pair
table correction; the `ROADMAP` entry. Plus the customer migration note, which now has **four**
things to say, not one:

1. prayer intake has a replacement; a Custom Form is still not equivalent (it writes
   `Form_Responses`, populates no Feedback Type and no Program, and never reaches the prayer
   queue);
2. **`feedback-type-ids` omitted no longer offers every type** — `User Removal Request` is
   excluded by default. List it explicitly to get it back;
3. **signed-in submitters get no verification email** — only the acknowledgement. Fewer
   emails is the intended behaviour, not a broken template;
4. a prayer-wall page must filter on `Approved = 1 AND Visibility_Level_ID = 4`, never on
   visibility alone.

Small, and the item is not closed without it.
