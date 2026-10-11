# 40. Regenerate the MP models — `Forms.Standalone_Form_Use_Only` is missing

**Depends on:** nothing.
**Risk:** low. The models date from the initial commit, so they lag the live schema, and
`mp-column-names.test.ts` has to carry an allow-list entry for a column MP really has.
**Size:** 30 min, plus whatever the regenerated diff turns up.

Filed 2026-10-11 from the comparison-remediation epic's open follow-ups.

## What

`src/services/customFormService.ts` selects `Forms.Standalone_Form_Use_Only` (verified live
against MP, form 7). The generated model under
`src/lib/providers/ministry-platform/models/` predates the column, so
`src/services/mp-column-names.test.ts` lists it in `MODEL_GAPS`.

## Do

Regenerate the models (README, "Generate Ministry Platform Types"), then delete the
`MODEL_GAPS` entry. The test fails on a stale entry, so it tells you when the entry is no
longer needed. Review the regenerated diff for any other column a service relies on.

## Done when

`MODEL_GAPS` is empty, and `pnpm exec tsc --noEmit` and `pnpm test:run` pass.
