# profile — comparison test log

- **New**: `next-profile` — http://localhost:5173/demo-profile.html
- **Old**: About Me — https://mpi.ministryplatform.com/widgets/AboutMe (`<mpp-about-me>`)
- **Tested**: 2026-09-08 by subagent PEOPLE (block C50–C59)
- **Auth state(s) tested**: signed out **and** signed in as `PLAYWRIGHT_MP_USERNAME` (MP `dp_Users.User_ID` 98 → `Contacts.Contact_ID` 98)
- **Script**: `…/scratchpad/people-recon-anon.mjs`, `people-anon2.mjs`, `people-authed-new.mjs`, `people-authed-old.mjs`, `profile-subs.mjs`, `restore-flow.mjs`, `anon-login-btn.mjs`, `anon-new.mjs`, `mp-check.mjs` / `mp2.mjs` / `verify1.mjs` / `restore.mjs` (MP REST via client credentials)

> **The BRIEF's pairing for this widget is wrong.** `/widgets/AboutMe` is not an
> SPA or a config tool — it is the same server-rendered shell as the `.aspx`
> pages, carrying `<mpp-about-me>` — but `mpp-about-me` edits **contact
> attributes** (Occupation, Spiritual Gifts), not contact fields. It shares no
> field with `next-profile`. The legacy surface that edits a contact's own
> scalar fields is `mpp-household`'s "Edit Contact Info" / "Edit Household
> Member" dialogs. So this log compares `next-profile` against `mpp-about-me`
> for completeness, records that they are different capabilities (**C52**), and
> tests `next-profile` standalone against MP for data and flow correctness.

## What I tested

1. **Anonymous render, new.** Clean context, `demo-profile.html`, waited for the
   element to settle. Captured shadow text, all buttons, and the API sequence.
2. **Anonymous render, old.** Clean context, `/widgets/AboutMe`. Enumerated
   `mpp-about-me`'s shadow root including `#loginButton` visibility and the
   `mppw-alert` nodes.
3. **Signed-in render, new.** `assertAuthenticated` after the navigation, then
   `waitForWidget(… { apiPattern: /\/api\/embed\/profile/ })`. Enumerated every
   `input` / `select` / `textarea` / `button` with its label and current value.
4. **Signed-in render, old.** Same for `mpp-about-me`: 18 attribute checkboxes in
   two categories.
5. **Field-level data parity against MP.** Read `Contacts` row 98 with client
   credentials and compared every value the widget displayed.
6. **Validation — empty required.** Cleared `First_Name` and `Last_Name`, clicked
   **Save Profile**. Checked for inline messages, `aria-invalid`, and where focus
   landed.
7. **Validation — bad email.** `Email_Address = notanemail`, submitted.
8. **Validation — bad phone.** `Mobile_Phone = abc`, submitted, then
   `Mobile_Phone = ZZTEST-abc`, submitted, and read `Contacts.Mobile_Phone` back
   from MP.
9. **Native popup check.** Confirmed both forms carry `novalidate` and that the
   widget calls the shared `validateForm` / `bindLiveValidation` from
   `packages/embed-sdk/src/shared/form-validation.ts` (`profile.ts:3-4, 235, 363, 413, 421, 462, 546`).
10. **Real write + restore.** `Middle_Name = ZZTEST-MID` → **Save Profile** →
    verified in MP → restored to `null` via the MP API.
11. **Password form.** Rendered and enumerated only; **not submitted** (see
    Not tested).
12. **Responsive.** 390 x 844 screenshot.
13. **Keyboard / a11y.** Tab order of the first twelve focusables; label
    association per control.

## Results

| # | Check | Old (`mpp-about-me`) | New (`next-profile`) | Verdict |
|---|---|---|---|---|
| 1 | Anonymous render | `mppw-alert__warning` "Please login to view your skills and talents." + visible `<input value="Login">` | "Authentication required" + **Try Again** only, no sign-in affordance | **C53** |
| 2 | Element upgrades, no page errors | yes | yes — `apiFailures: []`, `consoleErrors: []` signed in | pass |
| 3 | Purpose / field set | 18 `Contact_Attributes` checkboxes, Edit / Submit / Cancel | prefix, first, middle, last, nickname, suffix, gender, DOB (3 selects), marital status, mobile, work phone, email, SMS opt-in, bulk-email opt-out, photo upload, password change | **different widgets — C52** |
| 4 | Data parity vs MP `Contacts` 98 | n/a | `First_Name` Christopher, `Nickname` Chris, `Last_Name` Kehayias, `Prefix_ID` 1, `Gender_ID` 1, `Marital_Status_ID` 2, DOB 11/25/1978, `Mobile_Phone` 321-794-1376, `Email_Address` chris.kehayias@acst.com, `Bulk_Email_Opt_Out` false — **all match MP exactly** | pass |
| 5 | Empty required submit | validates on Submit | inline "First name is required" / "Last name is required", `aria-invalid="true"` on both, focus moved to `First_Name`, **no native popup** | pass |
| 6 | Bad email | — | inline "Invalid email address", save blocked | pass |
| 7 | Bad phone `abc` / `ZZTEST-abc` | — | **zero validation messages, save succeeded (200), MP `Mobile_Phone` set to `NULL`** | **C51 (breaking)** |
| 8 | `novalidate` + shared validator | n/a | both forms `novalidate`; uses `shared/form-validation.ts` | pass |
| 9 | Real write lands | — | `Middle_Name = ZZTEST-MID` → `PUT /api/embed/profile` 200 → present in MP | pass |
| 10 | Restore | — | `Middle_Name` → `null`, `Mobile_Phone` → `321-794-1376`, both confirmed in MP | pass |
| 11 | Responsive 390 x 844 | usable | usable, single column | pass |
| 12 | Label association | checkboxes have no `<label for>` (bare `input`s, names only) | every text/select control has a matching `<label for>`; **the three DOB selects (`dob-month`/`dob-day`/`dob-year`) and both checkboxes have no `for=`/`aria-label`** — the group heading carries the meaning | minor, noted below |
| 13 | Tab order | n/a | follows visual order: photo button → file input → Prefix → First → Middle → Last → Nickname → Suffix → Gender → DOB month/day/year …; no `tabindex` overrides | pass |

## Findings filed

- `C51-profile-non-numeric-phone-silently-wipes-number.md` — non-numeric phone
  input is stripped to empty, passes validation, and `NULL`s the stored number.
- `C52-about-me-contact-attributes-no-counterpart.md` — `mpp-about-me`'s
  Occupation / Spiritual Gifts self-service has no `next-*` counterpart, and
  `next-profile` is not it.
- `C53-auth-required-states-have-no-sign-in-button.md` — signed-out
  `next-profile` (with `next-my-household` and `next-subscriptions`) offers
  "Try Again" instead of a Sign In button.

## Where the new widget is better

- It is a far larger capability than anything legacy offered a member for their
  own record: legacy scattered name/phone/email editing into the household
  widget's modals and had no photo upload and no password change at all.
  `next-profile` does all of it in one form.
- **Password change in place** (`oldPassword` / `newPassword` /
  `confirmPassword` with per-field reveal toggles). Legacy sends the member to
  MP's own OAuth profile page.
- **Photo upload** with a live preview button. No legacy equivalent.
- **SMS opt-in** with the consent copy ("Message and data rates may apply…")
  next to it. Legacy has no texting consent surface.
- Real validation with inline, per-field messages and `aria-invalid`, versus
  legacy's bare checkboxes.
- Labels are properly associated for the text and select fields;
  `mpp-about-me`'s checkboxes have no labels at all.

## Not tested / blocked

- **Password change was not submitted.** Changing the password of the shared
  Playwright account would lock out the five sibling agents on this run and
  invalidate `PLAYWRIGHT_MP_PASSWORD` in `.env.local`. The form renders, is
  enumerated, and carries `novalidate` + the shared validator; the submit path is
  untested. Unblocked by a second throwaway MP OAuth user.
- **Photo upload was not exercised.** `GET /api/embed/profile/photo?thumbnail=true`
  returns 200 and the avatar renders, but no file was uploaded — it would replace
  the real person's contact photo, and I could not verify the old file could be
  restored byte-for-byte.
- **`mpp-about-me` writes were not exercised.** Ticking a Spiritual Gift and
  submitting would create `Contact_Attributes` rows on a real contact whose
  restore semantics I could not confirm (`Attribute_Categories` is
  *"restricted by your organization's administrator"* for our API user, so I
  could not read back what the widget writes). `Contact_Attributes` for
  Contact 98 was `[]` before and after — nothing was created.
- **The DOB / checkbox label gap** is recorded in the results table rather than
  filed: legacy is worse in the same way, so it is not a regression, but the
  three DOB selects would each benefit from an `aria-label` ("Birth month" etc.)
  and the two checkboxes from wrapping `<label>`s.

## MP records changed and restored

| Record | Field | Original | Test value | Restored | Confirmed |
|---|---|---|---|---|---|
| `Contacts` 98 | `Middle_Name` | `null` | `ZZTEST-MID` | `null` | yes — MP API read-back |
| `Contacts` 98 | `Mobile_Phone` | `321-794-1376` | wiped to `null` by the C51 bug | `321-794-1376` | yes — MP API read-back |

No other household member's record was touched.

## Screenshots

- `screenshots/profile-new-anon.png` — new, signed out: "Authentication required / Try Again"
- `screenshots/about-me-old-anon.png` — old, signed out: warning + Login button
- `screenshots/profile-new-authed.png` — new baseline, signed in (full form)
- `screenshots/about-me-old-authed.png` — old baseline, signed in (18 attribute checkboxes)
- `screenshots/profile-new-authed-mobile.png`, `screenshots/profile-new-mobile.png` — 390 x 844
- `screenshots/profile-new-validation-required.png` — empty first/last name, inline errors
- `screenshots/profile-new-validation-email.png` — "Invalid email address"
- `screenshots/profile-new-validation-phone.png` — bad phone, **no** error raised
- `screenshots/profile-new-bad-phone-accepted.png` — C51: `ZZTEST-abc` saved as `NULL`
- `screenshots/profile-new-save-success.png` — `Middle_Name = ZZTEST-MID` saved
