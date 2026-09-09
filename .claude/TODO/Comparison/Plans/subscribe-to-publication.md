# `next-subscribe-to-publication` — plan

**Items:** C70 (functional) · Tier 1 #2 in `ROADMAP-missing-widgets.md`
**Cutover verdict: C70 blocks cutover for any church whose site has a newsletter sign-up
form** — which is most of them. There is no host-page workaround: the only route onto a
publication today is `next-subscriptions`, which 401s `sub === "public"` outright.

> **Source-availability correction.** The finding and the original brief assumed the legacy
> `/Api/SubscriptionsApi/…` endpoints were MP-hosted and unreadable. **They are on disk** at
> `S:\MP\mp-Widgets\PortalComponents\` (`Controllers\Api\`, `Services\`, `DataManagers\`,
> `Models\`, plus `DatabaseScripts\StoredProcedures\`). Everything below is read off that
> implementation with line cites, not inferred from the bundle or the table schema. That
> changed two answers materially — question 4 (`mppVerifyId` was already a stateless JWT) and
> question 1 (legacy does create contacts and households) — and it surfaced three legacy
> defects we must not port (see **Legacy defects**).

**Owns:**

Create:
- `packages/embed-sdk/src/components/subscribe-to-publication.ts`
- `packages/embed-sdk/src/components/subscribe-to-publication.test.ts`
- `packages/embed-sdk/demo-subscribe-to-publication.html`
- `packages/types/src/subscribe-to-publication.ts` (+ `.test.ts`)
- `src/app/api/embed/subscribe-to-publication/publication/route.ts` (+ `.test.ts`)
- `src/app/api/embed/subscribe-to-publication/send-verification/route.ts` (+ `.test.ts`)
- `src/app/api/embed/subscribe-to-publication/verify/route.ts` (+ `.test.ts`)
- `src/services/_shared/mp-lookup.ts` (+ `.test.ts`) — the only shared module still missing

**All five shared primitives already exist. Consume them; create none.** Every section below is
written against the code on disk, and each divergence from what an earlier draft of this plan
specified is resolved in the existing code's favour:

| Module | Landed in | See |
|---|---|---|
| `src/lib/embed/anonymous-write.ts` | `93b00fb` | Shared primitives #3 |
| `src/lib/embed/action-token.ts` | `93b00fb` | #2 |
| `src/lib/embed/pending-action.ts` | `93b00fb` | #2b |
| `src/lib/embed/rate-limit.ts` (`windowSeconds`, `failClosed`) | `93b00fb` | #2c |
| `src/services/messageTemplateService.ts` | `d05d3e5`, hardened in `de1c67b` | #1 |

`anonymous-write.ts` also supplies `isReturnUrlAllowed` and `buildReturnUrl`, so **no
`return-url.ts` promotion is needed** and `auth/_lib/auth-route-helpers.ts` is left alone.

Touch:
- `src/services/subscriptionService.ts` (+ its existing `.test.ts`) — email-keyed subscribe
- `packages/types/src/index.ts` + `index.test.ts` — barrel
- `packages/types/src/widgets.ts` — registry entry (drives both demo surfaces)
- `packages/embed-sdk/src/index.ts` — export + auto-register import
- `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/core.ts` — **one** new `errors.*` code
  (`publication_not_found`); everything else is inherited from C69 / C72 or already exists
- `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/giving.ts` — `subscribeToPublication`
- `src/app/(demo)/demo/_lib/widget-catalog.ts` — demo extras entry
- `README.md` — roster + the deliberate non-ports
- `CLAUDE.md` — element roster + re-measured counts
- `.claude/TODO/Comparison/Plans/ROADMAP-missing-widgets.md` — mark C70 picked up

---

## What legacy does

All three endpoints the client calls are `[AllowAnonymous]`
(`Controllers/Api/SubscriptionsApiController.cs:67`, `:89`, `:129`).

### 1. Load the publication, then branch on the URL

`mpp-subscribe-to-publication.js:132` calls `GetPublication(publicationid)`; at `:141` it
reads `mpp-verify-id` off `window.location.search`. Present → `_verifyEmailLink()` (`:213`);
absent → `SetupInitialForm()` (`:150`). **One element serves both hops of the double opt-in**,
distinguished only by a query param. Copy that shape.

`GetPublication` is `ApiClient.GetRecordAsync("dp_Publications", id)`
(`DataManagers/SubscriptionsManager.cs:67`) — a **bare primary-key fetch with no
`Available_Online` check**. Legacy will render a subscribe form for an internal publication.
Note the inconsistency: legacy's own signed-in list proc requires `P.Available_Online = 1`
(`DatabaseScripts/StoredProcedures/api_MPPW_SearchSubscriptions.sql:38`). We enforce the flag
on every hop (see Security).

### 2. The form

`BuildVerificationForm()` (`mpp-subscribe-to-publication.js:482`) renders First Name
(required), Last Name (required), Email (required) and Mobile Phone (optional) — `:504-507` —
plus three hidden inputs: `ContactId`, `VerificationEmailTemplateID`, `PublicationID`
(`:499-501`). Heading is `publicationDescription` with `[Publication_Title]` merged; the
publication `description` renders under it as an `<h5>`.

Signed in, `DisplayContactInfoForm()` (`:164`) shows a **"Subscribe As" household-member
dropdown** (`:493-495`, populated at `:193`), collapses the name fields to the chosen member's
values and posts that member's `ContactId`. Signed out, the dropdown is hidden.

### 3. `SendVerificationEmail` — and what `mppVerifyId` actually is

`Services/SubscriptionsService.cs:159-241`. **Design question 4 is settled by precedent:
`mppVerifyId` is a signed, self-describing JWT, not a persisted row id.**

```csharp
// SubscriptionsService.cs:196-212
var jwtPayload = new Dictionary<string, object> {
  { "firstName", … }, { "lastName", … }, { "email", … }, { "mobilePhone", … },
  { "publicationID", subscribeInitialModel.PublicationID },
  { "onBehalfId", _currentUserAccessor.GetCurrentUser()?.UserId }
};
if (subscribeInitialModel.ContactId.HasValue && contactSimple.ContactId > 0)
    jwtPayload.Add("contactId", contactSimple.ContactId);
// Set expiration to 24 hours or 1440 minutes
string jwt = _utilityService.CreateJwt(jwtPayload, null, 1440);
```

The link is `{ReturnUrl}?mpp-verify-id={jwt}` (`:164`, `:192`, `:218`). `VerifyTokenAndSubscribe`
(`:104`) does nothing but `DecodeJwt` (`:109`) and read the claims — **there is no pending table
anywhere**: `DatabaseScripts/` has no verification table, and none of the 28 `api_MPPW_*` procs
touches one.

The email goes through `EmailManager.CreateEmail(templateId, contactSimple, record)` with merge
record `{ mpp_verify_email_url, mpp_contact_first_name, mpp_contact_last_name }` (`:218-222`).
`EmailManager` reads the `dp_Communications` template and does `[token]` string replacement over
subject and body; a brand-new subscriber has no `ContactId`, so it takes the `MessageInfo`
direct-to-address branch. That is precisely what `planYourVisitService.renderAndSend` already
reimplements over MP REST.

**Notably absent from step 1: any contact lookup.** Legacy does not check whether the email is
known before emailing. That is the shape we want for anti-enumeration, and it falls out free.

### 4. `VerifyTokenAndSubscribe` → the writes

`SubscriptionsService.cs:104-157` decodes, requires `firstName`/`lastName`/`email`/
`publicationID`, then calls `SubscriptionsManager.SubscribeToPublication`
(`SubscriptionsManager.cs:155-192`):

- No `contactId` claim → `_contactManager.FindContact(firstName, lastName, email)` (`:178`),
  matching `(First_Name = f OR Nickname = f) AND Last_Name = l AND Email_Address = e`
  (`ContactManager.cs:540-562`).
- Still nothing → `SubscribeNewContactToPublication` (`:292-331`): **creates a Contact, creates
  a Household, associates them, re-finds the contact, then subscribes.** `CreateContact` writes
  `Company:false, Status, Household_Position_ID, Mobile_Phone, Email_Address, Gender_ID,
  First_Name, Last_Name, Nickname, Display_Name` (`ContactManager.cs:625-648`).
  `CreateHousehold` is passed only `Name = lastName` (`SubscriptionsManager.cs:315-318`), so
  `Congregation_ID`, `Address_ID` and `Household_Source_ID` all go in null
  (`HouseholdManager.cs:180-195`).
- Contact found (or supplied) → `SubscribeContactToPublication` (`:333-352`) →
  `SubscriptionManager.AddOrUpdate` (`SubscriptionManager.cs:120-152`), which selects
  `dp_Contact_Publications` by `Contact_ID` + `Publication_ID` and **updates if present, creates
  if not**. The operation is already idempotent upstream.
- Finally, for a *known* contact, `UpdateContactEmail(contactId, email)`
  (`SubscriptionsService.cs:147-150`) — legacy **overwrites the contact's email address with the
  one typed into the form.** See Legacy defects; do not port this.

**No stored procedure is involved in any write.** `api_MPPW_SearchSubscriptions.sql` is the only
subscription proc and it is a read for the signed-in list widget. So hand-rolled table CRUD
through `MPHelper` is the correct shape here, matching legacy's own `SubscriptionsManager`.

### 5. Legacy copy

`DatabaseScripts/ApplicationLabels/mpp-subscribe-to-publication.json` — 13 labels, each already
carrying `english`, `spanish`, `chinese` and `portuguese`. See **i18n**: this is a vetted
translation seed for two of our three locales.

---

## Legacy defects — do not port these

Reading the server turned up three, and they are the reason this widget is a rewrite rather
than a transcription. **`grep -rn "RateLimit\|Throttl\|EnableRateLimiting" --include=*.cs`
across the whole solution returns zero hits.** Nothing in legacy is rate-limited.

### D1 — an anonymous endpoint that rewrites any contact's email address: account takeover

**Stated plainly, because it is the most serious finding in this comparison pass: legacy exposes
an unauthenticated HTTP endpoint that lets any caller set an arbitrary contact's email address to
one they control. On an email-identified IdP that is an account-takeover primitive, not a
data-integrity bug.** The regression guard for it is a route-test assertion, not a comment (see
Tests).

`SubscribeToPublicationModel.ContactId` is `[FromForm]`-bound (`Models/SubscribeToPublicationModel.cs:10`)
on an `[AllowAnonymous]` endpoint (`SubscriptionsApiController.cs:127-129`). The client fills it
from a hidden input (`mpp-subscribe-to-publication.js:499`). The service copies it, unvalidated,
straight into the signed token (`SubscriptionsService.cs:205-207`), and `VerifyTokenAndSubscribe`
then does:

```csharp
// SubscriptionsService.cs:144-150
await _subscriptionsManager.SubscribeToPublication(contactId, firstName, lastName, email, …);
if (contactId.HasValue)
    await _contactManager.UpdateContactEmail(contactId.Value, email);
```

So an unauthenticated caller can POST
`ContactId=<any>&EmailAddress=attacker@evil.example&FirstName=x&LastName=y`, receive the
verification email **at their own address**, click their own link, and **have MP set that
contact's email address to theirs**. On an email-identified IdP that is a password-reset
takeover, driven entirely from a public form.

**Our design forecloses it structurally, not by validation:** no `contactId` claim in the token
at all, no `Contacts.Email_Address` write ever, and the contact is resolved *from the verified
email address* rather than named by the caller. There is a regression test for the email write
specifically, because "restore parity" is the obvious way to reintroduce it.

### D2 — an unauthenticated email cannon, and an unvalidated link inside it

The same defect C69's planner found in `PrayerFeedbackApiController`. Here it is worse, because
`ReturnUrl` is also client-bound (`SubscribeToPublicationModel.cs:24`) and is interpolated into
the email with **no validation of any kind**:

```csharp
// SubscriptionsService.cs:164
subscribeInitialModel.VerifyEmailUrl = $"{subscribeInitialModel.ReturnUrl}?mpp-verify-id=";
```

So an attacker can make the church's own mail server send a church-branded email, to an address
of their choosing, containing a link to a site of their choosing — a phishing kit with the
church's deliverability reputation attached. Unlimited, unauthenticated, unlogged.

**Ours:** the return URL must be same-origin with an allowlisted request Origin (Q5), the body
carries no attacker-controlled free text, and both hops are rate-limited on two keys before any
MP call.

### D3 — `Unsubscribe` takes a bare `Contact_Guid` off the query string

Not this widget, but the same controller, and C72 inherits it:
`Unsubscribe(string contactGuid, int publicationId)` is `[AllowAnonymous]`
(`SubscriptionsApiController.cs:118-125` → `SubscriptionsManager.cs:227-289`). Anyone holding or
harvesting a contact GUID can unsubscribe anyone. This is exactly what
`ROADMAP-missing-widgets.md` warns about under "Sealed anonymous action tokens". **Flagged here
so C72's plan does not have to rediscover it**, and it is the strongest argument for the shared
signed-token primitive.

---

## The six design questions

### Q1 — A verified email that matches no MP contact

**Recommendation: create a minimal Contact + Household, as legacy does.**

Refusing is not defensible. "Sign up for our newsletter" exists for exactly the visitor with no
MP record, and the finding's own argument is that requiring a login "converts a one-field form
into a registration funnel". Legacy has created these records for years
(`SubscriptionsManager.cs:292-331`), so churches' data-hygiene expectations already assume it,
and `dp_Contact_Publications.Contact_ID` is a required FK (`mp_lookup`) — there is no
email-only subscription row to fall back on.

Three deliberate improvements over legacy:

1. **Set `Email_Verified: true`.** `Contacts.Email_Verified` is a required boolean (schema
   confirmed). A double opt-in is precisely the evidence that column exists to record, and
   legacy leaves it default. Cheapest quality win in the item.
2. **Match on email alone, not name + email.** Legacy's `FindContact` requires first, last *and*
   email to agree, so "Bob Smith" signing up when MP holds "Robert Smith" at the same address
   creates a duplicate. A subscription is keyed to a mailbox, not to a spelling. So
   `findContactIdByEmail(email)` → `Email_Address = '<email>' AND Company = 0 AND
   Contact_Status_ID <> 3`, ordered by `Contact_ID`, `top 1`; create only when that is empty.
   Deterministic, and it stops the duplicate-contact bleed.
3. **Populate the household properly.** `Household_Source_ID` = id of
   `Household_Sources.Household_Source = 'Website'` (19 on the reference instance; resolved by
   value, **field omitted when absent**, never hard-coded), and `Congregation_ID` from the
   publication's own `dp_Publications.Congregation_ID` when non-null. Legacy passes both null,
   so staff cannot tell a widget-created contact from a hand-typed one.

No `Participants` row and no milestone — a newsletter subscriber is not a participant. Legacy
agrees; noting it so nobody adds one by analogy with Plan Your Visit.

### Q2 — A verified email matching an existing contact

Subscribe that contact and say nothing about it. The step-1 response is byte-identical either
way (Q6), and the step-2 confirmation renders the same sentence. **Never write
`Contacts.Email_Address`** (D1).

### Q3 — Already subscribed to that publication

**Idempotent upsert, one success state.** `subscribeEmailToPublication` selects
`dp_Contact_Publications` on `Contact_ID` + `Publication_ID`:

- no row → create `{ Contact_ID, Publication_ID, Unsubscribed: false }`
- row with `Unsubscribed: true` → update `{ Contact_Publication_ID, Unsubscribed: false }`
- row with `Unsubscribed: false` → **write nothing**, return `alreadySubscribed: true`

The visitor sees `subscribeToPublication.verified` either way — *"You'll start receiving {title}
at {email}."* No "you were already subscribed" variant: nothing actionable differs, a
double-clicked link is the common cause, and one string is one string to translate three times.
`alreadySubscribed` **is** in the JSON and in the `subscribed` event detail so a host page's
analytics can distinguish them — safe, because the caller has already proven mailbox control.

Never write `_Synced_List_Name` or `_Unsubscribe_Sync_Pending`; underscore-prefixed columns are
MP-managed (the MailChimp sync owns them).

### Q4 — Double opt-in with no server-side pending table

**Recommendation: a signed, self-describing token. Not a close call — legacy made the same
choice, and the source proves it.**

`mppVerifyId` was a 24-hour HS256 JWT (`SubscriptionsService.cs:212`, `UtilityService.cs:46-55`)
with no backing table anywhere in `DatabaseScripts/`. The brief's open question resolves to
"legacy did it the stateless way too".

The affirmative case, independent of precedent:

- A pending table would be a new MP table (a schema change per customer — a non-starter) or a
  Redis row. Redis is `getSessionStore()`, which is **in-memory in dev and on any deploy without
  `UPSTASH_REDIS_REST_URL`** — so a pending row minted before a restart strands the visitor's
  link, and the failure appears only in production.
- A 24-hour TTL on a store whose sliding-idle semantics are tuned for 5-minute sessions is a
  poor fit.
- The operation is idempotent (Q3), so replay-until-expiry is harmless. That removes the usual
  argument for server-side state.

**Use `pending-action.ts`, not raw `action-token.ts` — single-use, store-backed.** This reverses
the position an earlier draft of this plan took, for two reasons:

1. `PendingActionKind` is `Extract<ActionTokenType, "prayer-feedback" | "publication-verify">` —
   **this widget is named in it.** The parallel C69/C72 work already decided that a flow which
   creates a `Contacts` row redeems through the store, and its header spells out why: *"only when
   that link is opened do we write anything to MinistryPlatform… without it, an unauthenticated
   POST mints rows in a church's CRM as fast as a script can manage, and MP has no good bulk undo
   for that."* Same argument, same widget.
2. **A reason their header does not give, and it is the decisive one for *this* widget:** a
   replayable token silently resurrects an unsubscribe. Visitor subscribes, later unsubscribes,
   then anything that re-fetches the old confirmation link — a mail client prefetcher, a security
   scanner, a forwarded thread, the visitor tidying their inbox — **re-subscribes them**, because
   the write is idempotent in the *subscribe* direction. Idempotency, which is what made replay
   look harmless, is exactly what makes it harmful once `Unsubscribed` can have been flipped in
   between. Single-use closes it; nothing else does.

```ts
// Step 1
const token = await createPendingAction("publication-verify", {
  email: string,          // lower-cased, trimmed, ≤254
  firstName: string,      // trimmed, ≤50, control chars stripped
  lastName: string,       // trimmed, ≤50, control chars stripped
  publicationId: number,
  origin: string,         // the request Origin at mint time — see below
}, ACTION_TOKEN_EXPIRY["publication-verify"]);

// Step 2
const result = await consumePendingAction(
  "publication-verify", token, guardPublicationVerifyData,
);
```

Three consequences, all improvements:

- **The emailed URL gets short.** The token is a signed envelope over one random `jti`, so link
  length stops depending on the payload — friendlier to mail clients and link rewriters.
- **The payload is sealed, not merely signed.** `createPendingAction` puts it through
  `seal()` (AES-256-GCM) in the store, so the visitor's own name and email are no longer readable
  by anyone who has the URL. With a self-contained JWT they were base64, in a link that sits in an
  inbox and in any forwarded copy of it. That is a real privacy gain I would not have got from
  `action-token.ts` alone.
- **A fourth outcome appears**, `used`, and it needs its own copy and its own error code — see
  the honest cost, below.

Expiry comes from `ACTION_TOKEN_EXPIRY["publication-verify"]` = **3 days**, against legacy's 24
hours, with that module's reasoning (*"newsletter sign-ups sit in inboxes"*). Adopt it; record the
divergence from legacy in the migration notes.

**The honest cost of single-use.** A visitor who clicks the link twice — or clicks it on their
phone after already confirming on a laptop — gets `used`, not a second confirmation, because the
payload is burned and we no longer know which publication or address it was. The stateless design
would have shown a cheerful second `verified`. Mitigation, no module change: the `used` state
renders `linkUsed` — *"That link has already been used. If you confirmed your subscription,
you're all set."* — plus the `managePreferences` link, which is where someone genuinely unsure
should go. That is a worse two-click experience in exchange for closing the resurrect-an-
unsubscribe hole, and it is the right trade.

**`unavailable` fails closed and is retryable.** `consumePendingAction` returns `unavailable`
rather than redeeming when the store is unreachable, and in that path the record is **not**
burned — so this maps to `internal_error` and the widget's `error` state, whose retry re-POSTs the
link again shortly, not to sign up again.

**Two claims legacy had that we drop:**

- `contactId` — resolve the contact from the email at verify time instead. This is the structural
  half of the D1 fix: a token that names a contact row is a contact-scoped write credential
  sitting in an inbox; a token that names only an email address is not.
- `onBehalfId` — it existed to attribute the write to the signed-in user, and it only has meaning
  alongside the "Subscribe As" dropdown, which we are not porting.

**One claim legacy did not have and we add:** `origin`, checked at verify time against the
request `Origin`. Without it, a token minted on church A's page verifies from church B's page.
Both origins are in the allowlist, so `requireWidgetAuth` alone will not catch it, and
`action-token.ts` has no notion of origin.

**This needs no change to either shared module.** `origin` goes in the sealed `data`, the route's
`guard` requires it to be a non-empty string, and the route then compares
`data.origin !== origin` → `verification_invalid`. Sealed and signed, so unforgeable; checked by the
caller, so both shared modules stay as written. **Worth proposing as a shared convention** — "any
anonymous action minted on a host page carries the minting origin in its payload and the redeeming
route compares it" — because C72's unsubscribe capability is at least as replay-worthy across
origins. That is a joint call, not a change I should force (Open question 10).

### Q5 — `return-url` safety

The link goes into an email, the URL comes from host-page markup, and legacy validated it not at
all (D2). So the host page is the threat model and the attribute is not trusted.

**The rule is already implemented — use `isReturnUrlAllowed(candidate, origin)` from
`anonymous-write.ts`.** Two conditions, both required:

1. The request `Origin` must already be in `EMBED_ALLOWED_ORIGINS`. `withAnonymousWrite` →
   `requireWidgetAuth` enforces that before the handler body runs, and the widget JWT's own
   `origin` claim must match it. That is the trust anchor: *an origin we allowlisted is an origin
   we are willing to put in an email.* It is not "our origin" — the host page is a third-party
   church site — it is "an origin we already decided to serve".
2. `isReturnUrlAllowed` requires `url.origin === originUrl.origin`, **`https:` only** (with an
   explicit `http:` exemption for `localhost` / `127.0.0.1` / `[::1]` so a dev page still works),
   and **refuses any URL carrying credentials** — `url.username || url.password` → false.

That last clause is stricter than the `URL.origin`-only reasoning an earlier draft relied on, and
better: `https://church.example@evil.example` is refused outright rather than merely parsing to
the wrong origin. Its comment names the exact threat — *"an open-redirect vector aimed at a
church's own congregation: the church's domain sends the mail, so the link inherits its
credibility"* — which is **D2 designed out at the primitive level**.

Two adjustments to what an earlier draft of this plan proposed:

- **Do not strip `search`.** Use `buildReturnUrl(returnUrl, param, token)`, which is
  `URL.searchParams.set` — so a host page whose landing URL legitimately carries `?page=2` keeps
  it, and a host that tries to smuggle a second copy of the verify param gets it **overwritten**
  rather than duplicated. `set` handles the collision concern that motivated stripping, and does
  it without breaking legitimate params. Its own note explains the other half: hand-rolled
  `?`/`&` chains have produced double-encoded tokens in this codebase's ancestry.
- **HTML-escaping is not my concern any more.** `messageTemplateService.renderTemplate` escapes
  every merge value unconditionally (`messageTemplateService.ts:185`), and `d05d3e5` migrated
  `planYourVisitService` onto it, so PYV's unescaped-merge hole is closed too.

Still mine to enforce in the route: **cap `returnUrl` at 2048 chars** and reject control
characters before calling `isReturnUrlAllowed` (it validates shape, not length).

**Default when the attribute is absent:** the current page URL minus query and fragment — the
fallback `plan-your-visit.ts:99-107` already uses. Legacy marks `returnurl` required; we do not
need to, and one fewer required attribute is one fewer way to misconfigure.

### Q6 — No enumeration, no existence disclosure

**The mechanism: step 1 does not look up the contact at all.** Not "looks it up and hides the
answer" — does not perform the query. Contact resolution happens on the verify hop, after the
caller has proven mailbox control, which is also where legacy does it
(`SubscriptionsService.cs:144`). There is no branch to leak and no timing difference to measure:
step 1 is constant work — validate → mint → read template → send.

`POST …/send-verification` answers **202 with `{ "ok": true }`** for every accepted submission:
known address, unknown address, already-subscribed address, undeliverable address. Identical
status, identical body, identical headers. The only non-2xx responses are facts about the
*request or the host's configuration*, never about a person.

**Call-out, as required.** `src/app/api/embed/plan-your-visit/send-verification/route.ts:78-83`
returns:

```ts
{ success: false, contactExists: true, message: "An account already exists for that email." }
```

That is an existence oracle. Any anonymous caller with an allowlisted origin can test arbitrary
email addresses against the church's contact database, one per request, up to the default
120/min limit, and get a clean boolean back. **This widget must not repeat it, and the PYV route
needs its own item.** It is not a drop-in fix — PYV's UX depends on the branch to offer sign-in,
so the honest repair is to *send* a "you already have an account, here is a sign-in link" email
and return the same uniform 202. Filed as Open question 3; out of scope here.

Secondary channels closed:

- `publication_not_found` is returned for **both** a nonexistent publication and one that is not
  `Available_Online`, so the id space cannot be probed for internal publications.
- No route in this widget returns any contact field. The verify response carries the publication
  title, the echoed email from the token, and booleans.
- The widget renders `this.errorText(payload)` and never the English `message`, so a server
  string cannot leak into the page.

---

## Attribute surface

Kebab-case, per `C79` / `CROSS-4` ("widget attributes are kebab-case", plus the proposed guard
test asserting `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`). This element has no deployed markup, so
**there is no legacy alias to accept** — `CROSS-4`'s one-release alias applies to renames of
shipped attributes, not to a new element.

| New name | Legacy | Required? | Meaning |
|---|---|---|---|
| `publication-id` | `publicationid` (required) | **yes** | `dp_Publications.Publication_ID`. Must be `Available_Online`. |
| `verification-email-template-id` | `verificationemailtemplateid` (required) | **yes** | `dp_Communications.Communication_ID` for the verification email. |
| `return-url` | `returnurl` (required) | no | Where the verification link lands. Defaults to the current URL minus query and fragment. Must be same-origin with the request (Q5). |
| `verify-param-name` | — (hard-coded `mpp-verify-id`) | no | Query param carrying the token. Default **`nextwidgets_verify`** (ruled 2026-09-09 — see below). Also must differ from `next-plan-your-visit`'s so two verify widgets on one page cannot both consume the same token. |
| `my-subscriptions-url` | — (legacy `mpp-unsubscribe`'s `mysubscriptionswidgettargeturl`) | no | Rendered as "Manage all your email preferences" on the verified state. Closes the loop into `next-subscriptions`, and is the same link C72 needs. |
| `recaptcha-site-key` | — | no | Opt-in bot check on step 1. Plumbing exists (`src/lib/embed/recaptcha.ts`, `widget-catalog.ts:34`). |
| `api-host` | — | no | Standard across the SDK. |

**Not ported:** the `mobilephone` field, and the signed-in "Subscribe As" dropdown — see
Deliberate non-ports.

**The `nextwidgets_verify` ruling, and the inconsistency it exposes.** The `nextwidgets_*`
convention covers *every browser-visible key the SDK owns*, and a query param on the host page is
exactly that — the enumeration in CLAUDE.md (localStorage, cookies, URL fragments) is not
exhaustive, and it is **extended to query params** (ruled 2026-09-09). Do **not** copy
`next-plan-your-visit`'s `mpp-verify-id`: `mpp-` is the legacy MP prefix that commit `8c387c1`
spent an entire change removing from client-facing keys, and a new widget reintroducing it would
undo that deliberately.

Which makes PYV's own `mpp-verify-id` an inconsistency — **and one that needs its own item, not a
rename.** Verification links carrying that param are already in visitors' inboxes with up to a
24-hour life, so PYV needs a **dual-read**: accept `nextwidgets_verify` first, fall back to
`mpp-verify-id`, and drop the fallback after the old links have expired. Its
`verify-param-name` attribute already makes the read configurable, so the change is small; it is
just not mine, and doing it as a straight rename would strand every link in flight.

Attribute handling follows `CROSS-4`: **no `oldValue !== null` guard.**
`attributeChangedCallback` is `if (oldValue !== newValue) this.reconfigure()`, where
`reconfigure()` is a no-op before first render and a re-init after. Setting `publication-id` on
a mounted element must re-render.

---

## Server

### Service — extends `src/services/subscriptionService.ts`

Extend, do not fork: that file already owns `dp_Publications` / `dp_Contact_Publications` and
the "subscribed = row exists AND `Unsubscribed` is false" rule.

**Merge hazard — C72 is extending the same file right now.** It has added
`getContactByContactGuid`, `unsubscribeByContactGuid` and `resubscribeByContactGuid` (~279
lines). My three methods are additive and do not overlap those, but **whoever lands second
rebases rather than resolving by hand**, and the shared private helpers are the collision risk:
if C72 has already added its own `sqlLiteral` / `clean` / `getIdByValue`, use theirs and drop the
Phase 1 extract to a no-op rather than introducing a second copy in one file. Check before
writing.

```ts
export interface PublicationSummary {
  Publication_ID: number;
  Title: string;
  Description: string | null;
  Congregation_ID: number | null;
}

/**
 * A publication a host page may offer for anonymous opt-in.
 * Returns null for a missing id AND for one that is not Available_Online —
 * the caller must not be able to tell those apart.
 */
public async getOnlinePublication(publicationId: number): Promise<PublicationSummary | null>;

/** Contacts.Contact_ID owning `email`, or null. Email-only match (Q1.2). */
public async findContactIdByEmail(email: string): Promise<number | null>;

/**
 * Resolve-or-create the contact owning `email`, then upsert its
 * dp_Contact_Publications row for `publicationId` to Unsubscribed = false.
 * Idempotent. The returned booleans are for logging and host-page analytics,
 * never for a branch in the visitor-facing copy.
 * NEVER writes Contacts.Email_Address (see D1).
 */
public async subscribeEmailToPublication(args: {
  email: string;
  firstName: string;
  lastName: string;
  publicationId: number;
}): Promise<{ contactId: number; contactCreated: boolean; alreadySubscribed: boolean }>;
```

Private: `createSubscriberContact`, `createSubscriberHousehold`, `upsertContactPublication`.

**`getOnlinePublication` is strict: `Publication_ID = <n> AND Available_Online = 1`, `top 1`. No
`OR Available_Online IS NULL`, and this deliberately diverges from `getSubscriptions` in the same
file — do not "tidy them up" into agreement** (ruled 2026-09-09).

The reasoning, recorded so it survives the next reader: **they are different trust surfaces.**
`getSubscriptions` backs a signed-in management view of publications the member may already be
on, where showing an unflagged row is at worst untidy. This is an **anonymous write** that puts a
stranger onto a mailing list, and treating an unset flag as "yes, publish this" is the wrong
default on that side of the line. The failure mode is also benign here in a way it is not there:
this widget takes **one explicit `publication-id` from host markup**, so a NULL flag surfaces as
a `publication_not_found` the church can see and fix, rather than as a silent exposure. Legacy's
own proc agrees (`api_MPPW_SearchSubscriptions.sql:38`); legacy's `GetPublication` is the outlier,
and it checks nothing at all.

`Available_Online` is nullable (`mp_lookup`) and populated on the reference instance
(`Publication_ID 1` false, 2/3/4 true).

*(While in there: `api_MPPW_SearchSubscriptions.sql:26-35` confirms `dp_Publications` relates to
congregations through a plain `Congregation_ID` **column**, not a join table. That answers
`subscriptions.md`'s Phase 3 open question about C61's filter — recorded here because it came
free with this read.)*

### MP tables written, exact column set

**`Contacts`** (create — only when `findContactIdByEmail` returns null):

| Column | Value |
|---|---|
| `Company` | `false` |
| `Display_Name` | `"<Last>, <First>"` |
| `First_Name` | trimmed, ≤50 |
| `Last_Name` | trimmed, ≤50 |
| `Nickname` | `<First>` |
| `Email_Address` | lower-cased, trimmed, ≤254 |
| `Contact_Status_ID` | id of `Contact_Statuses.Contact_Status = 'Active'` |
| `Household_Position_ID` | id of `Household_Positions.Household_Position = 'Head of Household'` |
| `Bulk_Email_Opt_Out` | `false` |
| `Email_Verified` | **`true`** — the double opt-in earns it |

Not set, deliberately: `Contact_GUID`, `_Contact_Setup_Date`, `Texting_Opt_In_Type_ID`,
`Email_Unlisted`, `Do_Not_Text`, `Mobile_Phone_Unlisted`, `Remove_From_Directory` — all
schema-required but MP-defaulted; `planYourVisitService.createContact` omits the same set and
works. Also not set: `Mobile_Phone` (not collected), `Gender_ID`, `Date_of_Birth`.

**`Contact_Status_ID` is the real column, and this is confirmed against the live domain.**
`Contacts` has `Contact_Status_ID` (required, FK to `Contact_Statuses`) and **no `Status` column
at all**. `planYourVisitService.ts:396` writes `Status: c.statusId` after correctly resolving the
Active id at `:256` — so PYV computes the value and then writes it to a column that does not
exist. It has stayed invisible because the underlying default happens to be Active, and probably
because C24 means PYV's registration step has never completed in production, so nobody has
inspected a contact it created. **Use `Contact_Status_ID`. PYV is being fixed separately on this
branch — do not touch that file.**

**Both lookup ids are resolved by value and cached**, never hard-coded —
`Contact_Statuses` / `Household_Positions` are `Access: Read` reference tables whose ids are
stable on stock instances but not guaranteed. Use the cached `getIdByValue` shape from
`planYourVisitService.ts:520-545` (extracted to `_shared/mp-lookup.ts` in Phase 1). If either
resolves null, fail the verify hop with `save_failed` rather than writing a contact with a null
required column.

**`Households`** (create, one per created contact):

| Column | Value |
|---|---|
| `Household_Name` | `<Last>`, or `"Subscriber"` when blank |
| `Bulk_Mail_Opt_Out` | `false` |
| `Household_Source_ID` | id of `Household_Sources.Household_Source = 'Website'`; **field omitted when absent** |
| `Congregation_ID` | the publication's `Congregation_ID`; **field omitted when null** |

Then `Contacts` update `{ Contact_ID, Household_ID }` — the two-step `associateHousehold` shape
from `planYourVisitService.ts:344-348`, because `Households.Address_ID` and
`Contacts.Household_ID` point at each other and MP has no combined create.

**`dp_Contact_Publications`**:
- create `{ Contact_ID, Publication_ID, Unsubscribed: false }`
- update `{ Contact_Publication_ID, Unsubscribed: false }`
- never `_Synced_List_Name`, never `_Unsubscribe_Sync_Pending`

**No other table.** No `Participants`, no `Participant_Milestones`, no `Addresses`. No stored
procedure (§4 — none exists for these writes).

**Date/time: nothing crosses the MP boundary in this widget.** Said explicitly so a reviewer
does not go looking for `DomainTimezoneService`. `_Contact_Setup_Date` is MP-stamped, and
`MessageInfo.StartDate` is omitted (as `planYourVisitService.renderAndSend` omits it). If a
future change ever sets `StartDate`, it goes through
`DomainTimezoneService.getInstance().toMpSqlDatetime(...)` — never `new Date().toISOString()`.

### Routes

Directory: `src/app/api/embed/subscribe-to-publication/`. Route dirs mirror the widget slug in
this repo (`plan-your-visit/`, `subscriptions/`), and C72 will want a sibling `unsubscribe/`.
C70's "Where to fix" suggested `subscribe/`, written before the element name settled; the slug
wins.

The two POST routes are `withAnonymousWrite(req, { widget: ["subscribe-to-publication", "*"],
limits: [...] }, handler)` — which supplies the JWT check, the `sub === "public"` acceptance, the
POST-only guard, the pre-handler limits and the CORS headers (Shared primitives #3). The `GET`
read keeps the plain `requireWidgetAuth` + `getCorsHeaders` shape, since the wrapper is POST-only
by design. All three export `OPTIONS` via `buildOptionsResponse`.

---

**1. `GET /publication?publicationId=<n>`**

`checkRateLimit("subpub:pub:<ip>", 60)` — fail-**open** (the default), because a store outage
should not blank a church's sign-up form.
Success `200`: `{ publication: { Publication_ID, Title, Description } }` — `Congregation_ID` is
**not** returned; the widget has no use for it.

| Code | Status | When |
|---|---|---|
| `invalid_request` | 400 | missing / non-numeric / ≤0 `publicationId` |
| `publication_not_found` | 404 | no such row **or** `Available_Online` is not `1` |
| `rate_limited` | 429 | |
| `internal_error` | 500 | |

---

**2. `POST /send-verification`**

Request (`SubscribeVerificationRequestSchema`, `@mpnext/types`):

```ts
{
  publicationId: number,        // int, positive
  firstName: string,            // 1..50 after trim
  lastName: string,             // 1..50 after trim
  email: string,                // z.string().email(), ≤254
  returnUrl?: string,           // ≤2048; absolute http(s), same-origin
  recaptchaToken?: string
}
```

**A wrinkle the wrapper creates, and the resolution.** `withAnonymousWrite` checks its `limits`
*before* the handler runs, but the per-address bucket needs the email — which is in the body the
handler parses. Resolve it by reading the body **before** calling the wrapper (`await req.json()`
in the route, guarded) and passing the hashed-email bucket in `limits`; the handler then reuses
the parsed object. Do **not** move the address bucket inside the handler: that would put it after
the wrapper's own gate but is fine order-wise — the reason not to is that a bucket checked inside
the handler no longer returns the wrapper's single uniform `rate_limited`, and a hand-rolled one
is how the per-bucket oracle creeps back in.

Order of operations, and the order matters:

1. Parse the body (`invalid_request` on unparseable JSON) — needed only to hash the address for
   the limit key. Zod validation still happens inside the handler.
2. `withAnonymousWrite` → POST check, widget JWT, `sub === "public"` accepted, origin
   allowlisted and JWT origin-bound, then both limits with `failClosed: true` (its default):
   - `subpub:send:ip:<ip>` — **5 per minute**
   - `subpub:send:email:<sha256Hex(email.toLowerCase())>` — **3 per hour**
     (`windowSeconds: 3600`)

   Two keys because one IP must not fan out across addresses and one address must not be
   mail-bombable from a botnet — and the per-address one must be *per hour*, because a
   per-minute cap still permits a steady all-day bombardment of one mailbox from rotating IPs.
   **This is the D2 fix**, and both report the same `rate_limited`.
3. Zod parse → `validation_failed` with `z.flattenError(parsed.error).fieldErrors` in `details`.
4. reCAPTCHA, only when `recaptchaToken` is present → `validation_failed` (Phase 7).
   (`verifyRecaptchaToken` returns `{ success: true }` with no secret configured, so this is a
   no-op for churches that do not opt in.)
5. Length/control-char cap on `returnUrl`, then
   `isReturnUrlAllowed(returnUrl ?? <origin-derived default>, origin)` → `invalid_request` with
   the diagnostic in `message`.
6. `getOnlinePublication(publicationId)` → `publication_not_found`.
7. `createPendingAction("publication-verify", { email, firstName, lastName, publicationId,
   origin }, ACTION_TOKEN_EXPIRY["publication-verify"])` — a store write, so a store outage
   surfaces here as `internal_error` rather than as an email carrying a link that can never be
   redeemed.
8. `buildReturnUrl(returnUrl, "nextwidgets_verify", token)` — **not** a hand-built string. This
   is exactly where someone writes `` `${base}?` + `${param}=${token}` ``, which
   `src/lib/no-template-concat.test.ts` fails the run for; using the primitive removes the
   opportunity entirely, and `URL.searchParams.set` encodes the token once.
9. `MessageTemplateService.sendMessageTemplate(templateId, { email, name }, { mpp_verify_email_url,
   mpp_contact_first_name, mpp_contact_last_name, mpp_publication_title })`, mapping its typed
   errors per the table in Shared primitives #1: `TemplateNotFoundError` /
   `NoFromAddressError` / `TemplateSendFailedError` → **`email_send_failed`**; an absent or
   unparseable `verification-email-template-id` attribute → **`template_not_configured`**.
   (`mpp_publication_title` is new; legacy merged only the URL and the two names, and a
   verification email that cannot name the publication is a worse email. Existing churches'
   templates ignore an unused token, so it is additive.)

**No step reads `Contacts`.** That is the anti-enumeration invariant, and there is a test for it.

Success `202`: `{ "ok": true }` — byte-identical for every accepted submission.

| Code | Status | When |
|---|---|---|
| `method_not_allowed` | 405 | not a POST — from the wrapper |
| `auth_required` | 401 | no/invalid widget JWT — from the wrapper, detail not echoed |
| `invalid_request` | 400 | unparseable body, **or** a `return-url` that is not https + same-origin, too long, or control-charred (diagnostic in `message`) |
| `validation_failed` | 400 | Zod failure (+ `details`); also a rejected reCAPTCHA |
| `publication_not_found` | 404 | missing or `Available_Online` is not `1` |
| `template_not_configured` | 422 | `verification-email-template-id` absent or unparseable |
| `email_send_failed` | 502 | template id does not resolve, its From contact has no address, or the send threw |
| `rate_limited` | 429 | either bucket, **including a store outage** (`failClosed: true`) — one code for both, deliberately |
| `internal_error` | 500 | the pending-action store write failed, or anything the handler throws |

---

**3. `POST /verify`**

**POST, and the wrapper enforces it.** `withAnonymousWrite`'s own reasoning is the one I would
have given and is worth quoting because it is the whole reason the emailed link lands on a page
rather than on this endpoint: *"a state-changing `GET` is fetched by mail scanners, link-preview
bots and URL-rewriting gateways, which is how an emailed link unsubscribes someone who never
clicked it."* Same hazard, opposite direction — for me a prefetched `GET` would subscribe someone
who never clicked. So the link lands on the host page, and the page POSTs. Keeping the token in
the body also keeps it out of our access logs, out of any CDN cache key and out of a `Referer`.
The widget calls `history.replaceState` to strip the param from the address bar after reading it,
the way the auth ladder handles `#nextwidgets_auth`.

Request `{ token: string }` (≤1024 — the envelope is a `jti`, not a payload). Limit
`subpub:verify:<ip>` @ 20/min, `failClosed: true` (the wrapper's default; it writes MP records).

1. `consumePendingAction("publication-verify", token, guardPublicationVerifyData)`, mapping
   `invalid` → `verification_invalid`, `expired` → `verification_expired`, `used` →
   `verification_used`, `unavailable` → `internal_error` (Shared primitives #2b).
   **This is the burn** — everything after it runs on an already-consumed record.
2. `data.origin !== origin` → `verification_invalid` (Q4). **Deliberately not its own code** — a
   distinct answer would tell a prober the token was otherwise valid. Note the ordering cost:
   the record is burned before this check, so a cross-origin replay consumes the link rather
   than leaving it usable. That is the right way round — a token being presented from the wrong
   origin is evidence it has leaked, and burning it is containment, not collateral damage.
3. `getOnlinePublication(data.publicationId)` → `publication_not_found` (a publication taken
   offline between mint and click is a real case three days apart).
4. `subscribeEmailToPublication(data)` → `save_failed` on an MP write failure.

Success `200`:
`{ subscribed: true, publicationTitle: string, email: string, alreadySubscribed: boolean }`
(`email` echoed from the token so the widget can render *"…at {email}"* without holding state
across the page load).

| Code | Status | When |
|---|---|---|
| `method_not_allowed` | 405 | not a POST — from the wrapper |
| `auth_required` | 401 | no/invalid widget JWT — from the wrapper |
| `invalid_request` | 400 | missing / oversized token |
| `verification_invalid` | 400 | bad signature, wrong `kind`, unreadable payload, **or origin mismatch** |
| `verification_expired` | 410 | envelope past `exp` — proved from the signature, no store read |
| `verification_used` | 409 | envelope good, record already burned |
| `publication_not_found` | 404 | taken offline since minting |
| `rate_limited` | 429 | including a store outage (`failClosed: true`) |
| `save_failed` | 502 | an MP write failed, or a required lookup id resolved null |
| `internal_error` | 500 | pending-action store unreachable (**retryable — the record was not burned**), or anything thrown |

### Every error code this widget emits — reconciled, and it costs **one** new key

**This widget lands last of the three anonymous-write widgets, so it inherits rather than
defines.** An earlier draft of this plan proposed ten new `errors.*` keys. Reconciled against
what C69 (`prayer-feedback.md`) and C72 (`unsubscribe.md`) have already committed to, nine of the
ten disappear:

| Semantics | Draft name | **Final** | Provenance |
|---|---|---|---|
| envelope forged / malformed / wrong `kind` | ~~`invalid_token`~~ | **`verification_invalid`** | C69 |
| envelope past `exp` | ~~`expired_token`~~ | **`verification_expired`** | C69 |
| envelope good, record already burned | ~~`link_already_used`~~ | **`verification_used`** | C69 |
| template id absent or unparseable attribute | ~~`email_template_not_found`~~ | **`template_not_configured`** | C69 |
| `TemplateNotFoundError` / `NoFromAddressError` / send threw | ~~`send_failed`~~ | **`email_send_failed`** | C69 |
| an MP write failed | ~~`subscribe_failed`~~ | **`save_failed`** → `errors.saveFailed` | C72, via the `WIRE_CODE_KEYS` entry **C72 adds** — I reuse it |
| `return-url` refused | ~~`invalid_return_url`~~ | **`invalid_request`** | existing, already in `WIRE_CODE_KEYS`. The distinction is a developer diagnostic, so it belongs in the English `message` — *"return-url must be https and same-origin with the request"* — not in a visitor-facing key. |
| pending-action store unreachable | ~~`service_unavailable`~~ | **`internal_error`** | existing → `errors.generic`, *"Something went wrong. Please try again."* — which already says the retryable thing. |
| reCAPTCHA rejected | ~~`captcha_failed`~~ | **`validation_failed`** | existing. Phase 7 anyway; revisit only if a reviewer wants distinct copy. |
| publication missing **or** not `Available_Online` | `publication_not_found` | **`publication_not_found`** | **the one new key.** Matches the existing `*_not_found` family in `core.ts` (`event_`, `form_`, `group_`, `opportunity_`, `campaign_`). |

Plus, unchanged and already existing: `validation_failed`, `invalid_request`, `rate_limited`,
`auth_required`, `internal_error` — the last four all reached through `WIRE_CODE_KEYS`.

So: **one new sentence in three locales.** No new `WIRE_CODE_KEYS` entries of my own.

**Why sharing C69's `verification_*` copy does not put prayer wording in front of my visitor.**
C69's `verification_used` sentence is *"This request has already been submitted. Thank you!"*,
which would be wrong here. It never renders: my widget **branches on the code into its own
state** and renders `subscribeToPublication.linkUsed` / `linkExpired` / `linkInvalid` from my own
namespace. The shared `errors.*` sentence is the fallback for a surface that has no specific
state for the code — which, for these three, mine always does. That is also why the shared
sentences should be written *neutrally* rather than tuned to either widget; flagging it to C69 as
a review note, not changing their copy.

**Dependency:** `save_failed → errors.saveFailed` in `WIRE_CODE_KEYS` and `errors.link_expired`
are C72's to add. I use the first and **not** the second — C72's `link_expired` covers "expired,
tampered, or wrong `typ`, collapsed into one", whereas I keep C69's three-way
`verification_invalid` / `_expired` / `_used` split because `pending-action.ts` hands me three
distinguishable reasons and the visitor's next action differs for each (Q4). Recording the
deliberate difference so it does not read as drift.

Already mapped by `WIRE_CODE_KEYS` (`shared/base-widget.ts:27-34`): `invalid_request`,
`rate_limited`, `internal_error`. **No `WIRE_CODE_KEYS` additions needed** — every new code is
spelled the same as its catalogue key.

Every code carries a sibling `message:` on the same line; `error-codes.test.ts`'s final
assertion requires it.

---

## Widget

`packages/embed-sdk/src/components/subscribe-to-publication.ts`, element
`next-subscribe-to-publication`, extending `MPNextWidget`.

```ts
connectedCallback() {
  this.injectStyles(this.getStyles() + FORM_VALIDATION_STYLES);
  // initLocale before the first render(): a Spanish visitor must not see
  // English swap to Spanish. Free here — we paint a loading state while the
  // publication loads anyway.
  void this.initLocale().then(() => { this.render(); this.init(); });
}
```

No `disconnectedCallback` is needed (no timers, no listeners outside the shadow root). **If one
is ever added it must call `super.disconnectedCallback()`** — the base class unsubscribes the
locale listener and the `lang` MutationObserver there.

### States

| State | Entered when | Renders |
|---|---|---|
| `loading` | mount | spinner + `common.loading` |
| `form` | publication loaded, no verify param in the URL | heading, description, first/last/email, submit |
| `submitting` | submit passes client validation | submit disabled, `common.submitting` |
| `sent` | `202` from `send-verification` | `checkEmailTitle` + `checkEmail` with the address; form cleared and hidden |
| `verifying` | mount with a verify param present | spinner + `verifying` |
| `verified` | `200` from `verify` | `verifiedTitle` + `verified`; `managePreferences` link when `my-subscriptions-url` is set |
| `linkExpired` | `verification_expired` | `linkExpired` + a "Sign Up Again" button that drops back to `form` |
| `linkInvalid` | `verification_invalid` | `linkInvalid` + the same button |
| `linkUsed` | `verification_used` | `linkUsed` + the `managePreferences` link — **not** a sign-up button, because the likeliest cause is a second click on a link that already worked |
| `error` | `internal_error`, publication load failure, or any unmapped code | `common.unableToLoad` + `this.errorText(payload)` + `common.retry`, which **re-POSTs the same token** — correct, because the `internal_error` that reaches this state is a store outage in which the record was *not* burned |

`linkUsed` exists only because the flow is single-use and store-backed (Q4). The three link
states differ in **affordance**, which is the whole point of keeping them apart rather than
collapsing to one "bad link" message: `linkExpired` offers a fresh sign-up, `error` offers the
same link again, and `linkUsed` offers neither — signing up again would be pointless and
retrying would fail identically.

**`linkUsed`'s copy must be warm and non-alarming** (ruled 2026-09-09): the visitor almost
certainly succeeded and is simply seeing it twice, so the sentence leads with reassurance and
only then offers the preferences link. It must not read as an error, and it must not imply they
need to do anything.

The `form` / `verifying` branch on first paint reproduces
`mpp-subscribe-to-publication.js:141-151`. `notAvailable` is the copy for a
`publication_not_found` on the initial load — a host-configuration error phrased for a visitor.

Events (declared in `packages/types/src/widgets.ts`):
`verificationSent { email }` · `subscribed { publicationId, email, alreadySubscribed }` ·
`subscribeFailed { code }`.

### i18n

**Namespace `subscribeToPublication`, in `locales/<code>/giving.ts`.** Reasoning: `subscriptions`
already lives there, this is the same domain (same two tables, same lifecycle), and C72's
`unsubscribe` belongs in the same file — the publication lifecycle stays in one place with one
owner, which is what `en/index.ts`'s "one file per widget domain … a single owner" comment is
for. Add `next-subscribe-to-publication` to `giving.ts`'s header list. It is not shared copy (so
not `core.ts`) and not a people surface (so not `people.ts`).

**Seed the translations from legacy rather than machine-translating.**
`DatabaseScripts/ApplicationLabels/mpp-subscribe-to-publication.json` carries `spanish` and
`portuguese` for all 13 labels, vetted by MP. Two caveats, both of which mean *adapt, do not
paste*:

- **The Portuguese is European-flavoured and second-person-informal** (`tu`/`teu`;
  e.g. `emailSentConfirmation` → *"Verifique seu email e siga o link…"* is fine, but
  `publicationDescription` → *"Preencha o seguinte formulário para se inscrever em [Título de
  Publicação]"* has **translated the merge token itself**, which would break interpolation). We
  ship `pt-BR`, and the in-repo `pt-BR` catalogue is second-person-formal (`você`/`seu`). A light
  pass, not a rewrite.
- **The Spanish is second-person-informal** (`tú`: *"Completa el siguiente formulario para
  suscribirte…"*, *"¡Gracias por suscribirte!"*), while the in-repo `es` catalogue is formal
  (`usted`: `subscriptions.subtitle` → *"Elija las publicaciones que desea recibir."*). Convert
  to `usted` for consistency with the 25 widgets already shipped.
- Legacy's `[Publication_Title]` token becomes our `{title}`; legacy's Spanish and Portuguese
  strings mostly **dropped the token entirely** (`emailSentConfirmation` es/pt name no
  publication at all). Restore it — `catalogue-parity.test.ts` checks that placeholder sets match
  across locales, so a dropped `{title}` is a test failure, not just worse copy.

| Our key | English | Legacy label | Translation seed |
|---|---|---|---|
| `heading` | `Subscribe to {title}` | `publicationDescription` | **adapt** — es/pt exist; re-add `{title}`, formalise |
| `lead` | `Complete the form below and we'll email you a link to confirm your subscription.` | `publicationDescription` (split) | **adapt** |
| `loading` | `Loading publication…` | — | new |
| `submit` | `Subscribe` | `submitVerificationButtonText` ("Send" / *Enviar* / *Enviar*) | **new wording** — "Subscribe" is the better button; legacy's *Enviar* does not fit it |
| `checkEmailTitle` | `Check your email` | — | new |
| `checkEmail` | `We've sent a confirmation link to {email}. Open it to finish subscribing to {title}.` | `emailSentConfirmation` | **adapt** — es/pt are close; add `{email}` and `{title}` |
| `verifying` | `Confirming your subscription…` | — | new |
| `verifiedTitle` | `You're subscribed` | `subscriptionSuccessMessage` (*"¡Gracias por suscribirte!"* / *"Grato pela assinatura!"*) | **adapt** — formalise the es |
| `verified` | `You'll start receiving {title} at {email}.` | `subscriptionSuccessMessage` (extended) | **adapt** |
| `linkExpired` | `That confirmation link has expired. Sign up again to get a new one.` | `verificationFailedMessage` (*"link has expired"*, and its `previousEnglish` shows MP tightened this same wording once) | **adapt** — es/pt still say *"intenta nuevamente"* / *"Tente novamente"*, i.e. they were never updated to match the English change. Write them fresh. |
| `linkInvalid` | `That confirmation link isn't valid. Please sign up again.` | `subscriptionTokenInvalidMessage` (referenced at `SubscriptionsService.cs:120` but **absent from the label file** — a legacy dead reference: the visitor would have got `undefined`) | new |
| `linkUsed` | `You're all set — this link has already been confirmed.` | — (legacy links were replayable, so this state could not arise) | new. Leads with the reassurance, per the ruling; no "already been used", which reads as a rebuke. |
| `notAvailable` | `This publication isn't available for online sign-up.` | `publicationDoesNotExist` (*"La publicación solicitada no se puede encontrar."*) | **adopt verbatim** — accurate in both, and the visitor-facing meaning is identical |
| `signUpAgain` | `Sign Up Again` | — | new |
| `privacyNote` | `We'll only email you {title}, and you can unsubscribe from any message.` | — | new |
| `managePreferences` | `Manage all your email preferences` | — | new |

**Reused, not re-added** — and legacy has these too, which is the point of `core.ts`:
`fields.firstName` (legacy `firstNameLabel`), `fields.lastName` (`lastNameLabel`),
`fields.email` (`emailAddressLabel`), `validation.formIncomplete`
(`validationFailedMessage` — *"Please fill out all required fields."*, already in our
`validation` namespace), plus `common.loading`, `common.submitting`, `common.retry`,
`common.unableToLoad` and the `errors.*` set. Legacy's `mobilePhoneLabel` and `subcribeAsLabel`
(sic — misspelled in legacy) are not needed; both fields are non-ports.

**No plural messages.** Nothing here counts anything, so the CLDR trap does not arise. If one is
ever added, `es` and `pt-BR` both report `many` as well as `one`/`other`, and a two-branch plural
fails `catalogue-parity.test.ts` for both.

`es` and `pt-BR` are written in the same commit, both `satisfies Messages`, so a missing, extra
or misspelled key is a `tsc --noEmit` failure.

### Form validation

Shared module only — `validateForm`, `bindLiveValidation`, `requiredStar`,
`FORM_VALIDATION_STYLES` from `packages/embed-sdk/src/shared/form-validation.ts`, with
`{ t: this.t }` so messages come from the catalogue. **No native `reportValidity`.**

| Field | Rules |
|---|---|
| First Name | required, trim, `maxlength=50` (matches `Contacts.First_Name`) |
| Last Name | required, trim, `maxlength=50` |
| Email | required, `type="email"`, `maxlength=254`, lower-cased on submit |

On failure: `this.t("validation.formIncomplete")` in the message region and **no fetch**. Every
rule is re-enforced server-side by Zod; the client copy is convenience, not the boundary.

---

## Shared primitives needed

Two of the three now exist. What follows is written against the code as it stands, not against
what I would have designed — **the point of the primitive is that C70 and C72 share one, so where
they diverge, the one already on disk wins.**

### 1. Message templates — **already built, consume as-is**

`src/services/messageTemplateService.ts`, committed at `de1c67b`. Public API:

```ts
MessageTemplateService.getInstance(): Promise<MessageTemplateService>

sendMessageTemplate(          // dp_Communications
  templateId: number,
  to: TemplateRecipient | TemplateRecipient[],   // { email, name }
  merge: TemplateMergeData,                      // Record<string, string>, `[Token]` case-insensitive
  options?: { fromContactId?: number },
): Promise<void>

sendCommunicationTemplate(…)  // dp_Communication_Templates, same shape
```

Both things I was going to ask for are already in it, and better than my sketch:

- **HTML-escaping is unconditional**, not an option — `renderTemplate` escapes every merge value
  (`messageTemplateService.ts:185`). So the Q5 escaping requirement is satisfied with no flag to
  forget. (Legacy had this hole too: `EmailManager.CreateEmail` is `StringBuilder.Replace` with
  no escaping.)
- **The failure taxonomy is typed and split**, which maps straight onto my error codes:

| Thrown | My code | Status |
|---|---|---|
| `TemplateNotFoundError` | `email_send_failed` | 502 |
| `NoFromAddressError` | `email_send_failed` | 502 |
| `TemplateSendFailedError` | `email_send_failed` | 502 |
| `NoRecipientError` | `internal_error` | 500 (we validated the address; reaching this is our bug) |

My call site:

```ts
await (await MessageTemplateService.getInstance()).sendMessageTemplate(
  templateId,
  { email, name: `${firstName} ${lastName}` },
  {
    mpp_verify_email_url: verifyUrl,
    mpp_contact_first_name: firstName,
    mpp_contact_last_name: lastName,
    mpp_publication_title: publication.Title,
  },
);
```

**No `.catch()`.** The service's own doc note says best-effort callers should catch explicitly so
the choice is visible; for this widget the email *is* the flow, so a send failure must surface as
`email_send_failed` rather than a cheerful 202.

`planYourVisitService.ts` still has its private copy; migrating it is not my change (Open
question 9).

### 2. Anonymous action tokens — **already built, and I adapt to it**

`src/lib/embed/action-token.ts`, landed while this plan was being written (untracked at time of
writing, so it may still move). Actual API:

```ts
export type ActionTokenType = "pyv-verify" | "prayer-feedback" | "publication-verify" | "unsubscribe";
export const ACTION_TOKEN_EXPIRY: Record<ActionTokenType, number>;
export type ActionTokenFailure = "invalid" | "expired" | "wrong-type";
export type ActionTokenResult<T> = { ok: true; data: T } | { ok: false; reason: ActionTokenFailure };

createActionToken<T extends Record<string, unknown>>(
  typ: ActionTokenType, data: T, expirySeconds?: number,   // default ACTION_TOKEN_EXPIRY[typ]
): Promise<string>

verifyActionToken<T>(
  expectedTyp: ActionTokenType, token: string,
  guard: (payload: Record<string, unknown>) => T | null,
): Promise<ActionTokenResult<T>>
```

**Four deltas from what I had specified, and how this plan resolves each:**

| I specified | It does | Resolution |
|---|---|---|
| `typ: "pub-subscribe"` | `"publication-verify"` (its comment names this widget) | **Use theirs.** |
| `{ typ, origin, data }` nested | flat `{ ...data, typ }` | **Use theirs.** `origin` becomes a `data` field. |
| Zod `schema` | a `guard` predicate returning `T \| null` | **Use theirs.** I export a `guardPublicationVerifyToken` next to the Zod schema in `@mpnext/types` so one file owns the shape; the guard is the thin adapter. |
| `origin` claim + `"origin_mismatch"` reason | no origin concept | **Signed in `data`, compared in the route** — no module change (Q4). Do **not** add an `origin_mismatch` reason: the wire answer is `verification_invalid` either way (Q6), so a fourth failure value would exist only to be collapsed. |

Everything else I needed it already does, and its header argues the same points independently:
`typ` is an *input* compared against the token's, never read off it and branched on; `expired` is
distinguished from `invalid` via jose's `ERR_JWT_EXPIRED` (`action-token.ts:130-133`), which is
what `verification_expired` vs `verification_invalid` rests on; and `verify-token.ts` stays in place as a thin
wrapper so PYV's in-flight links keep verifying.

Its `ACTION_TOKEN_EXPIRY` sets `publication-verify` to **3 days** against legacy's 24 hours.
Adopt it (Q4).

**One thing to flag back to C72**, not to change unilaterally: `ActionTokenType` includes
`"unsubscribe"` as a single value with a **180-day** expiry. My subscribe write and their
unsubscribe write are opposite mutations of the same `dp_Contact_Publications` row, and the
`typ` check is the only thing keeping them apart — so the union is doing real security work and
**neither of us should widen it to a shared "publication" type.** The current split is correct;
recording it so it stays that way.

### 2b. Single-use pending actions — **already built, and this widget is named in it**

`src/lib/embed/pending-action.ts` (also just landed). I use this rather than `action-token.ts`
directly; the reasoning is in Q4.

```ts
export type PendingActionKind = Extract<ActionTokenType, "prayer-feedback" | "publication-verify">;
export type PendingActionFailure = "invalid" | "expired" | "used" | "unavailable";
export type PendingActionResult<T> = { ok: true; data: T } | { ok: false; reason: PendingActionFailure };

createPendingAction<T>(kind: PendingActionKind, data: T, ttlSeconds: number): Promise<string>
consumePendingAction<T>(kind, token, guard: (data: unknown) => T | null): Promise<PendingActionResult<T>>
```

The URL carries a signed envelope over a random `jti`; the payload is `seal()`-ed in the session
store and redeemed with `kvGetDelete`, an atomic read-and-burn. Failure mapping:

| `reason` | My code | Status | Why |
|---|---|---|---|
| `invalid` | `verification_invalid` | 400 | forged, malformed, or minted for another flow (`wrong-type` is folded in by that module, deliberately — saying which flow it belonged to leaks what else the bearer holds) |
| `expired` | `verification_expired` | 410 | envelope past `exp`; costs no store round-trip |
| `used` | `verification_used` | 409 | envelope good, record burned |
| `unavailable` | `internal_error` | 500 | store unreachable; **record not burned, so retryable** — the widget's `error` state re-POSTs the same token |

**Nothing in it needs changing for me.** `publication-verify` is already in `PendingActionKind`,
and its "it fails closed" note — *"writing a row on the strength of a token we could not verify is
the thing the round-trip exists to prevent"* — is exactly the property my write needs.

### 2c. `checkRateLimit` gained the two options I needed

`src/lib/embed/rate-limit.ts` was extended in the same wave with `windowSeconds` and
`failClosed`, and its new header argues against what an earlier draft of this plan proposed. It is
right and I have changed the numbers below accordingly:

- *"the 60s window cannot express '3 per hour', which is what an endpoint that sends email to a
  submitted address needs: a per-minute limit alone lets one address be mail-bombed steadily all
  day, and from rotating IPs it is not even slowed down."* — my per-address limit becomes
  **3/hour** (`windowSeconds: 3600`), not 2/minute.
- *"Failing open on an unauthenticated email endpoint turns a store outage into an open relay
  pointed at whatever address the caller supplies."* — `send-verification` and `verify` both pass
  **`failClosed: true`**. The publication read does not: a store outage should not blank the form.

### 3. The anonymous-write convention — **already built; it is the wrapper, not a checklist**

`src/lib/embed/anonymous-write.ts` (`93b00fb`). Everything an earlier draft of this plan proposed
as eight rules-to-remember is now enforced by a wrapper, which is strictly better:

```ts
withAnonymousWrite(
  req,
  { widget: string | string[]; limits: { key, limit, windowSeconds? }[]; failClosed?: boolean },
  handler: (ctx: { claims, origin, cors, ip }) => Promise<NextResponse>,
): Promise<NextResponse>

errorResponse(code, message, status, cors): NextResponse
isReturnUrlAllowed(candidate, origin): boolean
buildReturnUrl(returnUrl, param, value): string
```

What it enforces, and the codes it can emit before my handler ever runs:

| Behaviour | Code / effect |
|---|---|
| **POST only** — *"a state-changing `GET` is fetched by mail scanners, link-preview bots and URL-rewriting gateways"* | `method_not_allowed`, 405 |
| Widget JWT still required; `sub === "public"` accepted | `auth_required`, 401 — **detail deliberately not echoed**, so "bad token" / "wrong origin" / "wrong widget" are indistinguishable |
| Every limit checked **before the handler**, so before any MP read, write or email | `rate_limited`, 429 |
| **One `rate_limited` for every bucket** — *"telling the caller which limit they hit reports whether the address they submitted is one we have seen before"* | (this is an anti-enumeration property I had not thought of) |
| `failClosed` defaults to **`true`** here, inverting `checkRateLimit`'s own default | |
| Handler throws → opaque `internal_error`, never MP's error text | `internal_error`, 500 |

Three notes for my routes specifically:

- **`GET /publication` cannot use it** and should not: the wrapper is POST-only by design, and
  that route is a read. It keeps the plain `requireWidgetAuth` + `getCorsHeaders` shape, accepts
  `sub === "public"`, and rate-limits fail-**open** (a store outage should not blank the form).
- **The single-`rate_limited`-code rule matters more here than the wrapper's comment says.** My
  two buckets are per-IP and per-**email-address**; a distinguishable per-bucket code would let a
  caller learn that an address had recently been submitted, which is a weaker but real version of
  the Q6 oracle. Getting that for free from the wrapper is the argument for using it rather than
  hand-rolling.
- The two rules the wrapper cannot enforce stay mine: **Zod-parse the body**
  (`validation_failed` + `z.flattenError(...).fieldErrors` in `details`), and **state between
  hops is a sealed pending action, never a bare identifier** — no `contactId`, no `Contact_Guid`,
  no `email` + `publicationId` pair on the completing hop. Those close D1 and D3, and they are
  asserted by route tests rather than trusted.

`method_not_allowed` has no `errors.*` entry and needs none: it is unreachable from the widget
(which only ever POSTs), and `error-codes.test.ts` scans `src/app/api/embed/**/route.ts`, not
`src/lib/embed/`. A widget that somehow received it would render `errors.generic`, which is right.

Optional per-widget: `verifyRecaptchaToken` when the host supplies a token (Phase 7).

### 4. Small, but it will be duplicated a fourth time otherwise

`getIdByValue` (cached lookup-table id resolution), `sqlLiteral`, `clean` and `toNumberOrNull`
exist in `planYourVisitService.ts:57-63, 520-545` and are needed verbatim here. Extract to
`src/services/_shared/mp-lookup.ts` in the same phase as #1.

---

## Tests

### New files

**`src/lib/embed/action-token.test.ts` is C72's file, not mine** — it owns the module. What I add
there is one case, coordinated with them: a `"publication-verify"` token verified as
`"unsubscribe"` returns `"wrong-type"`, and the reverse. That is the assertion that keeps a
subscribe capability from being a redeemable unsubscribe capability on the same row, and neither
plan should assume the other wrote it.

Everything origin-related is tested **in my route test**, not there, because the origin check
lives in the route (Q4): a token whose `data.origin` differs from the request Origin → 400
`verification_invalid`.

**No `return-url.test.ts`** — `isReturnUrlAllowed` and `buildReturnUrl` ship with
`anonymous-write.ts` and are its to cover. My route test asserts only that I *call* them and
honour the result (the D2 guard above).

**`src/services/messageTemplateService.test.ts` already exists** (shipped with `de1c67b`). Nothing
to add — its HTML-escaping and error-taxonomy coverage is what I depend on, and my route test
asserts only the **mapping** from its errors to my codes.

**`src/app/api/embed/subscribe-to-publication/publication/route.test.ts`**
- `Available_Online = 1` → 200 with title + description; **no `Congregation_ID` in the body**
- `Available_Online = 0` and a nonexistent id → **the same** `publication_not_found` / 404

**`.../send-verification/route.test.ts`** — the important file
- **enumeration:** an email the MP mock knows and one it does not produce byte-identical JSON and
  the same status. Assert on the serialised body, not on parsed fields.
- **no contact read:** the MP mock is never called with `table: "Contacts"` on this hop
- **D1 regression guard — assert *ignored*, not merely unused.** POST a body carrying
  `contactId: <a real id>` alongside `email: attacker@evil.example`. Assert: the response is the
  same uniform 202; the sealed pending-action payload contains **no** `contactId` key; and after
  redeeming, `subscribeEmailToPublication` was called with the **email-resolved** contact, and no
  MP update touched `Contacts.Email_Address` for the supplied id. This is the account-takeover
  primitive from D1, so it gets an assertion rather than a comment.
- **D2 regression guard — same standard.** `returnUrl` on another origin → `invalid_request` and
  `sendMessageTemplate` **not called**; `http://church.example/x` (non-localhost) → same, since
  `isReturnUrlAllowed` is https-only; `https://church.example@evil.example/x` → same, refused on
  the credentials check before origin comparison even matters; `javascript:alert(1)` → same. In
  every case assert **no email was sent**, not just that a 400 came back.
- a `returnUrl` carrying `?page=2` **keeps it** and gains exactly one `nextwidgets_verify`; a
  `returnUrl` that already carries `nextwidgets_verify=stale` has it **overwritten**, not
  duplicated (`buildReturnUrl` is `searchParams.set`)
- non-online publication → `publication_not_found`
- both rate-limit keys are consulted — the per-address one with `windowSeconds: 3600` — and
  `rate_limited` short-circuits **before** the template read (assert `sendMessageTemplate` was
  not called)
- both send-hop limits pass `failClosed: true`, so a throwing store denies rather than allows
  (the open-relay guard)
- a failing `createPendingAction` (store down) → `internal_error`, and **no email is sent**:
  a link that can never be redeemed must not reach an inbox
- `TemplateNotFoundError`, `NoFromAddressError` and `TemplateSendFailedError` all →
  `email_send_failed`, 502; an absent `verification-email-template-id` → `template_not_configured`,
  422 (the error-mapping table in Shared primitives #1)
- 51-character first name → `validation_failed` with `firstName` in `details`
- `recaptchaToken` present and failing → `validation_failed`, and no email sent
- the minted token carries `origin` equal to the request Origin

**`.../verify/route.test.ts`**
- valid token → 200, and `subscribeEmailToPublication` called with the token's data
- expired → `verification_expired`, 410
- token whose `data.origin` differs from the request Origin → `verification_invalid`, and **no write**
- an `"unsubscribe"`-typed token presented here → `verification_invalid`
- **single-use:** the same token twice → 200 then `verification_used` / 409, and
  `subscribeEmailToPublication` called exactly **once**. This is the resurrect-an-unsubscribe
  guard from Q4 and the most important assertion in the file.
- store unreachable → `internal_error` / 500, and **no write**
- publication taken offline between mint and verify → `publication_not_found`, and no write

**`packages/embed-sdk/src/components/subscribe-to-publication.test.ts`**
- renders the form only after `initLocale` resolves; `heading` interpolates the publication title
- submit with an empty email shows the shared validation message and issues **no** fetch
- `sent` state names the submitted address
- a URL carrying `?nextwidgets_verify=…` goes straight to `verifying`, never paints the form, and
  `history.replaceState` strips the param
- a `verification_expired` response renders `linkExpired` and **never** the server's English `message`
- `my-subscriptions-url` set → the `managePreferences` link renders; unset → it does not
- setting `publication-id` on a mounted element re-renders (the `CROSS-4` C39 guard)

**`packages/types/src/subscribe-to-publication.test.ts`** — schema accept/reject round-trips.

### Extended files

**`src/services/subscriptionService.test.ts`**
- `getOnlinePublication`: null for `Available_Online = 0` and for a missing id; non-null when the
  flag is NULL (and the same clause as `getSubscriptions`)
- `subscribeEmailToPublication`, no matching email → creates `Contacts`, then `Households`, then
  the association, then the link; asserts the **exact** column set including
  `Email_Verified: true`, `Bulk_Email_Opt_Out: false`, a resolved `Contact_Status_ID` and
  `Household_Position_ID`, and that no underscore-prefixed column and no `Mobile_Phone` is written
- existing contact → nothing created but the link; `contactCreated: false`
- existing row with `Unsubscribed: true` → **update**, not create; `alreadySubscribed: false`
- existing row with `Unsubscribed: false` → **no write at all**; `alreadySubscribed: true`
- `Households.Congregation_ID` set from the publication when non-null, field omitted when null
- `Household_Source_ID` omitted when `'Website'` does not resolve
- `Contact_Statuses` / `Household_Positions` lookup returning null → throws, and **no `Contacts`
  row is created**
- **never writes `Contacts.Email_Address`** — the D1 regression guard, because "restore parity
  with legacy's `UpdateContactEmail`" is the obvious way to reintroduce an account takeover
- never touches `Participants`

**`packages/types/src/index.test.ts`** — new schema names added to `expectedSchemas`.

### Existing guard tests that fail if this work is incomplete

| Test | Fails when |
|---|---|
| `i18n/error-codes.test.ts` | `publication_not_found` lacks an `errors.*` entry in `en`, `es` **or** `pt-BR`; **or any inherited code lands before C69/C72's catalogue entry does** (it scans every `src/app/api/embed/**/route.ts`, so my routes turn it red for *their* missing keys too — hence the Phase 3 sequencing note); any route answers with English prose in `error:`; any code lacks a sibling `message:` |
| `i18n/catalogue-parity.test.ts` | `subscribeToPublication` present in `en` but not `es`/`pt-BR`; a `{title}` / `{email}` placeholder set that differs across locales — **the exact way legacy's own es/pt strings were wrong** (they dropped `[Publication_Title]`) |
| `i18n/no-english-literals.test.ts` | **any** literal in the new component. `BUDGET` is `{}` and must stay `{}`, so adding an entry is not an option: the widget ships fully localised or not at all |
| `i18n/widget-locale.test.ts` | (indirectly) a `disconnectedCallback` added without `super` |
| `src/lib/no-template-concat.test.ts` | the verify-URL build joins two template literals with `+`. Using `buildReturnUrl` removes the opportunity, which is the better fix than remembering the rule |
| `packages/types/src/index.test.ts` | barrel not updated |
| `tsc --noEmit` | `es`/`pt-BR` missing, extra or misspelled keys under `satisfies Messages` |
| `pnpm i18n:check` | English moved without the translations following (staleness) |

E2E is optional for v1 — the flow needs a real mailbox. If added,
`e2e/widget/subscribe-to-publication.spec.ts` can mint a token server-side and drive only the
verify hop, skipping when MP credentials are absent (the shape `login-hardened.spec.ts` uses).

---

## Security

**What an unauthenticated caller can cause, worst case.**

Without a token (step 1 only): up to **5 verification emails per minute per IP** and **3 per
hour per address**. Each is a church-authored `dp_Communications` template with four merged
values — a first name and last name (each ≤50 chars, control chars stripped, HTML-escaped), a
URL on an allowlisted origin, and the publication title. **There is no attacker-controlled free
text in the body.** No MP record is written, and none is read except the publication and the
template.

With a valid signed token (i.e. having proven control of the mailbox): at most **one `Contacts`
row, one `Households` row, and one `dp_Contact_Publications` row set to subscribed**, for one
`Available_Online` publication. No other table.

**What is not possible — and, for each, the legacy defect it corresponds to:**

- *Subscribing a third party.* The write requires a token, and the token only reaches the address
  it names. (Legacy: any address, given a client-supplied `ContactId` — D1.)
- *Re-subscribing someone who has since unsubscribed, by re-fetching an old link.* The token is
  single-use and burned atomically on redemption (Q4). This one is worth naming explicitly
  because a stateless token would have permitted it **precisely because** the write is
  idempotent, and a mail-client prefetcher or security scanner is enough to trigger it — no
  attacker required. (Legacy: fully replayable for 24 hours.)
- *Setting someone else's email address.* No route writes `Contacts.Email_Address`, ever.
  (Legacy: `UpdateContactEmail` on an anonymous flow — D1, an account-takeover primitive.)
- *Making the church's mail server send a link to an arbitrary site.* `return-url` must be
  same-origin with an allowlisted origin. (Legacy: `ReturnUrl` straight into the email,
  unvalidated — D2.)
- *Sending unlimited email.* Two rate-limit keys, checked before any MP call — 5/min per IP and
  **3/hour per address** — both `failClosed`, so a store outage denies rather than turning the
  endpoint into an open relay. (Legacy: no rate limiting anywhere in the solution — zero grep
  hits.)
- *Subscribing anyone to an internal publication.* `Available_Online` enforced on every hop.
  (Legacy: `GetPublication` is a bare PK fetch — `SubscriptionsManager.cs:67`.)
- *Learning whether an address is known to the church.* Step 1 performs no contact query at all
  and returns one body for every outcome — no branch, so no timing channel. (And explicitly not
  the `contactExists: true` shape of `plan-your-visit/send-verification:78-83`.)
- *Enumerating the publication id space.* Missing and not-online collapse to one code.
- *Unsubscribing anyone.* No route here writes `Unsubscribed: true`. (Legacy: a bare
  `Contact_Guid` off a query string — D3, and C72's inheritance.)
- *Reading contact data.* No response contains a contact field.
- *Replaying a token cross-site.* The `origin` claim is checked against the request Origin.

**Residual risk, stated rather than hidden.** Someone controlling many mailboxes can create junk
contacts at 3/hour/address. That is legacy's exposure too (unbounded there), the per-address limit
is the control, and `recaptcha-site-key` is the escalation for a church that sees abuse. It is a
data-hygiene cost, not a security boundary — and every such contact is `Email_Verified: true`
with `Household_Source = 'Website'`, so staff can find and merge them.

---

## Deliberate non-ports — write these into the migration notes

1. **The mobile-phone field** (`mpp-subscribe-to-publication.js:507`, optional in legacy). A
   newsletter opt-in needs an email address; a phone number is PII the flow does not use, and
   writing `Contacts.Mobile_Phone` from an anonymous form interacts with `Texting_Opt_In_Type_ID`
   and texting consent in ways a subscription form has no business deciding. Adding
   `collect-mobile-phone` later is a one-line change if a customer asks.
2. **The signed-in "Subscribe As" household dropdown** (`:164-211`, `:493-495`). It is the reason
   legacy's token carries `contactId` and `onBehalfId`, and dropping those two claims is what
   makes the token email-scoped rather than contact-scoped (Q4, D1). A signed-in member who wants
   to manage a household member's subscriptions has `next-subscriptions`, and `next-my-household`
   is where household-scoped editing lives. Recorded as a decision, not an oversight.
3. **`UpdateContactEmail` on verify** (`SubscriptionsService.cs:147-150`) — D1. Regression-tested.
4. **Legacy's unchecked `GetPublication`** — we require `Available_Online`.
5. **The publication's default image.** `api_MPPW_SearchSubscriptions.sql:22` joins `dp_Files`
   for a `Default_Image` and legacy's signed-in list renders it. Not ported here: it needs a file
   route and adds a request to a one-publication form. Worth reconsidering for
   `next-subscriptions` (see `subscriptions.md`), not for this element.

---

## Resolved (ruled 2026-09-09) — recorded so the reasoning is not re-litigated

1. **Single-use redemption, and `linkUsed` on a second click — approved.** A replayable token
   silently resurrecting an unsubscribe is a worse failure than a confusing second click, and a
   mail prefetcher is enough to trigger it. This is also *why* `pending-action.ts` lists
   `publication-verify` and deliberately omits `unsubscribe`: **the two flows differ precisely on
   whether replay is harmless.** Copy must be warm and non-alarming (see States).
2. **Query param is `nextwidgets_verify`.** The `nextwidgets_*` rule covers every browser-visible
   key the SDK owns and is extended to query params. PYV's `mpp-verify-id` is now an
   inconsistency needing a **dual-read**, filed separately — see Attribute surface.
3. **`Contact_Status_ID`, confirmed against the live domain.** PYV's `Status:` write goes to a
   column that does not exist. **Filed as
   `.claude/TODO/Comparison/C83-plan-your-visit-writes-nonexistent-contacts-status-column.md`**
   and being fixed separately on this branch — do not touch `planYourVisitService.ts`. See MP
   tables.
4. **PYV's `contactExists` oracle stays with `plan-your-visit.md`.** Documenting it here as the
   pattern not to repeat is the correct scope.
5. **`Available_Online = 1`, strictly, and deliberately different from `getSubscriptions`.** They
   are different trust surfaces; do not tidy them into agreement. Full reasoning in Server →
   Service.
6. **`messageTemplateService` extraction and the PYV migration are already done** (`d05d3e5`,
   hardened `de1c67b`), so PYV has the unconditional HTML-escaping too. Nothing to own.
7. **`origin` in the sealed payload is accepted as a local decision** — no shared-module change.
   C69 or C72 may lift it later if they want it.

## Open questions

1. **Contact creation is unconditional.** Should there be a `create-contact="false"` mode that
   subscribes only already-known addresses and silently drops the rest? It would suit a church
   that refuses widget-created records, but it makes the widget appear to work while doing nothing
   for most visitors. Recommend: no attribute in v1.
2. **`Household_Sources` has no "Subscribe Widget" row** (ids 17–39 on the reference instance;
   `'Website'` = 19, `'Plan a Visit Widget'` = 36). I resolve `'Website'` by value and omit the
   field when absent. The alternative is asking every customer to add a lookup row. Recommend:
   keep `'Website'`.
3. **Two 502s (`email_send_failed`, `save_failed`) where no embed route used 502 before.** Both
   are inherited names — C69 assigns 502 to `email_send_failed`, C72 assigns 502 to `save_failed`
   — so I am following, not choosing. Noting it only because if a reviewer wants embed routes to
   stay 500-only, that is a decision across all three plans rather than mine to make.
4. **A review note for C69, not a question for me.** If `errors.verification_used` keeps C69's
   *"This request has already been submitted. Thank you!"*, the shared key is tuned to one widget.
   My visitor never sees it (I branch into `subscribeToPublication.linkUsed`), so this costs me
   nothing — but the three `verification_*` sentences would read better written neutrally, since
   three widgets now share them.

### Settled by ruling — 2026-09-09

All four resolved. Do not reopen these without a reason that is not already recorded here.

1. **No `create-contact="false"` in v1 — recommendation accepted.** A widget that appears to
   work while silently discarding most submissions is a worse failure than one that does not
   offer the mode, because the church cannot see it happening. If a customer genuinely refuses
   widget-created records, the honest answer is that this widget is not for them.
2. **Keep `Household_Source = 'Website'` — recommendation accepted**, resolved by value and
   omitted when the lookup misses, matching C69. Recorded as a *possible* future tidy rather
   than a requirement: `'Plan a Visit Widget'` (36) shows MP does model widget-specific
   sources, so a `'Subscribe Widget'` row is the neater long-run answer — but it is not worth
   making every customer add a lookup row before the widget works.
3. **Use 500, not 502. This overrides the two inherited assignments**, and C69 and C72 should
   be brought into line rather than this plan following them.

   The reasoning is not that 502 is inaccurate — MP *is* an upstream service, so a failed MP
   call is defensibly a bad gateway. It is that **the machine code already carries the
   meaning**, which is the entire point of the `{ error, message }` envelope: `email_send_failed`
   and `save_failed` say more than any status code will, and the widget branches on the code,
   never the status. Adding a second, partially-overlapping signal in 3 routes out of 30 buys
   no information and costs a reader the question *"does a 500 somewhere else mean something
   different?"* — which is drift, not precision.

   If the repo wants an upstream-failure convention it should adopt one deliberately across all
   30 embed routes, as a `CROSS-` item. Three new widgets are the wrong place to introduce it.
4. **Write the three shared `verification_*` sentences neutrally — your note is upheld**, and
   it is C69's to action since it defines the keys. A message three widgets share cannot be
   phrased for one of them; *"This request has already been submitted"* is prayer-intake
   wording that would read oddly as a newsletter fallback even if only a fallback. Neutral
   phrasing, e.g. "This link has already been used." That also protects the case where a
   future widget renders the shared sentence directly instead of branching as you do.

---

## Sequenced phases

Each is independently committable and leaves the suite green.

**Phase 1 — one small extract; the shared work is done.**
`src/services/_shared/mp-lookup.ts` (`getIdByValue`, `sqlLiteral`, `clean`, `toNumberOrNull`
lifted from `planYourVisitService.ts:57-63, 520-545`), with tests and no behaviour change.

**All five shared primitives already exist — `anonymous-write.ts`, `action-token.ts`,
`pending-action.ts`, the `rate-limit.ts` options and `messageTemplateService.ts`. Do not
re-create any of them.** The only edit any needs is the one coordinated cross-flow `wrong-type`
test case noted under Tests.

**Phase 1 also has a sequencing dependency on C72:** the `save_failed → errors.saveFailed`
entry in `WIRE_CODE_KEYS` is theirs to add and mine to reuse. If C70 lands first, add it and tell
them; if they land first, reuse it untouched. It must not end up duplicated.

**Phase 2 — types and service.** `packages/types/src/subscribe-to-publication.ts` + barrel +
`index.test.ts`; the three new methods on `subscriptionService.ts` + tests. Fully tested and
unreachable from the network.

**Phase 3 — i18n.** The `subscribeToPublication` namespace across `en` / `es` / `pt-BR`, seeded
from `DatabaseScripts/ApplicationLabels/mpp-subscribe-to-publication.json` per the table above,
plus **the one new `errors.*` key** (`publication_not_found`).

Land this **before** the routes, and mind the cross-plan coupling: `error-codes.test.ts` scans
*every* `src/app/api/embed/**/route.ts`, so my routes emitting `verification_invalid`,
`verification_expired`, `verification_used`, `template_not_configured`, `email_send_failed` or
`save_failed` will turn it red until **C69's and C72's** catalogue entries exist. So either land
after them, or add the missing inherited keys in this phase and tell them — but do not add a
second spelling of any of them. Run `pnpm i18n:sync` to record the baselines.

**Phase 4 — routes.** The three route files + their tests, including the enumeration test and the
D1 / D2 regression guards (which assert *ignored* and *not sent*, not merely absent).

**Phase 5 — component and registration.** `components/subscribe-to-publication.ts`, its test, the
`export` + auto-register `import` in `packages/embed-sdk/src/index.ts`, and the
`packages/types/src/widgets.ts` registry entry (category `Public`, `needsUserMenu: false`,
`needsMpWidgets: false`, the three events).

**Phase 6 — demo and docs.** `packages/embed-sdk/demo-subscribe-to-publication.html` (modelled on
`demo-plan-your-visit.html`, including the localStorage persistence of the template id so it
survives the email round trip), the `widget-catalog.ts` extras entry, README roster + the
non-ports, CLAUDE.md roster and re-measured counts, and the `ROADMAP-missing-widgets.md` update.

**Phase 7 — optional.** The `recaptcha-site-key` path end-to-end, and
`e2e/widget/subscribe-to-publication.spec.ts` driving the verify hop from a server-minted token.

---

## Acceptance

- A signed-out visitor on a church page can enter a name and email, receive a verification email,
  and clicking the link subscribes them to the configured publication.
- The same flow works for an email MP already knows, and the visitor is told nothing about that.
- Clicking the link twice writes once: the second click shows `linkUsed`, and
  `subscribeEmailToPublication` ran exactly once.
- A visitor who unsubscribes and then re-opens the old confirmation link is **not** re-subscribed.
- `POST /send-verification` returns a byte-identical body for a known and an unknown address, and
  reads no `Contacts` row.
- A body carrying `contactId` changes nothing, and no code path writes `Contacts.Email_Address`.
- A `return-url` on any origin other than the requesting one is refused and no email is sent.
- A `publication-id` that is not `Available_Online` behaves exactly like one that does not exist.
- A token minted on one allowlisted origin does not verify from another.
- An expired link says so and offers a fresh sign-up; an invalid one says something different.
- The widget renders entirely in `es` and `pt-BR` with no English leakage, and
  `MPNextEmbed.enablePseudoLocale()` shows no plain-ASCII strings.
- `pnpm test:run`, `pnpm lint` and `pnpm i18n:check` are clean, with `BUDGET` still `{}`.

## Depends on / unblocks

**Fully satisfied — all five shared primitives landed while this plan was being written**, which
is the parallel-planning working: `anonymous-write.ts`, `action-token.ts`, `pending-action.ts`
and the `rate-limit.ts` options (`93b00fb`), plus `messageTemplateService.ts` (`d05d3e5`,
hardened `de1c67b`, wanted by C69 / C11 / C66 too). All consumed as-is. Every divergence from
what this plan would have specified is tabled in Shared primitives #1, #2, #2b, #2c and #3 and
**resolved in the existing code's favour** — including three places its reasoning beat mine:
single-use redemption, a per-hour rather than per-minute address limit, and one uniform
`rate_limited` across buckets so the bucket hit is not itself an oracle.
**Still needs** only Phase 1's `_shared/mp-lookup.ts`, plus C72's `save_failed` `WIRE_CODE_KEYS`
entry.
**Coordinates with** `subscriptions.md`: its "Do better than parity" note wants an
`unsubscribed=1` entry state on `next-subscriptions`; `my-subscriptions-url` here is the other
half of that link, and both should use the same URL contract.
**Hands C72** three findings it would otherwise rediscover: legacy's bare-`Contact_Guid`
unsubscribe (D3), the absence of any rate limiting in the legacy solution, and the
`api_MPPW_SearchSubscriptions.sql` confirmation that `dp_Publications.Congregation_ID` is a
plain column (which also answers `subscriptions.md`'s C61 open question).
**Surfaces** an existing defect in `plan-your-visit/send-verification` (Open question 3) and a
probable one in `planYourVisitService.createContact` (Open question 2).
