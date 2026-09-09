# group-details — comparison test log

- **New**: `next-group-details` — http://localhost:5173/demo-group-details.html?id=49
- **Old**: Group Details — https://mpi.ministryplatform.com/widgets/group_details.aspx?id=49
- **Tested**: 2026-09-08 by subagent **groups** (block C10–C19)
- **Auth state(s) tested**: signed out **and** signed in as `PLAYWRIGHT_MP_USERNAME`
  (MP User 98 / Contact 98, "Kehayias, Chris")
- **Scripts**:
  - `.claude/playwright/widget/scripts/groups-gd-compare.mjs` — baseline render + full element enumeration, run twice (anonymous, then `AUTHED=1`)
  - `.claude/playwright/widget/scripts/groups-gd-validate.mjs` — sign-up tab, empty submit, bad email, bad phone, native-popup probe, both sides
  - `.claude/playwright/widget/scripts/groups-gd-write.mjs` — inquiry and sign-up writes, both sides (`SIDE=new|old`, `DO_SIGNUP=1`)
  - `.claude/playwright/widget/scripts/groups-mp-verify2.mts` — the proc's detail result sets for group 49
  - `.claude/playwright/widget/scripts/groups-mp-verify3.mts` / `…5.mts` — read back `Group_Inquiries` / `Group_Participants`
  - `.claude/playwright/widget/scripts/groups-mp-cleanup.mts` — fixture teardown

> **Correction to the original brief.** This widget is *not* new-only. `mpp-group-details`
> exists and `/widgets/group_details.aspx` is a live page, so this was run as a
> head-to-head comparison (per CONFIG-MAP.md section 3.1 and the coordinator's correction).

**Configuration used.** The legacy page ships:

```html
<mpp-group-details returnurl="../Groups" inquiryemailtemplate="665"
                   signupemailtemplate="664" inquirefullgroups="false"
                   leadersignupemailtemplate="664">
```

`demo-group-details.html` builds its widget from script with only
`group-id`, `return-url`, `show-full-address="true"` and `api-host`. So for every
comparison run the demo widget was **removed and rebuilt via DOM** with the legacy set
mirrored onto it — `inquiry-email-template="665"`, `signup-email-template="664"`,
`leader-signup-email-template="664"`, `inquire-full-groups="false"`, and
`show-full-address` dropped (the legacy page does not set it). No demo page or widget
source was edited. Attribute-name mapping per CONFIG-MAP.md section 4.3, which scores this
pair as complete attribute parity — a score this run had to qualify (see C11).

## What I tested

1. **Anonymous render, both sides**, on group 49 ("Kehayias Home Group"): shadow text,
   full element inventory (labels, inputs, required flags, select options, computed
   visibility of 18 named legacy containers), desktop + 390×844 screenshots.
2. **Signed-in render, both sides**, same group, with `assertAuthenticated` after the
   navigation on each. Compared the household picker contents and the two tab panels.
3. **Data parity against MP.** Called `api_MPPW_SearchGroups` with `@GroupId: 49` and
   compared every field the two views render — title, group focus, meeting frequency,
   meeting day/time, capacity, start date, location, and the second result set (group
   leaders) — against both widgets.
4. **Tab switching.** Clicked `#signUpTab` / `[data-tab="signup"]` and back, verifying the
   panel swaps and reading the resulting markup and ARIA attributes.
5. **Sign-up tab, signed out**, both sides: what is offered instead of the form.
6. **Sign-up tab, signed in**, both sides: full input inventory and picker options.
7. **Validation on the inquiry form, both sides**: (a) empty submit with the anonymous /
   "Blank Form" path selected, (b) `emailAddress = "not-an-email"`, (c)
   `mobilePhoneNumber = "abc"`. Recorded the `required` attribute set, the per-field error
   text, `aria-invalid`, and the form-level summary and its position.
8. **Native `reportValidity` probe.** Monkey-patched `HTMLFormElement.prototype.reportValidity`
   and `HTMLInputElement.prototype.reportValidity` in-page before submitting, and counted calls.
9. **Inquiry write, end to end, both sides.** Signed in, picker on "Kehayias, Chris",
   message `ZZTEST-groups-agent NEW/OLD inquiry 2026-09-08`, submitted, then read the
   resulting `Group_Inquiries` rows out of MP and compared all 11 columns.
10. **Sign-up write, end to end, both sides.** Same, message
    `ZZTEST-groups-agent NEW/OLD signup 2026-09-08`, then compared the resulting
    `Group_Participants` rows.
11. **Email behaviour.** Watched the legacy network for the template calls and hidden form
    fields; traced the new POST payload, route and service for any communication call.
12. **Console / network hygiene** on every run.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Element upgrades, shadow root populated | yes | yes | **pass** |
| 2 | Console errors / failed requests, signed in | none | none (`apiFailures: []`) | **pass** |
| 3 | Data fields rendered (title, focus, frequency, day, time, capacity, start, location) | all | all, same values (`2 of 20`, `Main Congregation`, `Every Other Week`, Monday 6:30 PM) | **pass** |
| 4 | Agreement with `api_MPPW_SearchGroups @GroupId=49` | yes | yes | **pass — both correct** |
| 5 | Group leaders | `Kehayias, Chris` + `Hoy, Candice`, avatars | same two, avatars, **plus `mailto:` links** | **pass, new better** |
| 6 | Two tabs present | Contact / Sign Up | Contact / Sign Up | **pass** |
| 7 | Tab ARIA semantics | radio group conveys role + selected state | `<button>` with no `role="tab"`, `role="tablist"`, `aria-selected` or `aria-controls` | **fail → C19** |
| 8 | Tabs keyboard operable | yes | yes | **pass** |
| 9 | Sign-up tab when signed out | tab shown, form hidden, `#loginButtonContainer` visible | `Please sign in to sign up for this group.` + a **Sign In** button | **pass, new better** |
| 10 | Inquiry allowed anonymously | yes | yes | **pass** |
| 11 | "Already inquired / signed up" warning leaks to anonymous users | no | no — the string is present in the shadow root but `display:none` (HARNESS gotcha 3; checked computed style before concluding) | **pass** |
| 12 | Household picker, signed in | `Blank Form, Kehayias Chris/Sarah/Aiden/Jillian` | `Kehayias Chris/Sarah/Aiden/Jillian, Someone else…` | **pass** (ordering/naming drift → C19) |
| 13 | Picker default, signed in | `Blank Form` | the signed-in contact (`98`) | **pass, new better** |
| 14 | Sign-up for a non-household person | yes, via `Blank Form` + typed name/email/phone | **no such option** | **fail → C14** |
| 15 | Inquiry required fields | First, Last, Email, **Phone** | First, Last, Email | **fail → C16** |
| 16 | Bad email caught | `Invalid format` | `Enter a valid email address.` | **pass** |
| 17 | Bad phone caught | not format-checked (required only) | not required at all | **fail → C16** |
| 18 | Native `reportValidity` popup | n/a | **never called** (`rv: 0` across three submits) — shared `form-validation.ts`, inline `.mpx-field-error`, `aria-invalid="true"` | **pass** |
| 19 | Per-field error copy | `First Name is required` | `This field is required.` (identical on all) | **fail → C19** |
| 20 | Form-level error position | inside the form, by the submit | at the **top of the shadow root**, above the title and image | **fail → C19** |
| 21 | Inquiry submit succeeds | `500 POST /Api/GroupsApi/Inquire` (row still created) | `200 POST /api/embed/group-details/inquire` | **new better** — legacy 500s after the insert |
| 22 | `Group_Inquiries` row: `Contact_ID`, `Comments`, `Inquiry_Date` | correct | correct, same wall-clock minute | **pass** |
| 23 | `Group_Inquiries` row: `First_name`, `Last_name`, `Email`, `Phone` | `Chris` / `Kehayias` / `chris.kehayias@acst.com` / `321-794-1376` | **all NULL** | **fail → C12** |
| 24 | Inquiry confirmation email | attempted (hidden `UseEmailTemplate=665`; the 500 is in that step) | **none** — `*-email-template` accepted and ignored by design | **fail → C11** |
| 25 | Leader sign-up notification email | attempted (hidden `LeaderSignupEmailTemplate`) | **none** | **fail → C11** |
| 26 | Sign-up submit succeeds | `500 POST /Api/GroupsApi/SignUp` (row still created) | `200 POST /api/embed/group-details/signup` | **new better** |
| 27 | `Group_Participants` row fields | id 310: Participant 10, Role 2 "Group Member", `Notes` "… .  Created by Group Finder." | id 309: **identical** on every column | **pass — exact write parity** |
| 28 | Post-submit greeting | generic | `Thanks, **Kehayias Chris**!` — surname first | **fail → C17** |
| 29 | Map / directions | `#map` + `#mapAddress` present (hidden: no coordinates) | Google Maps `output=embed` iframe, rendered only when lat/long are non-null | **untestable** — see Not tested |
| 30 | `inquire-full-groups` honoured | `false` on the sample page | attribute read (`boolAttr`) | **untestable** — see Not tested |
| 31 | 390×844 reflow | single column, no horizontal overflow | single column, no horizontal overflow | **pass** |
| 32 | Copy / label / field-order parity | see C19 table | 13 differences | **fail → C19** |
| 33 | Attribute surface | 9 legacy options | all 9 present (renamed to kebab) + `group-id`, `id-parameter-name` | **pass** — but three of them are inert (C11) |

## Findings filed

- `C11-group-details-sends-no-inquiry-or-signup-email.md` — no inquiry / sign-up / leader-notification email is sent; the three `*-email-template` attributes are accepted and ignored (functional).
- `C12-group-inquiry-row-missing-name-email-phone.md` — inquiries from household members write NULL `First_name`/`Last_name`/`Email`/`Phone` (functional).
- `C14-group-details-signup-no-blank-form.md` — sign-up can only target a household member; legacy's `Blank Form` is gone (functional).
- `C16-group-details-inquiry-phone-no-longer-required.md` — phone dropped from the required set (ux).
- `C17-group-details-greets-user-surname-first.md` — "Thanks, Kehayias Chris!" (cosmetic).
- `C19-group-details-copy-layout-and-tab-semantics-drift.md` — 13 copy/layout differences plus missing tab ARIA (cosmetic).

**A note on CONFIG-MAP.md section 4.3.** It scores this pair as "complete parity, nothing
filed", which is correct at the attribute level and misleading at the behavioural level:
`inquiry-email-template`, `signup-email-template` and `leader-signup-email-template` are
declared in `observedAttributes` but never read. That is exactly the class of thing static
analysis cannot see, and it is now C11.

## Where the new widget is better

- Both writes **succeed**. The legacy inquiry and sign-up both return 500 on this MP
  instance (after creating the row), leaving the visitor with
  "There was an error processing your group inquiry. undefined". Ours returns 200 cleanly.
- `Group_Participants` write parity is **exact** — same participant, role and `Notes` shape.
- Signed-out sign-up gets a real prompt ("Please sign in to sign up for this group." +
  Sign In) rather than legacy's bare hidden-form-plus-login-button.
- Group leaders are `mailto:` links.
- The picker defaults to the signed-in contact rather than legacy's `Blank Form`.
- Validation is inline, `aria-invalid`-annotated and never raises the native popup.

## Not tested / blocked

- **The map / full-address path.** No group on this MP domain has coordinates or a street
  address — `api_MPPW_SearchGroups` returns `Latitude: null`, `Longitude: null`,
  `Address: ""` for all four online groups, so legacy's `#map` stays hidden and ours never
  renders its iframe. Both `show-full-address="true"` and the default were requested and the
  route answered 200 either way. Unblock by creating a `ZZTEST-` group whose
  `Offsite_Meeting_Address` has a geocoded `Address_ID`, then re-running `gd-compare.mjs`.
  Worth doing: ours uses a keyless `https://www.google.com/maps?q=…&output=embed` iframe
  where legacy uses the Google Maps JS API, and that difference is untested.
- **`inquire-full-groups` (and therefore inquiring into a full group).** The proc returns no
  full group for this domain even with `@ShowFullGroups: true` (the full groups are
  `Group_Type_ID 9` and excluded for other reasons), so there is no full group reachable
  from the finder to open. Unblock with a `ZZTEST-` group of a finder-visible type with
  `Group_Is_Full = 1`.
- **`count-group-inquiries`** was passed through but its effect (inquiries counted toward
  capacity) could not be observed with 0 pre-existing inquiries on group 49.
- **`hide-contact-tab` / `hide-sign-up-tab`** were not exercised; the legacy sample page
  sets neither, so there was no like-for-like baseline. Both are read by the new component.
- **Whether legacy's emails actually arrive.** We have no mailbox for the test contact, and
  legacy's send step 500s on this instance. C11 rests on legacy *attempting* the send
  (hidden `UseEmailTemplate` fields, template pre-validation, and the failure landing after
  the insert) plus ours provably having no send path at all — not on a received email.

## Fixture data

Created and **deleted**: `Group_Inquiries` 4 (new) and 5 (old), `Group_Participants` 309
(new) and 310 (old), all on group 49. Teardown verified — `Comments LIKE 'ZZTEST%'` and
`Notes LIKE 'ZZTEST%'` both return `[]` (`groups-mp-cleanup.mts`,
`groups-mp-cleanup2.mts`). Nothing left behind.

## Screenshots

- `screenshots/group-details-old-anon.png` / `group-details-new-anon.png` — anonymous baseline pair.
- `screenshots/group-details-old-anon-mobile.png` / `group-details-new-anon-mobile.png` — same at 390×844.
- `screenshots/group-details-old-authed.png` / `group-details-new-authed.png` — signed-in baseline pair, household picker visible.
- `screenshots/group-details-old-authed-mobile.png` / `group-details-new-authed-mobile.png` — same at 390×844.
- `screenshots/group-details-old-signup-authed.png` — legacy sign-up: `Blank Form` + four identity fields (C14).
- `screenshots/group-details-new-signup-authed.png` — new sign-up: picker + message only (C14).
- `screenshots/group-details-old-inquiry-validation.png` — legacy: four field-specific required errors (C16, C19).
- `screenshots/group-details-new-inquiry-validation.png` — new: three generic errors, summary at the top (C16, C19).
- `screenshots/group-details-old-inquiry-bad-email.png` / `group-details-new-inquiry-bad-email.png` — bad-email handling.
- `screenshots/group-details-new-inquiry-submitted.png` — success copy, showing "Thanks, Kehayias Chris!" (C17) and the claim that a message was sent (C11).
- `screenshots/group-details-old-inquiry-submitted.png` — legacy's post-500 error banner.
- `screenshots/group-details-new-signup-submitted.png` / `group-details-old-signup-submitted.png` — sign-up outcomes.
