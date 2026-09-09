# group-finder — comparison test log

- **New**: `next-group-finder` — http://localhost:5173/demo-group-finder.html
- **Old**: Group Finder — https://mpi.ministryplatform.com/widgets/group_finder.aspx
- **Tested**: 2026-09-08 by subagent **groups** (block C10–C19)
- **Auth state(s) tested**: signed out **and** signed in as `PLAYWRIGHT_MP_USERNAME`
  (MP User 98 / Contact 98, "Kehayias, Chris" — resolved via
  `.claude/playwright/widget/scripts/groups-mp-verify4.mts`)
- **Scripts**:
  - `.claude/playwright/widget/scripts/groups-gf-public.mjs` — baseline render, control enumeration, card markup, mobile
  - `.claude/playwright/widget/scripts/groups-gf-filters.mjs` — 11 filter combinations, both sides, result-set diff
  - `.claude/playwright/widget/scripts/groups-gf-a11y.mjs` — keyboard activation, focus ring, tab order, anon suggest, validation
  - `.claude/playwright/widget/scripts/groups-gf-suggest.mjs` — suggest-a-group write, both sides, signed in
  - `.claude/playwright/widget/scripts/groups-gf-suggest-anon.mjs` — anonymous suggest submit, card anchor check
  - `.claude/playwright/widget/scripts/groups-mp-verify.mts` / `…2.mts` / `…6.mts` — MP verification
  - `.claude/playwright/widget/scripts/groups-mp-cleanup2.mts` — fixture teardown

**Configuration used.** The legacy page ships
`<mpp-group-finder targeturl="./group_details.aspx/" showsuggestagroupbutton="true">`, and
`demo-group-finder.html` already ships the kebab-case equivalent
(`target-url="/demo-group-details.html" show-suggest-a-group-button="true"`), so the pair
is like-for-like as served. No attributes needed to be injected. Confirmed against
CONFIG-MAP.md section 2.3.

## What I tested

1. **Anonymous baseline render, both sides.** `waitForWidget` on `mpp-group-finder` /
   `next-group-finder` (new also gated on `GET /api/embed/group-finder`), then full-page
   screenshots and a dump of the settled shadow text.
2. **Complete control enumeration, both sides.** Walked every `input`/`select`/`textarea`/
   `button`/`a` in each shadow root, recording id, name, type, computed visibility, and the
   first six options of every `select`. Cross-checked against the `observedAttributes` /
   `configurationItems` union in CONFIG-MAP.md section 4.2 and against
   `GroupFinder.js`'s own template ids.
3. **Advanced-search toggle.** Clicked `#advancedSearchLink` / `[data-action="toggle-advanced"]`
   and re-read visibility, confirming the same eight controls live behind it on both sides.
4. **Eleven filter combinations, both sides, comparing result sets not renderings.**
   keyword=`bible`, keyword=`golf`, congregation=`Main Congregation`, meeting day=Monday,
   meeting time=Evening, meets-online=on, group focus=`Bible & Book Study`,
   life stage=`Single`, city=`Melbourne`, city=`32904`, keyword=`zzzznomatch`. Each case
   set the fields, clicked the submit control, waited for the results to settle, and read
   back **group ids in DOM order** (from `a.buildDetailsButton@id` on the old side and
   `[data-group-id]` on the new).
5. **MP cross-check of the unfiltered result set.** Called `api_MPPW_SearchGroups` directly
   with the client credentials (`@ShowFullGroups: false`, `@ShowFutureGroups: false`) and
   compared row count, ids and order against both widgets. Also enumerated all 25
   `Groups` rows with `Available_Online = 1` to check what the proc excludes.
6. **Group visibility / publication flags.** Verified that both widgets go through the same
   proc with the same parameters, that neither passes `@ShowFullGroups`/`@ShowFutureGroups`
   by default, and that the `Hidden` column the proc returns is ignored identically by both.
7. **Result-card markup and keyboard operability.** Compared card HTML; focused the first
   card / the first `See Details` anchor and pressed Enter, then Space, checking whether the
   URL changed; read the computed focus outline; walked eight Tab stops from the keyword box.
8. **Suggest-a-Group, signed out.** Clicked the button on both sides and recorded which
   containers are visible; then filled the new form completely and submitted it to see where
   an anonymous visitor ends up.
9. **Suggest-a-Group validation.** Empty submit on the new form; recorded the summary
   message, per-field `.mpx-field-error` text and `aria-invalid` state.
10. **Suggest-a-Group write, signed in, both sides.** Submitted
    `ZZTEST-groups-agent NEW/OLD suggested group` with Congregation=Main, Meeting Day=Tuesday,
    Meeting Time=19:00, then read both resulting `Groups` rows out of MP and compared 17
    columns.
11. **Responsive.** Re-rendered both at 390×844 and screenshotted.
12. **Console / network hygiene.** Captured console, pageerror, requestfailed and every
    `/api/embed/*` response on the new side for every run.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Element upgrades, shadow root populated | yes | yes | **pass** |
| 2 | Console errors attributable to the widget | none (only the documented MP `[AUTH] No token…` / `User not authenticated.` noise) | none | **pass** |
| 3 | Failed `/api/embed/*` requests | n/a | none (`apiFailures: []` on every run) | **pass** |
| 4 | Filter controls present | keyword, campus, neighborhood, city/postal, focus, life stage, 7 days, 4 times, meets-online, search, suggest | identical set, same grouping behind Advanced | **pass — full control parity** |
| 5 | Filter controls *not* in either | age range, meeting frequency, "has openings", radius/geo search, map view, sort, paging | same — legacy has none of these either | **pass** |
| 6 | `>20 results` hint | `mppw-alert__info` with `viewMoreLabel` | `Showing the first results — refine your search…` | **pass** (not triggerable on this domain: 4 groups) |
| 7 | Unfiltered result set | 4 groups: 49, 8, 6, 7 | 4 groups: 49, 8, 6, 7 — same order | **pass** |
| 8 | keyword=`bible` | 3: 8, 6, 7 | 3: 8, 6, 7 | **pass** |
| 9 | keyword=`golf` | 1: 8 | 1: 8 | **pass** |
| 10 | congregation=Main | 4: 49, 8, 6, 7 | 4: 49, 8, 6, 7 | **pass** |
| 11 | meeting day=Monday | 2: 49, 6 | 2: 49, 6 | **pass** |
| 12 | meeting time=Evening | 3: 49, 6, 7 | 3: 49, 6, 7 | **pass** |
| 13 | meets-online=on | 0 | 0 | **pass** |
| 14 | focus=`Bible & Book Study` | 3: 49, 6, 7 | 3: 49, 6, 7 | **pass** |
| 15 | life stage=`Single` | 1: 6 | 1: 6 | **pass** |
| 16 | city=`Melbourne` / `32904` | 0 / 0 | 0 / 0 | **pass** (no group on this domain has an address — see Not tested) |
| 17 | keyword no-match | 0 | 0 | **pass** |
| 18 | Agreement with MP directly | 4 rows from `api_MPPW_SearchGroups` | same 4 | **pass — both correct** |
| 19 | Unpublished / full / ended groups leaked | no | no | **pass** — 25 `Groups` rows carry `Available_Online = 1`; the proc returns 4, and both widgets show exactly those 4 |
| 20 | Card → detail navigation by mouse | yes | yes | **pass** |
| 21 | Card → detail navigation by keyboard | **yes** (Enter on `a.buildDetailsButton`) | **no** (Enter and Space both no-op) | **fail → C10** |
| 22 | `a[href]` in the card (new tab / copy link / crawlable) | 1 | **0** (CTA is a `span`; card is a `div role="link" tabindex="0"`) | **fail → C10** |
| 23 | Focus ring visible on the focusable card | yes | yes (`outline: solid 2px #004C97`) | **pass** |
| 24 | Tab order sane | yes | yes: keyword → Search → Advanced Search → 4 cards → Suggest a Group | **pass** |
| 25 | Suggest-a-Group gated when signed out | **yes, up front** — `Please login to be able to suggest a new group` + Login, fields hidden | **no** — full form shown; submit 401s twice and dead-ends with no sign-in control | **fail → C15** |
| 26 | Suggest-a-Group empty submit | n/a (gated) | shared `form-validation.ts`: summary + 3 inline errors + `aria-invalid`; **no native `reportValidity`** | **pass** |
| 27 | Suggest-a-Group write, signed in | `200 POST /Api/GroupsApi/SuggestGroup` | `200 POST /api/embed/group-finder/suggest` | **pass** |
| 28 | Suggested `Groups` row fields | Group 58 | Group 57 — identical `Ministry_ID` 8, `Group_Type_ID` 1, `Primary_Contact` 98, `Congregation_ID` 1, `Meeting_Day_ID` 3, `Meeting_Time` 19:00:00, `Available_Online` false, `Group_Is_Full` false | **pass** |
| 29 | Suggested `Start_Date` time zone | `2026-09-09T02:18:00` (**UTC**) | `2026-09-08T22:18:00` (domain wall-clock) | **new is correct** — see below |
| 30 | 390×844 reflow | single column, no horizontal overflow | single column, no horizontal overflow | **pass** |
| 31 | Copy / date / empty-state parity | see C18 table | 13 differences | **fail → C18** |
| 32 | `citypostalcode` pre-settable from markup | yes | no | already filed as **C64** — not re-filed |

## Findings filed

- `C10-group-finder-cards-not-keyboard-operable.md` — result cards are `tabindex="0" role="link"` but Enter/Space do nothing and the card contains no anchor (functional).
- `C15-group-finder-anonymous-suggest-dead-ends.md` — anonymous visitor fills the whole Suggest-a-Group form, then hits a 401 with no sign-in affordance (ux).
- `C18-group-finder-copy-and-format-drift.md` — 13 copy / date-format / empty-state / placeholder differences (cosmetic).

Not re-filed (already covered by the config cartographer): **C64** (`citypostalcode` not
pre-settable), **C67** (no MP-configurable labels), **C68** (no `customCss`).

## Where the new widget is better

- **Result-set correctness is identical** across all eleven filter combinations *and*
  against a direct `api_MPPW_SearchGroups` call — the new finder is a faithful port,
  including the `@DaysOfWeek` pipe-joined encoding and the four `@Morning`/`@Lunchtime`/
  `@Afternoon`/`@Evening` flags.
- **`Start_Date` on a suggested group is written in the domain's wall-clock time**
  (`2026-09-08T22:18`), which is the MP convention; the **legacy** widget wrote
  `2026-09-09T02:18` — the same instant expressed in UTC, i.e. four hours into the wrong
  day at 22:18 EDT. `DomainTimezoneService` is doing its job and legacy is the wrong one
  here. Not filed as a finding against us.
- Suggest-a-Group uses the shared `form-validation.ts` with inline errors and
  `aria-invalid`, and never raises the native `reportValidity` popup.
- Meeting-day checkbox labels are full day names rather than legacy's `Su Mo Tu…`,
  which is better for screen readers (listed in C18 only as drift, not as a regression).

## Not tested / blocked

- **City / postal-code filtering could not be exercised for real.** Every group on this MP
  domain returns `Address: ""` and `Latitude: null` from the proc, so `Melbourne` and
  `32904` both correctly return 0 on both sides. Confirming the filter actually *matches*
  would need a group with an offsite meeting address; unblock by creating a `ZZTEST-`
  group with an `Address_ID` and re-running case 16 of `gf-filters.mjs`.
- **The `>20 results` hint (check 6) never rendered** — the domain has 4 online groups.
  Both code paths were read and are equivalent (`length > 20`), but neither was seen.
- **`show-full-groups` / `show-future-groups` could not be differentiated.** Calling the
  proc with `@ShowFullGroups: true` still returns the same 4 rows: the full groups on this
  domain (ids 14, 15, 16, 19, 23–26 …) are `Group_Type_ID 9` and are excluded by the proc
  for other reasons. Both widgets pass the flag identically, so this is a fixture gap, not
  a parity gap.
- **Labels could not be compared against a *customised* MP domain.** Legacy pulls copy from
  `GetLabels`; ours is hardcoded. That is C67's subject, and C18 only compares the
  as-shipped defaults.

## Fixture data

Created and **deleted**: `Groups` 57 (`ZZTEST-groups-agent NEW suggested group`) and 58
(`ZZTEST-groups-agent OLD suggested group`). Teardown verified — `Group_Name LIKE 'ZZTEST%'`
returns `[]` (`groups-mp-cleanup2.mts`). Nothing left behind.

## Screenshots

- `screenshots/group-finder-old-initial.png` — legacy baseline, anonymous, 1440×900.
- `screenshots/group-finder-new-initial.png` — new baseline, anonymous, 1440×900.
- `screenshots/group-finder-old-mobile.png` — legacy at 390×844.
- `screenshots/group-finder-new-mobile.png` — new at 390×844.
- `screenshots/group-finder-old-empty-state.png` — legacy no-match: styled alert with guidance.
- `screenshots/group-finder-new-empty-state.png` — new no-match: bare "No groups found."
- `screenshots/group-finder-new-card-keyboard.png` — first card focused; still on the finder after Enter and Space (C10).
- `screenshots/group-finder-old-suggest-anon.png` — legacy gates suggest behind a login prompt (C15).
- `screenshots/group-finder-new-suggest-anon.png` — new shows the whole form to an anonymous visitor (C15).
- `screenshots/group-finder-new-suggest-anon-submit.png` — the 401 dead end, form still populated (C15).
- `screenshots/group-finder-new-suggest-validation.png` — empty submit: shared validator, no native popup.
- `screenshots/group-finder-old-suggest-authed.png` — legacy suggest form, signed in.
- `screenshots/group-finder-new-suggest-submitted.png` — new suggest success.
- `screenshots/group-finder-old-suggest-submitted.png` — legacy returns to the results grid after a successful suggest.
