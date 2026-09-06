# CLAUDE.md - MPNext-Widgets

## Overview

**pnpm monorepo**: Component-only embed SDK extraction. Contains 5 embed SDK widgets (user-menu, add-to-calendar, full-calendar, profile, my-invoices) with their supporting API routes, services, and shared types. The embed SDK builds framework-agnostic Web Components (Shadow DOM) loaded via `<script>` on external sites.

## Structure

```
src/                           # Next.js 16 (App Router)
├── app/api/embed/             # Widget API endpoints (subset for 5 widgets)
│   └── auth/                  # Widget login: config, login, callback, exchange, logout, me
├── services/                  # Singleton services (addToCalendar, fullCalendar, profile, subscription, user, invoice, domainTimezone)
├── lib/embed/                 # Widget auth (JWT, CORS, auth mode, encrypted server sessions, MP OAuth)
├── lib/providers/ministry-platform/  # MP REST API (MPHelper, models, auth)
packages/
├── embed-sdk/                 # @mpnext/embed-sdk (Vite library)
│   ├── src/components/        # 5 Web Components (next-* custom elements)
│   ├── src/shared/            # base-widget.ts, api-client.ts, cdn-loader.ts, auth-session.ts
│   └── demo-*.html            # Per-widget demo pages + index.html
└── types/                     # @mpnext/types (Zod schemas + TS interfaces)
public/embed-sdk/              # Deployed bundles (ES + UMD), mp-widget-overrides.css
```

## Package Manager

**pnpm** (not npm). Use `pnpm add <pkg> --filter @mpnext/embed-sdk` for workspace packages.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Next.js dev server (port 3000) |
| `pnpm dev:sdk` | Watch-build embed SDK |
| `pnpm test:widget` | Launch Next.js + Vite demo together |
| `pnpm build` | Full build (SDK then Next.js) |
| `pnpm build:sdk` | Build embed SDK only |
| `pnpm build:web` | Build Next.js only |
| `pnpm lint` | ESLint |

## Testing

Manual widget testing via `pnpm test:widget` (opens http://localhost:5173). Playwright E2E tests also available.

**Playwright test account**: `PLAYWRIGHT_MP_USERNAME` / `PLAYWRIGHT_MP_PASSWORD` in `.env.local`. This is a non-admin MP OAuth user with **MFA disabled**.

**Dev auth**: Widget session auth is origin-based — no tenant id or init token. The `/api/embed/session` route validates the request origin against `EMBED_ALLOWED_ORIGINS` (`src/lib/embed/config.ts`). Local dev origins: `localhost:3000`, `localhost:5173` (and 127.0.0.1 variants).

**Auth mode locally**: `EMBED_AUTH_MODE` defaults to `legacy` (demo pages use `<mpp-user-login>` from MPWidgets.js). To exercise the hardened flow, set `EMBED_AUTH_MODE=dual` (or `EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual` to switch only the Vite demo) and register `http://localhost:3000/api/embed/auth/callback` as a redirect URI on the MP OAuth client. No `EMBED_SESSION_STORE_URL` → in-memory session store (sessions reset with the dev server). Demo pages show the resolved mode in a banner. `e2e/widget/login-hardened.spec.ts` runs the full login only when the Playwright creds are set and the mode is not `legacy`.

## Widget Architecture

1. External site loads `next-embed.es.js` via `<script type="module">`
2. SDK auto-wires a token provider backed by the page-wide `AuthSession` (`MPNextEmbed.init()` overrides it)
3. `AuthSession` fetches `GET /api/embed/auth/config` once → mode for this origin (`legacy` on any failure)
4. Token ladder: `#nw_auth` handoff code → `POST /api/embed/auth/exchange` → `sid` (localStorage `nw_sid`; sessionStorage with `session-scope="tab"`); then `POST /api/embed/session { wid, sid }` → JWT v2; `401 invalid_session` clears the sid. Outside `hardened`, a valid legacy `mpp-widgets_AuthToken` is sent as `mpUserToken` (v1 in `legacy`; silent upgrade to a `sid` in `dual`). Otherwise a public JWT.
5. JWT (5-min expiry) is cached in memory until 30s before `exp`; widgets render in Shadow DOM and call the API with Bearer + auto-refresh on 401
6. Sign In (dual/hardened) = top-level redirect to `/api/embed/auth/login` → MP authorize → `/api/embed/auth/callback` creates the encrypted server session and returns to the page with `#nw_auth=<code>`

**Design**: Web Components + Shadow DOM (no framework deps, ~33KB gzip), JWT+CORS auth, multi-tenant origin allowlists, MP tokens only in the encrypted server session (never in the JWT or host-page storage in `hardened`).

**5 widgets**: `next-user-menu`, `next-add-to-calendar`, `next-full-calendar`, `next-profile`, `next-my-invoices`

**MP widget styling**: `public/embed-sdk/mp-widget-overrides.css` injected into MP Shadow DOM widgets via `customcss` attribute. User-menu applies this automatically.

## Services (src/services/)

All services follow singleton pattern: `const svc = await ServiceName.getInstance()`. Each wraps `MPHelper`.

Services: `addToCalendar`, `fullCalendar`, `profile`, `subscription`, `user`, `invoice`, `domainTimezone`

## MP Date/Time Handling

**Convert all date/time values at the MP boundary** — use `DomainTimezoneService` (never raw `new Date(x).toISOString()` or `getFullYear()`) when sending or receiving datetime fields, since MP stores wall-clock values in the domain's time zone, not UTC. Server-side, route writes/filters through `DomainTimezoneService.getInstance().toMpSqlDatetime(...)`. Client-side, format MP values with `Intl.DateTimeFormat({ timeZone })` using the IANA zone from `getMpTimezone()` (`src/app/actions/domain.ts`).

See **[Date/Time Handling Reference](.claude/references/ministryplatform.datetimehandling.md)**.

## Code Conventions

- **Named exports only** (no default exports)
- **React Server Components** by default; `"use client"` only when needed
- **TypeScript strict mode**; path alias `@/*` = `src/*`
- **Naming**: PascalCase (types/components), camelCase (functions), kebab-case (files), snake_case (MP fields)

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

- **Widget auth**: JWT (jose HS256, `iss`/`aud`, 5-min expiry, `origin` claim must match the request origin) with tenant-based CORS. `requireWidgetAuth(req, { widget: 'name' })` in API routes. Claims `ver: 2` carry an opaque `sid` (server session); `ver: 1` (legacy) carry `mpAccessToken`. Routes only read `claims.sub`; the two that need the user's own MP token call `getMpUserAccessToken(claims)` (`src/lib/embed/embed-session.ts`), which handles both versions and refreshes via MP under a store lock.
- **Auth mode**: `resolveAuthMode(origin)` (`src/lib/embed/auth-mode.ts`) from `EMBED_AUTH_MODE` (`legacy` default | `dual` | `hardened`) with `EMBED_AUTH_MODE_ORIGINS` per-origin overrides. `legacy`: `mpUserToken` only. `dual`: `sid` or `mpUserToken` (silent upgrade returns a `sid`). `hardened`: `sid` only. Server setting; the SDK discovers it via `GET /api/embed/auth/config`.
- **Server sessions**: `EmbedSessionRecord` keyed by `sha256(sid)` in `EmbedSessionStore` (Upstash Redis REST via `EMBED_SESSION_STORE_URL`, else in-memory). MP access/refresh/id tokens sealed with AES-256-GCM (`EMBED_SESSION_ENC_KEY`). Sliding idle + absolute TTLs. One-time 60s handoff codes bridge the OAuth callback to the SDK (`#nw_auth` fragment, never a query string).
- **Login routes** (`src/app/api/embed/auth/`): `login` (validates origin + same-origin `return_to`, signed state cookie `nw_oauth_state`, 302 to MP) → `callback` (state check, code exchange, userinfo, create session, handoff) → `exchange` (POST, single-use, origin-bound). `logout` deletes the session and returns the MP end-session URL; `me` reports the signed-in user for a v2 token. `login`/`callback` are top-level navigations (no CORS). Unauthenticated routes are rate-limited per IP (`checkRateLimit`).
- **MP OAuth client**: register `https://<widget-host>/api/embed/auth/callback` as redirect URI and each host-site origin as post-logout URI. `EMBED_OAUTH_PKCE` off by default. `EMBED_PUBLIC_URL` pins the host used in `redirect_uri` behind proxies.
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
| `src/lib/embed/auth.ts` | `requireWidgetAuth()` -- accepts `widget: string \| string[]`; `isOriginAllowed()` (https-only wildcards), `getClientIp()` |
| `src/lib/embed/auth-mode.ts` | `resolveAuthMode(origin)` / `parseAuthModeOverrides()` -- `EMBED_AUTH_MODE` + per-origin overrides |
| `src/lib/embed/config.ts` | Tenant configs & allowed origins |
| `src/lib/embed/jwt.ts` | Widget JWT (jose) create/verify + `signStateToken`/`verifyStateToken` for the OAuth state cookie |
| `src/lib/embed/crypto.ts` | AES-256-GCM `seal`/`open`, `randomToken`, `sha256Hex`, `timingSafeEqualStr` |
| `src/lib/embed/session-store.ts` | `EmbedSessionStore` interface; `MemorySessionStore`, `UpstashSessionStore`, `getSessionStore()` |
| `src/lib/embed/embed-session.ts` | `createEmbedSession`/`getEmbedSession`/`deleteEmbedSession`, handoff codes, `getMpUserAccessToken(claims)` with refresh lock |
| `src/lib/embed/mp-oauth.ts` | MP OpenID endpoints, `buildAuthorizeUrl`, `exchangeAuthorizationCode`, `fetchMpUserinfo` (60s cache), `buildEndSessionUrl`, PKCE |
| `src/lib/embed/rate-limit.ts` | `checkRateLimit(key)` fixed 60s window on the session store |
| `src/lib/embed/types.ts` | `WidgetClaims` (v1/v2), `EmbedAuthMode`, `EmbedSessionRecord`, session request/response types |
| `src/app/api/embed/auth/*` | `config`, `login`, `callback`, `exchange`, `logout`, `me` routes (see Authentication) |
| `src/app/api/embed/session/route.ts` | Mints widget JWTs from `sid`, legacy `mpUserToken`, same-origin Better Auth session, or public |
| `packages/embed-sdk/src/index.ts` | SDK entry point -- registers widgets, token provider via `AuthSession`, `window.MPNextEmbed = { init, getAuthSession }` |
| `packages/embed-sdk/src/shared/auth-session.ts` | `AuthSession` singleton: mode discovery, `nw_sid` storage, `#nw_auth` handoff, JWT cache, `login`/`logout`/`me`/`onChange` |
| `packages/embed-sdk/src/shared/base-widget.ts` | Abstract base class (Shadow DOM, token mgmt, fetch, `requestLogin()` → cancelable `loginRequired` then `authSession.login`) |
| `packages/embed-sdk/src/components/user-menu.ts` | Mode branches: `legacy` (MPWidgets.js `<mpp-user-login>`, REAUTH) vs `dual`/`hardened` (own Sign In, `/auth/me`, `/auth/logout`) |
| `e2e/widget/login-hardened.spec.ts` | Playwright: full widget sign-in/out; skips unless creds set and mode != legacy |
| `WIDGET-AUTH-MIGRATION-PLAN.md` | Legacy → hardened migration plan, phases, per-customer cutover runbook |
| `packages/embed-sdk/vite.config.ts` | Vite library mode (ES + UMD output) |
| `public/embed-sdk/mp-widget-overrides.css` | Brand CSS for MP Shadow DOM widgets |
| `.claude/references/ministryplatform.query-syntax.md` | MP REST API query syntax reference (`$filter`, `$select`, `_TABLE` traversal) |
| `.claude/references/ministryplatform.datetimehandling.md` | How to send/receive MP datetimes safely via `DomainTimezoneService`, anti-patterns, Windows↔IANA mapping, test guidance |
| `src/services/domainTimezoneService.ts` | Singleton: MP domain TZ → IANA, `toMpSqlDatetime`, `parseMpDatetime` |
| `src/app/actions/domain.ts` | `getMpTimezone()` server action for client-side `Intl.DateTimeFormat` rendering |
