# C14. `next-group-details` sign-up can only sign up a household member — legacy's "Blank Form" option, which signs up anyone, is gone

**Widget:** `next-group-details` (old: `mpp-group-details`, `/widgets/group_details.aspx`)
**Severity:** functional
**Confidence:** confirmed — both sign-up forms enumerated in the browser signed in as the Playwright user
**Found:** 2026-09-08, comparison run (groups agent)

## Old behaviour

Signed in, on the "Sign Up For This Group" tab, `#signUpAs` offers **five** options:

```
Blank Form, Kehayias, Chris, Kehayias, Sarah, Kehayias, Aiden, Kehayias, Jillian
```

Choosing "Blank Form" calls `ShowSignUpBlankForm()`, which reveals `#signUp_firstNameText`,
`#signUp_lastNameText`, `#signUp_emailText`, `#signUp_phoneText` and marks all four
required. So a signed-in user can sign up somebody who is *not* in their household — a
friend they are bringing, a relative in a different household record, a person with no MP
contact at all — by typing their details. The same "Blank Form" option exists on the
inquiry tab.

## New behaviour

`#gd-signup-as` offers **four** options and no escape hatch:

```
Kehayias, Chris, Kehayias, Sarah, Kehayias, Aiden, Kehayias, Jillian
```

The whole sign-up form is a picker plus a message box — the only inputs measured were
`#gd-signup-as` (select) and `#gd-signup-message` (textarea). There is no "Someone else…"
entry, and the name/email/phone block that the *inquiry* tab shows for "Someone else…" is
not rendered on the sign-up tab at all. The component enforces it on submit
(`group-details.ts:259-262`):

```ts
if (tab === "signup" && (contactId == null || contactId <= 0)) {
  this.setMessage("danger", "Please choose who is signing up.");
  return;
}
```

and the design note at `group-details.ts:73-74` states the intent:

```
 *  - Sign-up uses a household-member contact (no anonymous "Blank Form" sign-up,
 *    which the backend cannot attribute to a participant).
```

That reasoning holds for the *participant* row — `GroupsService.signUp` needs a
`Participant_ID` — but legacy solved the same problem: its API creates the contact /
participant from the typed details (`GroupsService.resolveParticipantId` in this repo
already contains the "create a Participant record when missing" half of that logic, it
just has no path to create the Contact).

Sign-up otherwise reaches full write parity — the two rows created on group 49 were
identical (see Evidence) — so this is specifically the missing option, not a broken flow.

## Why it matters

Bringing someone along is the normal way small groups grow, and the person being brought
is very often not in the inviter's MP household: an adult child, a roommate, a
neighbour, a spouse whose record was never linked. Legacy handled all of those from the
group page in one submit. On ours, the visitor sees a dropdown containing only their own
family, has no way to proceed, and their only options are to abandon the sign-up or to
phone the church — which is exactly the friction the widget exists to remove. A church
migrating loses that capability without any message telling them it went.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/group-details-old-signup-authed.png`
    ("Blank Form" first in `#signUpAs`, First/Last/Email/Phone fields present)
  - `.claude/playwright/widget/screenshots/group-details-new-signup-authed.png`
    (picker + message only)
- Measured, old `#signupForm`: `signUpAs` opts
  `["Blank Form","Kehayias, Chris","Kehayias, Sarah","Kehayias, Aiden","Kehayias, Jillian"]`
  plus `signUp_firstNameText`, `signUp_lastNameText`, `signUp_emailText`,
  `signUp_phoneText`, `signUp_messageText`
- Measured, new `#gd-signup-form`: `[{"id":"gd-signup-as","opts":["Kehayias, Chris","Kehayias, Sarah","Kehayias, Aiden","Kehayias, Jillian"]},{"id":"gd-signup-message"}]`
- Write parity proof (both deleted afterwards): `Group_Participants` 309 (new) and 310
  (old) on group 49 — same `Participant_ID` 10, same `Group_Role_ID` 2 ("Group Member"),
  same `Notes` shape `"… .  Created by Group Finder."`
  (`.claude/playwright/widget/scripts/groups-mp-verify5.mts`)
- Scripts: `.claude/playwright/widget/scripts/groups-gd-validate.mjs`, `.claude/playwright/widget/scripts/groups-gd-write.mjs`
- Note the inquiry tab *does* have the equivalent ("Someone else…",
  `group-details.ts:619-623`), which is why this reads as an omission rather than a
  deliberate narrowing of the whole widget.

## Where to fix

- `packages/embed-sdk/src/components/group-details.ts` — `renderSignupForm()` (`:637-668`),
  `renderAsPicker()`, and the guard at `:259-262`.
- `src/services/groupsService.ts` — `signUp()` and `resolveParticipantId()`.
- `src/app/api/embed/group-details/signup/route.ts` — accept the typed identity fields.

## Suggested fix

Mirror the inquiry tab. Add "Someone else…" to `#gd-signup-as`, reuse
`renderBlankFields()` so the same First/Last/Email/Phone block appears (required, via the
shared `form-validation.ts`), and drop the `contactId`-required guard in favour of
"either a contactId **or** a full name+email".

Server side, `signUp` needs a contact-resolution step before `resolveParticipantId`: look
for an existing `Contacts` row by email, and create one if there is none, then let the
existing participant-creation path run. That is the same shape as legacy and reuses the
`defaultParticipantType` config lookup already present. Decide deliberately whether an
anonymous (not signed-in) blank-form sign-up should be allowed — legacy shows the login
prompt for the sign-up tab too, so keeping sign-in required and only widening *who* can be
signed up matches legacy exactly and avoids opening an unauthenticated contact-creation
endpoint.
