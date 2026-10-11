# 41. `planYourVisitService.getConfigValue` ignores `Application_Code`

**Depends on:** nothing.
**Risk:** a configuration key that exists under two applications is read ambiguously.
`top: 1` returns whichever row MP gives first, so the phone mask or the global congregation
can silently come from the wrong application.
**Size:** small service fix.

Filed 2026-10-11 from the comparison-remediation epic's open follow-ups.

## Where

`src/services/planYourVisitService.ts`, `getConfigValue(keyName)`. It reads
`dp_Configuration_Settings` filtered only on `Key_Name` (callers: `PhoneMask`,
`GlobalCongregationID`).

## Do

Add the `Application_Code` predicate. Check which codes the legacy widget server uses for
these keys (its source is at `S:\MP\mp-Widgets`) and confirm against MP with `mp_lookup`.
Build the filter with `sqlLiteral` from `services/_shared/mp-lookup.ts`. If another service
reads `dp_Configuration_Settings` the same way, share one helper rather than copying.

## Done when

Each key is read with its application code, a unit test pins the filter, and
`mp-url-length.test.ts` / `mp-column-names.test.ts` still pass.
