# Roadmap — the eleven legacy widgets with no counterpart

**Items:** C72 · C70 · C78 · C69 · C52 · C76 · C71 · C74 · C75 · C73 · C77
**Scope decision recorded 2026-09-09:** these are ranked here with a build / defer / won't-port
recommendation each. **No per-widget implementation plan is written until one is picked up** —
this file exists so the decisions get made deliberately rather than discovered at cutover.

## The shape of the gap

The legacy catalogue is 36 tags; ours is 25 elements. Eleven legacy widgets have no `next-*`
counterpart. They are not a uniform set: three are compliance- or flow-critical, one is a whole
product domain, three are platform infrastructure, and four are conveniences.

**And two BRIEF pair-table entries are wrong in ways that matter** — correct them before anyone
re-measures:

- `next-custom-form` pairs with `mpp-custom-form`, **not** `mpp-prayer-feedback-form` (C69).
  The latter's counterpart is `next-prayer-feedback`, built 2026-09-09.
  They are separate tags in MPWidgets.js's loader table with disjoint attribute surfaces.
- `next-checkout` / `next-pay` / `next-checkout-complete` pair with `/widgets/Checkout`,
  `/widgets/pay` and `mpp-checkout-complete` — **not** `/widgets/giving.aspx`, which is an
  `mpp-smart-link` to Realm and not a payment widget at all (C74).
- `next-opportunity-finder` does **not** cover `mpp-mission-trip-finder` (C76): one filters
  Opportunities, the other filters Pledge Campaigns.

## Build order

### Tier 1 — build (in this order)

| # | Widget | Why it ranks here |
|---|---|---|
| **1** | **C72 `mpp-unsubscribe`** — one-click unsubscribe — **DONE 2026-09-09, `next-unsubscribe`** | **The only item in this file with a compliance edge.** A bulk email needs a working unsubscribe that does not require authentication — CAN-SPAM baseline in the US, GDPR/PECR practice elsewhere, and what mailbox providers score senders on. On our stack the link in an already-sent email has nowhere to point: `/api/embed/subscriptions` 401s `sub === "public"` outright. A recipient who cannot unsubscribe marks the message as spam, which damages deliverability for every subsequent send from that domain. |
| **2** | **C70 `mpp-subscribe-to-publication`** — anonymous, email-verified opt-in — **DONE 2026-09-09, `next-subscribe-to-publication`** | "Sign up for our newsletter" on a church home page is the most common publication touchpoint and is **by definition anonymous** — the visitor has no MP login and will not create one to join a mailing list. On our stack the only way onto a publication is to sign in first, which turns a one-field form into a registration funnel. Pairs with C72: we shipped the signed-in middle of the publication lifecycle and neither end. |
| **3** | **C78 `mpp-pre-check`** — event pre-check / check-in QR — **DONE 2026-09-09, `next-pre-check`** | Children's check-in is one of the highest-traffic Sunday operations a church runs, and pre-check is what keeps the queue short. **No host-page workaround exists** — a church cannot hand-author a QR code bound to MP's check-in. A church using it today must keep MPWidgets.js on that page, with the dual-login cost that implies. **Risk framing corrected 2026-09-09:** this entry ranked C78 third partly on an unknown QR blocker and an assumed-missing server. Both were wrong — the legacy server and its stored procedure are in `S:\MP\mp-Widgets` in full, and the QR payload is a 16-byte plain string. The **severity** ranking stands; the **risk** ranking did not. It was the least risky of the four, not the most. |
| **4** | **C69 `mpp-prayer-feedback-form`** — prayer / praise / feedback intake — **DONE 2026-09-09, `next-prayer-feedback`** | Prayer intake is, for many churches, the **first thing on the website that writes to MP**. The near-miss is the danger: a church could hand-build a Custom Form for it, but that writes `Form_Responses` rather than `Feedback_Entries`, populates no Feedback Type and no Program, and **never appears in the tools staff use to work a prayer queue**. Submissions land somewhere the prayer team does not look. |

### Tier 2 — decide, then build or document

| # | Widget | The decision |
|---|---|---|
| **5** | **C52 `mpp-about-me`** — self-service contact attributes | Self-declared attributes are how a church finds the electrician in the congregation and staffs teams from spiritual gifts. Without it there is **no member-facing way to maintain `Contact_Attributes` at all**, and the catalogue has no answer for a first-class MP concept. Build it as `next-contact-attributes`, its own element — **not a tab on `next-profile`**: the legacy surface is a separate page, a church may want it on a different site page, and its data model (rows with start/end dates) is nothing like the flat field set `next-profile` posts. **Two questions must be answered with MP first** (the API user could not read either): which `Attribute_Categories` are member-visible (legacy shows only 2 of 5, so it honours a flag — probably `Available_Online`), and whether writes should end-date a removed attribute or hard-delete the row. |
| **6** | **C76 mission trips** — three tags, one domain | The largest single gap: finder → application (with confirmation email) → per-participant fundraising, donor list and leader view of team progress. **The real cost is not the three widgets, it is that a church running trips cannot cut over at all** and must run both stacks and both login models on the same site indefinitely. Almost certainly a deliberate scope decision — **the useful output of this item is a recorded decision, not code.** If picked up: the data model is Pledge Campaigns, so `pledgeCampaignService.ts` / `myPledgesService.ts` are the starting point, and `showdonors` / `showteamprogress` both expose one person's fundraising data to another and need an **authorisation rule decided up front**, not an attribute that hides a section client-side. |
| **7** | **C71 `mpp-rss-reader`** — publication feed | A publishing surface: render a prayer list, weekly announcements or a devotional feed onto a page. Small and self-contained — one attribute, one GET, a list render — and it is **MP's own sample home page**, so the first widget an evaluating church sees. **Settle one thing first:** the legacy widget takes a publication *name*, which suggests it resolves to a feed MP exposes rather than reading rows. Inspect `RssReader.js`'s endpoint before designing the service; if MP publishes an actual RSS/Atom document the route is a fetch-and-normalise, not a table query, and that shapes the whole item. |

### Tier 3 — needs an auth-design decision before it is a build question

| # | Widget | The decision |
|---|---|---|
| **8** | **C74 `mpp-smart-link`** | Links out with the signed-in user merged into the URL (`{{isAuthenticated}}`, `{{userDisplayName}}`, `{{userEmail}}`, `{{userLocale}}`). Two losses: churches whose giving runs on an external processor have no hand-off element, and the catalogue loses its **general-purpose escape hatch** — the answer to "MP has no widget for X, but our vendor does". |
| **9** | **C75 `mpp-smart-frame`** | The same idea in an iframe, so the vendor page stays on the church's own page. In practice its absence turns an in-page flow into a new-tab hand-off, which is a measurable conversion loss on a giving page. |

**Both are blocked on the same question, and it should go to whoever owns the auth design:**
this repo's hardened model exists so that MP tokens and user PII stay in the encrypted server
session and never reach host-page storage (`WIDGET-AUTH-MIGRATION-PLAN.md`). Interpolating the
signed-in user's email into a URL handed to an arbitrary third party — or to a framed origin —
runs against that premise. **It is entirely plausible both were omitted on purpose**, in which
case the resolution is a documented *"won't port, here is what to use instead"* rather than an
implementation.

If they are built, the security requirements are not optional: `encodeURIComponent` every
substituted value; restrict the scheme to `https:` (a `javascript:` href with an interpolated
display name is script injection driven by MP profile data, in a same-origin execution
context); for the frame, an explicit `sandbox` allow-list, a `referrerpolicy`, and a
**required** `frame-title` (legacy makes it optional; a titleless iframe fails WCAG 4.1.2).
Build C74 first and share its token-substitution helper.

### Tier 4 — owned by `CROSS-5`, not by this file

| # | Widget | Status |
|---|---|---|
| **10** | **C73 `mpp-locale-selector`** | **Committed as part of `CROSS-5-theming-labels-locale.md`.** Not a standalone build. It is on **all 21** pages of MP's own sample site and the choice is plumbed outward to third parties, so it is a supported deployment, not an edge case — but **it must not be built before C67's label mechanism**, or it switches a preference no label honours. |
| **11** | **C77 `mpp-user-label`** | **Blocked on C67, and it is C67's best end-to-end test** — the cheapest possible consumer of the label pipeline, worth building immediately after the endpoint lands and before 25 widgets are converted onto it. Filed at `ux` rather than `functional` because a church *can* hard-code the word into its own page markup; what it loses is single-sourcing, so the page and the widgets drift into two names for the same ministry. One deliberate decision: if `bare="true"` means "renders as host-page text", this element should skip the shadow root and write to its own light DOM — the only element in the SDK that would. |

## What builds cheaply once, and serves several of these

Four primitives are named across the tiers — three from the start, and a fourth the first
three widgets discovered. Building any of them for one widget and not extracting it is how we
end up with four hand-rolled versions.

1. **Template send — BUILT, `src/services/messageTemplateService.ts`.** Extracted from
   `planYourVisitService.ts`, which had it inline, and now consumed by C69 for both the
   verification and the acknowledgement email. Two named methods rather than one call with a
   `source` flag, because the two MP template tables (`dp_Communications` /
   `dp_Communication_Templates`) have different column names and the caller always knows
   which kind of id it was handed. Merge values are HTML-escaped **with no opt-out** — the
   legacy widget substituted them raw, which made every one of these templates a stored-XSS
   vector into a staff mailbox; the subject is deliberately *not* escaped, being a plain-text
   header. `TemplateNotFoundError` / `NoFromAddressError` / `TemplateSendFailedError` let a
   route answer `template_not_configured` versus `email_send_failed` without string-matching.
   Still wanted by **C11 in `group-details.md`** and **C66 in `checkout-pay.md`**.
2. **Sealed anonymous action tokens — BUILT, `src/lib/embed/action-token.ts`.**
   `createActionToken` / `verifyActionToken` over a closed `ActionTokenType` union, with
   per-flow expiry in `ACTION_TOKEN_EXPIRY` (`unsubscribe` is 180 days — a short-lived
   unsubscribe link is itself a compliance regression). The expected `typ` is an argument,
   compared, never read off the token and trusted; without that comparison every flow's tokens
   become capability for every other flow. `src/lib/embed/pending-action.ts` wraps it with a
   store-backed one-time burn for the flows that must not be replayable — deliberately **not**
   unsubscribe, which must stay replayable. First consumer of `pending-action.ts` is C69's
   `prayer-feedback/verify`, whose four outcomes (`invalid` / `expired` / `used` /
   `unavailable`) each map to a distinct answer; note that `unavailable` is the fail-closed
   store error and must never be reported as a successful write. C70's
   `subscribe-to-publication/verify` is the second consumer, and it is the one that makes the
   case for the burn hardest to argue with: its write is *idempotent*, which is what makes a
   replayable handle look harmless — right up to the point where the visitor has unsubscribed
   in between, and a mail prefetcher re-fetching the old link silently re-subscribes them.
   Note the design conclusion C72 reached and this file's original framing did not: a sealed
   token cannot be the *only* identifier for a bulk unsubscribe, because MP's merge engine
   cannot produce one. See the answered open question below.
3. **An anonymous-write route convention — BUILT, `src/lib/embed/anonymous-write.ts`.**
   `withAnonymousWrite(req, { widget, limits, failClosed }, handler)`: POST-only, a widget JWT
   still required (`sub === "public"` merely *accepted*), every rate-limit bucket checked before
   the handler, and one `rate_limited` code for every bucket so which bucket was hit is not
   itself an oracle. First consumer is `src/app/api/embed/unsubscribe/route.ts`; C69's
   `prayer-feedback/submit` is the second, and the first to use the **callback** form of
   `limits` so a per-email bucket can be keyed off the parsed body after authentication;
   C70's `subscribe-to-publication` is the third, on both POST hops. One lesson from C69 that
   every later consumer inherits: add the per-address bucket **only when an address was
   submitted**, or every address-less request shares one "no address" hash and the whole
   congregation is capped at 3/hour.

4. **Lookup and escaping helpers — BUILT, `src/services/_shared/mp-lookup.ts`** (C70 phase 1).
   Not named in the original three, and it should have been: `sqlLiteral`, `clean` and
   `toNumberOrNull` were byte-identical in `planYourVisitService.ts` and
   `prayerFeedbackService.ts`, `clean` in `groupsService.ts` too, and C70 would have been the
   fourth copy. A SQL-escaping helper duplicated four ways is the one in the set where a
   divergence is an injection bug rather than an inconsistency. `getIdByValue` (cached
   resolution of a lookup id from its human-readable value) and `cap` live there too; the
   `MPHelper` and the id cache stay with the calling service.

## The one open question, answered — C72's severity stands

**Question:** does MP's own send pipeline already generate unsubscribe links pointing at a
*Platform* URL rather than at this widget? If it did, the compliance risk would be lower than
stated and C72 would drop to a convenience gap.

**Answer: no. Measured 2026-09-09, and C72 keeps the severity it was filed at.**

| Check (reference domain, read-only `mp_query`) | Result |
|---|---|
| Communications in the domain | 1047 |
| …containing `unsubscribe.aspx` | **0** |
| …containing `pubid=` | **0** |
| …containing `cg=` | **1** — stock template `Communication_ID = 66` |
| …containing the literal `Contact_GUID` | **1** — the same template |

Every stock template's footer is a MailChimp-inherited `mc:edit="unsubscribe"` **region**,
whose content is inert boilerplate with no link and no token in it. The word "unsubscribe" in
those bodies is a region *name*, which is why a naive `LIKE '%unsubscribe%'` matches nearly
everything and means nothing.

**And the legacy stack generated no such link either.** `S:\MP\mp-Widgets\DatabaseScripts`
(1,922 lines of SQL across 8 scripts plus 28 `api_MPPW_*` procs) contains no unsubscribe URL,
no `cg=`, and no `[Contact_GUID]` merge token. The only `unsubscribe` hit in the whole SQL set
is `CASE WHEN CP.Unsubscribed = 1 THEN 0`. So neither MP's send pipeline nor the legacy widget
stack ever assembled the link: **the church authored it in a message template.** A church that
adds no footer of its own has no unsubscribe at all.

**The merge-field answer, recorded so the work is not re-sized:** `[Contact_GUID]` is a real,
supported merge token and `?cg=` is MP's own house convention for identifying a recipient in an
emailed link — MP's stock template does exactly this
(`my_user_account.aspx?dg=[Domain_GUID]&cg=[Contact_GUID]`), and legacy's widget read exactly
that parameter. This is also **why C72's own *Suggested fix* — a sealed token in the email —
was not implementable as the only path**: MP's template merge substitutes field tokens and
cannot compute an HMAC or an AES-GCM seal, so for a bulk send (which MP performs, not us) the
`Contact_GUID` is the only per-recipient unguessable value that can reach the link.
`next-unsubscribe` therefore accepts both, with a defined precedence, and accepts `cg` at that
one route only. Full reasoning: `unsubscribe.md`, *The identification decision*.

**One thing still wants a live confirmation** before a church edits templates in bulk: the
`[Contact_GUID]` evidence is from a *template*, and no *sent* message body in the reference
domain contains `cg=` (template 66 is triggered by user-account setup, not a publication send).
The cutover step is therefore *"send one test bulk email to a selection of one and check the
merged link"*, documented in README under *Widget Unsubscribe Links*.

## Regardless of what gets built — write it down

Every widget left unported needs a line in the customer migration notes, because a church needs
to know **before** cutover, not after:

- *"Churches running mission trips must keep MPWidgets.js on those three pages."*
- *"Event pre-check has no replacement."*
- *"Prayer request intake has no replacement — a Custom Form is not equivalent and writes to a
  different table."*

Running both stacks on one site means running both login models side by side (legacy
`mpp-user-login` writing `mpp-widgets_AuthToken` against the new `sid`/JWT ladder). **That
dual-stack cost is the real severity of every Tier 2 gap**, and it is the thing a church will
not discover from a feature list.
