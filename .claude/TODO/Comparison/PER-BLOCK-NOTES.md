# Per-block filing notes (verbatim, as each agent wrote them)

These are the sections each testing agent appended to `README.md` as it finished, kept
intact and moved here at consolidation so the top-level index could be rewritten without
discarding them. They carry each agent's own measurement notes and method. The
authoritative index is `README.md`; the fullest per-widget record is
`.claude/playwright/widget/tests/*.md`.

No section exists for C01–C09 (events) or C30–C39 (giving) — those agents wrote their
detail into their test logs instead.

---


<!-- Consolidated at the end of the run. -->

### C10–C19 — groups (filed 2026-09-08, browser + MP verification)

`next-group-finder`, `next-group-details` and `next-my-groups` driven side by side with
`mpp-group-finder`, `mpp-group-details` and `mpp-my-groups`, signed out and signed in, with
the legacy pages' exact attribute configuration mirrored onto ours. Both inquiry and
sign-up **writes** were walked end to end on both sides and the resulting MP rows compared
column by column (all fixture data deleted afterwards). Test logs:
`.claude/playwright/widget/tests/group-finder.md`, `group-details.md`, `my-groups.md`.

**Read parity is exact.** All eleven Group Finder filter combinations returned the same
groups in the same order on both sides *and* matched a direct `api_MPPW_SearchGroups` call;
`next-my-groups` matched `api_MPPW_GetMyGroups` and the legacy widget exactly; neither
finder leaked an unpublished, full or ended group. The gaps are in the **write** and
**auth-state** paths.

- `C10` — `next-group-finder` result cards are `tabindex="0" role="link"` but Enter/Space do nothing, and the card contains no anchor at all (functional)
- `C11` — `next-group-details` sends no inquiry / sign-up / leader-notification email; the three `*-email-template` attributes are accepted and silently ignored (functional)
- `C12` — group inquiries from household members write NULL `First_name`/`Last_name`/`Email`/`Phone`; legacy populates all four (functional)
- `C13` — `next-my-groups` signed out renders "Unable to Load" with a dead "Try Again" instead of a sign-in prompt (functional)
- `C14` — `next-group-details` sign-up can only target a household member; legacy's "Blank Form" is gone (functional)
- `C15` — `next-group-finder` lets an anonymous visitor fill the whole Suggest-a-Group form, then dead-ends on a 401 with no sign-in affordance (ux)
- `C16` — group inquiry no longer requires a phone number (ux)
- `C17` — post-submit greeting is surname-first, "Thanks, Kehayias Chris!" (cosmetic)
- `C18` — Group Finder copy / date-format / empty-state / placeholder drift, 13 differences (cosmetic)
- `C19` — group-details copy, field-order and layout drift, plus tabs with no ARIA tab semantics (cosmetic)

Two qualifications to earlier documents, worth reading before acting on either:

- **CONFIG-MAP.md section 4.3** scores `next-group-details` as complete attribute parity.
  That is true at the attribute level and misleading behaviourally: the three
  `*-email-template` attributes are in `observedAttributes` and never read — now `C11`.
- The **legacy** widget is the wrong one in two places, so neither is filed against us:
  `POST /Api/GroupsApi/Inquire` and `/SignUp` both return **500** on this MP instance
  (after creating the row), and legacy writes a suggested group's `Start_Date` in **UTC**
  (`2026-09-09T02:18`) where ours correctly writes domain wall-clock (`2026-09-08T22:18`).

### C60–C79 — static config parity (filed 2026-09-08, no browser used)

Measured from `curl` of all 21 sample pages, the `mpp-*` loader table and per-widget
`observedAttributes` inside `mpi.ministryplatform.com/widgets/dist/*.js`, and the
`observedAttributes`/`getAttribute` surface of `packages/embed-sdk/src/components/*.ts`.
Full tables and the "needs runtime confirmation" list: `.claude/playwright/widget/CONFIG-MAP.md`.

**MPWidgets.js knows 36 `mpp-*` tags; this repo ships 25 `next-*` elements. Eleven legacy
widgets have no counterpart at all.**

Missing attributes / options:

- `C60` — `next-my-invoices` accepts no configuration attributes at all (six legacy options, four filter controls)
- `C61` — `next-subscriptions` has no `congregation-id`, client **or** server side
- `C62` — `next-my-contribution-statement` has no My Giving link-out
- `C63` — `next-plan-your-visit` cannot set the user-notification email template, though the service already accepts it
- `C64` — `next-group-finder` cannot pre-set City/Postal Code, though it renders and sends the field
- `C65` — `next-opportunity-details` has no `show-full-address`; the address always renders
- `C66` — `next-checkout` has no `receipt-template-id`; "receipt" appears nowhere in the repo

Cross-cutting:

- `C67` — no MP-configurable labels (`GetLabels` has no equivalent); all copy is hardcoded English
- `C68` — no `customCss` and no domain custom-styles channel; new widgets cannot be restyled at all
- `C79` — four widgets use flat lowercase attribute names while the other 21 use kebab-case

Legacy widgets with no `next-*` counterpart:

- `C69` — `mpp-prayer-feedback-form` (and the BRIEF's `next-custom-form` pairing is wrong; `mpp-custom-form` is the real pair)
- `C70` — `mpp-subscribe-to-publication` (anonymous, email-verified opt-in)
- `C71` — `mpp-rss-reader` (publication feed)
- `C72` — `mpp-unsubscribe` (one-click unsubscribe — the compliance-adjacent one)
- `C73` — `mpp-locale-selector` (no locale concept anywhere in the SDK)
- `C74` — `mpp-smart-link` (what `/widgets/giving.aspx` actually is)
- `C75` — `mpp-smart-frame`
- `C76` — the whole mission-trip domain: `mpp-mission-trip-finder`, `mpp-mission-trip`, `mpp-my-mission-trips`
- `C77` — `mpp-user-label` (blocked on C67)
- `C78` — `mpp-pre-check` (event pre-check + check-in QR code)

Three corrections to the BRIEF's pair table, recorded in CONFIG-MAP.md and worth reading
before testing those widgets: `next-event-details`, `next-group-details`,
`next-opportunity-details` and `next-statement-preferences` are **not** "new only" (each has
a legacy counterpart); `/widgets/giving.aspx` is a `mpp-smart-link`, not a payment widget;
and `mpp-mission-trip-finder` queries Pledge Campaigns, not the Opportunities table.

### C40–C49 — payments: `checkout`, `pay`, `checkout-complete`, `my-invoices` (filed 2026-09-08, browser + MP verification)

**Correction to the BRIEF and to the note above: a legacy payment baseline does exist.**
`/widgets/giving.aspx` is indeed only an `mpp-smart-link` (C74), but the real legacy
payment surface is `/widgets/Checkout` (= `/widgets/checkout/`, `<mpp-checkout>`) and
`/widgets/pay` (`<mpp-pay>`) — absent from the sample site's navigation dropdown, both
confirmed by `curl` and then driven in the browser. `next-checkout` and `next-pay` were
therefore tested as genuine head-to-heads, not as new-only widgets.
`mpp-checkout-complete` is in the loader table but its bundle throws
`at.registerComponent is not a function` on this MP domain, so `next-checkout-complete`
has no drivable legacy peer (an MP-side fault, not filed against this repo).

**The payment write path is completely broken today.** C40 is the one to read first: it
stops every other payment behaviour from being observable.

- `C40` — **breaking**: `paymentService` selects a non-existent `Invoices.Amount_Paid`, so
  every payment fails silently and **no `Payments` row is ever written**
- `C41` — **breaking**: `next-checkout` tells the payer a declined or failed payment is
  "being processed" (`checkout-complete.ts` gets this right; `checkout.ts` does not)
- `C42` — **breaking**: signed-in `next-checkout` 500s — `api_MPPW_GetInvoice` has no
  `@MpLoggedInContactId` parameter — and shows the raw MP error to the payer
- `C43` — functional: the payment request token is unlimited-use for 15 minutes;
  Back-then-resubmit mints a second distinct payment, and there is no overpay guard
- `C44` — **breaking**: `next-my-invoices` "Pay Now" injects the legacy `<mpp-checkout>`
  tag with the numeric `Invoice_ID` instead of `next-checkout` with the `Invoice_GUID`
- `C45` — functional: `next-my-invoices` rows are non-focusable `div`s, so the list and
  the whole route to payment have no keyboard path
- `C46` — functional: anonymous `next-my-invoices` shows "Unable to Load" + a dead
  "Try Again"; legacy shows a warning and a working Login button
- `C47` — cosmetic: a zero-total unpaid invoice reads "Paid in full" under "Status None Paid"
- `C48` — functional: `next-pay` collects four fields with required-only validation
  (expiry `13/99` and CVV `abc` are accepted) against legacy's payor + billing block,
  `<select>` expiry and bank-account option
- `C49` — functional: `next-checkout`'s "Make Changes" link drops the event and invoice
  ids that legacy resolves into it

Runtime confirmations were appended to two of the cartographer's items rather than filed
separately: **C60** (the four missing filter controls enumerated live; the zero-total
record-set difference; and the **disproof** of the CONFIG-MAP 7.7 client-side-search
suspicion — neither system found the hidden product name) and **C66** (the legacy page
really does set `receipttemplateid="2695"`, "receipt" really appears nowhere in this
repo, and the receipt belongs server-side in `paymentService`).

Two things deliberately **not** filed as defects, because they are parity: anonymous
access to an invoice by GUID (legacy's `/widgets/checkout/?id=<guid>` behaves identically,
with a live Pay Now), and the absence of `autocomplete` tokens on the card fields.

Payment submits used only the published sandbox PAN `4111 1111 1111 1111` at $0.01.
Nothing was submitted on the legacy side: MP's gateway configuration for this domain is
unreadable to our API user, so it could not be established that no processor is reached.
All ten `Invoices` / `Invoice_Detail` fixtures were `ZZTEST-` prefixed and deleted, with
deletion verified. Per-widget detail: `.claude/playwright/widget/tests/checkout.md`,
`pay.md`, `checkout-complete.md`, `my-invoices.md`.

### C50–C59 — people (filed 2026-09-08, both sites driven in a browser)

`next-profile`, `next-my-household`, `next-online-directory`,
`next-subscriptions`, `next-user-menu` against `mpp-about-me`, `mpp-household`,
`mpp-online-directory`, `mpp-subscriptions` + `mpp-subscribe-to-publication`, and
`mpp-user-login`. Every widget tested signed out **and** signed in; every write
verified against MP with client credentials and restored. Test logs:
`.claude/playwright/widget/tests/{profile,my-household,online-directory,subscriptions,user-menu}.md`.

- `C50` — **breaking**: `next-online-directory` cannot run *any* search — the MP query string is 2,100–2,335 chars, over IIS's 2048 `maxQueryString`, so MP returns an IIS 404 page
- `C51` — **breaking**: `next-profile` silently `NULL`s a stored phone number when non-numeric text is typed (the input mask empties the field, so validation passes)
- `C52` — functional: `mpp-about-me`'s self-service contact attributes (Occupation, Spiritual Gifts) have no counterpart; `next-profile` is **not** its pair — the BRIEF's mapping is wrong
- `C53` — ux: signed-out `next-profile` / `next-my-household` / `next-subscriptions` show an error and a "Try Again" button with no way to sign in (this is the runtime answer to CONFIG-MAP §7.3; `next-online-directory` is the one that gets it right)
- `C54` — ux: `next-user-menu` closes its dropdown and its `aria-modal` dialog on Escape but leaves focus on `<body>` instead of the trigger, and the modal has no Tab trap
- `C55` — functional: `next-subscriptions` has no "Do not send me bulk email messages" control; `Contacts.Bulk_Email_Opt_Out` is only reachable through `next-profile`
- `C56` — functional: `next-user-menu` slots child markup when signed out and silently discards it when signed in, so legacy `userUrls` custom menu links have no equivalent (settles CONFIG-MAP §7.2)
- `C57` — cosmetic: `next-my-household` drops the birth **year** from the member list that legacy shows

Three CONFIG-MAP §7 items resolved without a new finding:

- **§7.1 `householdid` vs `keyword="hh <id>"`** — parity by a different route. The convention is implemented correctly and the filter returns the same 2 records in the same order as legacy `householdid="85"` when run directly against MP. Not demonstrable in the widget until C50 is fixed. The cartographer was right to withdraw the draft item.
- **§7.2 `userUrls`** — a real gap, filed as C56.
- **§7.3 signed-out rendering** — a real gap, filed as C53.

Two things that are **not** findings and are worth knowing before re-testing:

- **The online-directory access gate is at parity.** Both widgets require a
  directory-enabled participant type *and* either no member status or a
  directory-enabled one. All three `Member_Statuses` on this instance have
  `Can_Access_Directory = false`, so the directory is closed to everyone by
  default and cannot be tested without changing a flag. A first pass appeared to
  show ours granting access where legacy denied — that was MP caching the
  permission against the pre-change token; a fresh login showed legacy granting
  it too. **Re-login on the legacy side after changing an MP permission flag.**
- **On privacy, ours is stricter than legacy everywhere measurable.** Ours nulls
  unlisted phone/address server-side, never sends an email address to the browser
  (only a `canEmail` boolean), and never sends a birth year. Legacy ships all of
  it to the browser and hides it client-side in `CanShowEmail` /
  `CanShowMobilePhone` / `CanShowHomePhone`. Nothing ours exposes is withheld by
  legacy.

**TODO item 38 is settled by this block** (reported to the coordinator rather
than filed as a duplicate C-item; evidence in `tests/user-menu.md`): the
`<mpp-user-login>` that `next-user-menu` injects carries **zero attributes**, its
shadow root holds only MP's own `mppw-widgetstyles.css`, and the login control
computes to MP's default `rgb(74, 149, 236)` rather than brand `#004C97`.
`window.__nextEmbedCSSUrl` is written by the generated loader and read by
nothing. That is item 38's reading 2, and it is a narrower question than C68.

### C20–C29 — serving & visit (`opportunity-finder`, `opportunity-details`, `plan-your-visit`, `custom-form`)

Driven in a browser on both stacks against the same MP instance, signed out and
signed in; every write verified by reading the MP row back with client credentials.
Test logs: `tests/opportunity-finder.md`, `tests/opportunity-details.md`,
`tests/plan-your-visit.md`, `tests/custom-form.md`,
`tests/my-mission-trips-legacy-only.md`.

- `C20` — **functional** — `next-opportunity-finder` renders no Attributes filter: the config query names a `Attributes.Available_Online` column MP does not have, 500s, and a bare `catch` swallows it. Legacy offers 19 attributes in 2 groups.
- `C21` — **functional** — `next-opportunity-details` stores a `Responses` row with `First_Name`/`Last_Name`/`Email`/`Phone` all NULL when responding as a household member; legacy backfills them from the contact.
- `C22` — **functional** — `next-opportunity-finder` cards are `role="link" tabindex="0"` with a click-only handler: Enter and Space do nothing and there is no anchor, so there is no keyboard route to a detail page. Legacy's "See Details" is a real `<a href>`.
- `C23` — **functional** — `next-plan-your-visit` has no address autocomplete; legacy binds `google.maps.places.Autocomplete`, and this repo already ships `shared/google-places.ts` plus the MP key channel for two other widgets.
- `C24` — **breaking** — `next-plan-your-visit` puts MP's *display* phone mask (`PhoneMask = "xxx-xxx-xxxx"`) into the HTML `pattern` attribute, so the required Mobile Phone field rejects every real number and the flow can never be submitted. Removing the attribute lets the identical form complete and write a correct set of MP records.
- `C25` — **functional** — `next-opportunity-finder` renders a one-time opportunity as "Fridays" and drops its date; legacy shows "Fri, Dec 31, 2027".
- `C26` — **functional** — `next-custom-form` has no "Complete Form As" household picker, so a parent cannot complete a form for a child and `Form_Responses.Contact_ID` stays null.
- `C27` — **functional** — `next-custom-form`'s address block has no Country field; legacy's is required and defaults to United States of America.
- `C28` — **ux** — `next-plan-your-visit` (13 of 14 controls) and `next-custom-form` (20 of 27) render labels that are not associated with their inputs, so the fields have no accessible name. Legacy associates nearly all of them.
- `C29` — **ux** — phone inputs in `next-opportunity-details` and `next-custom-form` are `type="text"` where legacy uses `type="tel"` — no numeric keypad on mobile. `next-plan-your-visit` already gets this right.

**Best news of the block: `next-custom-form` drops no MP form field type.** All nine
`Form_Field_Types` — Text Box, Memo, Date, Radio Vertical, Radio Horizontal,
Drop-down, Instructions, Checkbox and File Upload — render with matching types, order,
option lists and required flags across three forms, and the stored
`Form_Response_Answers` rows are identical to legacy's. Attribute parity on
`next-opportunity-finder` and result-set parity on every filter combination tested
(keyword, frequency, ministry, unfiltered) are also exact. `next-plan-your-visit`'s
step-2 field set matches legacy field for field, and its MP write (Household,
Address, head + spouse + child Contacts, Participants, Milestones, notification email)
is complete and correct once C24 is out of the way.

Three things looked like breaking defects and are **parity**, so no item was filed —
worth knowing before someone re-tests:

- **`Opportunities.Close_Responses` is ignored by both stacks.** With the flag set, both widgets still render a working Respond form and both accept the response.
- **An anonymous visitor can forge `ContactId` on an opportunity response.** Submitting anonymously with another person's contact id produced, on **both** sides, a `Responses` row against that person's real `Participant_ID`. Ours is not a new hole, but it is worth closing while C21 is fixed.
- **Neither stack validates phone format**, and neither shows a native `reportValidity` popup. Both accept the literal string `abc` as a phone number, and both accept a 3,000-character message with no `maxlength`.

Two limits on this block's coverage, both recorded in the logs rather than filed:

- **Legacy Plan Your Visit step 2 is unreachable.** Its verify link carries a JWT signed with MP's server secret (`VerifyEmailLink` answers `500 "Error decoding jwt"` for anything else), the verification email leaves no row in `dp_Communications`, and step 1 creates no contact whose GUID could stand in. Step 2's field-for-field comparison is therefore derived from the legacy bundle's own `BuildTextInput`/`BuildDateInput`/`BuildPhoneInput` call sites — complete for *which fields exist*, silent on rendered copy and client behaviour.
- **`next-opportunity-finder` may list hidden opportunities and this could not be tested.** `OpportunityFinderService`'s `SearchRow` type declares a `Hidden` field and never reads it. Every row `api_MPPW_SearchOpportunities` returns on this instance has `Hidden = 0`, and the flag is computed inside the proc rather than stored on `Opportunities`, so the condition cannot be created through the REST API. **This is the one residual data-exposure risk in the block and it needs a DB-side answer.**

One more `plan-your-visit` defect was found and could not be filed for lack of a
number in the block: `syncChildren()` (`plan-your-visit.ts:326-331`) preserves only
`dob`, so adding or removing a child wipes every previously typed child name, gender
and age-group. Measured, reproducible, and named in C24's "Where to fix" — it deserves
its own `functional` item if a number frees up at consolidation.
