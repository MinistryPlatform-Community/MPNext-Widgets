# CLAUDE.md - MPNext-Widgets

## Overview

**pnpm monorepo**: Component-only embed SDK extraction. It carries the **whole widget
catalogue** — framework-agnostic Web Components (Shadow DOM) loaded via `<script>` on
external church sites — plus the API routes, services, and shared types behind them.

The catalogue grows; do **not** trust a count in this file over the disk. Sources of
truth: one file per widget in `packages/embed-sdk/src/components/`, one demo page per
widget at `packages/embed-sdk/demo-*.html`. To re-measure:

```bash
grep -rho 'customElements\.define(\s*"next-[a-z-]*' packages/embed-sdk/src | sort -u
ls packages/embed-sdk/demo-*.html | wc -l
ls src/app/api/embed/ ; ls src/services/*.ts | grep -v '\.test\.'
```

Snapshot at 2026-09-07: **25** registered `next-*` elements, 25 demo pages, 27
`src/app/api/embed/` route directories, 27 services.

## Structure

```
src/                           # Next.js 16 (App Router)
├── app/(demo)/                # Signed-in demo library (gates itself in layout.tsx)
├── app/api/auth/              # Better Auth [...all], app logout, session-tokens
├── app/api/embed/             # Widget API endpoints — one dir per widget, plus:
│   ├── auth/                  #   widget login: config, login, callback, exchange, logout, me
│   └── session/               #   mints the widget JWT
├── app/actions/               # Server actions (e.g. getMpTimezone)
├── components/                # App-side React: session-provider, sign-out-button, token-bridge/
├── lib/                       # auth.ts (Better Auth), auth-session.ts, auth-secondary-storage.ts,
│                              #   auth-profile-capture.ts, app-logout.ts, env.ts
├── lib/embed/                 # Widget auth (JWT, CORS, auth mode, encrypted server sessions, MP OAuth)
├── lib/providers/ministry-platform/  # MP REST API (MPHelper, models, auth)
├── proxy.ts                   # Deny-by-default route gate (isPublicPath)
└── services/                  # Singleton services wrapping MPHelper (one per widget domain)
packages/
├── embed-sdk/                 # @mpnext/embed-sdk (Vite library, ES output only)
│   ├── src/components/        # One `next-*` Web Component per widget, plus 5 `full-calendar-*`
│   │                          #   sub-modules (cards, list, mini-cal, modal, styles) that
│   │                          #   full-calendar.ts composes and that register no element
│   ├── src/shared/            # base-widget, api-client, auth-session, cdn-loader,
│   │                          #   form-validation, google-places, custom-form
│   └── demo-*.html            # Per-widget demo pages + index.html
└── types/                     # @mpnext/types (Zod schemas + TS interfaces)
public/embed-sdk/              # next-embed.js (stable loader) → content-hashed ES bundle,
                               #   sourcemap, mp-widget-overrides.css (hashed + unhashed)
scripts/                       # hash-sdk.js, copy-sdk.js, setup bootstrap
e2e/widget/                    # Playwright specs
.claude/TODO/                  # Numbered deferred work — read README.md there before "fixing" something
```

## Package Manager

**pnpm** (not npm). Use `pnpm add <pkg> --filter @mpnext/embed-sdk` for workspace packages.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Next.js **and** the Vite widget demo together (3000 + 5173) |
| `pnpm dev:next` | Next.js dev server only (port 3000) |
| `pnpm dev:sdk` | Watch-build embed SDK |
| `pnpm test:widget` | Same as `pnpm dev` (demo at http://localhost:5173) |
| `pnpm build` | Full build (SDK then Next.js) |
| `pnpm build:sdk` | Build the SDK, content-hash it, copy into `public/embed-sdk/` |
| `pnpm build:web` | Build Next.js only |
| `pnpm test` / `pnpm test:run` | Vitest (jsdom) — watch / single run |
| `pnpm test:coverage` | Vitest with v8 coverage |
| `pnpm test:e2e` / `pnpm test:e2e:widget` | Playwright |
| `pnpm lint` | ESLint |
| `pnpm setup` / `pnpm setup:check` | Interactive env bootstrap / validate `.env.local` |

## Testing

Unit and component tests are **Vitest on jsdom** (`vitest.config.mts`), colocated as
`*.test.ts(x)` next to the code. Run `pnpm test:run` before opening a PR; `pnpm lint`
must be clean. Playwright E2E lives in `e2e/widget/`. Manual widget testing via
`pnpm test:widget` (opens http://localhost:5173).

`@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toBeDisabled`,
`toHaveAttribute`, …) are available **and typed**: `src/test-setup.ts` imports
`@testing-library/jest-dom/vitest`, the vitest-specific entry that augments
`Assertion` in the `vitest` module, and that file is in the root tsconfig
`include`, so the augmentation covers every test in the program (including
`packages/*/src/**/*.test.ts`, which the package tsconfigs exclude). Prefer them
over `toBeTruthy()` / `toBeNull()` on DOM queries — the failure messages print
the element. Do not swap the import back to the bare `@testing-library/jest-dom`
entry: it only ships the jest namespace declarations, and every matcher then
fails `tsc --noEmit`.

**Playwright test account**: `PLAYWRIGHT_MP_USERNAME` / `PLAYWRIGHT_MP_PASSWORD` in `.env.local`. This is a non-admin MP OAuth user with **MFA disabled**.

**Dev auth**: Widget session auth is origin-based — no tenant id or init token. The `/api/embed/session` route validates the request origin against `EMBED_ALLOWED_ORIGINS` (`src/lib/embed/config.ts`). Local dev origins: `localhost:3000`, `localhost:5173` (and 127.0.0.1 variants).

**Auth mode locally**: `EMBED_AUTH_MODE` defaults to `legacy` (demo pages use `<mpp-user-login>` from MPWidgets.js). To exercise the hardened flow, set `EMBED_AUTH_MODE=dual` (or `EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual` to switch only the Vite demo) and register `http://localhost:3000/api/embed/auth/callback` as a redirect URI on the MP OAuth client. No `UPSTASH_REDIS_REST_URL` → in-memory session store, which works out of the box (it is kept on `globalThis` so the RSC and route-handler bundles share it and HMR does not sign you out); sessions reset when the dev server restarts. No Redis or loopback shim is needed to sign in locally. Demo pages show the resolved mode in a banner. `e2e/widget/login-hardened.spec.ts` runs the full login only when the Playwright creds are set and the mode is not `legacy`.

## Toolchain & Pinned Versions

Node **24** (`.nvmrc`, `engines.node: 24.x`, CI). TypeScript **6.0.3**, Next **16.3.4**,
React **19.2.8**, Better Auth **1.7.3**, Vitest **5** + `@vitest/coverage-v8` **5** on
jsdom **30**, ESLint **10.10.0**, chalk **6**. `eslint.config.mjs` carries a
version-detection workaround for `eslint-plugin-react`, which has no ESLint 10 support
yet (`.claude/TODO/18-*`). Two peer warnings on `pnpm install` are expected and filed
(`.claude/TODO/17-*`, `18-*`).

**One pin is deliberate — read the TODO before bumping it.** It was attempted and
reverted on 2026-09-07:

- `typescript` stays **6.0.3**. TS 7 is blocked upstream: `typescript-eslint` throws
  `does not support TS 7.0` inside `eslint-config-next`'s import chain, so `pnpm lint`
  fails outright. See `.claude/TODO/03-typescript-7.md`.

Do not bump `@types/node` past `^24.13.3` — it matches the Node 24 runtime.

**CDN assets carry SRI.** `loadScript(url, integrity?)` and
`injectExternalCSS(root, url, integrity?)`
(`packages/embed-sdk/src/shared/cdn-loader.ts`) set `integrity` and
`crossOrigin="anonymous"`. FullCalendar is the only CDN dependency left, and since
v7 it is **four** pinned URLs, each with its own `sha384-` hash, in the `FC_ASSETS`
table at the top of `full-calendar.ts`: `all/global.js`, then
`themes/<theme>/global.js` (ordered — the theme is an IIFE over
`FullCalendar.Shared`), plus `skeleton.css` and `themes/<theme>/theme.css`.
**Bumping `FC_VERSION` or `FC_THEME` means recomputing every hash in the same
edit** — a stale hash blocks the asset with no visible error of its own (a bad
script hash reads as "Failed to load calendar library."; a bad stylesheet hash
just renders unstyled).

Two rules go with that table. Use `all/global.js`, never `all/global.min.js`: v7
publishes no minified global bundle, so jsDelivr mints one on the fly and a hash
over it would pin CDN-generated bytes rather than author-published ones (the trap
`add-to-calendar-button` fell into, below). And do **not** load
`themes/<theme>/palette.css`: it declares every theme custom property on `:root`,
which never matches inside a shadow tree, while `theme.css` consumes them in 67 of
68 `var()` uses with no fallback — shipping it yields a calendar with no borders,
no today highlight, no event chips and no now-indicator. The `:host` block at the
top of `full-calendar-styles.ts` supplies that whole contract in brand colours
instead; keep it complete when bumping the version or theme.

**FullCalendar 7 emits no stable class names.** Its DOM carries build-generated
hashes (`fc-classic-wsy`, `fc-1h`, …), so a `.fc-*` selector matches nothing and a
patch release would re-break anything targeting one. Style the calendar through the
`--fc-classic-*` variables, through v7's `*Class` hook options (`eventClass`,
`dayCellClass` — v7 renamed `*ClassNames` to `*Class`), or through the stable
`data-date` / `aria-current="date"` attributes on day cells. Never through a class
name the library generated.

**`add-to-calendar-button` is gone (2026-09-08).** It was ELv2-licensed (not open
source; v3 is the paid line) and the URL the SDK loaded, jsDelivr's
`dist/atcb.min.js`, was **not a file in the npm tarball** — jsDelivr minified
`dist/atcb.js` on the fly, so `ATCB_SRI` pinned CDN-generated bytes
(`.claude/TODO/15`, now resolved). `packages/embed-sdk/src/shared/calendar-links.ts`
replaces it: pure builders for the Google / Outlook.com / Microsoft 365 / Yahoo
URL templates plus an RFC 5545 `.ics`, and `next-add-to-calendar` renders its own
dropdown. No CDN, no SRI, ~438KB less over the wire. Do not reintroduce a calendar
library — the whole surface is four query strings and a text file.

**Never join two template literals with `+`.** Turbopack's production minifier folds a
`+` chain of template literals whose interpolations are all compile-time constants and
**drops literal text** — an MP filter reached the API as
`Pertains_To_Page_ID=376From_Contact=142157`, and only from a deployed build (`next dev`,
`tsx`, and Vitest do not minify). Write one literal, or an array and `.join(...)`.
`src/lib/no-template-concat.test.ts` scans the repo and fails the run if the pattern
returns. Full incident and the "grep the built chunk" diagnostic:
`.claude/references/nextjs.build-hazards.md`.

## Widget Architecture

1. External site loads `/embed-sdk/next-embed.js` (the stable loader; it imports the content-hashed `next-embed.<hash>.es.js`) via `<script type="module">`. The demo pages and the customer copy-paste snippet use this path — never `next-embed.es.js`, which the build does not publish.
2. SDK auto-wires a token provider backed by the page-wide `AuthSession` (`MPNextEmbed.init()` overrides it)
3. `AuthSession` fetches `GET /api/embed/auth/config` once → mode for this origin (`legacy` on any failure)
4. Token ladder: `#nw_auth` handoff code → `POST /api/embed/auth/exchange` → `sid` (localStorage `nw_sid`; sessionStorage with `session-scope="tab"`); then `POST /api/embed/session { wid, sid }` → JWT v2; `401 invalid_session` clears the sid. Outside `hardened`, a valid legacy `mpp-widgets_AuthToken` is sent as `mpUserToken` (v1 in `legacy`; silent upgrade to a `sid` in `dual`). Otherwise a public JWT.
5. JWT (5-min expiry) is cached in memory until 30s before `exp`; widgets render in Shadow DOM and call the API with Bearer + auto-refresh on 401
6. Sign In (dual/hardened) = top-level redirect to `/api/embed/auth/login` → MP authorize → `/api/embed/auth/callback` creates the encrypted server session and returns to the page with `#nw_auth=<code>`

**Design**: Web Components + Shadow DOM (no framework deps), JWT+CORS auth, multi-tenant origin allowlists, MP tokens only in the encrypted server session (never in the JWT or host-page storage in `hardened`). Widget forms use the shared `packages/embed-sdk/src/shared/form-validation.ts` (no native `reportValidity` popup).

**The element roster** (25 as of 2026-09-07 — this is the one place it is listed; re-measure with the command in Overview rather than trusting it):
`next-add-to-calendar`, `next-checkout`, `next-checkout-complete`, `next-custom-form`,
`next-event-details`, `next-event-finder`, `next-full-calendar`, `next-group-details`,
`next-group-finder`, `next-my-contribution-statement`, `next-my-giving`,
`next-my-groups`, `next-my-household`, `next-my-invoices`, `next-my-pledges`,
`next-online-directory`, `next-opportunity-details`, `next-opportunity-finder`,
`next-pay`, `next-plan-your-visit`, `next-pledge-campaign`, `next-profile`,
`next-statement-preferences`, `next-subscriptions`, `next-user-menu`.

**MP widget styling**: `public/embed-sdk/mp-widget-overrides.css` injected into MP Shadow DOM widgets via `customcss` attribute. User-menu applies this automatically.

**MPWidgets.js is a loader, not a bundle.** On its own `DOMContentLoaded` handler it
scans the document for the widget tags it knows, fetches `/widgets/dist/<Widget>.js`
(the script that calls `customElements.define`) only for the tags it found, and
installs the `MutationObserver` that re-scans **after** an awaited CSRF round-trip in
that same handler. A tag inserted between those two is seen by neither, and
`customElements.whenDefined()` never resolves for it because MP was never told to load
it. Anything in this repo that injects an `mpp-*` tag after an async step must keep
poking the DOM until MP registers it -- `watchMpLoginRegistration()` in `user-menu.ts`
is the reference implementation (re-insert every 300ms, 6s budget, then warn). This is
not an origin/allowlist matter: MP paints on any origin, `localhost:5173` included.

## Services (src/services/)

One service per widget domain, all following the same singleton pattern:
`const svc = await ServiceName.getInstance()`. Each wraps `MPHelper` and is named
`<domain>Service.ts` (camelCase file name — the one place this repo does not use
kebab-case). Add a new widget's data access as a new service here rather than calling
`MPHelper` from a route. `ls src/services/` is the roster; there is no index to keep in
sync.

## MP Date/Time Handling

**Convert all date/time values at the MP boundary** — use `DomainTimezoneService` (never raw `new Date(x).toISOString()` or `getFullYear()`) when sending or receiving datetime fields, since MP stores wall-clock values in the domain's time zone, not UTC. Server-side, route writes/filters through `DomainTimezoneService.getInstance().toMpSqlDatetime(...)`. Client-side, format MP values with `Intl.DateTimeFormat({ timeZone })` using the IANA zone from `getMpTimezone()` (`src/app/actions/domain.ts`).

See **[Date/Time Handling Reference](.claude/references/ministryplatform.datetimehandling.md)**.

## Code Conventions

- **Named exports only** (no default exports)
- **React Server Components** by default; `"use client"` only when needed
- **TypeScript strict mode**; path alias `@/*` = `src/*`
- **Naming**: PascalCase (types/components), camelCase (functions), kebab-case (files), snake_case (MP fields). Exception: `src/services/*Service.ts` is camelCase.
- **No `+` between template literals** — one literal, or an array and `.join(...)`. The production minifier folds those chains and drops text (see Toolchain above); a guard test enforces it.

### Import Patterns
```typescript
import { MPHelper } from '@/lib/providers/ministry-platform';
import type { CalendarEvent } from '@mpnext/types';
```

### MPHelper
```typescript
const mp = new MPHelper();
await mp.getTableRecords({ table: 'Contacts', filter: '...' });
await mp.createTableRecords('TableName', [data], { schema: ZodSchema });
await mp.updateTableRecords('TableName', [data]);
await mp.executeProcedure('ProcName', { param: 'value' });
```

## Authentication

- **App auth (Better Auth)**: no `database` adapter on purpose; `secondaryStorage` points at the same Upstash Redis as the widget sessions (`src/lib/auth-secondary-storage.ts`, keys `nw:kv:ba:*`). Better Auth 1.7 serves the whole session path from there, so a sign-in survives a restart / cold start / instance switch; `user` + `account` rows stay ephemeral, which is fine because nothing persists data keyed by the Better Auth `user.id`. `session.cookieCache.maxAge` is **300s** (5 min). `UPSTASH_REDIS_REST_URL` / `_TOKEN` are **required in production** even in `legacy` widget mode — `getSessionStore()` throws there without them (opt out with `REDIS_ALLOW_MEMORY_FALLBACK=1`). The legacy `EMBED_SESSION_STORE_*` spellings are still read as a deprecated fallback.
- **App session reads** (`src/lib/auth-session.ts`): `getAuthoritativeSession(headers)` passes `disableCookieCache` and reads the store — **every authorization path must use it**, because the cookie cache would otherwise let a revoked session keep authorizing for up to 5 minutes. `getCachedSession(headers)` is the cheap read, for display-only surfaces. `GET /api/auth/get-session` is forced authoritative in `src/app/api/auth/[...all]/route.ts` via `forceAuthoritativeSessionRead(request)` — `customSession` attaches MP tokens there, so it is a credential hand-off, not a display read.
- **Profile fields**: `userGuid` / `imageGuid` are Better Auth `additionalFields` with `input: false`, so a client `updateUser` for either returns `FIELD_NOT_ALLOWED` (400) — that is the design, not a bug: `userGuid` is an authorization input, and a client that could set its own could impersonate another MP user. They are populated server-side by `databaseHooks` reading a request-scoped slot filled during the MP OAuth callback — `runWithMpProfileCapture` / `captureMpProfile` / `getCapturedMpProfile` in `src/lib/auth-profile-capture.ts`, wrapped around both Better Auth handlers.
- **App logout**: `src/lib/app-logout.ts` (`requestAppLogout()`) is the **only** client-side logout path — used by `src/components/sign-out-button.tsx` and by `TokenBridge`. It ends both the Better Auth session and the MP IdP session via `POST /api/auth/logout`, returns MP's `end_session` URL, and the caller must reach it by a **top-level navigation**. Never call Better Auth's `POST /api/auth/sign-out` directly: it ends only the app session, and MP signs the user straight back in.
- **Route gate**: `src/proxy.ts` is deny-by-default. `isPublicPath()` allowlists `/api`, `/signin`, `/demo`, `/embed-sdk`, matched as path **segments** (so a future `/demo-admin` stays gated). `/embed-sdk/` must stay exempt — host sites fetch those static files anonymously and cross-origin, and a redirect to `/signin` hands them HTML where a JS module or stylesheet was expected.
- **Widget auth**: JWT (jose HS256, `iss`/`aud`, 5-min expiry, `origin` claim must match the request origin) with tenant-based CORS. `requireWidgetAuth(req, { widget: 'name' })` in API routes. Claims `ver: 2` carry an opaque `sid` (server session); `ver: 1` (legacy) carry `mpAccessToken`. Routes only read `claims.sub`; the ones that need the user's own MP token call `getMpUserAccessToken(claims)` (`src/lib/embed/embed-session.ts`), which handles both versions and refreshes via MP under a store lock.
- **Auth mode**: `resolveAuthMode(origin)` (`src/lib/embed/auth-mode.ts`) from `EMBED_AUTH_MODE` (`legacy` default | `dual` | `hardened`) with `EMBED_AUTH_MODE_ORIGINS` per-origin overrides. `legacy`: `mpUserToken` only. `dual`: `sid` or `mpUserToken` (silent upgrade returns a `sid`). `hardened`: `sid` only. Server setting; the SDK discovers it via `GET /api/embed/auth/config`.
- **Server sessions**: `EmbedSessionRecord` keyed by `sha256(sid)` in `EmbedSessionStore` (Upstash Redis REST via `UPSTASH_REDIS_REST_URL`, else in-memory — required in production, where `getSessionStore()` throws without it unless `REDIS_ALLOW_MEMORY_FALLBACK=1`). MP access/refresh/id tokens sealed with AES-256-GCM (`EMBED_SESSION_ENC_KEY`). Sliding idle + absolute TTLs. One-time 60s handoff codes bridge the OAuth callback to the SDK (`#nw_auth` fragment, never a query string).
- **Login routes** (`src/app/api/embed/auth/`): `login` (validates origin + same-origin `return_to`, signed state cookie `nw_oauth_state`, 302 to MP) → `callback` (state check, code exchange, userinfo, create session, handoff) → `exchange` (POST, single-use, origin-bound). `logout` deletes the session and returns the MP end-session URL; `me` reports the signed-in user for a v2 token. `login`/`callback` are top-level navigations (no CORS). Unauthenticated routes are rate-limited per IP (`checkRateLimit`).
- **MP OAuth client**: register `https://<widget-host>/api/embed/auth/callback` as redirect URI and `${BETTER_AUTH_URL}/signin` as the **only** post-logout URI. Host-site origins are deliberately **never** registered and never sent to MP: MP refuses to complete an end-session whose `post_logout_redirect_uri` it does not recognise (drops `id_token_hint`, shows a "Would you like to logout?" prompt, leaves the SSO session alive), and an embed SDK cannot enumerate its host pages. `buildEndSessionUrl()` is the one server-side builder and takes no destination argument. Embedded visitors get home via the widget host's own bounce — `src/lib/embed/logout-return.ts`: a sealed ticket → `GET /api/embed/auth/logout?t=` sets `nw_logout_return` → MP → `/signin`, where `src/proxy.ts` spends the cookie. `legacy` (browser-built end-session URL) uses the registered URI, advertised by `/api/embed/auth/config`. `EMBED_OAUTH_PKCE` off by default. `EMBED_PUBLIC_URL` pins the host used in `redirect_uri` behind proxies.
- **Never** log token material, write `mpp-widgets_*` from the SDK outside `legacy`, or add new npm deps for this (jose + WebCrypto are available). Full plan: `WIDGET-AUTH-MIGRATION-PLAN.md`; runbook in README "Widget Authentication".

## Brand Colors

| Role | Color | Hex |
|------|-------|-----|
| Primary | Blue | `#004C97` |
| Black | Text | `#2D2926` |
| Accent | Gold | `#F1BE48` |
| Secondary | Navy | `#002855` |
| Info | Light Blue | `#009CDE` |
| Success | Green | `#86AD3F` |
| Error | Coral | `#FF6D6A` |

## Key Files

| File | Purpose |
|------|---------|
| `src/proxy.ts` | Deny-by-default route gate; `isPublicPath()` (segment-aware) and the `nw_logout_return` landing |
| `src/lib/auth.ts` | Better Auth config: `secondaryStorage`, 300s `cookieCache`, `input: false` additional fields, `databaseHooks` |
| `src/lib/auth-session.ts` | `getAuthoritativeSession()` (store read -- use on authorization paths), `getCachedSession()`, `forceAuthoritativeSessionRead()` |
| `src/lib/auth-profile-capture.ts` | Request-scoped `userGuid`/`imageGuid` slot: `runWithMpProfileCapture`, `captureMpProfile`, `getCapturedMpProfile` |
| `src/lib/auth-secondary-storage.ts` | Better Auth `secondaryStorage` over the embed session store (`nw:kv:ba:*`) -- why the app runs with no `database` adapter |
| `src/lib/app-logout.ts` | `requestAppLogout()` + `clearMpWidgetStorage()` / `MP_WIDGET_STORAGE_KEYS` -- the single client-side logout path |
| `src/components/sign-out-button.tsx` | `SignOutButton` -- must be a button (Better Auth `/sign-out` is POST-only); calls `requestAppLogout` |
| `src/app/api/auth/[...all]/route.ts` | Better Auth handlers wrapped in profile capture + forced-authoritative `get-session` |
| `src/app/api/auth/logout/route.ts` | App logout endpoint: `auth.api.signOut()` + MP `end_session` URL with `id_token_hint` |
| `src/lib/embed/auth.ts` | `requireWidgetAuth()` -- accepts `widget: string \| string[]`; `isOriginAllowed()` (https-only wildcards), `getClientIp()` |
| `src/lib/embed/auth-mode.ts` | `resolveAuthMode(origin)` / `parseAuthModeOverrides()` -- `EMBED_AUTH_MODE` + per-origin overrides |
| `src/lib/embed/config.ts` | Tenant configs & allowed origins |
| `src/lib/embed/jwt.ts` | Widget JWT (jose) create/verify + `signStateToken`/`verifyStateToken` for the OAuth state cookie |
| `src/lib/embed/crypto.ts` | AES-256-GCM `seal`/`open`, `randomToken`, `sha256Hex`, `timingSafeEqualStr` |
| `src/lib/embed/session-store.ts` | `EmbedSessionStore` interface; `MemorySessionStore`, `UpstashSessionStore`, `getSessionStore()` (singleton on `globalThis` -- the App Router evaluates this file once per bundle; must be Upstash in production, where it throws otherwise); generic `kv*` KV under `nw:kv:` |
| `src/lib/embed/embed-session.ts` | `createEmbedSession`/`getEmbedSession`/`deleteEmbedSession`, handoff codes, `getMpUserAccessToken(claims)` with refresh lock |
| `src/lib/embed/mp-oauth.ts` | MP OpenID endpoints, `buildAuthorizeUrl`, `exchangeAuthorizationCode`, `fetchMpUserinfo` (60s cache), `buildEndSessionUrl` (+ `getRegisteredPostLogoutRedirectUri`), PKCE |
| `src/lib/embed/logout-return.ts` | Sealed return ticket + `nw_logout_return` cookie: gets an embedded visitor back to their church page without registering it with MP |
| `src/lib/embed/rate-limit.ts` | `checkRateLimit(key)` fixed 60s window on the session store |
| `src/lib/embed/types.ts` | `WidgetClaims` (v1/v2), `EmbedAuthMode`, `EmbedSessionRecord`, session request/response types |
| `src/app/api/embed/auth/*` | `config`, `login`, `callback`, `exchange`, `logout`, `me` routes (see Authentication) |
| `src/app/api/embed/session/route.ts` | Mints widget JWTs from `sid`, legacy `mpUserToken`, same-origin Better Auth session, or public |
| `packages/embed-sdk/src/index.ts` | SDK entry point -- registers widgets, token provider via `AuthSession`, `window.MPNextEmbed = { init, getAuthSession }` |
| `packages/embed-sdk/src/shared/auth-session.ts` | `AuthSession` singleton: mode discovery, `nw_sid` storage, `#nw_auth` handoff, JWT cache, `login`/`logout`/`me`/`onChange` |
| `packages/embed-sdk/src/shared/base-widget.ts` | Abstract base class (Shadow DOM, token mgmt, fetch, `requestLogin()` → cancelable `loginRequired` then `authSession.login`) |
| `packages/embed-sdk/src/shared/cdn-loader.ts` | `loadScript(url, integrity?)` / `injectExternalCSS(root, url, integrity?)` -- SRI + `crossOrigin="anonymous"` for all four FullCalendar CDN assets |
| `packages/embed-sdk/src/shared/form-validation.ts` | Shared widget form validation (no native `reportValidity` popup) |
| `packages/embed-sdk/src/components/user-menu.ts` | Mode branches: `legacy` (MPWidgets.js `<mpp-user-login>`, REAUTH) vs `dual`/`hardened` (own Sign In, `/auth/me`, `/auth/logout`). `watchMpLoginRegistration()` re-inserts `<mpp-user-login>` until MPWidgets.js registers it -- both `legacy` and `dual` + `prefer-mp-login` bootstrap through that one watch (see MP widget styling below) |
| `packages/embed-sdk/src/components/full-calendar.ts` | Largest widget; composes the five `full-calendar-*` sub-modules and carries `FC_ASSETS` -- the four pinned FullCalendar 7 URLs and their hashes |
| `packages/embed-sdk/vite.config.ts` | Vite library mode (ES output only) + the canonical customer setup snippet injected into every demo page |
| `scripts/hash-sdk.js`, `scripts/copy-sdk.js` | Content-hash the SDK bundle and publish it plus the stable `next-embed.js` loader into `public/embed-sdk/`; `copy-sdk` deletes every build-owned file there that the current build did not emit (`mp-widget-overrides.css` is exempt — it is `hash-sdk`'s tracked **input**, and `hash-sdk` exits non-zero if it is missing) |
| `e2e/widget/login-hardened.spec.ts` | Playwright: full widget sign-in/out; skips unless creds set and mode != legacy |
| `WIDGET-AUTH-MIGRATION-PLAN.md` | Legacy → hardened migration plan, phases, per-customer cutover runbook |
| `public/embed-sdk/mp-widget-overrides.css` | Brand CSS for MP Shadow DOM widgets |
| `.claude/TODO/README.md` | Numbered deferred work + what was already attempted and reverted -- read before a dependency bump |
| `.claude/references/ministryplatform.query-syntax.md` | MP REST API query syntax reference (`$filter`, `$select`, `_TABLE` traversal) |
| `.claude/references/ministryplatform.datetimehandling.md` | How to send/receive MP datetimes safely via `DomainTimezoneService`, anti-patterns, Windows↔IANA mapping, test guidance |
| `.claude/references/nextjs.build-hazards.md` | Faults that exist only in a minified production build — the `+`-joined template-literal fold, and how to grep the built chunk |
| `src/lib/no-template-concat.test.ts` | Repo-wide guard: fails if any source file joins two template literals with `+` |
| `src/services/domainTimezoneService.ts` | Singleton: MP domain TZ → IANA, `toMpSqlDatetime`, `parseMpDatetime` |
| `src/app/actions/domain.ts` | `getMpTimezone()` server action for client-side `Intl.DateTimeFormat` rendering |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
