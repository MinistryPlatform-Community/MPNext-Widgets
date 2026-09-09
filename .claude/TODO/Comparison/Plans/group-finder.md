# `next-group-finder` — plan

**Items:** C10 (functional, shared) · C15 (ux) · C64 (functional) · C18 (cosmetic)
**Cutover verdict: C10 blocks cutover; the rest is Phase 2.**
**Owns:** `packages/embed-sdk/src/components/group-finder.ts`

## What the feedback says

The finder's data layer is **exact**, and that is the headline: all eleven filter combinations
tested returned identical group ids in identical order on both systems *and* matched
`api_MPPW_SearchGroups` directly. **No legacy filter is missing.** No unpublished, full or
ended group leaked on either side. What is wrong is the shell around that data.

- **C10** — the result card is `div role="link" tabindex="0"` with a click-only listener and
  **no anchor at all**. Enter does nothing, Space does nothing, `anchorsInCard: 0`,
  `ctaTag: "SPAN"`. Legacy's card carried a real `<a href="./group_details.aspx/?id=49">`. So
  the finder's only job — get a visitor from the list into a group's detail page — has no
  keyboard path, and everyone loses open-in-new-tab, copy-link and hover preview.
- **C15** — an anonymous visitor can fill in the entire Suggest-a-Group form (name,
  description, congregation, focus, life stage, day, time), press Submit, and hit a 401 dead
  end. Legacy gates *before* the form: click "Suggest A Group" signed out and it shows
  *"Please login to be able to suggest a new group"* with the fields still hidden.
- **C64** — `city-postal-code` is the **one** of legacy's fifteen options that did not make
  it. The field is rendered, read on submit and sent; only the markup path into
  `this.cityPostalCode` is missing.
- **C18** — thirteen rows of copy and format drift.

## Where the new widget is already better — protect these

- **Filter parity is exact, verified against the proc.** Whatever is done to the shell, do not
  disturb the query.
- **Ours writes Suggest-a-Group `Start_Date` in domain wall-clock; legacy writes it in UTC.**
  Ours is correct. This is one of the run's explicit "new is better" findings.
- Mobile reflow is clean on both, no horizontal overflow.
- The ">20 results" info hint exists on both.

## Phase 1 — C10, the card

Per `CROSS-3` §1. Specifically here: `buildDetailUrl(g.id)` already produces the href, so wrap
the card body in `<a href="${url}" class="nw-gf-card-link">` (or make the `See Details →` CTA
the anchor and keep the card `onclick` as a mouse convenience), and drop `role="link"` /
`tabindex="0"` from the wrapper so the anchor is the single focus stop. Keep the click handler
for the `groupSelected` event and let the browser navigate.

`role="link"` is what makes this worse than plain markup: a screen reader announces "link",
Enter does nothing, and the page reads as broken rather than inaccessible. Four card stops in
the tab order that do nothing is a focus trap in the everyday sense.

`next-event-finder` (C05) and `next-opportunity-finder` (C22) have the identical pattern — one
shared `cardLink()` primitive, three widgets.

## Phase 2 — gate before the form, restore the attribute

### C15 — order the gate correctly

"Suggest a group" is a low-intent, high-friction action to begin with: someone is volunteering
unpaid effort. Making them type a name, a description and a campus and *then* telling them it
will not be accepted is the worst possible ordering — the work is lost, the reason arrives
after the fact, and no next step is offered. Legacy costs the visitor one click to learn the
rule.

Fix: in `renderSuggestForm()`, if there is no authenticated session, render the sign-in panel
(`next-group-details`'s `gd-login-panel` at `group-details.ts:640-646` is the in-repo shape)
and skip the fields entirely. `next-group-finder` does not currently track auth state at all,
unlike `next-group-details` which has `isAuthenticated` fed by
`/api/embed/group-details/me` — either add a cheap identity read on that pattern, or defer the
check to the moment "Suggest a Group" is clicked. Either is fine; **what matters is that the
decision happens before the visitor types.**

Keep the 401 handler as a backstop for the token-expired-mid-form case, and keep it
non-destructive — it already preserves the entered values.

**The `legacy`-mode half of C15 belongs to `CROSS-1`.** In `legacy` auth mode
`AuthSession.login()` is not the live path, so `requestLogin()` produces nothing visible and
the bare *"Please sign in to suggest a group"* is unactionable. The mode-aware sign-in helper
solves this for every widget at once; do not solve it here.

**Note the demo-page scaffolding.** `demo-group-finder.html` carries a `<next-user-menu>`
above the widget with a hint, so on the demo a determined tester can scroll up and sign in. A
customer who embeds only the finder has nothing. Do not let the demo mask the fix.

### C64 — one attribute

Add `"city-postal-code"` to `observedAttributes` (~`:93`) and seed `this.cityPostalCode` the
way `congregation-id` and `keyword` are seeded. The plumbing below it (`:183`, `:325-326`,
`:479-480`) already works, so this is a one-attribute change with no service or route work.

Geographic pre-scoping is the normal way a church embeds a finder on a neighbourhood or campus
landing page — "groups near you" without asking the visitor to type a postcode. A church
migrating finds fourteen of fifteen filters carried across and this one **silently** ignored,
which is the failure mode `CROSS-4` is about.

**Decide pre-fill vs lock.** Legacy *locks* an attribute-supplied field; the rest of the new
finder pre-fills and leaves editable. Pre-fill is the consistent choice here — and arguably
the better one, since a visitor who has moved can still search elsewhere.

## Phase 3 — C18, and the decision behind it

Thirteen rows of drift. Two are worth fixing **regardless** of the wider copy decision because
they actively look broken to a visitor:

- **Row 13, the empty state.** Legacy: *"0 Groups found. Please try again with different
  search criteria."* in a styled alert with an icon. Ours: *"No groups found."* as plain,
  unstyled text. Legacy tells the visitor what to do next and makes sure they see it. Adopt
  the meaning in our voice and give it the widget's alert styling.
- **Row 12, the no-photo placeholder.** Legacy shows a neutral group icon; ours paints
  `NoImageText` from the proc as body text inside a grey box — e.g. the literal words
  "Small Group" — which reads as a rendering failure. `my-groups.ts` already has a
  `groupSvg()` helper for exactly this case. Use it, and keep `NoImageText` as the
  `alt`/`aria-label`.

The other eleven rows (`Campus`/`Congregation`, `Any Campus`/`All Congregations`,
`Search Groups`/`Search`, `Show Advanced`/`Advanced Search`, `Su Mo Tu`/`Sunday Monday`,
`Mondays @ 6:30 PM` / `Monday · 6:30 PM`, `Capacity: 2 of 20` / `2 of 20`,
`Already Meeting` / `Already meeting`, the missing `Group Finder` heading, the `Key Word`
label) fold into `CROSS-5`.

**The item's real point is the meta-question:** *decide once whether the SDK is deliberately
re-voicing MP's copy or is meant to match it, and write that decision down — right now it is
neither, which is how a thirteen-row table happens.* That decision lives in `CROSS-5`.

Two rows are worth arguing on merit when that decision is made:

- **`Mondays` vs `Monday`.** Legacy's plural reads correctly for a recurring group; ours reads
  like a one-off. Legacy is right here.
- **`Campus` vs `Congregation`.** This MP instance's own congregation names literally read
  "Main Congregation" and "Friends & Internet Campus", so neither label is right for all data.
  Once labels are configurable this becomes the church's call, which is the correct answer.

## Do better than parity

- **Neither side shows `MeetingFrequency` on the card** even though the proc returns it
  (`Every Other Week` for the group tested) — both show it only on the detail view. A visitor
  scanning cards cannot tell a weekly group from a monthly one. That is a real gap in *both*
  systems and a cheap card improvement.
- **Suggest-a-Group could be better than a gate.** Rather than hiding the form behind sign-in,
  consider letting the visitor draft it and prompting to sign in at submit *while preserving
  the draft* — the 401 handler already preserves values. That is a better experience than
  either system, provided the requirement is stated up front. Only worth it once `CROSS-1`'s
  mode-aware sign-in actually works.

## Acceptance

- Enter and Ctrl-click open a group from the result list; every card exposes an `href`.
- Clicking "Suggest a Group" signed out shows a prompt, not a form.
- `city-postal-code="90210"` pre-scopes the finder.
- The empty state is styled and tells the visitor what to do.
- A group with no photo shows an icon, not the word "Small Group".
- All eleven filter combinations still return identical ids (regression guard).

## Depends on / unblocks

C10 follows `CROSS-3`. C15's `legacy`-mode half follows `CROSS-1`. C18's remaining rows follow
`CROSS-5`. C64 is independent and takes minutes.
