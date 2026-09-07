# 4. ESLint 9→10

**Depends on:** nothing. Can run in parallel with #2 and #3.
**Risk:** medium. **Size:** 1–3 hours.

## Why

`eslint` 9.39.4 → 10.10.0. Also lets us **delete two `pnpm.overrides`** that exist
only to patch ESLint's own transitive deps:

- `"js-yaml@4": ">=4.3.1 <5"` — `eslint > @eslint/eslintrc > js-yaml` (2 high, 1 moderate)
- `"@humanfs/node": ">=0.16.8"` — `eslint > @humanfs/node` (1 moderate)

After the bump, remove both, `pnpm install`, and confirm `pnpm audit` is still clean.

Note the root `devDependencies` entry is currently the loose `"eslint": "^9"` —
replace it with a pinned-minor range (`^10.10.0`) rather than `^10`.

`eslint@10` engines: `^20.19.0 || ^22.13.0 || >=24` — Node 24 OK.

## The actual risk

`eslint-config-next@16.3.4` peers `eslint: ">=9.0.0"`, so it *nominally* allows 10.
The risk is not the config, it's the plugin chain it pulls:

- `eslint-plugin-import`
- `@typescript-eslint/parser` → `@typescript-eslint/typescript-estree`
- `eslint-plugin-react-hooks` (which drags in `@babel/core`)

Any of those pinning to ESLint 9's API will fail at rule-load time, not lint time —
so a clean `pnpm install` is not evidence it works. You must actually run `pnpm lint`.

## Steps

1. `pnpm update --latest eslint`, and set the root range to `^10.10.0`.
2. Remove the `js-yaml@4` and `@humanfs/node` overrides; `pnpm install`; `pnpm audit`.
3. `pnpm lint` — must load all rules. Compare the output to the known baseline below.
4. `eslint.config.mjs` is already flat config, so no flat-config migration is needed.
   Check it against ESLint 10's config schema anyway.

## Known lint baseline (as of 2026-09-07)

`pnpm lint` = **0 errors, 1 warning**. The one warning is tracked separately in
`09-token-bridge-lint-warning.md`:

```
src/components/token-bridge/token-bridge.tsx
  71:9  warning  Do not use `window.location.href` to navigate to internal Next.js pages
                 @next/next/no-location-assign-relative-destination
```

If ESLint 10 reports anything beyond that one warning, it's new — triage before merging.

## Done when

Standard verification gate passes, `pnpm lint` still reports 0 errors and no
warnings other than the tracked one, and both overrides are deleted with a clean audit.
