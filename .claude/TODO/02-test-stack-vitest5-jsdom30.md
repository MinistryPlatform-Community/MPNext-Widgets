# 2. Test stack: vitest 4→5, @vitest/coverage-v8 4→5, jsdom 29→30

**Depends on:** Node 24 baseline (done).
**Risk:** medium. **Size:** ~half a day.

## Why

- `vitest` 4.1.7 → 5.0.0, `@vitest/coverage-v8` 4.1.7 → 5.0.0, `jsdom` 29.1.1 → 30.0.1.
- jsdom 30 lets us **delete the `undici` override** from `pnpm.overrides` in the root
  `package.json`. That override currently exists only because jsdom 29 pulls a
  vulnerable `undici` (10 advisories, 4 high). Once on jsdom 30, confirm
  `pnpm audit` is still clean *after* removing it.

## Must move together

`@vitest/coverage-v8`'s peer on `vitest` is pinned to **exactly `5.0.0`**, so
vitest and the coverage provider cannot be bumped independently. jsdom is the
`environment` for the DOM tests, so bump it in the same branch.

Peer/engine facts checked on 2026-09-07:
- `vitest@5` engines: `^22.12.0 || ^24.0.0 || >=26.0.0` — Node 24 OK.
- `vitest@5` peer `vite`: `^6.4.0 || ^7.0.0 || ^8.0.0` — our `vite@8.2.2` OK.
- `vitest@5` peer `@types/node`: `^22.0.0 || >=24.0.0` — our `^24.13.3` OK.
- `jsdom@30` engines: `^22.22.2 || ^24.15.0 || >=26.0.0` — Node 24.18 OK.

## Steps

1. `pnpm update --latest vitest @vitest/coverage-v8 jsdom`
2. Remove `"undici": ">=7.29.0 <8"` from `pnpm.overrides` in root `package.json`;
   `pnpm install`; `pnpm audit` must stay clean. If it does not, put the override
   back and note why in this file.
3. **Fix the pre-existing config-loader warning while you're here.** Vitest
   currently prints on every run:
   > Your Vite config uses features that are unsupported by `configLoader: 'native'`,
   > which is planned to become the default in a future major version of Vite:
   > ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1).

   Fix by renaming `vitest.config.ts` → `vitest.config.mts`. Do **not** add
   `"type": "module"` to the root `package.json` — that would change module
   resolution for `scripts/*.js` (`scripts/copy-sdk.js` and `scripts/hash-sdk.js`
   are CommonJS and use `require`), so `.mts` is the contained fix.
4. Run `pnpm test:coverage` (not just `test:run`) — the coverage provider is
   half of this upgrade and `test:run` won't exercise it.

## Where breakage is likely

48 test files / 808 tests pass today. Expect fallout concentrated in the
Shadow-DOM component tests, which are the most jsdom-sensitive:

- `packages/embed-sdk/src/components/*.test.ts` (esp. `user-menu.test.ts`, which
  stubs `<mpp-user-login>` custom-element registration)
- `packages/embed-sdk/src/shared/base-widget.test.ts`, `cdn-loader.test.ts`
  (these stub `document.createElement('script')` load/error events)

## Done when

Standard verification gate passes, `pnpm test:coverage` passes, coverage numbers
are not silently lower than before (check `coverage/` output), the vitest config
warning is gone, and the `undici` override is deleted.
