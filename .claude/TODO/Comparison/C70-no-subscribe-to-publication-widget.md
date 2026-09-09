# C70. Legacy `mpp-subscribe-to-publication` has no counterpart — there is no anonymous, email-verified publication opt-in

**Widget:** none (old: Subscribe to Publication, `/widgets/subscribe_to_publication.aspx`)
**Severity:** functional
**Confidence:** confirmed — static source read on both sides, including the new route that rejects anonymous callers; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

```html
<mpp-subscribe-to-publication
  returnurl="https://mpi.ministryplatform.com/subscribetopublication/"
  verificationEmailTemplateid="157" publicationid="4"></mpp-subscribe-to-publication>
```

`observedAttributes` in `/widgets/dist/SubscribeToPublication.js` is
`["verificationemailtemplateid","returnurl","publicationid"]`, and the configurator marks
**all three required**:

- `publicationid` — "Determines which Publication will be displayed."
- `returnurl` — "URL the widget exists on. The verification email will use this to complete the subscription and display confirmation."
- `verificationemailtemplateid` — "Email containing a verification link which will complete the subscription."

So: a **signed-out visitor** enters an email address, receives a verification email, and
clicking the link completes the subscription to one specific publication. Double opt-in,
no login required.

## New behaviour

No such element exists. The BRIEF pairs this page with `next-subscriptions`, but they are
different capabilities and the code says so plainly.

`next-subscriptions` is a **signed-in** management surface: a checkbox list of every
`Available_Online` publication with the contact's current state, saved as a whole set.
`src/app/api/embed/subscriptions/route.ts` refuses anonymous callers outright:

```ts
if (claims.sub === "public") {
  return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
}
```

and `src/services/subscriptionService.ts` keys everything off a `contactId` resolved from
`claims.sub`. There is no publication-scoped element, no email-verification flow, and no
route that accepts an email address from an unauthenticated visitor.

Note this gap pairs with **C72** (`mpp-unsubscribe`): the new stack has neither the opt-in
nor the one-click opt-out, only the signed-in middle.

## Why it matters

"Sign up for our newsletter" on a church home page is the single most common publication
touchpoint, and it is by definition anonymous — the visitor has no MP login and will not
create one to join a mailing list. On the new stack the only way onto a publication is to
already have an account and sign in, which converts a one-field form into a registration
funnel. The double opt-in that is being lost is also the part that makes the subscription
defensible: an email address confirmed by the owner, rather than typed by anyone.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/subscribe_to_publication.aspx`
- Loader table entry: `{tag:"mpp-subscribe-to-publication", script:"/dist/SubscribeToPublication.js",
  name:"Subscribe to Publication"}` in `/widgets/dist/MPWidgets.js`
- Old surface + required flags: `observedAttributes` in
  `/widgets/dist/SubscribeToPublication.js`; `configurationItems` in
  `/widgets/dist/WidgetConfigurator.js`
- New: 25-element roster contains no subscribe element;
  `src/app/api/embed/subscriptions/route.ts` (401 for `sub === "public"`);
  `src/services/subscriptionService.ts` (contact-keyed)
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 2.18, 4.13

## Where to fix

- new `packages/embed-sdk/src/components/subscribe-to-publication.ts` (+ demo page)
- new `src/app/api/embed/subscribe/` routes — an anonymous POST plus a verification
  callback, both rate-limited via `checkRateLimit` (`src/lib/embed/rate-limit.ts`)
- `src/services/subscriptionService.ts` — an email-keyed subscribe path alongside the
  contact-keyed one

## Suggested fix

`next-plan-your-visit` is the pattern to copy, not `next-subscriptions`: it is the existing
anonymous, email-verified, template-emailed flow in this repo
(`src/app/api/embed/plan-your-visit/send-verification/route.ts` plus
`src/services/planYourVisitService.ts`'s `dp_Communications` template send). Attribute
surface `publication-id`, `return-url`, `verification-email-template-id`, matching legacy.

Two things to get right, and they are the reasons this is not a small job: the anonymous
POST is an unauthenticated write that must be rate-limited per IP and must not leak whether
an email is already known to MP; and the verification link has to seal its payload rather
than trust a query string — `src/lib/embed/crypto.ts` (`seal`/`open`) and the sealed-ticket
pattern in `src/lib/embed/logout-return.ts` are the in-repo precedents.
