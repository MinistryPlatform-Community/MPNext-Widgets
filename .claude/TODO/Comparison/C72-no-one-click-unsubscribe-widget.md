# C72. Legacy `mpp-unsubscribe` has no counterpart — an unsubscribe link in a sent email has nowhere to land

**Widget:** none (old: `mpp-unsubscribe`, "One-Click Unsubscribe" — no sample page)
**Severity:** functional
**Confidence:** confirmed — MPWidgets.js loader table + bundle attribute surface; the new stack's anonymous-write refusal read from source. No browser used.
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

MPWidgets.js knows the tag:

```js
{tag:"mpp-unsubscribe", script:"/dist/Unsubscribe.js", name:"Unsubscribe from Publications"}
```

`observedAttributes` in `/widgets/dist/Unsubscribe.js` is
`["mysubscriptionswidgettargeturl"]`, read via `getAttribute(...)`, described by the
configurator as:

> **Target URL** — "Identifies the URL where the My Subscriptions Widget is configured."

The shape is characteristic and tells you how it works: the widget takes **no**
publication or contact identifier from markup, only a link across to the full
subscriptions page. The identity comes from the URL the recipient arrived on — i.e. this is
the landing page for the unsubscribe link in a sent email. Land, be unsubscribed, and be
offered "manage all your subscriptions" as the follow-up.

The sample site does not place this tag, so it does not appear in the BRIEF's page map;
it was found in the loader table. To compare it you must place the tag yourself — see
CONFIG-MAP.md section 5, and note MPWidgets.js will not pick up a tag injected after its
`DOMContentLoaded` scan.

## New behaviour

No unsubscribe element exists, and — more to the point — **no anonymous path to
unsubscribe exists at all.** `src/app/api/embed/subscriptions/route.ts` rejects
unauthenticated callers:

```ts
if (claims.sub === "public") {
  return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
}
```

`next-subscriptions` requires a signed-in MP user and resolves the contact from
`claims.sub` (`src/services/subscriptionService.ts`). There is no token-addressed,
login-free way off a publication.

## Why it matters

**This is the one item on the static pass with a compliance edge, which is why it is filed
above the other missing utilities.** A bulk email needs a working unsubscribe that does not
require the recipient to authenticate — that is the baseline expectation of CAN-SPAM in the
US and of GDPR/PECR practice elsewhere, and it is also simply what mailbox providers score
senders on. On the new stack the link in an already-sent email has nowhere to point: the
recipient hits a sign-in wall, and a recipient who cannot unsubscribe marks the message as
spam instead, which damages deliverability for every subsequent send from that domain.

Note the interaction with **C70**: neither the anonymous opt-in nor the anonymous opt-out
made it across. A church cutting over keeps only the signed-in middle of the publication
lifecycle.

## Evidence

- Loader table `ut=[…]` in `https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js`
  (offset ~684 900) — the `mpp-unsubscribe` entry quoted above
- Old surface: `observedAttributes` and `getAttribute("mysubscriptionswidgettargeturl")` in
  `https://mpi.ministryplatform.com/widgets/dist/Unsubscribe.js`; description from
  `/widgets/dist/WidgetConfigurator.js`
- No sample page: the tag appears on none of the 21 fetched pages
- New: 25-element roster has no unsubscribe element;
  `src/app/api/embed/subscriptions/route.ts` 401s `sub === "public"`;
  `src/services/subscriptionService.ts` is contact-keyed only
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 3, 4.13, 5

## Where to fix

- new `packages/embed-sdk/src/components/unsubscribe.ts` (+ demo page)
- new `src/app/api/embed/unsubscribe/route.ts` — token-addressed, anonymous, rate-limited
- `src/services/subscriptionService.ts` — an unsubscribe path keyed by the token's subject
  rather than by `claims.sub`

## Suggested fix

The whole design question is **how the recipient is identified without a login**, and this
repo already has the right primitive: a sealed, expiring token. `src/lib/embed/crypto.ts`
(`seal` / `open`, AES-256-GCM) plus the sealed-ticket pattern in
`src/lib/embed/logout-return.ts` are the precedents; do not accept a bare
`contactId`/`publicationId` from the query string, or the endpoint becomes an enumeration
tool for unsubscribing other people.

Sketch: MP's email template embeds a sealed token as a URL fragment or param; the widget
POSTs it to the new route; the route opens it, honours the unsubscribe for that
contact+publication, and returns a confirmation plus the `my-subscriptions-url` link-out
that legacy's one attribute provides. Rate-limit per IP with
`checkRateLimit` (`src/lib/embed/rate-limit.ts`).

One thing I cannot settle statically: whether MP's own send pipeline already generates
unsubscribe links pointing at a *platform* URL rather than at this widget — in which case
the compliance risk is lower than stated and this drops to a convenience gap. Worth
confirming with someone who knows MP's `dp_Communications` send path before sizing the
work.

## RESOLVED — 2026-09-09

`next-unsubscribe` exists (`packages/embed-sdk/src/components/unsubscribe.ts`,
`src/app/api/embed/unsubscribe/route.ts`, `packages/embed-sdk/demo-unsubscribe.html`),
with a demo page, an anonymous route, three complete catalogues and 87 tests
across the four files. Plan and full reasoning:
`.claude/TODO/Comparison/Plans/unsubscribe.md`. Phase 5 (linking both ways with
`next-subscriptions`) is deferred to C55 and recorded there.

**The one thing this file could not settle statically is answered, and the answer
keeps the severity where it was filed.** *"Whether MP's own send pipeline already
generates unsubscribe links pointing at a Platform URL"* — it does not. Of 1047
communications on the reference domain, **0** contain `unsubscribe.aspx` and **0**
contain `pubid=`; every stock footer is a MailChimp-inherited `mc:edit="unsubscribe"`
**region** holding inert boilerplate with no link and no token in it. The legacy
stack's own 1,922 lines of database scripts contain no unsubscribe URL and no
`[Contact_GUID]` token either. So the link was always church-authored in a message
template, and a church that authors none has no unsubscribe at all. This does **not**
drop to a convenience gap.

**Where the *Suggested fix* above was not followed, and why it could not be.** It
proposed a sealed, expiring token as *the* identifier: *"do not accept a bare
`contactId`/`publicationId` from the query string, or the endpoint becomes an
enumeration tool."* The enumeration argument is right and is honoured — there is no
integer contact path anywhere on the route. But **sealed-token-only is not merely
awkward, it is unimplementable for a bulk send.** MP's template merge substitutes
*field tokens*; it cannot compute an HMAC or an AES-GCM seal, there is no
`[Sealed_Unsubscribe_Token]`, and for a publication send MP does the sending, not us.
The only per-recipient unguessable value that can reach the link is `[Contact_GUID]`
— which is also MP's own house convention for exactly this (`my_user_account.aspx?dg=
[Domain_GUID]&cg=[Contact_GUID]` in MP's stock template) and what every legacy link
already in an inbox uses.

So the route accepts **both**, with a defined precedence: a valid `t` wins; an expired
or tampered `t` falls back to `cg`. That fallback is the point — `cg` is the path with
no expiry, and an unsubscribe link that has expired is itself a compliance regression,
because the recipient's only remaining move is to report the message as spam. A GUID
is ~122 bits of unguessable bearer capability, not the `contactId=1,2,3…` hazard this
file feared; what it is not is revocable, and that is accepted deliberately rather
than papered over. `cg` is therefore accepted at **this one route** and the route's
header comment says so.

Mitigations that go with accepting it: the widget strips `cg`/`pubid`/`t` from the
address bar before anything awaits; the email address comes back **masked
server-side** (`j•••@g•••.com`) and can be suppressed entirely; the per-capability
rate limit is keyed on `sha256Hex` so the GUID never reaches Redis in cleartext; and
the GUID is never logged.

**Two things were fixed rather than ported.** Legacy's transport was `Ajax.Get`
against `[HttpGet] [AllowAnonymous]` — a state-changing GET in an emailed URL, which
mail scanners and URL-rewriting gateways fetch. Here the emailed link lands on a page
that only renders and the write is a POST needing a widget JWT from an allowlisted
origin. And legacy's four `[AllowAnonymous]` actions on `SubscriptionsApiController`
have **no rate limit and no origin check**; this route has both, at 10/min/IP and
5/min per hashed capability, checked before any MP read.

**Still out of scope, and named in the README so a church is not surprised:** RFC 8058
one-click needs a `List-Unsubscribe` / `List-Unsubscribe-Post` header on the outbound
message, emitted by MP's SMTP path, which this stack does not control. The link in the
body is the supported path.
