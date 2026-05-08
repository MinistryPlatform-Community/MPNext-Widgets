# MPNext-Widgets

Embeddable Web Component widgets for [Ministry Platform](https://www.ministryplatform.com/), shipped as a framework-agnostic SDK that can be loaded via `<script>` on any external site.

This repo is a **pnpm monorepo** containing:

- A Next.js 16 app (`src/`) hosting the widget API endpoints, OAuth login, and a demo gallery.
- `@mpnext/embed-sdk` (`packages/embed-sdk/`) — the Web Components bundle (`next-user-menu`, `next-add-to-calendar`, `next-full-calendar`, `next-profile`, `next-my-invoices`).
- `@mpnext/types` (`packages/types/`) — shared Zod schemas and TypeScript types.

## Quick start

> Requires Node.js 18+ and **pnpm** (the repo declares `packageManager: pnpm@10.x` and a `preinstall` guard will refuse `npm install` / `yarn install`).

```bash
git clone https://github.com/MinistryPlatform-Community/MPNext-Widgets.git
cd MPNext-Widgets

# Interactive setup: prompts for MP host, OAuth client, secrets, then
# installs deps, generates MP types, and builds the project.
pnpm setup

# Or, set things up manually:
cp .env.example .env.local
# …fill in .env.local…
pnpm install
pnpm dev          # runs Next.js + the SDK demo together (ports 3000 + 5173)
```

To verify your environment without making changes:

```bash
pnpm setup:check
```

## Common commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server + SDK demo (concurrently) |
| `pnpm dev:next` | Next.js only (port 3000) |
| `pnpm dev:sdk` | Watch-build the embed SDK |
| `pnpm build` | Full production build (SDK then Next.js) |
| `pnpm lint` | ESLint |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm mp:generate:models` | Regenerate Ministry Platform table types from your tenant |

## Environment variables

See [`.env.example`](./.env.example) for the full list with inline documentation. At minimum you need:

- **OAuth login**: `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
- **Ministry Platform API**: `MINISTRY_PLATFORM_BASE_URL`, `MINISTRY_PLATFORM_CLIENT_ID`, `MINISTRY_PLATFORM_CLIENT_SECRET`
- **Embed widgets**: `EMBED_JWT_SECRET`, `EMBED_ALLOWED_ORIGINS`

A few values (`DEMO_ACCESS_GROUP_IDS`, `CALENDAR_ADMIN_GROUP_IDS`) gate access to staff-only features and currently fall back to Northwoods-specific MP group IDs if unset — set them for your own tenant.

## Architecture

External site → loads `next-embed.es.js` via `<script type="module">` → `MPNextEmbed.init()` registers a token provider → widgets render in Shadow DOM and call `/api/embed/*` with a short-lived JWT (5-min expiry, auto-refreshed on 401).

See [`CLAUDE.md`](./CLAUDE.md) for deeper architecture notes (services, MP integration, conventions, brand colors).
