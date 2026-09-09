# `next-group-details` — plan

**Items:** C11 (functional — the biggest silent difference in the group domain) ·
C12 (functional) · C14 (functional) · C16 (ux) · C17 (cosmetic) · C19 (cosmetic + one a11y row)
**Cutover verdict: blocks pilot cutover. Inquiries go nowhere and arrive anonymous.**
**Owns:** `packages/embed-sdk/src/components/group-details.ts`,
`src/services/groupsService.ts`, `src/app/api/embed/group-details/*`, `packages/types`

## What the feedback says

Three findings compound into one outcome: **a group inquiry is a lead that nobody is told
about and that carries no way to answer it.**

- **C11** — no inquiry, sign-up or leader-notification email is sent **at all**. All three
  `*-email-template` attributes are declared in `observedAttributes` (so the parity table
  scored the pair as complete) and never read. The component's own doc comment says so. The
  visitor sees *"Thanks … your message has been sent to the group"* and no message is sent to
  anyone. Legacy's own copy proves it sends: it validates each template on load and warns
  *"Invalid Email Template. Saving the record is allowed, however no email notifications will
  be sent."*
- **C12** — when the inquirer is a known household member (the default, and by far the common
  path) the `Group_Inquiries` row stores **NULL `First_name`, `Last_name`, `Email`, `Phone`**.
  The picker hides those inputs, `FormData` returns nothing, and the payload nulls all four.
  Legacy resolves the chosen contact and stores them. It is **asymmetric**: anonymous
  inquiries *do* carry the details, so the records hardest to trace are the ones from the
  church's own members.
- **C16** — phone is no longer required, so a share of inquiries arrive with an email only.

Together: a leader may end up with an inquiry they cannot answer by any channel, and no email
trail to recover the details from.

Then two capability/quality items: **C14** (sign-up can only sign up a household member —
legacy's "Blank Form" is gone) and **C17** (*"Thanks, Kehayias Chris!"*).

## Where the new widget is already better — protect these

Genuinely a lot, and it is worth being explicit so a parity-driven fix does not undo it.

- **Legacy's `Inquire` and `SignUp` both 500 after writing their row on this MP instance.
  Ours return 200.** The rows themselves reached full write parity (`Group_Participants` 309
  vs 310: same `Participant_ID`, same `Group_Role_ID`, same `Notes` shape).
- **Leaders are wrapped in `mailto:`** (C19 row 12) — legacy renders them unlinked.
- **The picker defaults to the signed-in contact**, where legacy defaults to `Blank Form`,
  i.e. the anonymous path. Ours is the better default and `Someone else…` is clearer than
  `Blank Form` (C19 row 7).
- **Validation is better in every respect except the phone field**: it uses the shared
  `form-validation.ts`, sets `aria-invalid="true"`, renders inline `.mpx-field-error` text,
  gives a specific message for a bad email, and — verified by monkey-patching
  `reportValidity` — **never** calls the native API. C16 is narrowly about `required` on one
  input, not about the mechanism.

## Phase 1 — make an inquiry answerable

### C12 — back-fill server-side (do this first; it is small and it is the safety net)

In `GroupsService.createInquiry`: when `form.contactId` is set and any of the four fields is
null, read the contact and fill them in. `getCurrentContact` already selects exactly
`firstName`, `lastName`, `emailAddress`, `mobilePhoneNumber`.

**Do it on the server, not by sending the fields from the client.** The client only knows the
household member's `Display_Name`, and trusting a client-supplied email for a contact the user
picked from a list would let a caller write someone else's contact details of their choosing.
A `getTableRecords` on `Contacts` filtered to `form.contactId` also covers household members
other than the signed-in user, whose details the client never had.

Keep the client's null-coalescing as is — with the back-fill, the anonymous and member paths
converge on legacy's shape.

### C11 — the emails, and the one genuinely new piece of plumbing

There is **no communication helper anywhere in `src/lib/providers/ministry-platform`** today.
This is the only item in the backlog that needs a new provider primitive.

**Do not write a second mechanism.** `src/services/planYourVisitService.ts` already implements
"read a `dp_Communications` template, substitute `[merge_token]`s, send" — including the note
that MP's REST layer has no send-from-template call. **Extract that into a shared
`sendTemplateMessage(templateId, to, mergeData)` on the provider**, then have both
plan-your-visit and group-details use it. `checkout-pay.md` C66 needs the same primitive for
receipts, and `ROADMAP-missing-widgets.md` names two more consumers. Extracting it once is the
difference between one helper and four hand-rolled sends.

Then wire three sends:

1. inquiry → confirmation to the inquirer (`inquiry-email-template`)
2. sign-up → confirmation to the participant (`signup-email-template`)
3. sign-up → notification to the group's leaders (`leader-signup-email-template`) — the
   `contacts` array the detail call already returns carries `emailAddress`

**Send after the insert, and do not fail the request on a send error.** Return success with a
soft warning — which is exactly what legacy's own copy promises. Mirror legacy's up-front
template validation too, or at minimum log loudly when a template attribute is supplied and no
sender is configured, so the next migration does not go quiet the same way.

**Until this lands, soften the success copy at `group-details.ts:306`.** It currently
overstates what happened, and that is a one-line change that can ship today.

### C16 — decide the phone question, do not default it

The item is right that this deserves a decision rather than a reflex fix. Requiring a phone
number is real friction on a public form, and some churches would rather have the inquiry than
the number. But **legacy made the choice and we changed it by omission**, which also silently
changes the data contract for anyone reporting on `Group_Inquiries.Phone`.

**Recommendation: require it, and make it configurable.** A phone number is how a small-group
leader actually follows up — text or call, not another email. Add `required` plus
`requiredStar()` on the label (the shared validator drives both off the same attribute, so it
is one line per field) and add a `require-inquiry-phone` attribute defaulting to `true` for
churches that want the lower-friction form. Say so in the migration notes either way.

## Phase 2 — restore the capability, fix the greeting

### C14 — sign-up can only sign up a household member

Legacy's `#signUpAs` offers **Blank Form** plus the household; ours offers the household only,
and the guard at `:259-262` enforces it. The design note gives the reason — the backend cannot
attribute an anonymous sign-up to a participant — but **legacy solved the same problem**, and
`GroupsService.resolveParticipantId` already contains the "create a Participant when missing"
half; it just has no path to create the Contact.

This matters because bringing someone along is the normal way small groups grow, and that
person is very often not in the inviter's household: an adult child, a roommate, a neighbour,
a spouse whose record was never linked. Today the visitor sees a dropdown containing only
their own family and has to phone the church — the exact friction the widget exists to remove.

Fix: mirror the **inquiry tab, which already has this** (`Someone else…`,
`group-details.ts:619-623`). Add the option, reuse `renderBlankFields()`, and replace the
`contactId`-required guard with "either a contactId **or** a full name + email". Server side,
`signUp` needs a contact-resolution step before `resolveParticipantId`: look for a `Contacts`
row by email, create one if absent, then let the existing path run.

**Decide deliberately whether an anonymous blank-form sign-up should be allowed.** Legacy
shows the login prompt for the sign-up tab too, so keeping sign-in required and widening only
*who* can be signed up matches legacy exactly **and avoids opening an unauthenticated
contact-creation endpoint**. Take that option.

### C17 — "Thanks, Kehayias Chris!"

`displayNameFor` strips the comma out of MP's `Display_Name` (`"Last, First"`) instead of
reordering: `member.displayName.replace(/,/g, "")`. Only the household-member path — the
default and common one — is affected; the typed-name path is correct.

Cheap fix is split-and-swap with a guard for single-token display names. **Better: use the
first name alone** — *"Thanks, Chris!"* reads far better at the end of a flow someone just
committed to, and it removes the string parsing entirely. `getHouseholdMembers()` would need
`First_Name` added to its select, which is one column.

Getting somebody's name backwards is the last thing they read, and it reads as carelessness in
a way a misaligned border does not. **Grep for the same `.replace(/,/g, "")` idiom in other
widgets rendering `Display_Name`.**

## Phase 3 — C19, presentation

Three things worth doing; the rest is wording for `CROSS-5`.

1. **Move the form-level message into the form.** It currently renders at the top of the
   shadow root, above the group title and image — on a phone, off-screen. Press Send Message
   with a field missing and the visitor sees the button do nothing. **This is the only row in
   C19 that can cost a submission.** Render it inside `.gd-form-wrap` above the submit row, or
   scroll it into view when set. (C16 flags the same placement issue.)
2. **Give the tabs real tab semantics** — `role="tablist"` / `role="tab"` / `aria-selected` /
   `aria-controls` / `role="tabpanel"`. Cheap, and it sets the pattern before other widgets
   copy this markup. See `CROSS-3`.
3. **Field-specific required messages** — `${label} is required.` instead of the same
   *"This field is required."* on every field. Legacy's is friendlier when several fail at
   once, and the same generic string is on the finder's Suggest-a-Group form, so fixing it in
   the shared validator fixes both.

Rows 1–6 and 11 (wording, field order, the meeting line format) fold into the copy decision in
`CROSS-5-theming-labels-locale.md`. **Keep rows 7 and 12** — the picker ordering and the
`mailto:` leaders are both improvements.

## Do better than parity

- **The inquiry is the product, not the row.** Once C11 lands, consider what the leader
  actually receives: a name, a phone, a message, and a one-click way to reply. That is a
  better target than "legacy sent an email too".
- **Tell the visitor what happens next.** *"Your message has been sent to the group"* is
  vague even when true. *"Sarah Hoy leads this group and will be in touch — usually within a
  few days"* is the version that stops the follow-up call to the church office.
- **Make the template attributes honest.** Per `CROSS-4`, an attribute that is declared and
  not honoured should warn once naming itself. That one convention would have caught C11
  during development.

## Acceptance

- An inquiry from a signed-in member writes name, email and phone into `Group_Inquiries`.
- Inquiry, sign-up and leader-notification emails are sent from the configured templates; a
  send failure returns success with a warning, not a 500.
- Sign-up offers "Someone else…" and creates the contact and participant.
- The greeting reads "Thanks, Chris!".
- The form-level message renders next to the submit control.
- Tabs expose tab semantics.

## Depends on / unblocks

C11 **needs the shared `sendTemplateMessage` primitive**, which is also wanted by
`checkout-pay.md` (C66) and two roadmap widgets — extract it here or there, but extract it
once. C19's a11y row follows `CROSS-3`; its copy rows follow `CROSS-5`.
