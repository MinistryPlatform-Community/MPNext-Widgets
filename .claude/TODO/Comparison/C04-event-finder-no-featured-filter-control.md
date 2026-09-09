# C04. `next-event-finder` renders no Featured filter control; "featured only" is markup-only, where the legacy widget let the visitor toggle it

**Widget:** `next-event-finder` (old: Event Finder, `mpp-event-finder`)
**Severity:** functional
**Confidence:** confirmed — both forms enumerated in the browser
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-event-finder`'s Advanced panel contains **five** controls. Enumerated from its
shadow root on `https://mpi.ministryplatform.com/widgets/event_finder.aspx`:

| id | type | label |
|---|---|---|
| `monthId` | `select` | Month |
| `ministryId` | `select` | Ministry |
| `signUpTypeId` | `select` | Sign-up Type |
| **`isFeatured`** | **`input[type=checkbox]`** | **Featured** |
| `searchButton` | `input[type=submit]` | Search Events |

(plus `congregationId` and `keywordSearchText` on the always-visible first row). The
widget's `<label>` list is literally
`["Campus", "Key Word", "Month", "Ministry", "Sign-up Type", "Featured", "Featured"]`.
Ticking **Featured** and pressing **Search Events** re-runs the search with
`isFeatured=true` and renders `0 Events found. Please try again with different search
criteria.` on this dataset — i.e. the control works and is reachable by the visitor.

## New behaviour

`next-event-finder`'s Advanced panel has **four** controls and no checkbox anywhere in
its shadow root:

```
labels        : ["Congregation", "Ministry", "Month", "Sign-up Type"]
input[checkbox]: none
```

The capability exists but only as markup an integrator sets once:
`featured="true"` is read in `buildQuery()` and forwarded as `isFeatured=true`
(`packages/embed-sdk/src/components/event-finder.ts:135-136`). It is in
`observedAttributes` (`:63`) but has no form field, so the *visitor* can never toggle
it, and a page that sets `featured="true"` locks the whole finder to featured events
with no way back. Setting the attribute from Playwright confirms the plumbing is
correct — 0 results, matching legacy exactly — so this is purely a missing control,
not a broken filter.

Related but distinct: the legacy widget keeps **Campus** on the always-visible first
row, while the new widget hides Congregation behind "Advanced Search". Same control,
one click further away; noted here rather than filed separately.

## Why it matters

"Show me the featured events" is the one filter a church actually promotes — it is how
the Featured flag on the event record is meant to pay off, and the badge is already
rendered on the new cards (`event-finder.ts:338`), so a visitor can see that
*some* events are featured and has no way to narrow to them. On the legacy widget that
was one checkbox. Any customer whose page relied on visitors self-selecting featured
events loses the affordance on migration, and the only workaround — hardcoding
`featured="true"` — makes every other event unreachable on that page.

## Evidence

- Screenshot (old, Featured checkbox in the open Advanced panel): `.claude/playwright/widget/screenshots/event-finder-old-featured.png`
- Screenshot (new, Advanced panel open, four fields, no checkbox): `.claude/playwright/widget/screenshots/event-finder-new-advanced-open.png`
- Control enumeration: both shadow roots walked for `input,select,button,textarea,a,[role=button]`
  (script `…/scratchpad/events/01-old-ef.mjs`, `…/03-opts.mjs`).
- Filter-parity check: legacy Featured checkbox → 0 results; new `featured="true"`
  attribute → 0 results; `api_MPPW_SearchEvents` with `@IsFeatured=true` → 0 rows. The
  filter itself is at parity.

## Where to fix

`packages/embed-sdk/src/components/event-finder.ts:248-303` (`renderSearchForm` — the
Advanced grid), `:186-215` (`attachListeners`), `:216-228` (`readFormState`), and
`:135-136` where the attribute is currently the only input to `isFeatured`.

## Suggested fix

Add a `Featured` checkbox to the Advanced grid alongside the four selects, seed it in
`seedFromAttributes()` from the existing `featured` attribute, read it in
`readFormState()` into a `featured` state field, and have `buildQuery()` prefer that
state over the raw attribute (the same seed-then-mutate pattern the other four filters
already use, so the attribute keeps working as a default rather than a lock). While
there, consider promoting Congregation back to the visible row to match the legacy
layout.
