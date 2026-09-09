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
