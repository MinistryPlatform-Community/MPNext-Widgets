# CLAUDE.md - MPNext-Components

## Overview

**pnpm monorepo**: Component-only embed SDK extraction. Contains 3 embed SDK widgets (user-menu, add-to-calendar, full-calendar) with their supporting API routes, services, and shared types. The embed SDK builds framework-agnostic Web Components (Shadow DOM) loaded via `<script>` on external sites.

## Structure

```
src/                           # Next.js 16 (App Router)
├── app/api/embed/             # Widget API endpoints (subset for 3 widgets)
├── services/                  # Singleton services (addToCalendar, fullCalendar, profile, subscription, user)
├── lib/embed/                 # Widget auth (JWT, CORS, tenant config)
├── lib/providers/ministry-platform/  # MP REST API (MPHelper, models, auth)
packages/
├── embed-sdk/                 # @mpnext/embed-sdk (Vite library)
│   ├── src/components/        # 3 Web Components (next-* custom elements)
│   ├── src/shared/            # base-widget.ts, api-client.ts, cdn-loader.ts
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

## Widget Architecture

1. External site loads `nw-embed.es.js` via `<script type="module">`
2. `MPNextEmbed.init()` sets token provider
3. Token provider fetches JWT (5-min expiry) from `/api/embed/session`
4. Widgets render in Shadow DOM; API calls use Bearer token with auto-refresh on 401

**Design**: Web Components + Shadow DOM (no framework deps, ~5KB gzip), JWT+CORS auth, multi-tenant origin allowlists.

**3 widgets**: `next-user-menu`, `next-add-to-calendar`, `next-full-calendar`

**MP widget styling**: `public/embed-sdk/mp-widget-overrides.css` injected into MP Shadow DOM widgets via `customcss` attribute. User-menu applies this automatically.

## Services (src/services/)

All services follow singleton pattern: `const svc = await ServiceName.getInstance()`. Each wraps `MPHelper`.

Services: `addToCalendar`, `fullCalendar`, `profile`, `subscription`, `user`, `domainTimezone`

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

- **Widget auth**: Custom JWT (HS256, 5-min expiry) with tenant-based CORS. `requireWidgetAuth(req, { widget: 'name' })` in API routes.

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
| `src/lib/embed/auth.ts` | `requireWidgetAuth()` -- accepts `widget: string \| string[]` |
| `src/lib/embed/config.ts` | Tenant configs & allowed origins |
| `src/lib/embed/jwt.ts` | Widget JWT creation/verification |
| `packages/embed-sdk/src/index.ts` | SDK entry point -- registers 3 widgets |
| `packages/embed-sdk/src/shared/base-widget.ts` | Abstract base class (Shadow DOM, token mgmt, fetch) |
| `packages/embed-sdk/vite.config.ts` | Vite library mode (ES + UMD output) |
| `public/embed-sdk/mp-widget-overrides.css` | Brand CSS for MP Shadow DOM widgets |
| `.claude/references/ministryplatform.query-syntax.md` | MP REST API query syntax reference (`$filter`, `$select`, `_TABLE` traversal) |
| `.claude/references/ministryplatform.datetimehandling.md` | How to send/receive MP datetimes safely via `DomainTimezoneService`, anti-patterns, Windows↔IANA mapping, test guidance |
| `src/services/domainTimezoneService.ts` | Singleton: MP domain TZ → IANA, `toMpSqlDatetime`, `parseMpDatetime` |
| `src/app/actions/domain.ts` | `getMpTimezone()` server action for client-side `Intl.DateTimeFormat` rendering |
