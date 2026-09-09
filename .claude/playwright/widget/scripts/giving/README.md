# giving comparison scripts (block C30–C39, 2026-09-08)

Every script here was run from the repo root with `node <path>` (or
`pnpm exec tsx` for `mp-query.mts`). They import the shared harness by absolute
`file:///` URL, so they run from anywhere; the MP driver resolves `src/` relatively
and must be run from the repo root.

| Script | What it does |
|---|---|
| `mp-query.mts` | MP driver over `MPHelper` client credentials. `t <table> <select> <filter> [top]`, `p <proc> <jsonParams>`, `create`/`update`/`updatef`/`del <table> <json>`. Used for every ground-truth read and every fixture in this pass. |
| `old-discover.mjs` | `listShadowHosts` + settled-text dump of the four legacy giving pages. Run this first on an unfamiliar legacy page. |
| `new-baseline.mjs` | Signed-in baseline + screenshot for all five new widgets. |
| `signedout.mjs` | Anonymous render of all five new widgets and the four legacy pages, with API statuses (evidence for `C30`). |
| `giving-deep.mjs` | `next-my-giving`: show-more, soft-credit toggle, month filter, year navigation to the floor, mobile, a11y probe. |
| `giving-old-deep.mjs` | `mpp-my-giving`: visible-text/computed-style dump, class list, a11y probe. |
| `old-deep2.mjs` | Legacy year-navigation floor walk + the legacy statement widget's control inventory. |
| `stmt-deep2.mjs` | `next-my-contribution-statement` download interception + `next-statement-preferences` write round trip. |
| `old-stmt.mjs` | Legacy Save-as-PDF (download event) and the `SetStatementMethod` write. |
| `paperless-matrix.mjs` | Sets `Donors.Statement_Method_ID` to 1/2/4 via `mp-query.mts` and reads both widgets each time. Needs `GIVING_SCRATCH` pointing at a directory holding `donor-1.json` / `donor-2.json` / `donor-4.json`, each `[{"Donor_ID":6,"Contact_ID":98,"Statement_Method_ID":<n>}]`. |
| `pledges-deep.mjs` | `next-my-pledges` cancel flow end to end, plus the legacy inventory. |
| `old-cancel.mjs` | Legacy cancel, including its native `confirm()` dialog. |
| `pc-new.mjs`, `pc-new2.mjs` | `next-pledge-campaign` at a chosen campaign: field dump, validation matrix, real submit, Blank Form branch. |
| `pc-old.mjs`, `pc-old2.mjs` | Same for `mpp-pledge-campaign`, using `page.route` to rewrite `pledgecampaignid` in the fetched `.aspx`. |
| `kbd.mjs` | Tab order and computed focus outline across the four read-only giving widgets. Its output is kept beside it as `kbd.log`. |

Two things worth reusing:

- **`IsPending` in `api_MPPW_GetMyGivingHistory` is driven by `Batch_ID IS NULL`**, not by
  `Donations.Processed`. A donation fixture with no batch renders as `PENDING` instead of a
  date, which hides every date-formatting and year-boundary behaviour.
- **`api_MPPW_GetMyContributionStatements` returns nothing for a `Contribution_Statements`
  row with no attached file.** Create the row, then `MPHelper.uploadFiles` a PDF onto it.

The pledge/campaign/donation/statement fixtures these scripts create are listed, with
ids, in the per-widget logs under `.claude/playwright/widget/tests/`. All of them were
deleted at the end of the run.
