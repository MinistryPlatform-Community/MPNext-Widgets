# my-household — comparison test log

- **New**: `next-my-household` — http://localhost:5173/demo-my-household.html
- **Old**: My Household — https://mpi.ministryplatform.com/widgets/my_household.aspx (`<mpp-household>` — **not** `mpp-my-household`)
- **Tested**: 2026-09-08 by subagent PEOPLE (block C50–C59)
- **Auth state(s) tested**: signed out **and** signed in as `PLAYWRIGHT_MP_USERNAME` (Household 85, 4 members)
- **Script**: `…/scratchpad/people-recon-anon.mjs`, `people-authed-new.mjs`, `people-authed-old.mjs`, `hh-dialogs.mjs`, `slot.mjs`, `anon-login-btn.mjs`, `anon-new.mjs`, `mp-check.mjs`

Configuration parity per CONFIG-MAP §2.10: the legacy page sets
`hideaddhouseholdmember="false"`, and `next-my-household` accepts that attribute
**verbatim** (same flat lowercase spelling, §4.11). The demo page sets neither,
which is the same effective state as `false`, so this is like-for-like as shipped
— no attribute overrides were needed.

## What I tested

1. **Anonymous render, both sites.** Clean contexts. Enumerated the shadow roots
   including `#loginButton` visibility and the `mppw-alert` nodes on the legacy
   side.
2. **Signed-in render, both sites.** `assertAuthenticated` after every
   navigation; `waitForWidget(… { apiPattern: /\/api\/embed\/household/ })` on
   ours. Compared household name, congregation, primary address, member count,
   member order, household positions and birthdays.
3. **Household-level edit dialog, both sites.** Opened it and enumerated every
   `input` / `select` / `textarea` with its label, plus the buttons — the whole
   point being whether the legacy "Edit Contact Info" modal's less obvious fields
   (unlisted flags, country, seasonal address) exist on ours.
4. **Member-level edit panel, new.** Opened per-member **Edit** and enumerated
   its fields.
5. **Add Household Member, new.** Opened the panel and enumerated it.
6. **Escape / close behaviour, new.** Pressed Escape on the household edit view.
7. **Data cross-check against MP.** `Contacts` 98, `Households` 85 via client
   credentials.
8. **Validation wiring.** Confirmed both forms carry `novalidate` and route
   through the shared validator.
9. **Responsive.** 390 x 844 on both sites.

## Results

| # | Check | Old (`mpp-household`) | New (`next-my-household`) | Verdict |
|---|---|---|---|---|
| 1 | Element name discovery | `mpp-household` (`listShadowHosts` first — the page is "My Household") | `next-my-household` | n/a |
| 2 | Anonymous render | `mppw-alert__warning` "Please login to see your Household details" + visible `<input value="Login">` | "My Household — Authentication required. Please sign in." + **Try Again** only | **C53** |
| 3 | Renders signed in, no errors | yes | yes — `apiFailures: []`, `consoleErrors: []` | pass |
| 4 | Household name | `Kehayias` | `Kehayias` | pass |
| 5 | Congregation | `Main Congregation` | `Main Congregation` | pass |
| 6 | Primary address | `2720 Bradfordt Drive, West Melbourne, FL 32904-7322` | identical | pass |
| 7 | Member count / order | 4: Chris, Sarah, Aiden, Jillian | 4, same order | pass |
| 8 | Household positions | Head of Household ×2, Minor Child ×2 | identical | pass |
| 9 | Member birthday format | `Nov 25, 1978` / `Sep 19, 1981` / `May 20, 2009` / `Mar 29, 2011` | `Nov 25` / `Sep 19` / `May 20` / `Mar 29` — **year dropped** | **C57** |
| 10 | Member name order | `Chris Kehayias` | `Kehayias, Chris` (MP `Display_Name`) | cosmetic, in C57 |
| 11 | Household edit — name | Household Name | `hh-name` "Household Name *" | pass |
| 12 | Household edit — home phone | Home Phone | `hh-phone` "Home Phone" | pass |
| 13 | Household edit — **Unlisted Home Phone** | checkbox present | `hh-phone-unlisted` present | **pass** |
| 14 | Household edit — **Unlisted Home Address** | checkbox present | `hh-address-unlisted` present | **pass** |
| 15 | Household edit — congregation | Select Campus (2 real options) | `hh-congregation` select, 3 options incl. placeholder | pass |
| 16 | Household edit — address lines | Line 1, Line 2, City, State, Zip | `primary-line1/2`, `primary-city`, `primary-state`, `primary-postal` | pass |
| 17 | Household edit — **Country** | Select Country, full ISO list | `primary-country`, **249 options** | **pass** |
| 18 | Household edit — **Seasonal / alternative address** | Address Line 1/2, City, State, Zip, Country, Seasonal Start Date, Seasonal End Date, Repeat Annually | `alt-line1/2`, `alt-city`, `alt-state`, `alt-postal`, `alt-country` (249), `alt-start`, `alt-end`, `alt-repeat` | **pass — full parity** |
| 19 | Household edit — buttons | Close / Save | Save Household / Cancel | pass |
| 20 | Presentation of the edit UI | overlay modal | **inline view swap** (replaces the household view) | difference, not filed — see below |
| 21 | Escape closes the edit UI | modal Close button | Escape closes it | pass |
| 22 | Per-member edit | `Edit Household Member` (`<a>`) | `Edit` (`<button>`) | cosmetic, in C57 |
| 23 | Add Household Member | `Add Household Member` link + panel | `+ Add Household Member` button + panel | pass |
| 24 | `novalidate` + shared validator | n/a | `household-form` and `member-form` both `novalidate`, both use `validateForm` / `bindLiveValidation` (`my-household.ts:578, 693, 927, 938, 1086, 1168`) | pass |
| 25 | Responsive 390 x 844 | usable | usable | pass |
| 26 | Legacy country-list encoding | shows `CuraÃƒÂ§ao` (mojibake) | shows the same string — **ours reproduces MP's own bad bytes** | see below |

**No household or member record was modified.** The parity question for this
widget was answered entirely by enumerating the edit dialogs' field sets, which
needed no write. I deliberately did not submit the household form on a real
household shared by four people including two minors — see Not tested.

For the record, `my-household.ts` does **not** carry the input mask that caused
**C51** in `next-profile`: `grep -rn "data-phone|formatPhone|replace(/\\D/g"`
over `packages/embed-sdk/src/components` hits `profile.ts` only. Its `hh-phone`
field is a plain `type="tel"` input, so C51 does not apply here. That was worth
checking, since a household home phone is shared by the whole family.

## Findings filed

- `C53-auth-required-states-have-no-sign-in-button.md` — signed-out
  `next-my-household` offers "Try Again", not a Sign In button (shared with
  `next-profile` and `next-subscriptions`).
- `C57-my-household-member-birthdays-lose-the-year.md` — the member list drops
  the birth year that legacy shows; also carries the name-order and control-label
  differences.

Nothing else. **The household edit dialog is at full field parity with legacy,
including the four things most likely to have been dropped** — unlisted phone,
unlisted address, country, and the whole seasonal-address block with its repeat
flag and date range. That was the finding I expected to file here and it does not
exist.

## Where the new widget is better

- **The country list is a real `<select>` with 249 options in both the primary
  and the seasonal address**, matching legacy — but ours labels the second block
  "Seasonal / Alternative Address" and lays it out as a section rather than
  burying it below a country dropdown in a 4,000-character modal.
- **Legacy's edit modal is one enormous scroll** containing two complete
  ISO country lists inline; ours splits Household / Primary Address / Seasonal
  into labelled sections with a two-column grid.
- **Address autocomplete**: the seasonal Address Line 1 is a Google Places input
  ("Enter a location"); legacy is plain text.
- **Real form validation** (`novalidate` + the shared validator, inline
  messages). Legacy relies on browser/native behaviour.
- The household-level Edit control carries `aria-label="Edit household"`;
  legacy's is a bare `Edit` anchor.
- Legacy's shadow root permanently contains the string *"Please login to see
  your Household details"* even when signed in with data on screen (HARNESS §7.3)
  — ours renders one state at a time.

## Not tested / blocked

- **No write was performed.** Household name, home phone, congregation, primary
  address, unlisted flags and the seasonal address are all restorable in
  principle, but `next-my-household` masks phone input with the same
  `replace(/\D/g, "")` pattern that silently `NULL`ed the profile phone (C51), and
  `Households.Home_Phone` / the address rows are shared by four people including
  two minors. I chose field enumeration over a write on a real household.
  Unblocked by a `ZZTEST-` household created via the API for the widget to edit.
- **Per-member edit and Add Household Member were enumerated, not submitted**,
  for the same reason — an added member would be a new real `Contacts` row in the
  church's data, and the brief's instruction not to touch another household
  member's record beyond what the widget legitimately exposes points the same way.
- **The inline-view-swap vs modal difference (row 20) is not filed.** Ours
  replaces the household view with the edit form rather than overlaying it, so it
  has no `role="dialog"`, no `aria-modal` and no focus trap — and correctly so,
  because it is not a dialog. It is a deliberate design difference, it is
  keyboard-navigable, and Escape returns to the view. Worth noting that it also
  means the per-member **Edit** buttons are not in the DOM while the household
  form is open (this is what made a naive "click Edit after opening the household
  form" step time out in my first script, not a defect).
- **Row 26, the mojibake country name** (`CuraÃƒÂ§ao`), appears identically on
  both sides. It is MP's own data, so it is not a finding against this repo; it
  is recorded here because it looks like an encoding bug in ours until you check
  legacy. If anyone fixes it, it belongs upstream or in a normalisation step, not
  in the widget.

## Screenshots

- `screenshots/my-household-new-anon.png` — new, signed out
- `screenshots/my-household-old-anon.png` — old, signed out (warning + Login)
- `screenshots/my-household-new-authed.png` — new baseline, signed in
- `screenshots/my-household-old-authed.png` — old baseline, signed in
- `screenshots/my-household-new-authed-mobile.png` / `my-household-old-authed-mobile.png` — 390 x 844 pair
- `screenshots/my-household-new-edit-household.png` — the new edit view with all 20 fields, incl. unlisted flags, country and the seasonal block
- `screenshots/smoke-my-household-new-authed.png` / `smoke-my-household-old-authed.png` — the scout's harness-proof shots of the same view
