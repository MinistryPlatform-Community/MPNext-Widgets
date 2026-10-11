# 46. `SearchRow.Hidden` is never read — possible hidden-opportunity exposure

**Depends on:** a database-side answer about `api_MPPW_SearchOpportunities`.
**Risk:** if the procedure can return `Hidden = 1` to a public caller,
`next-opportunity-finder` lists an opportunity staff meant to hide. This is unverified, so
there may be no risk at all.
**Size:** 30 min to answer; a one-line filter if the answer is yes.

Filed 2026-09-08 as a known gap of the legacy-vs-next comparison run. Still open after the
comparison-remediation epic.

## What

`src/services/opportunityFinderService.ts` declares `Hidden` on its `SearchRow` and never
reads it. On the reference domain every row comes back `Hidden = 0`, and `Opportunities` has
no `Hidden` column: the flag is computed inside the procedure, so the condition could not be
produced through the API.

## Do

Read the procedure body to learn when `Hidden` is 1 and whether `@IsStaffUser = 0` already
excludes those rows. The legacy server source is at `S:\MP\mp-Widgets`; otherwise ask a DBA.
If public callers can receive hidden rows, filter `Hidden` server-side in the service.

## Done when

Either the service drops hidden rows (with a unit test), or this file records why the
procedure never returns them to a public caller and the unused field is removed.
