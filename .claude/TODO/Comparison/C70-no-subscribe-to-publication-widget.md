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

---

## Resolution — 2026-09-09, `next-subscribe-to-publication`

Built as `packages/embed-sdk/src/components/subscribe-to-publication.ts`, three routes
under `src/app/api/embed/subscribe-to-publication/`, and three methods on the existing
`src/services/subscriptionService.ts`. Full design in
`.claude/TODO/Comparison/Plans/subscribe-to-publication.md`; customer-facing docs in
README "Newsletter Sign-Up".

**Where this finding's suggested fix was followed.** `next-plan-your-visit` was indeed
the pattern to copy rather than `next-subscriptions` — but the two halves the finding
named as "the reasons this is not a small job" both turned out to be *shared* by then,
not per-widget work: `src/lib/embed/anonymous-write.ts` supplies the rate-limited,
POST-only, origin-checked wrapper, and `src/lib/embed/pending-action.ts` supplies the
sealed, single-use handle. Neither existed when this was filed. The attribute surface is
the one suggested (`publication-id`, `return-url`,
`verification-email-template-id`), kebab-cased.

**Where it was not.** The route directory is `subscribe-to-publication/`, matching the
element slug, rather than the suggested `subscribe/` — every other route directory in
the tree mirrors its widget's slug. And the widget's data access extends
`subscriptionService.ts` rather than adding "an email-keyed subscribe path alongside the
contact-keyed one" in a new file: it is the same two tables and the same "subscribed =
row exists AND `Unsubscribed` is false" rule.

**Three legacy defects found in the source and deliberately not ported**, all three
regression-tested rather than commented:

1. **An anonymous endpoint that rewrites any contact's email address.**
   `SubscribeToPublicationModel.ContactId` is `[FromForm]`-bound on an `[AllowAnonymous]`
   action, copied unvalidated into the verification token, and on redemption
   `SubscriptionsService.cs:147-150` calls `UpdateContactEmail(contactId, email)`. So an
   unauthenticated caller posts a stranger's contact id with their own address, clicks
   their own link, and MP moves that account to an address they control. On an
   email-identified IdP that is an account-takeover primitive, not a data-integrity bug.
   Structurally foreclosed here: no schema has a field for a contact id, the sealed
   payload is asserted to hold exactly five keys, and no route writes
   `Contacts.Email_Address`.
2. **An unauthenticated email cannon with an unvalidated link inside it.** `ReturnUrl`
   was client-bound and interpolated straight into the email
   (`SubscriptionsService.cs:164`) with no validation of any kind, on an endpoint with no
   rate limit — `grep -rn "RateLimit\|Throttl\|EnableRateLimiting" --include=*.cs` returns
   **zero hits across the whole legacy solution**. A phishing kit with the church's
   deliverability reputation attached. Now: same-origin https with no embedded
   credentials, 5/min per IP and 3/hour per hashed address, both fail-closed, all checked
   before any MP call or send.
3. **`GetPublication` is a bare primary-key fetch** (`SubscriptionsManager.cs:67`) with no
   `Available_Online` check, so legacy would render a subscribe form for a staff-only
   list. Legacy's own signed-in proc requires the flag
   (`api_MPPW_SearchSubscriptions.sql:38`) — the widget was the outlier. The flag is now
   in the MP filter on every hop, and a non-online publication answers exactly like one
   that does not exist so the id space cannot be probed.

**One improvement neither stack had.** Legacy's handle was a 24-hour JWT with no backing
table, i.e. **replayable**. Ours is single-use, and that is not tidiness: the subscribe
write is *idempotent*, which is what makes replay look harmless — right up to the point
where the visitor has unsubscribed in between, and a mail-client prefetcher or a security
scanner re-fetching the old link silently puts them back on the list. Idempotency is
exactly what makes replay harmful here. The cost is honest and accepted: a second click
shows "you're all set" rather than confirming again.

**Two deliberate non-ports**, both recorded in the README migration note: the
mobile-phone field (a newsletter opt-in needs a mailbox, and writing `Mobile_Phone` from
an anonymous form interacts with texting consent), and the signed-in "Subscribe As"
household dropdown (which is *why* legacy's token carried `contactId` and `onBehalfId`;
dropping it is what makes the handle email-scoped rather than contact-scoped).

**Out of scope, and stated in the plan.** The `recaptcha-site-key` path end-to-end — the
server verifies a posted `recaptchaToken`, but the element renders no challenge — and an
E2E spec, which needs a real mailbox.
