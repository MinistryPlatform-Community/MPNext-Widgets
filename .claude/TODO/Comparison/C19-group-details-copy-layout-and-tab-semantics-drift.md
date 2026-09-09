# C19. `next-group-details` copy, field-order and tab markup drift from `mpp-group-details`, and its tabs carry no ARIA tab semantics

**Widget:** `next-group-details` (old: `mpp-group-details`, `/widgets/group_details.aspx`)
**Severity:** cosmetic
**Confidence:** confirmed — both widgets rendered on the same group (49) anonymously and signed in, with the legacy page's exact attribute set mirrored onto ours
**Found:** 2026-09-08, comparison run (groups agent)

One item for the detail view's presentation layer; the substantive gaps are filed
separately as C11 (no emails), C12 (empty inquiry columns), C14 (no blank-form sign-up),
C16 (phone no longer required) and C17 (surname-first greeting).

## Old behaviour vs new behaviour

Configuration used on both sides, matching `/widgets/group_details.aspx`:
`returnurl="../Groups"`, `inquiryemailtemplate="665"`, `signupemailtemplate="664"`,
`inquirefullgroups="false"`, `leadersignupemailtemplate="664"` → the kebab-case
equivalents set on `<next-group-details>` via DOM.

| # | Surface | Old | New |
|---|---|---|---|
| 1 | Return link | `Back To Group Search Results` | `← Back to groups` |
| 2 | Group Focus | rendered bare, directly under the title (`Bible & Book Study`) | rendered as a labelled block (`Group Focus` / `Bible & Book Study`) further down |
| 3 | Meeting line | `Every Other Week on Mondays @ 6:30 PM` | `Every Other Week · Monday · 6:30 PM` |
| 4 | Start line | `Starts` / `Already Meeting` | `Starts` / `Already meeting` |
| 5 | Tab labels | `Contact This Group` / `Sign Up For This Group` | `Contact this Group` / `Sign Up for this Group` |
| 6 | Picker label | `Inquire As*:` / `Sign up as*:` | `Contact as *` / `Sign up as *` |
| 7 | Picker "anyone else" option | `Blank Form`, listed **first** | `Someone else…`, listed **last** |
| 8 | Field labels | `First Name*:` `Last Name*:` `Email Address*:` `Phone Number*:` `Message (optional):` | `First Name *` `Last Name *` `Email *` `Mobile Phone` `Message` |
| 9 | Required-field error | `First Name is required` (per field) | `This field is required.` (same text on every field) |
| 10 | Form-level error position | inside the form, next to the submit | at the **top of the shadow root**, above the group title and image |
| 11 | Submit button | `Contact This Group` / (sign-up) | `Send Message` / `Sign Up` |
| 12 | Leader list | name + avatar, not linked | name + avatar, wrapped in `mailto:` — **new is better** |
| 13 | Tab markup | radio inputs (`name="formSelector"`) + labels | `<button class="gd-tab">` with **no `role="tab"`, no `role="tablist"`, no `aria-selected`, no `aria-controls`** |

Row 13 is the only one with an accessibility consequence. The buttons are keyboard
reachable and operable (unlike the finder's cards — C10), so this is not a blocker; but a
screen-reader user gets "button, Contact this Group" with no indication that it is one of
two tabs, which is selected, or that pressing it swaps the panel below. Legacy's radio
group conveys all three for free. Arrow-key navigation between tabs is absent on both
sides.

Row 7 is worth a deliberate choice: legacy putting `Blank Form` first means the *default*
selection for a signed-in user is the anonymous path, which is arguably wrong; ours
defaults to the signed-in contact, which is better. The naming (`Blank Form` →
`Someone else…`) is also clearer in ours. Recorded as drift, not as a regression.

Rows 2–4 amount to the same data in a different arrangement: both views show title, group
focus, meeting frequency/day/time, capacity, start, location and leaders, sourced from the
same `api_MPPW_SearchGroups` result set. Field values matched exactly on group 49
(`Capacity 2 of 20`, `Main Congregation`, `Every Other Week`, `Monday 18:30`, leaders
`Kehayias, Chris` + `Hoy, Candice`).

## Why it matters

The detail page is where a visitor decides to commit, so its copy carries more weight per
word than the finder's. Row 10 is the one that can cost a submission: press Send Message
with a field missing and the explanatory message appears above the group image, which on a
phone is off-screen — the visitor sees the button do nothing. Row 9 is worse than legacy
when several fields fail at once, because the messages are indistinguishable from one
another. Row 13 is a small, cheap accessibility gap that is much easier to fix now than
after other widgets copy the same tab pattern.

## Evidence

- Baseline pairs (anonymous and signed in, desktop and 390×844):
  - `.claude/playwright/widget/screenshots/group-details-old-anon.png`,
    `group-details-new-anon.png`
  - `group-details-old-authed.png`, `group-details-new-authed.png`
  - `group-details-old-anon-mobile.png`, `group-details-new-anon-mobile.png`,
    `group-details-old-authed-mobile.png`, `group-details-new-authed-mobile.png`
- Validation pair (row 9, row 10):
  `group-details-old-inquiry-validation.png`, `group-details-new-inquiry-validation.png`
- Sign-up tab pair (rows 6–8, 13):
  `group-details-old-signup-authed.png`, `group-details-new-signup-authed.png`
- Measured label arrays:
  - old: `["Contact This Group","Sign Up For This Group","Inquire As*:","First Name*:","Last Name*:","Email Address*:","Phone Number*:","Message (optional):","Sign up as*:", …]`
  - new: `["Contact as *","First Name *","Last Name *","Email *","Mobile Phone","Message"]`
- Measured new tab markup:
  `["BUTTON.gd-tab gd-tab--active[role=null]:Contact this Group","BUTTON.gd-tab [role=null]:Sign Up for this Group"]`
- MP cross-check of the rendered values:
  `.claude/playwright/widget/scripts/groups-mp-verify2.mts` (proc row for group 49 plus its
  two leader contacts)
- Scripts: `.claude/playwright/widget/scripts/groups-gd-compare.mjs` (anon and `AUTHED=1`), `.claude/playwright/widget/scripts/groups-gd-validate.mjs`

## Where to fix

`packages/embed-sdk/src/components/group-details.ts` — `renderTabs()` (`~:590-615`),
`renderInquireForm()` (`:617-637`), `renderSignupForm()` (`:637-668`),
`renderBlankFields()`, `renderAsPicker()`, `setMessage()` and wherever the message element
is placed in `render()`.

## Suggested fix

Three concrete changes, in value order:

1. **Move the form-level message into the form.** Render it inside `.gd-form-wrap`,
   immediately above the submit row, instead of at the top of the shadow root — or scroll
   it into view when it is set. This is the only row here that can lose a submission.
2. **Give the tabs real tab semantics.** Wrap the two buttons in
   `<div role="tablist">`, give each `role="tab"`, `aria-selected`, `id` and
   `aria-controls`, and mark the panel `role="tabpanel"` with `aria-labelledby`. Left/right
   arrow handling is a nice extra. Cheap, and it sets the pattern before other widgets copy
   this markup.
3. **Field-specific required messages.** Pass the label text into the shared validator's
   required message (`${label} is required.`), matching legacy — this also fixes the same
   generic string on the finder's Suggest-a-Group form.

The rest (rows 1–6, 11) is wording; fold it into whatever decision comes out of C18 about
whether the SDK re-voices MP's copy or matches it. Keep row 12 (mailto leaders) and the
picker ordering in row 7 — both are improvements.
