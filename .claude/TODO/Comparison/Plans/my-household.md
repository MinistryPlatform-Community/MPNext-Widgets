# `next-my-household` — plan

**Items:** C53 (ux, shared) · C57 (cosmetic) · C79 (cosmetic, shared)
**Cutover verdict: C53 blocks cutover; the rest is Phase 2. The data is exact.**
**Owns:** `packages/embed-sdk/src/components/my-household.ts`,
`src/services/householdService.ts`, `src/app/api/embed/household/route.ts`

## What the feedback says

Both widgets agreed on everything of substance in this view: household name `Kehayias`,
congregation `Main Congregation`, primary address
`2720 Bradfordt Drive, West Melbourne, FL 32904-7322`, four members, same positions, same
order. Three presentation-layer items.

- **C53** — signed out, the widget renders *"My Household / Authentication required. Please
  sign in. / [Try Again]"* with no sign-in control. `[data-action="retry"]` re-issues the same
  401 forever.
- **C57** — member birthdays print month and day only (`Nov 25`) where legacy prints the full
  date (`Nov 25, 1978`). The data is present — MP holds
  `Date_of_Birth = "1978-11-25T00:00:00"` and the member Edit panel exposes the full date — it
  is the **summary row** that truncates it.
- **C79** — `hideaddhouseholdmember` is flat lowercase.

## Where the new widget is already better — protect these

- **Household data parity is exact**, including the address and every member's position.
- **Ours renders `Display_Name` (`Kehayias, Chris`) where legacy reassembles first + last
  (`Chris Kehayias`).** `Display_Name` is what MP considers canonical. Recorded in C57 as a
  difference, and **my recommendation is to keep ours** — but note it in the migration guide,
  because a church will see every name in their household flip on cutover and that is worth
  a sentence rather than a support ticket.
- `next-my-household` already uses `shared/google-places` — one of only two widgets that do.
- Its phone inputs are plain and unaffected by C51's destructive mask (which lives only in
  `profile.ts`).

## Phase 1 — C53, signed-out

Per `CROSS-1-signed-out-and-auth-states.md`. `GET /api/embed/household` correctly returns 401
for a public token; the widget's catch renders it through the generic error state. Branch on
the status into the shared sign-in panel.

Legacy's wording is *"Please login to see your Household details"*. Of the three widgets in
C53 this one at least *names* itself in the panel ("My Household"), which is why it reads less
like an outage than `next-subscriptions`'s bare "Unable to Load" — but it still offers only a
button that cannot work.

**Do not close C53 by fixing this widget alone** — it is one of ten in C81's class.

## Phase 2 — C57, the birthday year

Render the full date in the member summary row.

**Check where the truncation happens before editing the component.** The Edit panel has the
full date, so it is probably present in the payload and only the summary formats it short —
but if the API already truncates, the fix is server-side in `householdService.ts` /
`src/app/api/embed/household/route.ts` instead.

**Format through `Intl.DateTimeFormat` with the MP domain time zone** from `getMpTimezone()`,
per `CLAUDE.md`'s date/time rule — **not** a hand-rolled month table. And be careful not to
reintroduce the classic off-by-one: MP stores wall-clock in the domain zone, so
`new Date("1978-11-25T00:00:00")` parsed as local and formatted in another zone renders
`Nov 24`. See `.claude/references/ministryplatform.datetimehandling.md`.

### Do not "fix" the online directory from this item

C57 is explicit about this and it is worth repeating: `next-online-directory` also drops the
year (`OnlineDirectoryService.formatBirthday()` returns `"Mon D"` and `"MM-DD"` only) and
**there it is deliberate and correct** — legacy sends `dateofBirth` in full to every browser
that can see the directory, and withholding it is a **privacy improvement**, one of the run's
explicit "new is better" findings. This widget is different because every record shown belongs
to the signed-in user's own household.

**Why the year matters here.** A parent looking at their household to check which child's
record has the wrong birth date cannot tell from the list — every row shows a month and day
that is already right — and has to open each member's Edit panel in turn. Two children born
the same month and day are indistinguishable. Legacy answered the question from the list.

### The `Edit` / `Edit Household Member` label

Legacy's per-member control reads `Edit Household Member` (an `<a>`); ours reads `Edit` (a
`<button>`). At the household level ours is icon-only with `aria-label="Edit household"` where
legacy has a text `Edit` link. **Keep ours** — `Edit` inside a row that already names the
member is less redundant — and note it in the migration guide. Folds into `CROSS-5`'s copy
decision.

## Phase 3 — C79

Rename `hideaddhouseholdmember` → `hide-add-household-member`, accepting the old spelling as a
warning alias for one release. See `CROSS-4`.

## The shared Google Maps question

`my-household.ts:989` attaches the Places autocomplete. On `localhost:5173` the MP-supplied key
logs `ApiTargetBlockedMapError` inside `next-custom-form`, and autocomplete silently does
nothing while manual entry keeps working. **If MP's key is HTTP-referrer-restricted to the
church's own MP domain, the same degradation hits every embedded customer origin** — including
this widget, today, unnoticed. That question gates C23 in `plan-your-visit.md` and affects
`custom-form.md`; **this widget is the place it can be observed in production**, since it
already ships the integration. Worth checking here first.

## Do better than parity

- **The household is the one place a member can fix the church's data about their family**, and
  neither system treats it that way. Both render a list plus per-member Edit dialogs. Showing
  *what is missing* — no birthday on file, no mobile number, no address — turns a static list
  into a prompt the church actually benefits from.
- **The `|| null` audit from C51 applies here.** `next-profile` silently converts an emptied
  field into a delete; this widget also PUTs partial records. Check it against the rule
  proposed in `profile.md`: *an empty submitted field is not a delete instruction when the
  stored value was non-empty.* Household member writes were **not exercised** in the comparison
  run for lack of fixtures, so this is unverified territory.
- **`Display_Name` vs first-last is a decision, not a bug** — but it should be applied
  consistently. `next-group-details` had to un-mangle `Display_Name` for its greeting (C17) and
  the fix there was to prefer the first name. Pick one household-name convention across the SDK.

## Acceptance

- Anonymous load renders a sign-in prompt, not "Try Again".
- Member rows show the full birth date, formatted in the MP domain time zone, with no
  off-by-one at any zone offset.
- `next-online-directory`'s year-less birthday is **unchanged** (explicit non-regression).
- `hide-add-household-member` works; the legacy spelling warns once.
- Household data parity is unchanged (regression guard).

## Depends on / unblocks

C53 → `CROSS-1`. C79 → `CROSS-4`. C57 wants the `getMpTimezone()` path already documented in
`CLAUDE.md`. The Google Maps key question is shared with `plan-your-visit.md` and
`custom-form.md` and is best answered here.
