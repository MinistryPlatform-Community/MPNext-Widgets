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
