# event-finder — comparison test log

- **New**: `next-event-finder` — http://localhost:5173/demo-event-finder.html
- **Old**: Event Finder — https://mpi.ministryplatform.com/widgets/event_finder.aspx
  (markup: `<mpp-event-finder target="./event_details.aspx/">` — every filter left at its
  default, so the demo page's `target-url="/demo-event-details.html"` is already
  like-for-like per CONFIG-MAP §2.2; no attribute overrides were needed for the baseline)
- **Tested**: 2026-09-08 by subagent `events` (block C01–C09)
- **Auth state(s) tested**: signed out, and signed in as `PLAYWRIGHT_MP_USERNAME`
  (`assertAuthenticated` returned `ver=1, sub=03a109d5…, mpToken=true` on every authed
  navigation; the finder is a public widget and renders identically in both states)
- **Scripts**: `…/scratchpad/events/01-old-ef.mjs`, `02-ef-parity.mjs`, `03-opts.mjs`,
  `15-ef-filters.mjs`, `17-a11y.mjs`, `20-old-filters.mjs`, `21-old-filters2.mjs`,
  `22-old-signup.mjs` (scratchpad only; MP helper `mp.mjs`)

## What I tested

1. **Baseline render, both sites.** Loaded each page, waited with `waitForWidget`
   (`mpp-event-finder` / `next-event-finder` + `apiPattern: /\/api\/embed\/event-finder\?/`),
   captured console, page errors, failed requests and every `/api/embed/*` response.
2. **Control inventory.** Walked each shadow root for
   `input,select,button,textarea,a,[role=button]` plus every `<label>`, recording id,
   type, visibility (`offsetParent !== null`) and, for selects, the full option list.
3. **Option-list parity.** Compared Congregation, Ministry and Sign-up Type options
   value-by-value between the two widgets.
4. **Data parity, unfiltered.** Extracted the ordered list of event ids from both
   (legacy `a.buildDetailsButton[id]`, new `[data-event-id]`) and diffed the sets in
   both directions.
5. **Filter parity, one filter at a time**, driving each widget through its *own* form
   controls (legacy: `selectOption` on the shadow `<select>` + click `#searchButton`;
   new: set the field + dispatch `submit` on `#ef-form`), then cross-checking each
   result set against `api_MPPW_SearchEvents` called directly with client credentials:
   keyword `Worship`, `congregationId=2`, `monthId=11`, `ministryId=5`,
   `signUpTypeId=1`, Featured checked.
6. **Featured filter.** Confirmed the legacy `#isFeatured` checkbox exists, is inside
   the Advanced panel, and re-runs the search; confirmed no checkbox exists anywhere in
   the new shadow root; then set `featured="true"` as an attribute on the new element to
   prove the *filter* is at parity even though the *control* is missing.
7. **Search → detail flow.** Clicked a result card on the new widget and a
   `See Details` anchor on the legacy widget; compared the URL shape each produces.
8. **Keyboard / a11y.** Pressed Tab 14 times from the top of the new page recording
   `document.activeElement` through shadow roots; focused a result card and pressed
   Enter, asserting on `page.url()` before and after; read `role`, `tabindex`,
   `aria-label`, `alt` and `<label for>` bindings on both.
9. **Responsive.** Re-rendered both at 390×844 and screenshotted.
10. **Empty state.** Compared the copy each shows when a filter returns nothing.
11. **Truncation.** Read the code cap (`MAX_RESULTS = 100`,
    `src/services/eventFinderService.ts:48`) against the legacy standing footer.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Element upgrades, shadow root populated | yes | yes | **pass** |
| 2 | Console errors beyond the known MP noise | `[AUTH] No token available…`, `User not authenticated.` only | same two only | **pass** |
| 3 | API calls | `POST /widgets/Api/EventsApi/GetEvents` 200 | `auth/config` 200, `session` 200, `event-finder/config` 200, `event-finder` 200 | **pass** |
| 4 | Unfiltered result count | 34 | 34 | **pass** |
| 5 | Unfiltered result ids + order | `215,373,216,374,217,375,…` | identical; set difference empty both ways | **pass** |
| 6 | `api_MPPW_SearchEvents` direct | 34 rows | 34 rows | **pass** (both sides call the same proc) |
| 7 | Congregation options | `""=Any Campus, 2=Friends & Internet Campus, 1=Main Congregation` | `""=All Congregations, 2=…, 1=…` | **pass** (values identical; labels differ → C09) |
| 8 | Ministry options | 8 ministries, ids 1,8,2,6,7,11,4,5 | identical ids and names | **pass** |
| 9 | Sign-up Type options | `0=All Events, 1=Open Registration, 2=Open Volunteer Opportunities` | `""=Both, 1=…, 2=…` | **pass** (behaviour identical) |
| 10 | Keyword `Worship` | 37 | 37, identical ids | **pass** |
| 11 | `congregationId=2` | 0 | 0 | **pass** |
| 12 | `monthId=11` | 10 → `760,380,223,381,224,382,225,383,226,384` | identical | **pass** |
| 13 | `ministryId=5` | 0 | 0 | **pass** |
| 14 | `signUpTypeId=1` | 1 → the registration-active fixture | identical | **pass** (proc agrees: 1 row) |
| 15 | Featured filter *result* | 0 | 0 (via attribute) | **pass** (proc agrees: 0 rows) |
| 16 | Featured filter *control* | `input#isFeatured[type=checkbox]`, label `Featured`, in Advanced | **none** — attribute only | **FAIL → C04** |
| 17 | Advanced panel contents | Month, Ministry, Sign-up Type, **Featured** | Congregation, Ministry, Month, Sign-up Type | **FAIL → C04** |
| 18 | Congregation placement | always-visible first row | behind "Advanced Search" | ux nit, folded into C04 |
| 19 | Detail link shape | `<a href="./event_details.aspx/?id=215">See Details</a>` | `div[role=link][tabindex=0]`, click → `location.href` | **FAIL → C05** |
| 20 | Enter on a focused result | activates the anchor | **nothing** (URL unchanged, asserted) | **FAIL → C05** |
| 21 | Tab reaches every result | yes (anchors) | yes (9 consecutive `div.nw-ef-card` stops) | pass, but see #20 |
| 22 | `<label for>` bindings | all 5 bound | all 4 advanced selects labelled; keyword has `aria-label="Search events"` | **pass** |
| 23 | `<img alt>` on cards | `null` | no `<img>` in this dataset; source sets `alt=""` (decorative) | **pass** |
| 24 | Card date format | `Sat, Sep 12, 2026 6:05 PM - 7:30 PM` | `Sat, Sep 12, 6:05 PM – 7:30 PM` (no year) | **FAIL → C09** |
| 25 | Empty-state copy | `0 Events found. Please try again with different search criteria.` | `No events found.` | cosmetic, folded into C09 (root cause C67) |
| 26 | Standing footer | `To see additional results, please refine your search filters above` | none | cosmetic, folded into C09 |
| 27 | Result cap | legacy footer implies one; not reached (34 of 34) | `MAX_RESULTS = 100`, not reached | **not exercised** — see Not tested |
| 28 | Responsive 390×844 | 1-up cards, filters stack | 1-up cards (`@media (max-width: 640px)`), advanced grid → 1 column | **pass** |
| 29 | Signed-in rendering | same as signed out | same as signed out | **pass** |
| 30 | Form validation | n/a (no required fields) | n/a | **n/a** |

## Findings filed

- `C04-event-finder-no-featured-filter-control.md` — the Featured checkbox has no
  equivalent control; "featured only" is markup-only and locks the page.
- `C05-event-finder-cards-not-keyboard-activatable.md` — result cards are
  `div role="link"` with a click-only handler; Enter/Space do nothing, no href.
- `C09-event-finder-card-dates-omit-year.md` — card dates drop the year on a list that
  spans Sep 2026 → Jan 2027 (also carries the wording-difference table).

## Where the new widget is better

- **Filter dropdowns come from a dedicated endpoint** (`/api/embed/event-finder/config`)
  with an `End_Date` liveness predicate, so retired congregations and ministries drop
  out on their own.
- **Cards, not a list row plus a button.** Images, a `Featured` badge, a truncated
  description and a location line, in a responsive 3/2/1-column grid.
- **Advanced-panel state survives a search** — `readFormState()` runs before the toggle
  re-renders, so opening or closing the panel does not lose typed input. The legacy
  panel's toggling was unreliable enough that automating it needed a poll-until-visible
  loop.
- **`Cache-Control: public, max-age=120`** on the search response and `max-age=600` on
  the config response; the legacy `POST …/EventsApi/GetEvents` is uncacheable by
  construction.
- **Result order is explicitly preserved** from `api_MPPW_SearchEvents` rather than
  re-sorted — `eventFinderService.ts` rebuilds the proc's index order after the
  `api_MPPW_GetEvents` round-trip.

## Not tested / blocked

- **The 100-result cap and any truncation notice.** The unfiltered search returns 34
  events on MPI — the proc's own output, verified directly — so neither widget's cap was
  reached. Confirming that `MAX_RESULTS = 100` truncates silently (where legacy shows a
  "refine your search" footer) would need ~70 more public, online-available events;
  creating them was out of proportion to the finding. Recorded as a code-level
  observation in C09 rather than filed.
- **`reduce-series-to` / `event-type-id` / `program-id`.** Attribute-only on *both*
  widgets (legacy's `programId` and `eventId` are hidden inputs, with no control either),
  so there is nothing to compare interactively. Attribute surface already covered by
  CONFIG-MAP §4.1, which found full parity.
- **`target`, the legacy alias for `targeturl`.** Not filed per CONFIG-MAP §4.1 — the
  element name changed anyway, so no customer's markup carries over.
- **MP-configurable labels.** Every legacy string comes from
  `GET /Api/ConfigurationApi/GetLabels`; ours are hardcoded. Already filed as C67.

## Screenshots

- `event-finder-old-initial.png` — legacy baseline, unfiltered, 34 results, year on every card
- `event-finder-new-initial.png` — new baseline, same 34 results, no year
- `event-finder-old-mobile.png` — legacy at 390×844
- `event-finder-new-mobile.png` — new at 390×844
- `event-finder-new-advanced-open.png` — new Advanced panel: four fields, no Featured checkbox (C04)
- `event-finder-old-featured.png` — legacy Advanced panel with the Featured checkbox ticked (C04)
- `event-finder-old-month-11.png` — legacy `monthId=11`, 10 results (data-parity check #12)
- `event-finder-old-ministry-5.png` — legacy `ministryId=5`, 0 results (#13)
- `event-finder-old-signup-1.png` — legacy `signUpTypeId=1`, 1 result (#14)
