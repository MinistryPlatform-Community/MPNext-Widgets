# C11. `next-group-details` sends no inquiry / sign-up / leader-notification email — the three `*-email-template` attributes are accepted and silently ignored

**Widget:** `next-group-details` (old: `mpp-group-details`, `/widgets/group_details.aspx`)
**Severity:** functional
**Confidence:** confirmed — legacy request/response observed in the browser, new request/response observed, and the resulting MP rows read back with the client-credentials API
**Found:** 2026-09-08, comparison run (groups agent)

## Old behaviour

`/widgets/group_details.aspx` configures three templates:

```html
<mpp-group-details returnurl="../Groups"
                   inquiryemailtemplate="665"
                   signupemailtemplate="664"
                   inquirefullgroups="false"
                   leadersignupemailtemplate="664">
```

`GroupDetails.js` treats them as live wiring, not documentation:

- On load it *validates* each id through its communication service
  (`_getEmailTempate(this.inquiryEmailTemplate)`), and if the template does not resolve it
  paints a `mppw-alert__danger` reading **"Invalid Email Template. Saving the record is
  allowed, however no email notifications will be sent."** — i.e. the legacy widget's own
  copy states that the normal case *does* send notifications.
- Both forms carry the ids as hidden fields that post with the write:
  `<input type="hidden" name="UseEmailTemplate" value="665">` on the inquiry form, and
  `UseEmailTemplate` + `LeaderSignupEmailTemplate` on the sign-up form.

Observed on the wire, signed in as the Playwright user, group 49:

```
POST https://mpi.ministryplatform.com/widgets/Api/GroupsApi/Inquire   -> 500
POST https://mpi.ministryplatform.com/widgets/Api/GroupsApi/SignUp    -> 500
```

Both 500s, yet **both rows were created in MP** (`Group_Inquiry_ID 5`,
`Group_Participant_ID 310`). So the legacy failure is downstream of the insert — the
notification step — which is further confirmation that legacy attempts a send. (That 500
is a legacy-side defect on this MP instance, not something to fix here; it is recorded
only because it is how the send step made itself visible.)

## New behaviour

`next-group-details` declares all three attributes in `observedAttributes`
(`group-details.ts:100-102`), so CONFIG-MAP.md section 4.3 scores the pair as complete
attribute parity — but the component never reads them, and the doc comment says so
outright (`group-details.ts:69-72`):

```
 *  - Optional inquiry/sign-up confirmation + leader-notification emails are not
 *    sent in v1; the Group_Inquiries / Group_Participants records are still
 *    created. The *-email-template attributes are accepted but currently no-op.
```

Confirmed end to end: the inquiry submit is a single
`POST /api/embed/group-details/inquire` → 200, and the sign-up a single
`POST /api/embed/group-details/signup` → 200. No second call, and nothing in
`src/services/groupsService.ts` (`createInquiry`, `signUp`) or the two routes touches a
communication/template API. `grep -ri "email.template\|EmailTemplate\|Communication"`
over `src/services` and `src/app/api/embed/group-details` returns nothing.

So on a customer site the visitor sees "Thanks … your message has been sent to the group"
and no message is sent to anyone.

## Why it matters

Group inquiry is a handoff, not a database write. The legacy flow's actual product is the
email: the inquirer gets a confirmation, and — via `leadersignupemailtemplate` — the group
leader gets told a person is waiting for them. Ours writes a `Group_Inquiries` row that
nobody is told about, so the inquiry only surfaces if a staff member happens to run a
report. A visitor who fills the form and hears nothing back concludes the church ignored
them; the leader never learns the group grew. This is the single most damaging silent
difference we found in the group domain, and it is silent twice over: the success copy
claims a send, and the attributes a migrating customer copies across are accepted without
a warning. It also makes C12 (inquiry rows carry no name, email or phone) worse, because
there is not even an email trail to recover the contact details from.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/group-details-new-inquiry-submitted.png`
    ("Thanks, … Your message has been sent to the group.")
  - `.claude/playwright/widget/screenshots/group-details-old-inquiry-submitted.png`
    (legacy's post-500 error banner)
  - `.claude/playwright/widget/screenshots/group-details-new-signup-submitted.png`,
    `group-details-old-signup-authed.png`
- New network trace (only one POST, no template call):
  `200 POST /api/embed/group-details/inquire`, `200 POST /api/embed/group-details/signup`
- Legacy hidden fields, from the widget's own shadow DOM:
  `{"name":"UseEmailTemplate","type":"hidden"}` on `#inquiryForm`;
  `UseEmailTemplate` + `LeaderSignupEmailTemplate` on `#signupForm`
- Legacy source: `_getEmailTempate` / `#invalidInquiryEmailContainer` /
  `#invalidSignUpEmailContainer` in `https://mpi.ministryplatform.com/widgets/dist/GroupDetails.js`
- MP verification: `Group_Inquiries` rows 4 (new) and 5 (old) and `Group_Participants`
  rows 309 (new) and 310 (old) on group 49, read and then deleted with
  `.claude/playwright/widget/scripts/groups-mp-verify3.mts` /
  `groups-mp-verify5.mts` / `groups-mp-cleanup.mts`
- Script: `.claude/playwright/widget/scripts/groups-gd-write.mjs`

## Where to fix

- `packages/embed-sdk/src/components/group-details.ts:255-272` — put the three template
  ids into the POST payload (`inquiry-email-template`, `signup-email-template`,
  `leader-signup-email-template`).
- `src/app/api/embed/group-details/inquire/route.ts` and `…/signup/route.ts` — accept and
  validate them.
- `src/services/groupsService.ts` — `createInquiry` (around the
  `createTableRecords("Group_Inquiries", …)` call) and `signUp` (after the
  `Group_Participants` insert) are where the send belongs.
- `packages/types` — `GroupInquiryRequest` needs the template fields.

## Suggested fix

MP exposes message sending through the same REST surface `MPHelper` already wraps
(a `Messages`/communication insert or the `dp_` communication procedure — check
`src/lib/providers/ministry-platform` for what is already reachable; there is no
communication helper there today, so this is the one genuinely new piece of plumbing).
Add a small `sendTemplateMessage(templateId, toContactId|toEmail, mergeData)` to the
provider, then:

1. inquiry → confirmation to the inquirer using `inquiry-email-template`;
2. sign-up → confirmation to the participant using `signup-email-template`;
3. sign-up → notification to the group's leaders (the `contacts` array the detail call
   already returns, which carries `emailAddress`) using `leader-signup-email-template`.

Do the send **after** the insert and do not fail the request on a send error — return
success with a soft warning, which is what legacy's own copy promises ("Saving the record
is allowed, however no email notifications will be sent"). Mirror legacy's up-front
template validation too, or at minimum log loudly when an attribute is supplied and no
sender is configured, so the next migration does not go quiet again. Until this lands,
the success copy at `group-details.ts:306` overstates what happened and should be softened.
