# Dependency Upgrade TODOs

Deferred items from the dependency review of **2026-09-06/07**. Each file is
one branch's worth of work. They are ordered, but only loosely coupled — see
"Depends on" in each file.

The prerequisite (**Node 24 baseline**) is already done on `dev`:
`engines.node: "24.x"`, `.nvmrc: 24`, CI `node-version: 24`, `@types/node@^24.13.3`
in both the root and `@mpnext/embed-sdk`. Everything here assumes Node 24.

Also already done (do not redo): `next` 16.3.4, `better-auth` 1.7.3 (item 5,
PR #20), `chalk` 6.0.0 (item 6), `vite` 8.2.2, `postcss` 8.5.28, all
`@radix-ui/*`, `jose` 6.2.12, `zod` 4.5.4 (incl. `@mpnext/types`),
`react`/`react-dom` 19.2.8, `playwright` 1.63.0, `eslint-config-next` 16.3.4,
FullCalendar CDN pin 6.1.21, add-to-calendar-button CDN pin 2.15.0 (item 8,
PR #19), all four GitHub Actions majors, and security overrides for `undici` /
`js-yaml@4` / `@humanfs/node` / `brace-expansion`.
`pnpm audit` was clean as of 2026-09-07.

Do **not** bump `@types/node` past `^24.13.3` — it is deliberately pinned to
match the Node 24 runtime (Vercel runs 24).

| # | File | Risk | Rough size |
|---|------|------|-----------|
| 2 | `02-test-stack-vitest5-jsdom30.md` | medium | half day |
| 3 | `03-typescript-7.md` | high | half–full day |
| 4 | `04-eslint-10.md` | medium | 1–3 hours |
| 7 | `07-fullcalendar-7.md` | medium | needs visual QA |
| 10 | `10-sri-cdn-scripts.md` | low change, breaks a widget if the hash is wrong | 45 min |
| 12 | `12-demo-layout-redirect-loop.md` | low | 30 min |
| 13 | `13-token-bridge-never-mounts.md` | medium — server sign-out is a no-op today | ~1 hour |
| 14 | `14-better-auth-no-database.md` | medium — app sessions are lost on any restart | half a day |

Items 12, 13 and 14 are **not** dependency upgrades. 12 is a pre-existing bug found
while live-testing the better-auth 1.7 upgrade (item 5) on 2026-09-07 and
confirmed against a 1.6.30 baseline. 13 is a pre-existing wiring bug found while
browser-testing former item 9 on the same day: `TokenBridge` is not mounted on
any reachable route, so widget sign-out never clears the Better Auth session.
14 was found while browser-testing item 11 on the same day: Better Auth has no
`database` configured and silently runs on the in-memory adapter.

Item 9 (`no-location-assign-relative-destination` in `token-bridge.tsx`) is
**done** — `pnpm lint` is now 0 errors, 0 warnings, which is the baseline item 4
assumes.

Item 11 (`userGuid`/`imageGuid` dropped from the Better Auth session) is
**done** — populated server-side by `databaseHooks.user.create/update.before`
in `src/lib/auth.ts`, so `/demo` no longer trips item 12's loop. The loop itself
is still latent; item 12 remains open.

**Standard verification gate** for every branch below:

```
pnpm install
npx tsc --noEmit
pnpm --filter @mpnext/embed-sdk exec tsc --noEmit
pnpm test:run
pnpm lint
pnpm build
pnpm audit
```
