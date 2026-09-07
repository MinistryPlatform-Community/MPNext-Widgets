# Dependency Upgrade TODOs

Deferred items from the dependency review of **2026-09-06/07**. Each file is
one branch's worth of work. They are ordered, but only loosely coupled — see
"Depends on" in each file.

The prerequisite (**Node 24 baseline**) is already done on `dev`:
`engines.node: "24.x"`, `.nvmrc: 24`, CI `node-version: 24`, `@types/node@^24.13.3`
in both the root and `@mpnext/embed-sdk`. Everything here assumes Node 24.

Also already done (do not redo): `next` 16.3.4, `better-auth` 1.6.30, `vite` 8.2.2,
`postcss` 8.5.28, all `@radix-ui/*`, `jose` 6.2.12, `zod` 4.5.4 (incl. `@mpnext/types`),
`react`/`react-dom` 19.2.8, `playwright` 1.63.0, `eslint-config-next` 16.3.4,
FullCalendar CDN pin 6.1.21, all four GitHub Actions majors, and security
overrides for `undici` / `js-yaml@4` / `@humanfs/node` / `brace-expansion`.
`pnpm audit` was clean as of 2026-09-07.

| # | File | Risk | Rough size |
|---|------|------|-----------|
| 2 | `02-test-stack-vitest5-jsdom30.md` | medium | half day |
| 3 | `03-typescript-7.md` | high | half–full day |
| 4 | `04-eslint-10.md` | medium | 1–3 hours |
| 5 | `05-better-auth-1.7.md` | medium | 1–2 hours + manual auth test |
| 6 | `06-chalk-6.md` | low | 15 min |
| 7 | `07-fullcalendar-7.md` | medium | needs visual QA |
| 8 | `08-pin-add-to-calendar-cdn.md` | low change, real exposure | 15 min |
| 9 | `09-token-bridge-lint-warning.md` | low | 30 min |

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
