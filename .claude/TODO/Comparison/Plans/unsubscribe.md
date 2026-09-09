# `next-unsubscribe` — plan

**Items:** C72 (functional, compliance edge) · unblocks the C55/C70 publication lifecycle
**Cutover verdict: C72 blocks cutover for any church that sends bulk email, and the identification
design is `cg` + a sealed token, not sealed-token-only — because MP's merge engine cannot produce a
sealed token.**

**Ranked #1 in `ROADMAP-missing-widgets.md`.** That ranking is confirmed, not softened: the
roadmap's one open question — *"does MP's own send pipeline already generate unsubscribe links?"* —
is answered **no**, with evidence below. The compliance risk stands at the severity C72 filed it.

## Owns

Create:

- `packages/embed-sdk/src/components/unsubscribe.ts`
- `packages/embed-sdk/src/components/unsubscribe.test.ts`
- `packages/embed-sdk/demo-unsubscribe.html`
- `src/app/api/embed/unsubscribe/route.ts`
- `src/app/api/embed/unsubscribe/route.test.ts`
- `packages/types/src/unsubscribe.ts`
- `packages/types/src/unsubscribe.test.ts`

Touch:

- `src/services/subscriptionService.ts` — three new methods (extend; do not fork the table knowledge)
- `src/services/subscriptionService.test.ts` — exists already; extend it
- `packages/types/src/index.ts` — re-export
- `packages/types/src/widgets.ts` — roster entry (`slug: "unsubscribe"`, category `Public`,
  `needsUserMenu: false`)
- `packages/embed-sdk/src/index.ts` — `export {}` (~:47 block), `import "./components/unsubscribe"`
  (~:106), `detectFirstWidgetId` map (`"NEXT-UNSUBSCRIBE": "unsubscribe"`, ~:183), and the
  sibling-`api-host` selector list at `:145`
- `packages/embed-sdk/src/shared/base-widget.ts` — the same sibling selector list at `:112`, plus
  one `WIRE_CODE_KEYS` entry (`save_failed → errors.saveFailed`)
- `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/account.ts` — the `unsubscribe` namespace
- `packages/embed-sdk/src/i18n/locales/{en,es,pt-BR}/core.ts` — one new `errors.link_expired`
- `packages/embed-sdk/i18n-sources/` — re-record via `pnpm i18n:sync`
- `README.md` — a "Widget Unsubscribe Links" section (the customer migration note below)

**Not owned, needed:** `src/lib/embed/action-token.ts` and the anonymous-write route convention —
see *Shared primitives*.

**Read-only inputs** (cite, do not copy wholesale):
`S:\MP\mp-Widgets\PortalComponents\ClientApp\Components\mpp-unsubscribe.js`,
`…\Templates\Subscriptions\mpp-unsubscribe.html`,
`…\Services\SubscriptionsApiService.js`,
`…\PortalComponents\Controllers\Api\SubscriptionsApiController.cs`,
`…\PortalComponents\DataManagers\SubscriptionsManager.cs`,
and **`…\DatabaseScripts\ApplicationLabels\mpp-unsubscribe.json`** — the seven legacy labels already
translated into Spanish and Portuguese, which seed two of our three catalogues (see *i18n
namespace*).

## What legacy does

Read off `S:\MP\mp-Widgets`. Four files, and the shape is simpler than the finding assumed.

**The recipient is identified by query string, not by attribute and not by a token.**
`PortalComponents/ClientApp/Components/mpp-unsubscribe.js:71-73`:

```js
const urlParams = new URLSearchParameters(window.location.search);
this.contactGuid = urlParams.get("cg");
this.publicationId = urlParams.get("pubid") || 0;
```

**It unsubscribes on load, before any interaction** (`:93`, comment *"Automatically unsubscribe on
load"*), then reveals the email address (`:110`, `data.emailAddress` written straight into
`innerHTML`) and shows an Undo button (`:124`). The success copy branches on `pubid`:
`successfulUnsubscribeLabel` when `> 0`, `successfulBulkEmailOptOut` otherwise (`:115-122`). Undo
calls the mirror endpoint and hides its own button (`:137-156`, hide at `:151`).

**The one attribute is a link-out**, not an identifier: `mysubscriptionswidgettargeturl`
(`:20-24`, `:29-30`), configurator-described as *"Identifies the URL where the My Subscriptions
Widget is configured"*. The button is shown only when it is set (`:158-165`). The template
(`Templates/Subscriptions/mpp-unsubscribe.html:4-24`) is a spinner, a bold `Email: <span>`, an
alert region, and the two buttons.

**The transport is a mutating GET.** `Services/SubscriptionsApiService.js:20-27` builds
`/Api/SubscriptionsApi/Unsubscribe?contactGuid=…&publicationId=…` and calls `Ajax.Get`. Server side
`Controllers/Api/SubscriptionsApiController.cs:109-125` marks both actions `[HttpGet]
[AllowAnonymous]` with `int publicationId = 0`. **Do not copy this** — see the prefetch ruling.

**What it writes** (`DataManagers/SubscriptionsManager.cs:227-289`):

- `publicationId > 0`: reads `dp_Contact_Publications` with
  `Contact_ID_Table.Contact_Guid = '<cg>' AND Publication_ID = <n>` (`:233-234`) and sets
  `Unsubscribed = true` on **every** matching row (`:252-262`, comment *"Need to unsubscribe from
  all matching results"* — so duplicate `(Contact_ID, Publication_ID)` rows occur in the field).
  It creates no row when none exists.
- `publicationId == 0` or absent: reads `Contacts` by `Contact_Guid` (`:275`) and calls
  `BulkEmailOptOut(contactId, true)`, which writes `Contacts.Bulk_Email_Opt_Out` (`:211-221`).
- Undo is the same method with `undoLastTransaction = true`, writing `!undoLastTransaction`.

**Three legacy bugs to not port:**

1. **Undo writes only the first row** (`:240-250`) while unsubscribe writes all of them. A contact
   with duplicate rows can be unsubscribed but not fully undone.
2. **Undo forces `false` rather than restoring the prior value** (`:247`, `:280`). Someone who was
   already opted out before they clicked gets *opted back in* by pressing Undo.
3. **`Success = true` is returned even when nothing matched** (`:265`, `:284`, with
   `EmailAddress = null`). That is accidentally the right privacy behaviour — no existence
   disclosure — and we keep the behaviour deliberately, not accidentally.

## The identification decision

### What MP's send pipeline actually offers — the roadmap's cheapest question, answered

Measured against the live reference domain over `mp_query` (read-only):

| Check | Result |
|---|---|
| `Contacts.Contact_GUID` exists | **Yes** — `Guid`, `Required = Yes` (`mp_lookup Contacts`) |
| Communications in the domain | 1047 |
| …containing `unsubscribe.aspx` | **0** |
| …containing `pubid=` | **0** |
| …containing `cg=` | **1** — stock template `Communication_ID = 66` |
| …containing the literal `Contact_GUID` | **1** — the same template |

Template 66 (*"[Nickname], your User Account for MPI!"*, `Template = true`) carries:

```
https://mpi.ministryplatform.com/portal/my_user_account.aspx?dg=[Domain_GUID]&cg=[Contact_GUID]
```

**And the legacy stack itself generates no such link either.** `S:\MP\mp-Widgets\DatabaseScripts`
(1,922 lines of SQL across 8 scripts plus 28 `api_MPPW_*` procs) contains **no unsubscribe URL, no
`cg=`, and no `[Contact_GUID]` merge token**. The only `unsubscribe` hit in the whole SQL set is
`CASE WHEN CP.Unsubscribed = 1 THEN 0` in `StoredProcedures/api_MPPW_SearchSubscriptions.sql:28`,
and the only bracketed GUID merge tokens anywhere are `[Form_GUID]` in
`api_MPPW_GetEvents.sql:81` and `api_MPPW_GetPledgeCampaign.sql:63`. So neither MP's send pipeline
nor the legacy widget stack ever assembled the link: **the church authored it in a message
template.** That is negative evidence, and it is the strongest kind available here — the place a
generated link would have to live has been searched and is empty.

Two conclusions, both load-bearing:

1. **`[Contact_GUID]` is a real, supported merge token, and `?cg=` is MP's own house convention**
   for identifying a recipient in an emailed link. This is not a guess about what the merge engine
   might do — it is MP's own shipped template doing it, and legacy's widget reading the parameter
   MP's Portal writes.
2. **MP generates no unsubscribe link of its own.** Every stock template's footer is a
   MailChimp-inherited editable region, `mc:edit="unsubscribe"`, whose content is inert boilerplate
   — *"This Email was sent to you by MPI. You may need to allow your email client to display
   images…"* — with **no link and no token in it**. The word "unsubscribe" in those bodies is a
   region *name*, which is why a naive `LIKE '%unsubscribe%'` matches nearly everything and means
   nothing. So C72 does **not** drop to a convenience gap: a church that adds no footer of its own
   has no unsubscribe at all.

### Why sealed-token-only is not merely awkward — it is unimplementable

`ROADMAP-missing-widgets.md` and C72's *Suggested fix* both propose that the email template embed a
sealed token. **MP's template merge engine substitutes field tokens. It cannot compute an HMAC or an
AES-GCM seal.** There is no `[Sealed_Unsubscribe_Token]` and no way to author one, because the value
is per-recipient and cryptographic. Unless *we* do the sending — and for a bulk publication send we
do not; MP does — the only per-recipient unguessable value that can reach the link is
`[Contact_GUID]`.

That is decisive on its own. It is reinforced by the two facts the brief flags: MP's own house link
shape is `?cg=`, and every unsubscribe link already sitting in a recipient's inbox uses
`?cg=&pubid=`. A sealed-token-only route would be incompatible with the emails MP generates, with
the emails already sent, **and with the merge engine itself.**

### Is accepting a `Contact_GUID` from a query string acceptable?

Honestly weighed, yes — scoped to this one route, and with mitigations.

**For.** A `uniqueidentifier` is ~122 bits of entropy. It is an unguessable bearer capability, not
the enumeration hazard C72 feared: that fear is correct about `contactId=1,2,3…` and simply does not
transfer to a GUID. And what the capability authorises here is narrow: unsubscribe this contact from
one publication or from bulk email, and undo that. It reads nothing but the email address (which we
mask), authenticates nobody, and mints no session. MP already treats the same GUID as a Portal
capability in the same URL position (`my_user_account.aspx?cg=`), so we are not introducing the
property — we are consuming an MP-wide one.

**Against, and these are real.** It **never expires**. It sits in mail archives, corporate mail
gateways, browser history and `Referer` headers indefinitely. It is the *same* GUID used elsewhere
in MP, so a leak is not confined to unsubscribe. A forwarded newsletter hands the forwardee a
permanent unsubscribe capability over the forwarder.

**Mitigations we take** (each detailed below): the widget strips `cg`/`pubid`/`t` from the address
bar with `history.replaceState` immediately after reading them (precedent: `checkout.ts:128-140`),
so the GUID does not survive in the visible URL or in any subsequent same-page `Referer`; the email
address comes back masked; there is a per-capability rate limit keyed on `sha256Hex(cg)`; and the
GUID is never logged. What we cannot fix is the permanence, and we should not pretend to: an
unsubscribe capability that expires is itself a compliance regression, because a recipient digging
up a six-month-old email must still be able to get off the list.

### Ruling

**Accept both, in one route, with a defined precedence.**

| Path | Parameter | Who mints it | Expiry | Why it exists |
|---|---|---|---|---|
| Capability GUID | `cg` (+ optional `pubid`) | MP's merge engine, from `[Contact_GUID]` | none | The only path MP can produce. Compatible with already-sent mail and with legacy's landing page. |
| Sealed action token | `t` | **us**, where we control the send | 180 days | Narrower (carries only what this action needs), revocable by rotating the secret, and the only shape a mailbox-provider one-click POST could ever use. |

Precedence: **a valid `t` wins over `cg`.** An *expired or tampered* `t` falls back to `cg` when
`cg` is also present — which is the sharpest argument for two paths rather than one: `cg` is the
path with no expiry, and expiry is exactly why a sealed token cannot be the only path. Neither
present, or a malformed `cg`, is the `bad-link` state.

`cg` is accepted **at this route only**, and that restriction should be written into the route's
header comment so nobody generalises it.

## Attribute surface

Kebab-case throughout, per `C79` / `CROSS-4` ("widget attributes are kebab-case", and CROSS-4's
proposed `observedAttributes` guard test regex `/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` — every name below
passes it).

| New name | Legacy name | Required | Meaning |
|---|---|---|---|
| `my-subscriptions-url` | `mysubscriptionswidgettargeturl` | no | Absolute URL of the page carrying `next-subscriptions`. Renders the "Manage all my email preferences" link. Omitted when unset (legacy hides the button — same behaviour). **Scheme-restricted to `http:`/`https:`**; anything else is dropped with one `console.warn` naming the attribute, per CROSS-4's *"declared and not honoured must warn"* rule. |
| `api-host` | — | no | Standard across the SDK. |
| `cg-param` | — | no | Name of the query parameter carrying the GUID. Default `cg`. Exists because a church CMS may already own `cg`; mirrors `next-plan-your-visit`'s `verify-param-name` (`plan-your-visit.ts:107`). |
| `pubid-param` | — | no | Default `pubid`. Same reason. |
| `token-param` | — | no | Default `t`. The sealed path. |
| `show-email` | — | no | `"false"` drops the masked-address line entirely, for a church that wants zero disclosure. Default `"true"` (masked, never full). |
| `lang` | — | no | Base-class behaviour, `MutationObserver`-watched, **not** in `observedAttributes`. |

**No `publication-id` attribute — deliberate.** The publication comes from the link, not the
markup, so one landing page serves every publication. A church wanting a per-publication landing
page hardcodes `?pubid=` in its template, which is the same outcome without a second configuration
surface to get wrong.

## URL parameter surface

| Param | Legacy | Required | Meaning |
|---|---|---|---|
| `cg` | `cg` | one of `cg` / `t` | `Contacts.Contact_GUID`, merged by MP as `[Contact_GUID]`. Validated against a strict RFC 4122 shape before it reaches anything. |
| `pubid` | `pubid` | no | `dp_Publications.Publication_ID`. **Absent, empty or `0` → the bulk-email opt-out path**, exactly as legacy (`mpp-unsubscribe.js:73`; `SubscriptionsApiController.cs:121` defaults it to `0`; `SubscriptionsManager.cs:231`). |
| `t` | — | one of `cg` / `t` | Sealed action token for links we mint. Self-contained (carries the GUID and optional publication id), so it needs no companion params. |
| `dg` | `dg` (MP Portal) | ignored | MP's Portal templates pass `dg=[Domain_GUID]`. This deployment is single-domain; read and ignored so a church can paste an MP-shaped link unchanged. Documented in the migration note; **no** warn, because this is a URL parameter we chose to tolerate, not a declared attribute we failed to honour. |

## Server

### Service methods — extend `src/services/subscriptionService.ts`

The service already owns `dp_Publications` and `dp_Contact_Publications` and already has
`getContactIdByUserGuid` — which resolves **`dp_Users.User_GUID`**, a different column from the
`Contacts.Contact_GUID` we need. Add a sibling rather than overloading it; the name difference is
the whole point.

```ts
/** A GUID that reached MP-facing code has always passed this. */
export function isContactGuid(value: unknown): value is string;   // strict RFC 4122 shape

export interface UnsubscribeOutcome {
  /** A contact matched the capability. **Never serialised to the client.** */
  matched: boolean;
  /** Masked for display (`j•••@g•••.com`), or null. Masked server-side. */
  emailMasked: string | null;
  /** Already opted out before this call — i.e. there is nothing to undo. */
  wasAlreadyOptedOut: boolean;
  /** Rows / fields actually written. For the log line, not the response. */
  changed: number;
}

/** Contacts.Contact_GUID → contact id + address + current bulk flag. Read-only. */
public async getContactByContactGuid(
  contactGuid: string,
): Promise<{ contactId: number; email: string | null; bulkEmailOptOut: boolean } | null>;

/**
 * publicationId > 0  → dp_Contact_Publications.Unsubscribed = true on EVERY row
 *                      matching (Contact_GUID, Publication_ID). Creates none.
 * publicationId 0/undefined → Contacts.Bulk_Email_Opt_Out = true.
 */
public async unsubscribeByContactGuid(args: {
  contactGuid: string;
  publicationId?: number;
}): Promise<UnsubscribeOutcome>;

/** The undo. Only ever writes `false` — see below. */
public async resubscribeByContactGuid(args: {
  contactGuid: string;
  publicationId?: number;
}): Promise<UnsubscribeOutcome>;
```

**Why `resubscribeByContactGuid` takes no "prior state" argument.** Undo happens in a second HTTP
request, so a naive "restore what it was" needs the prior value to survive — either the client
echoes it (and can lie) or the server stores it (state, for a 30-second affordance). Neither is
needed: undo may only ever *reduce* an opt-out, so it writes `false` unconditionally and the
**widget decides whether to offer the button** from `canUndo` (`matched && !wasAlreadyOptedOut`).
Someone who was already opted out sees no Undo button, which is both the honest UI and the fix for
legacy bug (2). No stored state, no client-supplied state, and the legacy footgun is structurally
absent.

### MP tables and columns written

| Path | Read | Written |
|---|---|---|
| Per-publication (`pubid > 0`) | `dp_Contact_Publications.Contact_Publication_ID, Unsubscribed` filtered `Contact_ID_TABLE.Contact_GUID = '<cg>' AND dp_Contact_Publications.Publication_ID = <n>` | `dp_Contact_Publications.Unsubscribed` on **every** matching row (`Contact_Publication_ID` + the one field) |
| Bulk (`pubid` absent / `0`) | `Contacts.Contact_ID, Email_Address, Bulk_Email_Opt_Out` filtered `Contact_GUID = '<cg>'` | `Contacts.Bulk_Email_Opt_Out` (`Contact_ID` + the one field — **never a whole-record write**) |

Notes that are easy to get wrong:

- The traversal filter is verified working against the live domain:
  `dp_Contact_Publications` + `Contact_ID_TABLE.Contact_GUID IS NOT NULL AND
  dp_Contact_Publications.Publication_ID = 4` returned `Contact_Publication_ID 3 / Contact_ID 98`.
  Note the base-table columns are qualified — required once any `_TABLE` appears
  (`.claude/references/ministryplatform.query-syntax.md`).
- **No row is created when none exists.** Legacy does not, and creating an `Unsubscribed = true`
  row on demand would let a link-holder write rows for a contact who never subscribed. "Never
  subscribed" and "unsubscribed" are the same outcome for the recipient, and the response is
  identical either way.
- **All matching rows in both directions** — fixes legacy bug (1).
- **`DomainTimezoneService` does not apply here.** No datetime crosses the MP boundary on either
  path. Stated so nobody adds a `new Date().toISOString()` "audit" field.
- The GUID is validated with `isContactGuid` **before** it is interpolated into any filter. That is
  the injection control (legacy's equivalent is `.Clean()`), and it is also what makes the
  malformed-vs-unknown split below possible.

### Route — `POST /api/embed/unsubscribe`

**One route, not two.** Legacy has `Unsubscribe` and `UndoUnsubscribe`; here every guard (auth,
both rate limits, GUID validation, masking, the uniform response) is identical, and duplicating
them across two files is how they drift. The direction is a body field.

```
POST /api/embed/unsubscribe
Authorization: Bearer <widget JWT>        // required; `sub === "public"` is accepted
Content-Type: application/json

{ "cg"?: string, "pubid"?: number, "token"?: string,
  "action"?: "unsubscribe" | "resubscribe" }     // default "unsubscribe"
```

`requireWidgetAuth(req, { widget: ["unsubscribe", "subscriptions"] })` — **not `"*"`**. Least
privilege: `next-subscriptions` needs it for the Phase-5 link-out, nothing else does.

```
200 { "success": true,
      "scope": "publication" | "bulk",
      "publicationId": number | null,
      "email": string | null,      // masked, or null
      "canUndo": boolean }
```

`OPTIONS` via `buildOptionsResponse(req)`. **No `GET` export at all** — see the prefetch ruling.

| Code | Status | When | Catalogue key |
|---|---|---|---|
| `invalid_request` | 422 | No capability at all, or a `cg` that fails `isContactGuid` | `errors.invalidRequest` (existing, via `WIRE_CODE_KEYS`) |
| `validation_failed` | 400 | Zod rejects the body (bad `action`, non-numeric `pubid`) | `errors.validation_failed` (existing) |
| `link_expired` | 422 | `t` is expired, tampered, or minted for another `typ`, **and** no usable `cg` | **`errors.link_expired` — new, all three locales** |
| `rate_limited` | 429 | Either limit tripped | `errors.rateLimited` (existing, via `WIRE_CODE_KEYS`) |
| `save_failed` | 502 | MP accepted the read but the write failed | `errors.saveFailed` — existing sentence, **new `WIRE_CODE_KEYS` entry** `save_failed → errors.saveFailed` |
| `internal_error` | 500 | Anything else | `errors.generic` (existing, via `WIRE_CODE_KEYS`) |

So the copy cost is **one** new sentence in three locales, plus one `WIRE_CODE_KEYS` line. Reusing
`errors.saveFailed` through the map, rather than inventing `errors.save_failed`, is exactly what
`WIRE_CODE_KEYS` exists for (CLAUDE.md, *API errors are machine codes*).

**Not reused on purpose:** `invalid_code`. Its English is *"That sign-in link is no longer valid.
Please sign in again."* — the wrong sentence here, and CLAUDE.md names it a protocol signal the SDK
auth ladder reads. Do not overload it.

### Auto-unsubscribe on load, or one click?

**Ruling: no interaction required — the widget acts on load — but the mutation is a `POST`, never a
`GET`.**

The compliance argument is about the link *working*, not about being careful: RFC 8058 and every
mailbox provider's expectation is that following the link completes the opt-out, and a confirm click
is measurable drop-off on the one flow we are obliged to make easy. Legacy's UX is right.

Legacy's *transport* is wrong. `Ajax.Get` against `[HttpGet]` (`SubscriptionsApiService.js:20-27`,
`SubscriptionsApiController.cs:118-121`) is a state-changing GET, and state-changing GETs in email
get fetched by things that are not people: mailbox link scanners, corporate URL-rewriting gateways
(Proofpoint, Mimecast), browser and OS link previews. That is how you silently unsubscribe a
congregation and never find out.

The resolution is structural rather than a mitigation:

1. The emailed link is a **navigation to the church's HTML page.** That is a GET and it only
   renders. A scanner that fetches the page runs no JavaScript and changes nothing.
2. The state change is a **`POST` the widget issues from JavaScript** once mounted.
3. The POST needs a **widget JWT**, which needs a `POST /api/embed/session` from an
   origin in `EMBED_ALLOWED_ORIGINS`. A scanner cannot produce one.

Two independent reasons a scanner cannot trip it, and the human experience is identical to legacy's.

### Undo

**Keep it.** It is a good affordance in general and it is the specific remedy for a mis-click or a
forwarded link — the honest answer to the residual risk we accepted in the identification ruling.

- **Authorised by the same capability the page already holds.** The widget keeps the `cg`/`t` it
  read from the URL in a private field and replays it with `action: "resubscribe"`. Undo mints **no
  new capability**, and there is no undo link in the email.
- **Available for the life of the rendered page**, with no separate expiry. An expiring undo buys
  nothing: re-opening the same link re-unsubscribes anyway, so the capability's lifetime already
  bounds it. Say this rather than inventing a timer.
- **It only ever reduces an opt-out** (writes `false`), and it is not offered at all when
  `canUndo === false`. Fixes legacy bugs (1) and (2).

### Reveal of the email address

**Ruling: mask it, server-side, and let a church suppress it entirely.**

Legacy writes the full address into `innerHTML` (`mpp-unsubscribe.js:110`). That turns a leaked or
forwarded link into an email-address lookup keyed by a never-expiring GUID — precisely the property
we conceded above, so it is the one place we should not copy legacy.

But dropping it loses something real: the reveal answers *"is this the address they have for me?"*,
which is why the recipient clicked in the first place. A mask preserving the first character of the
local part, the first character of the domain label and the TLD (`j•••@g•••.com`) answers that for
someone who knows their own addresses and tells a link-holder almost nothing.

The masking happens **in the service, before the value leaves the server** — masking in the widget
would still put the full address in a response body sitting in an HTTP cache. `show-email="false"`
drops the line for a church that wants nothing shown. The label reuses `fields.email`.

### What the recipient sees when the GUID is unknown or malformed

**Ruling: unknown is byte-identical to success. Malformed never reaches the server.**

- **Unknown GUID** (well-formed, no matching contact): `200 { success: true, scope, publicationId,
  email: null, canUndo: false }` — the same shape and status as a real unsubscribe, differing only
  in fields that are legitimately `null`/`false` for a real contact too (no address on file,
  already opted out). **Never a 404.** A distinguishable 404 makes the route an oracle for
  *"is this GUID a live contact"*. It is also the right thing to show: either we unsubscribed them,
  or the address was never subscribed — in both cases they will not receive that email.
- **Malformed `cg`** (not GUID-shaped) is a *broken* link, not a *wrong* one, and gets its own
  `bad-link` state. Crucially the distinction is made **client-side from the URL shape, with no
  request** — the widget validates before it POSTs. The server also answers `invalid_request`, but
  no legitimate visitor reaches it.
- **Timing.** The unknown path is not measurably faster: it performs the same MP read (returning
  zero rows instead of one) with no early return before it, and assembles the response the same
  way. I will not over-claim constant time — the difference is one MP query's row count, far below
  the noise floor of a cross-internet request, and the per-capability rate limit is the real
  control.
- **The route never reports whether a `pubid` names a real publication**, which is why the success
  headline does not name the publication (below).

### Rate limiting

A legitimate recipient hits this **once** — twice with an undo, three times with a re-click. So:

```ts
// Both checked BEFORE any MP read; both answer `rate_limited` / 429.
await checkRateLimit(`unsub:ip:${getClientIp(req)}`, 10);
await checkRateLimit(`unsub:cap:${await sha256Hex(capability)}`, 5);
```

- **10/min per IP** — generous enough for a household behind one NAT plus a re-click, tight enough
  that an IP is not a bulk tool.
- **5/min per capability, hashed** — this is the one that matters. An attacker holding one scraped
  GUID and a botnet defeats an IP limit; the per-capability limit caps them at
  "unsubscribed, undone, unsubscribed", which is already the honest outcome of holding the link.
  `sha256Hex` so the GUID never reaches Redis in cleartext.
- `checkRateLimit` **fails open** on a store outage (`rate-limit.ts:33-40`). That is the correct
  trade here and should be noted rather than "fixed": a Redis blip must not break a compliance path.

## Widget

`next-unsubscribe`, Shadow DOM, extends `MPNextWidget`. Six states.

| State | Trigger | Renders |
|---|---|---|
| `working` | Mounted, capability parsed, POST in flight | Spinner + `unsubscribe.working`. Legacy's `#loadingContainer`. |
| `done` | 200, `canUndo: true` | `donePublication` or `doneBulk`; masked email line; **Undo**; the manage-preferences link when configured |
| `done-final` | 200, `canUndo: false` | Same headline, **no** Undo. Covers "already opted out" *and* "unknown GUID" — indistinguishable by design |
| `undone` | `resubscribe` succeeded | `unsubscribe.undone`; Undo gone (legacy hides it, `:151`); manage link stays |
| `error` | Non-2xx | `this.errorText(payload)` + `common.retry` |
| `bad-link` | No `cg` and no `t`, or a malformed `cg` — **decided client-side, zero fetches** | `unsubscribe.badLink` + the manage link, which is the genuinely useful escape hatch |

Mechanics that are requirements, not style:

```ts
connectedCallback() {
  this.injectStyles(this.getStyles());
  void this.initLocale().then(() => { this.render(); this.init(); });
}
```

`await this.initLocale()` **before the first `render()`** (CLAUDE.md). This widget is the strongest
case for it in the catalogue: it paints exactly one sentence and then stops, so an
English-then-Spanish swap would be the entire visible experience.

- **Strip the capability from the address bar** immediately after reading it —
  `history.replaceState` removing `cg`/`pubid`/`t`, precedent `checkout.ts:128-140`. Keeps the GUID
  out of the visible URL, out of anything the host page's analytics reads from `location.search`,
  and out of the `Referer` of any later same-page navigation. Held in a private field for the undo.
- `disconnectedCallback()` **must call `super.disconnectedCallback()`** (CLAUDE.md; the base class
  unsubscribes the locale listener and the `MutationObserver` there).
- The headline lives in `role="status" aria-live="polite"` so the `working → done` transition is
  announced (CROSS-3). No extra catalogue key — the headline itself is the announcement.
- Events emitted: `unsubscribed` (`{ scope, publicationId }`), `resubscribed`, `unsubscribeError`.
- **Never join two template literals with `+`** — the mask builder and the filter strings are the
  two obvious places to slip (`src/lib/no-template-concat.test.ts`).

### i18n namespace

**`unsubscribe`, in `locales/<code>/account.ts`.** Not `giving.ts` — even though `subscriptions`
lives there today. That placement is itself a misfiling (publications are not giving), but moving it
is a rename across three catalogues plus an `i18n-sync` baseline re-record, and it is not this
plan's job. `account.ts` already holds the account-level surfaces (`myInvoices`, `userMenu`), which
is where communication preferences belong. A new namespace should land in the right file rather than
join an existing mistake. **Follow-up for `subscriptions.md`:** move `subscriptions` to `account.ts`
alongside it.

**Reused before adding anything:** `common.retry`, `common.loading`, `fields.email`, and the whole
`errors.*` namespace via `errorText`.

**The `es` and `pt-BR` translations already exist and are vetted — seed from them.**
`S:\MP\mp-Widgets\DatabaseScripts\ApplicationLabels\mpp-unsubscribe.json` carries all seven legacy
labels with `english` / `spanish` / `chinese` / `portuguese`. We ship `en`/`es`/`pt-BR`, so two of
three catalogues come from a source a church has already been reading in production. **Caveat: the
Portuguese is European-flavoured and second-person-informal** — `Foste excluído`, `as tuas
preferências`, `Desfaz`, `Minhas Subscrições`. We ship `pt-BR`, which wants `você` and Brazilian
lexis (`inscrição`/`cancelar a inscrição` over `subscrição`). That is a light pass per string, not a
rewrite. The Spanish is `tú`-informal and reads fine as-is.

**New keys** — nine, all under `unsubscribe.`, with the legacy label each derives from:

| Key | English | Legacy label | Verdict |
|---|---|---|---|
| `working` | "One moment — updating your email preferences…" | — (legacy shows a bare spinner) | **new** |
| `donePublication` | "You have been unsubscribed." | `successfulUnsubscribeLabel` | **adapt** — take the first sentence only (see below) |
| `doneBulk` | "You have been removed from bulk email." | `successfulBulkEmailOptOut` | **adapt** — first sentence only |
| `undoButton` | "Undo" | `undoButtonText` | **verbatim** (`es` "Deshacer", `pt` "Desfazer" — both fine for `pt-BR`) |
| `undone` | "You have been re-subscribed." | `undoUnsubscribeSuccess` | **verbatim** en/es; `pt` "Foste re-subscrito." → `pt-BR` "Sua inscrição foi reativada." |
| `undoFailed` | "Unable to undo unsubscribe." | `unableToUndoUnsubscribeError` | **adapt** — legacy's `es`/`pt` are *wrong*: both read "No es posible anular la suscripción" / "Não é possível cancelar a subscrição", i.e. identical to `unableToUnsubscribeError` and describing the opposite action. Write these two fresh. |
| `manageLink` | "Manage all my email preferences" | `mySubscriptionsButtonText` ("My Subscriptions") | **adapt** — legacy's button label is a widget name, not an action; ours says what the link does |
| `badLink` | "This unsubscribe link is incomplete. Please use the link in a recent email from us." | — | **new** |
| `title` | "Email Preferences" — the `role="status"` region's accessible label | — | **new** |

**Adopt verbatim:** `undoButtonText`, `undoUnsubscribeSuccess` (en/es), `unableToUnsubscribeError`
→ mapped onto `errors.saveFailed` rather than a new key.
**Do not adopt:** the trailing half of both success labels. Legacy's full string is *"You have been
unsubscribed. Didn't intend to unsubscribe? Undo or update your subscription preferences via My
Subscriptions. Thank you!"* — which usefully **confirms that Undo plus the link-out is the intended
pairing** (design questions 2 and 3, settled from the source rather than inferred) but is bad copy
to port: it is prose that names two buttons, so it breaks when `my-subscriptions-url` is unset,
duplicates the accessible name of controls that are right there, and triples the length of the one
sentence a `role="status"` region will read aloud. **Ruling: keep the first sentence as the
headline; let the controls speak for themselves.** That is a deliberate copy improvement, recorded
as such.
**Fix, don't port:** `unableToUndoUnsubscribeError`'s Spanish and Portuguese, which are
mistranslations of the undo case (see the table).

**Two headline keys, not one with a `{scope}` placeholder.** Legacy has exactly this split
(`successfulUnsubscribeLabel` / `successfulBulkEmailOptOut`, `mpp-unsubscribe.js:115-122`) and the
`es`/`pt` pairs in the label file confirm it is structural, not lexical: *"Has sido desuscrito"* vs
*"Has sido eliminado de nuestro servicio de notificaciones"* share no verb.

**The per-publication headline deliberately does not name the publication.** We never read
`dp_Publications.Title` on this path, and naming it would confirm that the link's `pubid` maps to a
real publication — a small oracle for no gain, since the sentence works without it. Legacy does not
name it either, so this is parity, not a loss.

**No plurals in this namespace.** Nothing here is counted, so `catalogue-parity`'s plural-branch
assertion has nothing to check and the `es`/`pt-BR` `many` category is not in play. Worth writing
down because the guard test's existence implies a plural is expected.

`errors.link_expired` (in `core.ts`, all three locales): *"That link is no longer valid. Please use
the unsubscribe link in a recent email, or manage your preferences below."*

## Shared primitives needed

### 1. `sendTemplateMessage` — **not needed. Do not block on it.**

Nothing in the unsubscribe flow sends an email. Worth recording anyway: the roadmap says
`planYourVisitService.ts` implements this inline and is "the thing to extract" — but
`src/services/messageTemplateService.ts` already exists with `sendMessageTemplate()` and
`sendCommunicationTemplate()`. The extraction appears done; the roadmap entry is stale and C69/C70
should check it before rebuilding.

### 2. Sealed anonymous action tokens — **needed for Phase 4. C70 needs the same thing.**

Generalise `src/lib/embed/verify-token.ts` (whose `typ` is hardcoded `"pyv-verify"`) into
`src/lib/embed/action-token.ts`:

```ts
export type ActionTokenType = "pyv-verify" | "unsubscribe" | "publication-optin";

export interface ActionToken<P> { typ: ActionTokenType; data: P; iat: number; exp: number }

export async function createActionToken<P extends object>(
  typ: ActionTokenType, data: P, expirySeconds?: number,
): Promise<string>;

/** `typ` is the EXPECTED type, compared against the token's — never trusted from it. */
export async function verifyActionToken<P>(
  typ: ActionTokenType, token: string, guard: (data: unknown) => P | null,
): Promise<ActionToken<P> | null>;
```

What I require of it:

- **A token minted for one `typ` must never verify under another.** That is the whole reason
  `verify-token.ts` hardcodes its `typ`, and generalising it must preserve the property rather than
  lose it — hence the expected `typ` as an argument, compared, never read from the token and
  trusted. I will assert this at my own route boundary regardless of what its own tests do.
- HS256 over `getJwtSecret()`, as today. **No new dependency** (jose is present).
- **No `iss`/`aud` requirement on verify**, as `verify-token.ts` already documents — it matters more
  here, since an unsubscribe link may be opened months after the deploy that sent it.
- **Per-`typ` default expiry, and `unsubscribe` wants 180 days.** A short-lived unsubscribe token is
  a compliance regression. The route's `t`-expired → `cg` fallback exists because of this.
- My payload: `{ contactGuid: string; publicationId?: number }` — the **GUID**, not a `Contact_ID`,
  so the service has one lookup path rather than two.
- **Migration:** `createVerifyToken` / `verifyVerifyToken` become thin wrappers over
  `createActionToken("pyv-verify", …)` so `next-plan-your-visit` and its tests keep working
  unchanged. Tokens already emailed keep verifying — the wire format is unchanged.

### 3. An anonymous-write route convention — **C70 and C72 define it. Proposal:**

```ts
// src/lib/embed/anonymous-route.ts
export async function withAnonymousWrite<T>(
  req: NextRequest,
  opts: { widget: string | string[]; limits: Array<{ key: string; limit: number }> },
  handler: (claims: WidgetClaims) => Promise<{ status: number; body: T }>,
): Promise<NextResponse>;
```

Six rules it encodes, in priority order:

1. **A widget JWT is still required.** `requireWidgetAuth` enforces the origin allowlist.
   "Anonymous" means `claims.sub === "public"` is *accepted*, **not** that the route is
   unauthenticated. This is the most important rule and it is what makes the family safe: a
   scanner, a bot, or a `curl` from an unlisted origin cannot obtain a token.
2. **`POST` only.** No mutating `GET`, ever. `OPTIONS` from `buildOptionsResponse`.
3. **Rate-limit before any MP read** — per IP *and* per capability, capability keys hashed with
   `sha256Hex`.
4. **Uniform response.** Success, unknown-subject and already-in-that-state share one shape and one
   status. No 404 for "no such subject".
5. **No existence disclosure and no PII echo.** Anything identifying that comes back is masked
   server-side.
6. **Machine codes in `error`, English in `message`**, never the reverse.

If (3) is not ready when Phase 2 lands, the route is written inline against `requireWidgetAuth` +
`checkRateLimit` and refactored onto the helper later — but **the rules must be written down now**,
because C70 lands beside it and two hand-rolled conventions is the failure mode the roadmap warns
about.

## Tests

| File | Asserts |
|---|---|
| `src/services/subscriptionService.test.ts` (extend) | `isContactGuid` rejects non-GUIDs **before any MP call**; per-publication path writes **every** matching row; no row → **no create**; bulk path writes only `Contact_ID` + `Bulk_Email_Opt_Out`; `wasAlreadyOptedOut` reflects the prior read; `resubscribe` only ever writes `false`; unknown GUID → `matched: false`, zero writes; the masked address never contains the full local part |
| `src/app/api/embed/unsubscribe/route.test.ts` | **no `GET` export**; a `sub: "public"` claim is accepted; **unknown and known GUID bodies are deep-equal** after nulling `email`; both rate limits, each returning 429 + `rate_limited`; `invalid_request` for a malformed `cg`; `link_expired` for a tampered `t` with no `cg`; a valid `t` **wins** over `cg`; an expired `t` **falls back** to `cg`; a token minted with `typ: "pyv-verify"` is **rejected** (cross-`typ` guard); **no `Set-Cookie`** on any path; CORS headers on success *and* error |
| `packages/embed-sdk/src/components/unsubscribe.test.ts` | `initLocale()` resolves **before** the first `render()` (spy ordering); `bad-link` renders with **zero** fetches; POST body carries `cg`/`pubid`/`action`; `canUndo: false` renders no Undo; undo hides the button and shows `undone`; `history.replaceState` clears `cg`/`pubid`/`t`; `disconnectedCallback` calls `super`; `es` and `pt-BR` render translated headlines; a `javascript:` `my-subscriptions-url` is dropped and warns **once** |
| `packages/types/src/unsubscribe.test.ts` | Zod round-trip; `pubid` absent, `""` and `0` all resolve to the bulk path **identically** |

**Existing guard tests that fail if the work is incomplete:**

- **`i18n/no-english-literals.test.ts`** — `BUDGET` is `{}` and must stay `{}`. **Any** literal in
  `unsubscribe.ts` fails the run. No budget entry is to be added for this widget: the catalogue
  ships complete in the same commit as the component (Phase 3).
- **`i18n/catalogue-parity.test.ts`** — the `unsubscribe` namespace missing from `es`/`pt-BR`, or a
  placeholder mismatch.
- **`i18n/error-codes.test.ts`** — `link_expired` without `errors.link_expired` in all three, or
  `save_failed` without its `WIRE_CODE_KEYS` entry. It scans `src/app/api/embed/**` for
  `error: "…"` object properties, so it finds the new route automatically.
- **`tsc --noEmit`** — `es`/`pt-BR` `satisfies Messages` fails on a missing, extra or misspelled key.
- **`src/lib/no-template-concat.test.ts`** — repo-wide.
- **CROSS-4's proposed `observedAttributes` kebab-case guard**, if it has landed. All five
  attributes pass.

## Security

- **The capability analysis** is the *Identification decision* section above: a 122-bit GUID is an
  unguessable bearer capability, not an enumeration hazard; it never expires and we accept that,
  because an expiring unsubscribe is itself a compliance regression; and MP already treats the same
  GUID this way on its Portal.
- **Enumeration is impossible.** The only identifiers accepted are a GUID-shaped value and a signed
  token. There is no integer contact path, no email path, and no listing endpoint. `pubid` *is* an
  integer, but it is not a capability — it only narrows what a capability-holder can do to
  themselves, so guessing one gains nothing.
- **No existence disclosure.** Uniform 200 for unknown, known, and already-opted-out. No 404.
  Malformed input is separated client-side, before a request exists.
- **Prefetch and scanner mitigation.** `POST` only, no `GET` export, and the POST requires a widget
  JWT obtainable only from an allowlisted origin. The emailed link resolves to an HTML page that
  changes nothing when fetched.
- **PII disclosure** is one masked address, masked server-side, suppressible with
  `show-email="false"`.
- **Rate limits**: 10/min/IP and 5/min per hashed capability, both before any MP read.
- **No session, no cookie, no token is issued.** Holding a `cg` never becomes an authenticated
  session. The route test asserts no `Set-Cookie`.
- **CSRF is not a concern, and here is why:** the POST needs a `Bearer` widget JWT, which is not
  ambiently available to a cross-site form, and the SDK fetches with `credentials: "omit"` so no
  cookie rides along.
- **Never log the GUID or the address.** CLAUDE.md's *never log token material* extends to a `cg`,
  which is a bearer capability. The error path logs the outcome and at most a hashed capability
  prefix.
- **This is the second route in the tree to accept `sub === "public"`** (after
  `plan-your-visit/send-verification`). Name the other one and the reason in the route's header
  comment, so a future reader tightening the codebase does not "fix" it.
- **Legacy's anonymous surface has no rate limit at all, and we are fixing that rather than porting
  it.** `SubscriptionsApiController.cs` exposes four `[AllowAnonymous]` actions — `GetPublication`
  (`:64-83`), `VerifyEmailLink` (`:85-105`), `UndoUnsubscribe` (`:109-116`) and `Unsubscribe`
  (`:118-125`) — and **not one of them is rate-limited or origin-checked.** So yes, the class of
  defect C69 found in `SendVerificationEmail` is shared by this controller: that method is
  `[AllowAnonymous]`, accepts a **client-supplied `ContactId`** (`SubscriptionsService.cs:185-188`)
  and an arbitrary `EmailAddress`, and sends mail — an unauthenticated email cannon. We send no
  email on this path, so the cannon itself is C70's problem; what we inherit is the missing limiter,
  and the two-tier limit above is the fix.
- **Also not ported: `GetPublication` returns `NotFound()` for an unknown publication id**
  (`:76-79`), which is a small existence oracle over `dp_Publications`. Ours never reports whether a
  `pubid` names a real publication — see the uniform-response ruling and the "do not name the
  publication" note.
- **Audit attribution is weak, and legacy's is too.** `MPHelper` writes are attributed to the API
  client, so a church auditing *"who unsubscribed this contact"* sees the widget's service account.
  Legacy's GUID path passes no `onBehalfOfUserId` either (`SubscriptionsManager.cs:227` takes no
  user). Flagged as an open question rather than silently accepted.

## Customer migration note

This is the deliverable that makes the widget usable. Goes in README under "Widget Unsubscribe
Links".

**1. Host the landing page on an allowlisted origin — do this first.** The page's origin must be in
`EMBED_ALLOWED_ORIGINS` (`src/lib/embed/config.ts`) or `/api/embed/session` will not mint a token
and every visitor sees an error. This is the number-one setup failure.

**2. The page itself.** Standard SDK snippet plus:

```html
<next-unsubscribe
  my-subscriptions-url="https://www.example.church/email-preferences">
</next-unsubscribe>
```

**No sign-in and no `next-user-menu`** — the whole point is that it works for someone with no MP
login. A `next-user-menu` on the page is harmless but pointless.

**3. Add the footer to every bulk-email template.** MP will not do this for you:

```html
<a href="https://www.example.church/unsubscribe?cg=[Contact_GUID]&amp;pubid=4">
  Unsubscribe from the Weekly Newsletter
</a>
&nbsp;|&nbsp;
<a href="https://www.example.church/unsubscribe?cg=[Contact_GUID]">
  Stop all bulk email
</a>
```

- `[Contact_GUID]` is merged per recipient. **This is not a guess** — MP's own stock template
  (*"[Nickname], your User Account for MPI!"*) uses exactly this token in exactly this position:
  `my_user_account.aspx?dg=[Domain_GUID]&cg=[Contact_GUID]`.
- **`pubid` is hardcoded per template**, to the `dp_Publications.Publication_ID` that template is
  sent for. There is no `[Publication_ID]` merge token in evidence, and a communication's
  `Publication_ID` is a property of the *send*, not of the recipient row the merge runs over. So:
  one footer per publication template. **This is the one fiddly bit of the setup** and it belongs
  in bold in the customer doc.
- Omit `pubid` (or set `0`) for the "stop all bulk email" link — it writes
  `Contacts.Bulk_Email_Opt_Out`.
- **Escape the ampersand as `&amp;`** in an HTML template body. A raw `&` in an `href` inside MP's
  HTML editor is a real, repeated failure mode.

**4. MP generates no unsubscribe link on its own — and neither did the legacy widget stack.** Every
stock template's footer is a MailChimp-inherited `mc:edit="unsubscribe"` region containing plain
boilerplate — no link, no token. Measured on the reference domain: **0 of 1047** communications
contain `unsubscribe.aspx` or `pubid=`, and the legacy stack's own 1,922 lines of database scripts
contain no unsubscribe URL and no `[Contact_GUID]` token either. **A church that skips step 3 has no
unsubscribe at all** — which is C72, restated as a setup instruction.

**5. Already-sent emails keep working.** The parameter names are unchanged from legacy
(`?cg=&pubid=`), so a church that re-points its existing unsubscribe page — or adds a redirect from
it — at the new widget keeps every link already sitting in a recipient's inbox alive. This is the
single strongest practical argument for keeping `cg`, and it is worth telling the customer, not just
ourselves.

**6. RFC 8058 one-click is out of scope.** The mailbox-provider "Unsubscribe" button needs a
`List-Unsubscribe` / `List-Unsubscribe-Post` header on the outbound message, emitted by MP's SMTP
path, which we do not control. Tell churches the link in the body is the supported path. See open
question 1.

## Open questions

1. **`List-Unsubscribe` / RFC 8058.** Gmail and Yahoo require it of bulk senders above their volume
   thresholds. **Proposal:** build the widget now; file a separate item asking MP whether the header
   is configurable per Publication. If it is, it needs a *header-only* route — `POST`,
   `application/x-www-form-urlencoded` `List-Unsubscribe=One-Click`, **no** Bearer token (a mailbox
   provider cannot fetch a widget JWT), and a sealed token in the URL. That is the one place a
   sealed token is genuinely mandatory, which is another reason to settle the primitive's shape in
   Phase 0. **Do not design that route speculatively.**
2. **Audit attribution.** Whether an unsubscribe should leave a trace attributable to the recipient
   (a Contact audit entry, a note on the row) rather than to the API service account. Legacy has the
   same gap. Needs an MP-conventions ruling; not a blocker.
3. **`[Contact_GUID]` in a *bulk* merge, confirmed by a live send.** I confirmed the token in a
   stock **template** (`Communication_ID 66`, `Template = true`). I could **not** confirm it from a
   *sent* message body — no `dp_Communication_Messages` row in the reference domain contains `cg=`,
   and template 66 is triggered by user-account setup rather than a bulk publication send.
   **Proposal:** proceed on the template evidence, and make the first cutover step *"send one test
   bulk email to a selection of one and check the merged link"*. Five minutes, and it de-risks the
   whole feature before any template is edited at scale. **This is the one item I would want
   confirmed by someone with a live send before a church edits templates in bulk.**
4. **Should `next-subscriptions` grow a "stop all bulk email" affordance that mints a `t`?** It is
   the natural first consumer of the sealed path — and the thing that keeps that path exercised
   rather than dead code. `subscriptions.md` already wants an `unsubscribed=1` entry state.
   Recommend yes, Phase 5, but it is a coordination with `subscriptions.md` Phase 2 rather than a
   call this plan should make alone.

## Sequenced phases

Each is independently committable and leaves the suite green.

**Phase 0 — shared primitives** *(dependency, not owned)*. `action-token.ts` and the
anonymous-write convention. **Not a hard blocker:** Phase 2 can land the `cg` path against
`requireWidgetAuth` + `checkRateLimit` inline and be refactored onto the helper. Phase 4 does
require it.

**Phase 1 — types + service.** `packages/types/src/unsubscribe.ts`, the three service methods,
`isContactGuid`, the masking helper, and the service tests. No route, no widget, fully tested.

**Phase 2 — the route, `cg` path only.** Uniform response, server-side masking, both rate limits,
`POST`-only, route tests. `link_expired` is unreachable until Phase 4 and is not yet emitted, so no
catalogue change is needed here.

**Phase 3 — the widget, the demo page, and all three catalogues.** Plus SDK registration: the
`export` and `import` in `index.ts`, the `detectFirstWidgetId` map entry, the `types/widgets.ts`
roster row, and **both** sibling-`api-host` selector lists (`index.ts:145`, `base-widget.ts:112`).
This is the commit that must land the catalogue complete in `en`/`es`/`pt-BR` — `no-english-literals`
has an empty `BUDGET` and will not tolerate a staged conversion. Seed `es`/`pt-BR` from
`ApplicationLabels/mpp-unsubscribe.json` per the adopt/adapt table, then `pnpm i18n:sync` to record
the baselines and `pnpm i18n:check` to confirm nothing is stale.

**Phase 4 — the sealed `t` path.** Adds `link_expired` and its three catalogue entries, the
`t`-wins / `t`-expired-falls-back-to-`cg` precedence, and the cross-`typ` rejection test.

**Phase 5 — link both ways with `next-subscriptions`.** The `unsubscribed=1` entry state
`subscriptions.md` already wants, and a "stop all bulk email" affordance there that mints a `t`.
Coordinated with `subscriptions.md` Phase 2 (C55).

**Phase 6 — docs.** README "Widget Unsubscribe Links" (the migration note above), and mark C72 done
in `ROADMAP-missing-widgets.md` **with the merge-field answer recorded** — that file currently ends
on the open question this plan closes, and leaving it open invites the work being re-sized.

## Depends on / unblocks

Depends on Phase 0's two primitives (soft for `cg`, hard for `t`). Coordinates with
`subscriptions.md` (C55 — both write `Contacts.Bulk_Email_Opt_Out`, so the "two widgets, one field"
staleness note there applies to a page carrying both) and with `profile.md` Phase 3 for the same
reason. **Unblocks C70** by defining the anonymous-write convention and the action-token shape it
consumes. Answers the one open question at the foot of `ROADMAP-missing-widgets.md`.
