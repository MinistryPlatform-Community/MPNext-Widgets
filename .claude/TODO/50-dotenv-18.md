# 50. `dotenv` 17.4.2 → 18.0.7

**Depends on:** nothing. **Risk:** low. A trial bump was green, and neither caller uses a
removed feature. **Size:** ~15 minutes.

Filed 2026-10-11 by the dependency pass. It was deferred because it is a major, not because
anything broke.

## Why

It keeps the dependency current. It closes no advisory, and no override depends on it. Note
that `dotenv` sits in `dependencies`, but nothing in the deployed app imports it: Next reads
`.env*` itself. It could move to `devDependencies` in the same change.

## What the major changes (CHANGELOG 18.0.0, 2026-09-17)

- **Removed:** preloading (`node -r dotenv/config`; use `dotenv run -- cmd` instead),
  `.env.vault` support, tips, and the skill files.
- **Changed:** the "injecting env" message now goes to **stderr** instead of stdout.
- **Added:** a `dotenv` CLI, and an opt-in fast parser (`config({ fast: true })`).
- `exports` is CJS-only (`dist/index.cjs`). Both callers run under ESM interop (Playwright's
  config loader, `tsx`), and the trial shows that resolves.

## The callers, and why neither breaks

`grep -rnE "dotenv/config|DOTENV_KEY|env\.vault|-r dotenv"` over the repo found **no hits**, so
nothing uses a removed feature. The only callers:

- `playwright.config.ts:2,9`

  ```ts
  import { config as loadEnvFile } from "dotenv";
  loadEnvFile({ path: ".env.local", quiet: true });
  ```

  `quiet?: boolean` is still in v18's `dist/index.d.ts`, so the stderr change is moot here.
- `src/lib/providers/ministry-platform/scripts/generate-types.ts:4,18`

  ```ts
  import * as dotenv from "dotenv";
  dotenv.config({ path: envPath });
  ```

  Not quiet, so `pnpm mp:generate` will print its "injected env" line on **stderr** from now on.
  That is harmless unless someone pipes it.

The `.claude/playwright/widget/scripts/*.mts` probe scripts also import it. They are
throwaway harness scripts, but check them if one is still in use.

## Trial run (2026-10-11, reverted afterwards)

- `npx tsc --noEmit` → exit 0.
- `pnpm test:run` → 150 / 2863, all passing.
- `npx playwright test --list` → the config loads and lists 75 tests in 6 files.
- `tsx` import + `config({ path: '.env.local', quiet: true })` → it loads.

## Steps

1. `pnpm add dotenv@^18.0.7` (or `pnpm add -D`, see Why).
2. Run the standard gate.
3. Run `pnpm mp:generate` once against a real `.env.local`, and confirm the models regenerate
   with no diff.

## How to test

`npx playwright test --list` (config load), then `pnpm mp:generate` (the one script that reads
the env through dotenv rather than through Next).

## Done when

`dotenv` is on `^18`, the gate is green, and `mp:generate` produces no model diff.
