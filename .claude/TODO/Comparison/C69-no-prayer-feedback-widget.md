# C69. Legacy `mpp-prayer-feedback-form` has no `next-*` counterpart — `next-custom-form` is the counterpart of `mpp-custom-form`, not of this

**Widget:** none (old: Prayer And Feedback, `/widgets/prayer_feedback_form.aspx`)
**Severity:** functional
**Confidence:** confirmed — MPWidgets.js's own loader table lists both tags as distinct widgets with disjoint attribute surfaces; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

`/widgets/prayer_feedback_form.aspx` hosts:

```html
<mpp-prayer-feedback-form
  returnurl="https://mpi.ministryplatform.com/widgetsprayer_feedback_form.aspx/"
  programid="12" verificationemailtemplate="5125"></mpp-prayer-feedback-form>
```

`observedAttributes` in `/widgets/dist/PrayerFeedbackForm.js`:

```
["feedbacktypeids","programid","returnurl","verificationemailtemplate"]
```

with these vendor descriptions from `WidgetConfigurator.js`, verbatim:

- `programid` — "Prayer & Feedback responses will be associated with the identified Program if supplied."
- `feedbacktypeids` — "Determines which Prayer & Feedback types will be available in the Feedback Type dropdown menu. Include a comma separated list of the Feedback Type IDs"
- `verificationemailtemplate` — "Identifies a Message Template stored in the Platform that will be sent to the individual who submits a Prayer & Feedback response."
- `returnurl` — "The fully qualified URL where the widget will return you to, usually where the widget was placed on your website."

So it is a purpose-built widget over MP's Feedback Entries: a Feedback-Type dropdown
restricted to a chosen list, association with a Program, and an acknowledgement email to
the submitter.

## New behaviour

There is no prayer/feedback element in the 25-element `next-*` roster.

**The BRIEF's pair table maps this page to `next-custom-form` ("old page is a custom form
instance"). That is wrong, and it matters** — a sibling following it would compare two
unrelated widgets and conclude parity. MPWidgets.js's loader table lists both tags
separately:

```js
{tag:"mpp-custom-form", script:"/dist/MppCustomForm.js", name:"Custom Form"},
{tag:"mpp-prayer-feedback-form", script:"/dist/PrayerFeedbackForm.js", name:"Prayer Feedback"},
```

and their surfaces are disjoint: `mpp-custom-form` observes `["formguid"]` and nothing
else. `next-custom-form` observes `form-guid` / `form-id` / `id-parameter-name` /
`checkout-url` — i.e. it is a faithful counterpart of `mpp-custom-form` (in fact a
superset) and has no `programid`, no `feedbacktypeids`, no `verificationemailtemplate`.

A church *could* hand-build a Custom Form that collects prayer requests, but it would
write to `Form_Responses` rather than `Feedback_Entries`, would not populate the Feedback
Type or Program, and would not appear in the tools MP staff use to work a prayer queue.
That is a different record in a different table, not a configuration difference.

## Why it matters

Prayer request intake is one of the most-embedded widgets in the catalogue — for many
churches it is the first thing on the website that writes to MP. A church cutting over
finds no replacement, and the nearest thing (`next-custom-form`) silently lands its
submissions somewhere the prayer team does not look. Because the BRIEF asserts these are a
pair, this gap was at real risk of being marked "tested, parity" by a sibling.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/prayer_feedback_form.aspx`
- Both tags are in the loader table `ut=[…]` in
  `https://mpi.ministryplatform.com/widgets/dist/MPWidgets.js` (offset ~684 900)
- Old surface: `observedAttributes` from `/widgets/dist/PrayerFeedbackForm.js` and
  `/widgets/dist/MppCustomForm.js`; descriptions from `/widgets/dist/WidgetConfigurator.js`
- New roster: `grep -rho 'customElements\.define(\s*"next-[a-z-]*' packages/embed-sdk/src`
  → 25 elements, none for prayer or feedback
- New surface: `packages/embed-sdk/src/components/custom-form.ts:67`+
- No screenshot: static-only item by design
- Method note: `.claude/playwright/widget/CONFIG-MAP.md` sections 2.6, 3, 4.16

## Where to fix

- new `packages/embed-sdk/src/components/prayer-feedback.ts` (+ `demo-prayer-feedback.html`)
- new `src/app/api/embed/prayer-feedback/route.ts`
- new `src/services/prayerFeedbackService.ts` writing `Feedback_Entries`

## Suggested fix

Build it as its own element rather than bending `next-custom-form`, because the record it
writes and the fields it needs are fixed, not user-authored. `next-plan-your-visit` is the
closest in-repo template: anonymous submitter, a required-field form through
`shared/form-validation.ts`, an acknowledgement email sent via the
`dp_Communications`-template pattern already implemented in
`src/services/planYourVisitService.ts`, and a `return-url` for the verification bounce.
Attribute surface should be `program-id`, `feedback-type-ids`,
`verification-email-template`, `return-url`.

Also: correct the pair table in `.claude/playwright/widget/BRIEF.md` — `next-custom-form`
pairs with `mpp-custom-form`, for which the sample site has **no page**, so that
comparison needs the tag placed by hand (CONFIG-MAP.md section 5).

---

## Resolved — 2026-09-09, `next-prayer-feedback`

Built as its own element, as the *Suggested fix* asked, rather than by bending
`next-custom-form`. Plan and rulings: `.claude/TODO/Comparison/Plans/prayer-feedback.md`.
Customer-facing documentation: README, *Prayer & Feedback Intake*.

| Piece | Where |
|---|---|
| Element | `packages/embed-sdk/src/components/prayer-feedback.ts` (+ `demo-prayer-feedback.html`) |
| Service | `src/services/prayerFeedbackService.ts` — writes `Feedback_Entries` |
| Routes | `src/app/api/embed/prayer-feedback/{types,submitter,submit,verify}` |
| Wire types | `packages/types/src/prayer-feedback.ts` |

**The pair-table correction this finding asked for is done.**
`.claude/playwright/widget/BRIEF.md` now maps `next-custom-form` ↔ `mpp-custom-form`
(no page on the sample site; place the tag by hand, CONFIG-MAP.md §5) and
`next-prayer-feedback` ↔ `mpp-prayer-feedback-form`.

**Where the *Suggested fix* above was followed.** `next-plan-your-visit` was indeed the
closest in-repo template — anonymous submitter, required fields through
`shared/form-validation.ts`, a `dp_Communications` template send, a `return-url` for the
verification bounce — and the template-send half is now shared rather than copied
(`src/services/messageTemplateService.ts`, extracted from `planYourVisitService.ts` for
this and three other pending widgets).

**Where it was not.** The suggested attribute name was `verification-email-template`;
the built surface uses **`verification-email-template-id`**, matching the `-id` spelling
the two newest and closest widgets already use, and adds
`acknowledgement-email-template-id`. Those are two different contracts, not one
renamed: the verification template *must* render `[mpp_verify_email_url]`, so reusing it
on the signed-in path — which skips verification — would email a dead link.

Also not followed: a single `route.ts`. Four routes, because they have genuinely
different properties — `/types` is publicly cacheable for 10 minutes, `/submitter` is
per-household and `no-store`, `/submit` and `/verify` are rate-limited POSTs. Folding
`/submitter` into `/types` would have put one household's member names into a shared
cache.

**Four legacy defects were fixed rather than ported**, each with a regression test:

1. **The email cannon.** `PrayerFeedbackApiController.cs:66` was `[AllowAnonymous]` and
   took `ContactId` straight off the form: post a stranger's id and the server looked
   them up, harvested their real name and address, and mailed them a link that would
   file a prayer request against them. No auth, no household check, no rate limit. A
   contact id is now read only on a signed-in path, and only after a server-side
   household check.
2. **The duplicate guard**, which interpolated `Entry_Title` and `Description` into an
   MP filter *and* compared an untruncated value against a column it had truncated, so
   entries over 1000 characters never matched their own guard. Replaced by a single-use
   handle — an atomic read-and-burn in the session store, so single-use is a property of
   the storage rather than something a comparison has to get right.
3. **The disagreeing description limit.** The textarea said 2000, the column allows
   2000, and both the token and the insert cut at 1000. All 2000 survive end to end.
4. **The unconditional `Email_Address` overwrite** (`PrayerFeedbackService.cs:189`),
   which meant a typo in a public prayer form silently broke a member's giving
   statements and every other email MP sent them. The submitted address is written only
   when the contact has none on file — the case legacy's own UI was built for.

A fifth was found while porting and filed separately: legacy's
`ContactManager.CreateContact` writes `{"Status", …}`, and `Contacts` has no such
column. The real one is `Contact_Status_ID` (**C83**).

**One deliberate divergence a church will notice.** Omitting `feedbacktypeids` used to
offer all five feedback types, including `User Removal Request` — a GDPR erasure
workflow wearing a prayer-form costume. The default now excludes it, by both its stock
id and a `/removal/i` name match so the guard survives a re-seeded lookup table. An
explicit `feedback-type-ids` listing it is honoured, with a warning. It is a safety
default, not a control: a determined caller can post the id, because MP's foreign key
accepts it. Documented in the README migration note.

**What is accepted rather than solved.** The `feedback-type-ids` allowlist is host-page
markup, so the server enforces it as a *correctness* check and not as a boundary — a
caller can send any list. `isKnownFeedbackType` is the real guard, against a bogus FK.
Anyone wanting a hard restriction is asking for server-side tenant config, which is out
of scope, and the route's header comment says so plainly rather than implying the
attribute restricts anything.

**Out of scope, and stated in the plan.** E2E coverage: the flow needs a real mailbox,
and there is no mail-capture endpoint. `Feedback_Entries.Care_Case_ID` is left unwritten,
as legacy leaves it — whether MP expects the submitting widget to open a Care Case or
staff to do it from the Platform is a workflow question for someone who works a prayer
queue, not one the schema can answer.
