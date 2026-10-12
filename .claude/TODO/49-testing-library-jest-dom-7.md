# 49. `@testing-library/jest-dom` 6.9.1 → 7.0.1

**Depends on:** nothing. **Risk:** low. A trial bump was green on every gate below.
**Size:** ~15 minutes, most of it the verification gate.

Filed 2026-10-11 by the dependency pass. It was deferred only because it is a major, and that
pass applies no majors. It was not deferred because anything broke.

## Why

It keeps the test stack current. It closes no advisory, and no `pnpm.overrides` entry depends
on it.

## What the major changes (v7.0.0, 2026-07-20 release notes)

> BREAKING CHANGES: `@testing-library/dom` is now a required peer dependency. The minimum
> supported Node.js version is now 22.

- **Node ≥22:** already satisfied. The repo is on Node 24 (`engines.node: 24.x`, `.nvmrc`, CI).
- **`@testing-library/dom` peer (`>=10 <11`):** already in the tree as `10.4.1`. It enters as
  the peer of `@testing-library/react@16`, and pnpm's auto-install-peers satisfies jest-dom's
  peer with the same copy. The trial printed **no** new unmet-peer line. It is still worth
  declaring `@testing-library/dom` explicitly in root `devDependencies`, so the peer does not
  silently depend on what `@testing-library/react` happens to pull in.
- **The import this repo uses still exists.** `src/test-setup.ts:8` is

  ```ts
  import '@testing-library/jest-dom/vitest';
  ```

  v7's `exports` still maps `./vitest` to `types/vitest.d.ts` + `dist/vitest.mjs`, so the typed
  `Assertion` augmentation that CLAUDE.md "Testing" relies on is intact.
- v7 also adds `toContainAnyBy*` / `toContainOneBy*` matchers. Nothing here needs them.

## Trial run (2026-10-11, reverted afterwards)

With `pnpm add -D @testing-library/jest-dom@7.0.1` on top of that day's dependency pass:

- `npx tsc --noEmit` → exit 0. This is the check that matters: the matchers are typed through
  `src/test-setup.ts`, and a broken augmentation fails here, not at run time.
- `pnpm test:run` → 150 files / 2863 tests, all passing (identical to the baseline).
- The only peer warnings were the four ESLint ones (item 18).

## Steps

1. `pnpm add -D @testing-library/jest-dom@^7.0.1 @testing-library/dom@^10.4.1`
2. Run the standard gate (README).

## How to test

- `npx tsc --noEmit`. Any `toBeInTheDocument` / `toBeDisabled` / `toHaveAttribute` that loses
  its type fails here.
- `pnpm test:run`. Every component test under `packages/embed-sdk/src/components/` and
  `src/app/**` uses these matchers.

## Done when

Root `package.json` is on `^7` with `@testing-library/dom` declared, `tsc` is clean, and the
test count matches the baseline.
