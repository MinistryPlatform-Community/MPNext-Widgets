# 3. TypeScript 6→7 — **attempted 2026-09-07, blocked, not merged**

**Depends on:** #2 — done (PR #26). Also now blocked behind the same plugin chain
as #18.
**Risk:** high. **Size:** half to a full day *once the blocker clears*; today the
work is ~0 because it cannot be finished.
**Status:** attempted on branch `chore/typescript-7`, reverted. The bump itself is
clean — the blocker is `typescript-eslint`, which **hard-refuses** TypeScript 7.0.

## Why

`typescript` 6.0.3 → 7.0.2 across **all three** workspace packages — the root,
`@mpnext/embed-sdk`, and `@mpnext/types` each declare it separately. TS 7 is the
native (Go) compiler port, so this is the single largest item in this batch.

`typescript@7` engines: `>=16.20.0` — no Node constraint issue.

## What the 2026-09-07 attempt found

### The bump itself is completely clean

With `typescript@7.0.2` in all three packages:

| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | **0 errors**, 0.87s (was ~11s under TS 6) |
| `pnpm --filter @mpnext/embed-sdk exec tsc --noEmit` | **0 errors** |
| `pnpm --filter @mpnext/types exec tsc --noEmit` | **0 errors** |
| `pnpm test:run` | **832 passed / 50 files** — baseline |
| `pnpm build:sdk` | ✅ bundle emitted |
| `pnpm build` (SDK + `next build`) | ✅ exit 0 |
| `pnpm audit` | no known vulnerabilities |
| `pnpm lint` | ❌ **exit 2, zero files linted** — see below |

Specifically ruled out as risks (these were the things this file warned about):

- **Program size did not shrink.** `tsc --listFiles` was captured before and after
  the bump for all three packages and diffed. After normalising the lib directory
  (`typescript@6.0.3/lib/` → `@typescript/typescript-win32-x64@7.0.2/lib/`), the
  file lists are **byte-identical**: root 2314 files (918 project files), embed-sdk
  195 (38), types 183 (27). Same 89 `lib.*.d.ts` on both sides.
- **The `**/*.mts` glob still works.** `vitest.config.mts` is in the TS 7 root
  program, exactly as under TS 6. No glob or `.mts` resolution change.
- **Zod 4 inference is fine.** No diagnostics anywhere in `@mpnext/types` or in
  `MPHelper`'s generic `createTableRecords(..., { schema })` surface.
- **The SDK emit is bit-identical.** `pnpm build:sdk` from a wiped `dist/` produced
  `next-embed.2ba8f2b9.es.js` — the *same content hash* as the TS 6 build.
  `hash-sdk.js` and `copy-sdk.js` staged it into `public/embed-sdk/` normally.
  (No browser retest was needed or done: the shipped bytes did not change.)
- **`tsconfig.tsbuildinfo` is not checked in.** The earlier version of this file
  claimed it was; it is covered by `.gitignore:37` (`*.tsbuildinfo`) and
  `git ls-files` returns nothing for it. Nothing to fix. It *was* deleted before
  each run anyway so no stale incremental cache was read.
- **Next.js 16.3.4 is TS 7-ready.** It resolves `typescript/package.json` and
  spawns its `bin.tsc` as a child process (`next/dist/lib/typescript/runTypeScriptCli.js`),
  with explicit handling for "TypeScript 7's extensionless ESM bin wrapper". Verified
  end-to-end by planting a deliberate `TS2322` and confirming `next build` failed on it.

### The blocker: `typescript-eslint` refuses TS 7.0

`pnpm lint` does not degrade — it does not run at all:

```
typescript-eslint does not support TS 7.0.
Please see https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0
See also https://github.com/typescript-eslint/typescript-eslint/issues/10940

Oops! Something went wrong! :(
ESLint: 10.10.0
Error: typescript-eslint does not support TS 7.0.
    at .../typescript-eslint@8.69.0/node_modules/typescript-eslint/dist/index.js:52:11
    at .../eslint-config-next@16.3.4/node_modules/eslint-config-next/dist/index.js:5:64
```

This is a deliberate throw at module load, in `eslint-config-next`'s own import
chain, so it is not avoidable by rule config. It is also not fixable by upgrading:

- `typescript-eslint@latest` (8.70.0) and `@canary` (8.70.1-alpha.0) both still
  declare `peerDependencies.typescript: ">=4.8.4 <6.1.0"`.
- `eslint-config-next@16.3.4` depends on `typescript-eslint: ^8.46.0`.
- Upstream issue #10940 tracks support for **TS >= 7.1**, not 7.0.

The root cause is upstream of typescript-eslint: **TypeScript 7.0 ships no
compiler API at all.** Per the TS 7.0 announcement, a new API is expected in
**7.1**. Every tool that embeds the TS API (typescript-eslint, Vue, Svelte,
Astro, Angular, MDX) is blocked the same way. Next.js is unaffected only because
it shells out to the `tsc` *binary* instead of importing the API.

`pnpm install` under TS 7 also adds seven new peer warnings, all the same cap:

```
├─┬ @typescript-eslint/parser 8.69.0
│ └── ✕ unmet peer typescript@">=4.8.4 <6.1.0": found 7.0.2
   (…and typescript-estree, tsconfig-utils, project-service, typescript-eslint,
    @typescript-eslint/utils, eslint-plugin, type-utils)
```

### The documented workaround was tried, and it is not an upgrade

The TS 7.0 announcement documents a side-by-side install for exactly this case:

```json
"devDependencies": {
  "@typescript/native": "npm:typescript@^7.0.2",
  "typescript": "npm:@typescript/typescript6@^6.0.2"
}
```

This was applied to all three packages and **does** make everything green:
`pnpm lint` exit 0, `npx tsc` reports 7.0.2, `tsc6` reports 6.0.3, root typecheck
0 errors in ~1s.

**But it does not put this repo on TypeScript 7**, and it should not be merged as
if it did:

- Next.js resolves the package literally named `typescript`, which under this
  layout is `@typescript/typescript6@6.0.2`. Confirmed directly:
  `require.resolve('typescript/package.json')` →
  `@typescript/typescript6/package.json`, `bin: {"tsc6": "./bin/tsc6"}`. Next's
  bin lookup even has an explicit `/^tsc\d+$/` fallback that matches `tsc6`.
  So **`next build` — the gate that actually blocks a deploy — would keep
  type-checking with TS 6**, while `npx tsc` used TS 7.
- VS Code / the IDE resolve workspace TS the same way, so editor diagnostics stay
  on TS 6 too.
- That is precisely the split-compiler situation this file's step 1 warns about
  (the zod dual-instance episode), except worse: two different *compilers*
  disagreeing silently, with the faster one not being the one that gates CI.

Adopting the dual layout is a deliberate architectural decision with a real
downside, not a version bump. If it is ever wanted, it should be its own item
with its own justification — probably not worth it for `npx tsc` speed alone.

## Retry criteria

Do not reattempt until **all** of these hold:

1. `npm view typescript dist-tags` shows a `latest` of **7.1.x or newer** (7.1 is
   where the new compiler API lands).
2. `npm view typescript-eslint@latest peerDependencies.typescript` accepts that
   version — i.e. upstream issue
   https://github.com/typescript-eslint/typescript-eslint/issues/10940 is closed
   and shipped.
3. `eslint-config-next` depends on a `typescript-eslint` range that includes it
   (check `npm view eslint-config-next@latest dependencies`), or the local
   `eslint.config.mjs` has moved off `eslint-config-next`'s TS chain.

Item #18 is the sibling of this one — the same plugin chain, one ESLint major
behind. It is plausible both clear in the same `eslint-config-next` release.

## Steps (when retrying)

1. Bump in all three: root `devDependencies`, `packages/embed-sdk`,
   `packages/types`. Keep the three versions identical.
2. `pnpm install` — check the peer-warning list has not grown.
3. Capture `tsc --listFiles` **before** the bump for each package and diff it
   against the post-bump list, normalising the lib directory. An upgrade that
   "passes" because it type-checked fewer files is a failure. Baselines as of
   2026-09-07 (TS 6.0.3): root 2314 / 918 project, embed-sdk 195 / 38,
   types 183 / 27, and `vitest.config.mts` must be in the root program.
4. Typecheck each package independently:
   - `npx tsc --noEmit` (root)
   - `pnpm --filter @mpnext/embed-sdk exec tsc --noEmit`
   - `pnpm --filter @mpnext/types exec tsc --noEmit`
5. `pnpm build:sdk` — the SDK build script is `tsc && vite build`, so the SDK
   emits through tsc. Confirm `packages/embed-sdk/dist/next-embed.<hash>.es.js`
   is produced and that `hash-sdk.js` + `copy-sdk.js` stage it into
   `public/embed-sdk/`. If the content hash is unchanged from the TS 6 build the
   bytes are identical and no browser retest is needed; if it changes, load all
   five demo pages under `pnpm test:widget` and check the console.
6. `pnpm build`, `pnpm lint`, `pnpm test:run`, `pnpm audit`.

## Done when

Standard verification gate passes with a single `typescript` version (no
`@typescript/typescript6` alias) declared identically in all three packages, all
three packages typecheck, `next build` is confirmed to be running the new
compiler, and a freshly built SDK bundle loads in `pnpm test:widget` without
console errors.
