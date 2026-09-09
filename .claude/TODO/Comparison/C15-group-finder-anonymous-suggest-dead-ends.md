# C15. `next-group-finder` lets an anonymous visitor fill in the whole Suggest-a-Group form, then dead-ends on a 401 with no way to sign in

**Widget:** `next-group-finder` (old: Group Finder, `/widgets/group_finder.aspx`)
**Severity:** ux
**Confidence:** confirmed — walked end to end anonymously in a clean browser context on both sites
**Found:** 2026-09-08, comparison run (groups agent)

## Old behaviour

Both pages ship `showsuggestagroupbutton="true"`, so both show the button. Clicking
"Suggest A Group" while signed out on `/widgets/group_finder.aspx` gates *before* the
form: `#loginButtonContainer` becomes visible reading **"Please login to be able to
suggest a new group"** with the standard Login button, and
`#suggestGroupDetailsContainer` — the block that holds Group Name, Description, Campus,
Group Focus, Life Stage, Meeting Day, Meeting Time — stays `display: none`.

Measured anonymously:

```json
{"loginButtonContainer":{"display":"block","text":"Please login to be able to suggest a new group"},
 "suggestGroupDetailsContainer":{"display":"none"}}
```

Signed in, the same click flips it: `{"login":false,"details":true}`, and the submit
succeeds (`200 POST /widgets/Api/GroupsApi/SuggestGroup`).

So the legacy visitor is told the requirement before typing anything, and is handed the
control that satisfies it.

## New behaviour

Clicking "Suggest a Group" anonymously renders the complete form — Group Name*,
Description*, Congregation*, Group Focus, Life Stage, Meeting Day, Meeting Time, Submit
Suggestion — with no mention of sign-in. The visitor fills it in, presses Submit, and:

- `POST /api/embed/group-finder/suggest` → **401**
- `AuthSession` mints a fresh token and the widget retries → **401** again
- the form paints `Please sign in to suggest a group.` and **stops there**

The URL is unchanged, no login UI appears, and the typed values sit in a form that can
never be submitted. `submitSuggestion()` does call `this.requestLogin("group-finder")`
after the 401 (`group-finder.ts:377-382`), but in `legacy` auth mode — the resolved mode
for `localhost:5173` and the mode every current customer is on — `AuthSession.login()` is
not the live sign-in path (the host page signs in through `<mpp-user-login>` /
`next-user-menu`), so nothing visible happens. The widget is honest about the requirement
and powerless to meet it.

The demo page does carry a `<next-user-menu>` above the widget with the hint *"required
only to suggest a new group"*, so on the demo a determined tester can scroll up and sign
in. That is demo-page scaffolding, not part of `<next-group-finder>`; a customer who
embeds only the finder has nothing.

## Why it matters

"Suggest a group" is a low-intent, high-friction action to begin with — someone is
volunteering unpaid effort. Making them type a name, a description and pick a campus, and
*then* telling them it will not be accepted, is the worst possible ordering: the work is
lost, the reason is unexplained until after the fact, and there is no next step offered.
Legacy's ordering costs the visitor one click to learn the rule. Ours costs them the whole
form and gives them nowhere to go, which for a public church page reads as a broken
feature rather than a permission gate.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/group-finder-old-suggest-anon.png`
    (login prompt, fields hidden)
  - `.claude/playwright/widget/screenshots/group-finder-new-suggest-anon.png`
    (full form, no prompt)
  - `.claude/playwright/widget/screenshots/group-finder-new-suggest-anon-submit.png`
    (post-401 state: "Please sign in to suggest a group.", form still populated)
  - `.claude/playwright/widget/screenshots/group-finder-old-suggest-authed.png`,
    `group-finder-new-suggest-submitted.png` (both succeed signed in)
- New network trace, anonymous submit:
  `401 POST /api/embed/group-finder/suggest`, `200 POST /api/embed/session`,
  `401 POST /api/embed/group-finder/suggest`; `URL now: http://localhost:5173/demo-group-finder.html`
- Signed-in write parity confirmed in MP and then cleaned up: `Groups` 57 (new) and 58
  (old), identical `Ministry_ID` 8, `Group_Type_ID` 1, `Primary_Contact` 98,
  `Congregation_ID` 1, `Meeting_Day_ID` 3, `Meeting_Time` 19:00:00,
  `Available_Online` false (`.claude/playwright/widget/scripts/groups-mp-verify6.mts`,
  `groups-mp-cleanup2.mts`)
- Scripts: `.claude/playwright/widget/scripts/groups-gf-suggest.mjs`, `.claude/playwright/widget/scripts/groups-gf-suggest-anon.mjs`

## Where to fix

`packages/embed-sdk/src/components/group-finder.ts` — `renderSuggestForm()` (`:632-706`),
the `open-suggest` handler in `attachListeners()` (`:277-283`), and the 401 branch of
`submitSuggestion()` (`:377-382`).

## Suggested fix

Gate up front, the way `next-group-details`'s sign-up tab already does
(`group-details.ts:640-646` renders a `gd-login-panel` with a Sign In button instead of
the form). In `renderSuggestForm()`, if the widget has no authenticated session, render
that panel — "Please sign in to suggest a new group" plus the shared sign-in affordance —
and skip the fields entirely.

`next-group-finder` does not currently track auth state at all (unlike
`next-group-details`, which has `isAuthenticated` fed by `/api/embed/group-details/me`), so
this needs a cheap identity read on the same pattern, or simply deferring the check to the
moment "Suggest a Group" is clicked. Either is fine; what matters is that the decision
happens before the visitor types.

Keep the 401 handler as a backstop for the token-expired-mid-form case, but make it
non-destructive: preserve the entered values (it does) and, in `legacy` mode where
`AuthSession.login()` cannot navigate, say so in words the visitor can act on ("Please
sign in using the sign-in link on this page, then submit again") rather than a bare
"Please sign in to suggest a group." This is the same `legacy`-mode gap that
`requestLogin()` has everywhere, so it may be worth solving once in
`shared/base-widget.ts` instead of per widget.
