# 3. TypeScript 6→7

**Depends on:** #2 (do the test stack first, so test failures aren't ambiguous).
**Risk:** high. **Size:** half to a full day.

## Why

`typescript` 6.0.3 → 7.0.2 across **all three** workspace packages — the root,
`@mpnext/embed-sdk`, and `@mpnext/types` each declare it separately. TS 7 is the
native compiler port, so this is the single largest item in this batch.

`typescript@7` engines: `>=16.20.0` — no Node constraint issue.

## Do this one alone

Do not combine with #2 or #4. If the build breaks you want one variable.

## Steps

1. Bump in all three: root `devDependencies`, `packages/embed-sdk`, `packages/types`.
   Keep the three versions identical — a split TS version across the workspace is
   how the zod 4.4.3/4.5.4 dual-instance type errors happened in the last pass.
2. `pnpm install`
3. Typecheck each package independently, not just the root:
   - `npx tsc --noEmit` (root, `tsconfig.json`, strict mode, `@/*` → `src/*`)
   - `pnpm --filter @mpnext/embed-sdk exec tsc --noEmit`
   - `pnpm --filter @mpnext/types exec tsc --noEmit`
4. `pnpm build:sdk` — note the SDK build script is `tsc && vite build`, so the SDK
   emits **through** tsc. A TS 7 regression here breaks the shipped bundle, not
   just CI. Confirm `packages/embed-sdk/dist/next-embed.<hash>.es.js` is produced
   and that `scripts/hash-sdk.js` + `scripts/copy-sdk.js` still stage it into
   `public/embed-sdk/`.
5. `pnpm build` (full Next build) and `pnpm lint` — `eslint-config-next@16.3.4`
   peers `typescript >=3.3.1`, so it nominally accepts 7, but the
   `@typescript-eslint/*` chain underneath is the real risk. If lint explodes here
   rather than typecheck, that overlaps #4 — consider doing #4 first.

## Watch for

- `tsconfig.tsbuildinfo` is checked in at the repo root. Delete it before the
  first TS 7 run so you're not reading a stale incremental cache.
- Zod 4 schema inference in `@mpnext/types` and `MPHelper`'s generic
  `createTableRecords(..., { schema })` surface — the most inference-heavy code
  in the repo and the most likely place a compiler port changes behavior.

## Done when

Standard verification gate passes, all three packages typecheck, and a freshly
built SDK bundle loads in `pnpm test:widget` without console errors.
