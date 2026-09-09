# opportunity-finder — comparison test log

- **New**: `next-opportunity-finder` — http://localhost:5173/demo-opportunity-finder.html
- **Old**: Opportunity Finder — https://mpi.ministryplatform.com/widgets/opportunity_finder.aspx
- **Tested**: 2026-09-08 by subagent *serving & visit* (block C20–C29)
- **Auth state(s) tested**: signed out (both), signed in as `PLAYWRIGHT_MP_USERNAME` (old, for the detail-link trace)
- **Script**: scratchpad `of-public.mjs`, `of-filters.mjs`, `of-freq.mjs`, `of-card.mjs`, `of-shot.mjs`, `final-shots.mjs`; MP verification via `.claude/playwright/widget/scripts/serve-mp-probe.mts`

Configuration was already like-for-like per CONFIG-MAP §2.16 — the legacy page sets
only `target`, the demo page only `target-url`, so every filter starts at its default
on both sides. No attribute overrides were needed.

## What I tested

1. Baseline render, signed out, both sides: element upgraded, shadow root populated, console/network captured.
2. Result-set parity with no filters: card titles, ids, order, count, subtitles, badges.
3. Enumerated every form control on both sides (id, type, label, option list, visibility) and diffed them.
4. Captured legacy's `GET /Api/OpportunitiesApi/GetConfigurations` payload and the new `GET /api/embed/opportunity-finder/config` payload, and compared the four dropdown datasets.
5. Keyword filter: typed `Innovation`, submitted, compared results on both sides.
6. Keyword filter, no match: typed `zzzznothing`, compared the empty state.
7. Frequency filter: `One Time`, then `Ongoing`, on both sides.
8. Ministry filter: `Information Technology` on both sides.
9. Created a one-time MP opportunity (`ZZTEST-Serve-Compare`, `Opportunity_Date 2027-12-31`) via the client-credentials API and re-ran 2, 7 and 8 so a dated opportunity was in the result set.
10. Resolved the two systems' subtitle disagreement against MP by calling `api_MPPW_SearchOpportunities` directly and reading the raw proc row.
11. Detail-link convention: clicked "See Details" on the legacy card and recorded the URL it navigated to; compared with `buildDetailUrl()`.
12. Read the legacy card's `outerHTML` to compare its interactive semantics with ours.
13. Keyboard: tabbed through the whole new widget recording focus, then focused a card and pressed Enter and Space.
14. Responsive: re-rendered both at 390×844.
15. Checked whether the proc ever returns `Hidden = 1` rows and whether either side would show them.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Renders, no page errors | renders | renders | **pass** — new console noise is only the two anonymous `User not authenticated.` lines the harness documents |
| 2 | Unfiltered result set | Embracing AI, Innovation Volunteer, MyChurch Test Opportunity | same 3, same order (ids 4, 3, 2) | **pass** |
| 3 | Congregation filter | `#congregationId`, "Campus", 3 options | `#of-congregation`, "Congregation", 3 options | **pass** (label wording differs) |
| 3 | Ministry filter | `#ministryId`, 9 options | `#of-ministry`, 9 options | **pass** |
| 3 | Gender filter | `#genderId`, "Gender Required", 3 options | `#of-gender`, "Gender", 3 options | **pass** |
| 3 | Minimum Age | `#ageText`, number | `#of-age`, number | **pass** |
| 3 | Frequency | `select[name=frequency]`, 3 options | `#of-frequency`, 3 options | **pass** |
| 3 | Keyword | `#searchText`, label "Key Word" | `#of-keyword`, placeholder "Search opportunities…" | **pass** |
| 3 | **Attribute filter** | `#attributeType` + hidden `#attributeIDs`, **19 options in 2 groups** | **no control at all** | **fail → C20** |
| 3 | `eventId` / `programId` | hidden inputs, settable | attributes only, no control | parity (legacy's are hidden too) |
| 4 | Config datasets | 2 congregations, 8 ministries, 2 genders, 19 attributeTypes | 2, 8, 2, **0** | **fail → C20** |
| 5 | keyword=`Innovation` | 1 result: Innovation Volunteer | 1 result: Innovation Volunteer | **pass** |
| 6 | keyword=`zzzznothing` | "0 Opportunities found. Please try again with different search criteria." | "No opportunities found." | pass (copy differs — see C67) |
| 7 | frequency=One Time | ZZTEST-Serve-Compare only | ZZTEST-Serve-Compare only | **pass** |
| 7 | frequency=Ongoing | the other 3 | the other 3 | **pass** |
| 8 | ministry=Information Technology | 0 results | 0 results | **pass** |
| 9/10 | One-time opportunity subtitle | `Fri, Dec 31, 2027 12:00 AM` | `Fridays` (date dropped) | **fail → C25** |
| 11 | Detail-link convention | `./Opportunities/?id=4` — a **query param named `id`** | `?id=4` (default `id-parameter-name`) | **pass** — CONFIG-MAP's "legacy uses a trailing path segment" note does not hold for this finder |
| 12/13 | Card is keyboard-operable | `<a href>` "See Details" in the card footer, in the tab order, Enter works | `div[role=link][tabindex=0]`, click-only, **Enter and Space do nothing, no anchor** | **fail → C22** |
| 14 | 390×844 | single column, usable | single column, usable | **pass** |
| 15 | Publication / visibility flags | 3 rows, all `Hidden = 0` | same 3 rows | **pass, but see note** |

## Findings filed

- `C20-opportunity-finder-attributes-filter-missing.md` — the Attributes filter never renders because the config query names a non-existent `Attributes.Available_Online` column, 500s, and the error is swallowed.
- `C22-opportunity-card-not-keyboard-activatable.md` — result cards are announced as links and take focus but cannot be activated by keyboard; legacy's "See Details" is a real anchor.
- `C25-opportunity-one-time-date-shown-as-weekday-plural.md` — a one-time opportunity renders as "Fridays" and its date is dropped.

## Where the new widget is better

- The dated-opportunity aside, the new date/time formatting is cleaner: legacy prints a meaningless `12:00 AM` on every date-only opportunity, and the new widget deliberately suppresses midnight times.
- The Attributes control, when it eventually renders, is a **grouped multi-select** (optgroups per attribute type, multiple selections) where legacy allows exactly one attribute at a time.
- Cards carry a visible focus ring (`:focus-visible` outline) that legacy has no equivalent for — the problem in C22 is only that focus leads nowhere.
- Results are cached (`Cache-Control: public, max-age=120`) and the service batches the Maximum_Needed response tally into one query where legacy did an N+1 loop.

## Not tested / blocked

- **Unpublished / hidden opportunity exposure.** All four opportunities in this MP instance come back from `api_MPPW_SearchOpportunities` with `Hidden = 0`, so I could not observe either widget's behaviour for a hidden row. Worth flagging for whoever fixes C20: `OpportunityFinderService`'s `SearchRow` type declares a `Hidden` field and **never reads it**, so if the proc can ever return `Hidden = 1` to a non-staff caller (`@IsStaffUser: false`), the new widget would list it. I could not create that condition — `Opportunities` has no `Hidden` column of its own; the flag is computed inside the proc, which I cannot read. **This is the one residual data-exposure risk on this widget and it needs a DB-side answer.**
- `show-attribute-filter="false"` was not exercised, because the filter never renders in the first place (C20).
- `program-id` / `event-id` scoping: no opportunity in this instance is attached to an event, and every one is on Program 1, so a scoped query is indistinguishable from an unscoped one here.

## Fixture data

Created `ZZTEST-Serve-Compare` (Opportunity 5) with `Close_Responses` toggled during
the opportunity-details tests, plus Responses 46–49. **All deleted** — verified by
re-querying `Responses` for `Opportunity_ID = 5` (empty) and deleting Opportunity 5.

## Screenshots

- `opportunity-finder-old-initial.png` / `opportunity-finder-new-initial.png` — baseline pair, signed out.
- `opportunity-finder-old-advanced-attribute-type.png` / `opportunity-finder-new-advanced-no-attributes.png` — C20: the 19-option Attribute Type select vs no field.
- `opportunity-finder-old-onetime-shows-date.png` / `opportunity-finder-new-onetime-shows-fridays.png` — C25.
- `opportunity-finder-new-card-focus-enter.png` — C22: card focused, Enter pressed, still on the finder.
- `opportunity-finder-old-keyword-innovation.png` / `opportunity-finder-new-keyword-innovation.png` — keyword parity.
- `opportunity-finder-old-empty-state.png` / `opportunity-finder-new-empty-state.png` — empty-state copy.
- `opportunity-finder-old-mobile.png` / `opportunity-finder-new-mobile.png` — 390×844 pair.
