# 3. TypeScript 6→7 — **attempted 2026-09-07, blocked, not merged**

**Depends on:** #2 — done (PR #26). Also now blocked behind the same plugin chain
as #18.
**Risk:** high. **Size:** half to a full day *once the blocker clears*; today the
work is ~0 because it cannot be finished.
**Status:** attempted on branch `chore/typescript-7`, reverted. The bump itself is
clean — the blocker is `typescript-eslint`, which **hard-refuses** TypeScript 7.0.
Re-checked 2026-09-08: upstream is unchanged, but the block turned out to be a
*resolution* problem rather than a capability one, and there is now a **verified**
workspace-scoped workaround that does put the repo on TS 7. Still not recommended
yet — see "What the 2026-09-08 re-check found".

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

## What the 2026-09-08 re-check found

### Upstream has not moved

| Check | 2026-09-08 |
|---|---|
| `npm view typescript dist-tags` | `latest` **7.0.2**; `next` **7.1.0-dev.20260908.1** — 7.1 is in nightlies |
| `npm view typescript-eslint@latest peerDependencies` | 8.70.0, `typescript: ">=4.8.4 <6.1.0"` — unchanged |
| `npm view eslint-config-next@latest dependencies` | 16.3.4, `typescript-eslint: "^8.46.0"` — unchanged |

So retry criteria 1–3 below still all fail. But two things about the *shape* of the
block were wrong or unknown on 2026-09-07, and both change the calculus.

### The throw is in three packages, not one

`grep -rl "does not support TS"` across the installed tree hits
`typescript-eslint`, **`@typescript-eslint/parser`**, and
**`@typescript-eslint/eslint-plugin`**. All three run the same gate at module load:

```js
const [versionMajor] = ts.versionMajorMinor.split('.').map(Number);
if (versionMajor >= 7) { throw new Error('typescript-eslint does not support TS 7.0.'); }
```

Two dead ends follow, so nobody has to retry them:

- **Hand-assembling the TS layer from the sub-packages does not dodge it** — the
  parser and the plugin each throw on their own.
- **Dropping `eslint-config-next/typescript` and keeping only `core-web-vitals` does
  not help either.** `core-web-vitals.js` extends `dist/index.js`, which `require`s
  `typescript-eslint` on line 5 — the exact frame in the recorded stack trace. The
  whole of `eslint-config-next` is gated, not just its TS half.

The gate reads only `require('typescript').versionMajorMinor`, i.e. it is a
**resolution** question, not a capability question. That is what makes the option
below work.

### This repo runs *no* type-aware lint rules

This corrects the premise of the "split compiler" objection recorded above.

`eslint-config-next/typescript` spreads `typescript-eslint.configs.recommended` —
**not** `recommendedTypeChecked`. Verified with `eslint --print-config src/proxy.ts`:
113 rules total, of which 20 are `@typescript-eslint/*`, and **every one of them is
syntactic** (`no-explicit-any`, `no-unused-vars`, `ban-ts-comment`, …). There is no
`project` or `projectService` anywhere in `eslint.config.mjs` or in
`eslint-config-next`'s own `parserOptions`. `eslint.config.mjs` also ignores
`packages/**`, so the SDK and types packages are not linted at all.

typescript-eslint is therefore used here as a **parser**, not as a type checker. The
hazard the dual-install was rejected over — two compilers silently disagreeing, with
the faster one not gating CI — does not apply to an arrangement where only the
*linter's parser* is on the older version. The residual risk is TS 7-only **syntax**
that a TS 6 parser cannot read, and TS 7.0 is a port that introduces none.

### The option that does deliver TS 7 today: a workspace-scoped linter

`pnpm.packageExtensions` was tried first and **does not work** — injecting
`dependencies.typescript` into the `@typescript-eslint/*` packages loses to their own
`peerDependencies` declaration, and typescript-eslint still resolved 7.0.2.

What does work is pnpm's actual peer-resolution mechanism: peers resolve **per
subtree**, which is why the tree already carries four separately-peered
`typescript-eslint@8.69.0_<hash>` directories. Move the ESLint stack into its own
workspace package that pins TS 6, and leave the root on TS 7.

Verified end-to-end in a throwaway workspace on 2026-09-08:

- root `package.json` → `typescript: 7.0.2`; `tools/lint/package.json` →
  `typescript: 6.0.3` + `typescript-eslint`
- `require('typescript/package.json').version` was **7.0.2** at the root and
  **6.0.3** inside `tools/lint`
- `require('typescript-eslint')` from `tools/lint` **loaded without throwing**
  (13 configs; it reported `ts.versionMajorMinor === '6.0'`)
- `eslint --config tools/lint/eslint.config.mjs "src/**/*.ts"`, run from the TS 7
  root, linted root source files and both `no-explicit-any` and `no-unused-vars`
  fired normally

**This is not the dual-install rejected above.** There, the package literally named
`typescript` was TS 6, so `next build` and VS Code silently stayed on the old
compiler — the fatal objection. Here the root `typescript` **is** 7.0.2, so
`next build`, `npx tsc`, and the IDE all use TS 7. Only the linter's parser is on 6,
and per the section above it does no type analysis.

Costs, none of them hidden:

- a new `tools/lint` workspace package (`pnpm-workspace.yaml` gains `tools/*`)
- `pnpm lint` becomes `eslint --config tools/lint/eslint.config.mjs .`
- the `reactVersion` workaround in `eslint.config.mjs` (see TODO 18) must point its
  `createRequire` at the repo root, not at the config file's own directory
- two `typescript` entries in the lockfile until 7.1 lands and this is collapsed
- upside: the seven peer warnings from the 2026-09-07 attempt disappear, because the
  peer is satisfied inside `tools/lint`

**Recommendation:** this is a real architectural change carried only to buy compile
speed (~11s → ~0.9s), and TS 7.1 — where the compiler API lands and all of this
collapses to a version bump — is already publishing nightlies. Default to waiting.
Adopt the workspace-scoped linter only if the typecheck time starts actually costing
something, and if adopted, file it as its own item so the unwind is tracked.

## Retry criteria

Do not reattempt until **all** of these hold:

1. `npm view typescript dist-tags` shows a `latest` of **7.1.x or newer** (7.1 is
   where the new compiler API lands). As of 2026-09-08 `latest` is still 7.0.2, but
   `next` is `7.1.0-dev.20260908.1`, so 7.1 is already in nightlies — this criterion
   is the closest of the three to clearing.
2. `npm view typescript-eslint@latest peerDependencies.typescript` accepts that
   version — i.e. upstream issue
   https://github.com/typescript-eslint/typescript-eslint/issues/10940 is closed
   and shipped.
3. `eslint-config-next` depends on a `typescript-eslint` range that includes it
   (check `npm view eslint-config-next@latest dependencies`), or the local
   `eslint.config.mjs` has moved off `eslint-config-next`'s TS chain.

Item #18 is the sibling of this one — the same plugin chain, one ESLint major
behind. It is plausible both clear in the same `eslint-config-next` release.

If TS 7 is wanted **before** these clear, the workspace-scoped linter above is the
only arrangement found so far that delivers it without putting `next build` on the
old compiler. Treat that as a separate, deliberate decision — not as this item.

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
