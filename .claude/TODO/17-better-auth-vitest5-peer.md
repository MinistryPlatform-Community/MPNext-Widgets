# 17. Verify MP app sign-in on `better-auth` 1.7.7 with the re-targeted `@better-auth/core` patch

**Status:** the peer suppression this item tracked was **deleted on 2026-10-11**. One live check
is still owed.
**Depends on:** nothing.
**Risk:** low. The patch content is byte-identical and was verified applied, but no automated
test covers the code path it patches.
**Size:** ~10 minutes, with a free port 3000.

## What was done (2026-10-11 dependency pass)

- `better-auth` 1.7.3 → **1.7.7**. Upstream widened the optional peer to
  `vitest: ^2.0.0 || ^3.0.0 || ^4.0.0 || ^5.0.0` (`npm view better-auth@1.7.7
  peerDependencies.vitest`). The `peerDependencyRules.allowedVersions["better-auth>vitest"]`
  block was therefore **deleted** from `package.json`, not carried forward.
  `pnpm install --lockfile-only --resolution-only` shows no better-auth peer line. The four
  ESLint lines (item 18) are all that remain under the banner.
- The MP `id_token` patch (`clockTolerance: 30` in `verifyProviderIdToken`, commit e6e7ead) was
  **re-targeted**: `patches/@better-auth__core@1.7.3.patch` was `git mv`'d to
  `@better-auth__core@1.7.7.patch` and the `patchedDependencies` key changed to match. The diff
  content is unchanged. Verified:
  - upstream 1.7.7 still has no `clockTolerance` in `dist/oauth2/verify-id-token.mjs` (line 52
    is still bare `maxTokenAge: config.maxTokenAge`), so the patch is still needed;
  - `patch -p1 --dry-run` against the 1.7.7 tarball applies cleanly;
  - after install, the patched store dir
    (`@better-auth+core@1.7.7_pat_…/dist/oauth2/verify-id-token.mjs`) contains
    `clockTolerance: 30`.
- The full gate was green: 0 type errors in all three packages, 150 files / 2863 tests, lint
  0/0, and `pnpm build`.

## What is still owed

**One real sign-in through `/signin` → MP → `/api/auth/oauth2/callback/ministryplatform` →
`/demo`.** That is the only path that runs the patched function. No unit or e2e test covers it:
`e2e/widget/*` signs in through the *widget* flow (`/api/embed/auth/callback`,
`src/lib/embed/mp-oauth.ts`), which does not go through Better Auth.

It was attempted on 2026-10-11 and could not run. Port 3000 was held by **another project's**
dev server (an "AppMonitor / P&T Command Center" app, PID 119272 at the time), and Playwright's
`reuseExistingServer` attached to it. The process was deliberately not killed.

## Steps

1. Free port 3000, then `pnpm dev:next`.
2. In a browser, open `http://localhost:3000/demo` and sign in with the `PLAYWRIGHT_MP_*`
   account. Repeat a few times: the original bug only fired when the callback ran inside the
   ~1s between MP's `auth_time` and `nbf`.
3. Confirm you land on `/demo` (the catalogue, or `AccessDenied` for a non-admin, which is still
   a session). Confirm `GET /api/auth/get-session` returns a `user`. Confirm the server log
   holds no `invalid id token` / `nbf` error.

## Done when

A real MP sign-in completes on 1.7.7. Delete this file then.

The next `better-auth` bump must re-target the patch the same way, because it is keyed to an
exact `@better-auth/core` version. Check first whether upstream has added `clockTolerance`, and
drop the patch if it has.
