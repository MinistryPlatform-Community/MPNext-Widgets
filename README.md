# MPNext-Widgets

[![Release](https://img.shields.io/github/v/release/MinistryPlatform-Community/MPNext-Widgets?logo=github)](https://github.com/MinistryPlatform-Community/MPNext-Widgets/releases/latest)
[![Tests](https://github.com/MinistryPlatform-Community/MPNext-Widgets/actions/workflows/test.yml/badge.svg)](https://github.com/MinistryPlatform-Community/MPNext-Widgets/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/MinistryPlatform-Community/MPNext-Widgets/graph/badge.svg)](https://codecov.io/gh/MinistryPlatform-Community/MPNext-Widgets)

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![pnpm](https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Web Components](https://img.shields.io/badge/Web_Components-Shadow_DOM-29ABE2?logo=webcomponents.org&logoColor=white)](https://www.webcomponents.org/)
[![Zod](https://img.shields.io/badge/Zod-v4-3E67B1?logo=zod&logoColor=white)](https://zod.dev/)

Embeddable Web Component widgets for [Ministry Platform](https://www.ministryplatform.com/), shipped as a framework-agnostic SDK that can be dropped onto any external site via `<script>`. The Next.js app provides the backing API endpoints, OAuth login, and a demo gallery.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
  - [Quick Setup with Claude Code](#quick-setup-with-claude-code)
  - [Manual Setup](#manual-setup)
  - [OAuth Setup](#oauth-setup)
- [Project Structure](#project-structure)
- [Widgets](#widgets)
- [Ministry Platform Integration](#ministry-platform-integration)
- [Services](#services)
- [Embedding on an External Site](#embedding-on-an-external-site)
- [Testing](#testing)
- [Development](#development)
- [Claude Code Commands](#claude-code-commands)
- [Documentation](#documentation)
- [Code Style & Conventions](#code-style--conventions)

## Features

- **Five embeddable widgets**: `next-user-menu`, `next-add-to-calendar`, `next-full-calendar`, `next-profile`, `next-my-invoices` — each a framework-agnostic Web Component rendered in Shadow DOM
- **Framework-agnostic SDK**: Single `<script type="module">` tag loads `next-embed.es.js`; no React, jQuery, or build tooling required on the host site
- **Multi-tenant JWT auth**: Short-lived (5-min) widget JWTs (HS256) with per-tenant CORS allowlists, auto-refresh on 401, idempotency keys
- **Authentication**: Better Auth with Ministry Platform OAuth (via `genericOAuth` plugin) and OIDC RP-initiated logout
- **Type-Safe API**: Shared `@mpnext/types` package with Zod schemas + TypeScript types used on both sides of the wire
- **Next.js 16**: App Router with React Server Components, Turbopack, and a demo gallery for every widget
- **Cache-busting loader**: `next-embed.js` redirects to a hashed bundle so external pages always pick up the latest build
- **MP type generation**: CLI tool generates TypeScript interfaces and Zod schemas from your Ministry Platform database schema (300+ tables)
- **Playwright E2E**: End-to-end widget tests against a real Next.js + Vite demo stack

## Architecture

### Framework
- **Next.js 16** with App Router and Turbopack (host app + embed API endpoints)
- **React 19** with Server Components by default
- **TypeScript 6** in strict mode across all packages
- **Tailwind CSS v4** for the host app and demo gallery
- **Vite 8** library mode for the embed SDK (ES + UMD output)
- **pnpm 10** workspaces (3 packages: app, `@mpnext/embed-sdk`, `@mpnext/types`)

### Widget Embed Flow

```
External site
   │  <script type="module" src="https://your-host.com/embed-sdk/next-embed.js">
   ▼
next-embed.js (loader)        Reads x-sdk-hash header, redirects to next-embed.<hash>.es.js
   │
   ▼
next-embed.<hash>.es.js       Auto-registers <next-*> custom elements
   │                          Auto-wires a token provider → POST /api/embed/session
   ▼
<next-user-menu> etc.         Renders in Shadow DOM
   │                          Bearer-authenticates calls to /api/embed/* with a 5-min JWT
   ▼
/api/embed/*                  requireWidgetAuth() → MP REST API via MPHelper
```

### Ministry Platform Integration
Custom provider at `src/lib/providers/ministry-platform/`:
- REST API client with client-credentials OAuth2 and automatic token refresh
- Service-oriented design: Table, Procedure, Communication, File, Metadata, Domain
- Type-safe models and Zod schemas generated from your tenant
- Public entry point: `MPHelper`

### Authentication

Two layers, used by different surfaces:

| Surface | Auth | Where |
|---|---|---|
| Next.js app (sign in, demo gallery) | Better Auth + MP OAuth (`genericOAuth`) | `src/lib/auth.ts`, route protection via `src/proxy.ts` |
| Embed widgets on external sites | Custom HS256 JWT (5-min expiry) + CORS allowlist | `src/lib/embed/{auth,jwt,config}.ts` |

## Prerequisites

- **Node.js**: v18 or higher
- **Package Manager**: **pnpm 10.x** (the `preinstall` guard refuses `npm install` / `yarn install`)
- **Ministry Platform**: Active instance with API credentials and an OAuth client configured (see [OAuth Setup](#oauth-setup))

## Getting Started

### Quick Setup with Claude Code

If you have [Claude Code](https://claude.ai/code) installed, the setup process is automated:

```bash
git clone https://github.com/MinistryPlatform-Community/MPNext-Widgets.git
cd MPNext-Widgets
pnpm setup
```

The interactive setup command will:
1. Verify Node.js version (v18+ required)
2. Check git status
3. Create `.env.local` from `.env.example` (if needed)
4. Prompt for missing environment variables (MP host, OAuth client, secrets)
5. Auto-generate `BETTER_AUTH_SECRET` and `EMBED_JWT_SECRET` (optional)
6. Install workspace dependencies
7. Generate Ministry Platform types
8. Run a production build to verify configuration

**Additional setup options:**
```bash
pnpm setup:check            # Validation only (no changes)
pnpm setup -- --clean       # Clean install (delete node_modules first)
pnpm setup -- --skip-install # Skip pnpm install/update
pnpm setup -- --verbose     # Extra output
pnpm setup -- --help        # Show all options
```

Once setup completes, run `pnpm dev` and visit http://localhost:3000 (host app) and http://localhost:5173 (widget demo gallery).

---

### Manual Setup

If you prefer manual setup or don't have Claude Code:

#### 1. Clone the Repository

```bash
git clone https://github.com/MinistryPlatform-Community/MPNext-Widgets.git
cd MPNext-Widgets
```

#### 2. Install Dependencies

```bash
pnpm install
```

#### 3. Environment Configuration

Copy the example environment file and configure it with your Ministry Platform credentials:

```bash
cp .env.example .env.local
```

Update `.env.local` with your configuration. At minimum:

```env
# Better Auth Configuration
OIDC_CLIENT_ID=MPNextWidgets
OIDC_CLIENT_SECRET=your_client_secret
BETTER_AUTH_URL=http://localhost:3000
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
BETTER_AUTH_SECRET=your_generated_secret

# MinistryPlatform API Configuration
MINISTRY_PLATFORM_CLIENT_ID=MPNextWidgets
MINISTRY_PLATFORM_CLIENT_SECRET=your_client_secret
MINISTRY_PLATFORM_BASE_URL=https://your-instance.ministryplatform.com/ministryplatformapi

# Public Keys
NEXT_PUBLIC_MINISTRY_PLATFORM_FILE_URL=https://your-instance.ministryplatform.com/ministryplatformapi/files
NEXT_PUBLIC_APP_NAME=MPNext-Widgets

# Embed Widgets
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
EMBED_JWT_SECRET=your_generated_secret
EMBED_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Group-based access gates (no default; unset = no group-based access)
DEMO_ACCESS_GROUP_IDS=
CALENDAR_ADMIN_GROUP_IDS=
```

See [`.env.example`](./.env.example) for the full list with inline documentation, including `RECAPTCHA_SECRET_KEY`, `DEMO_PUBLIC_ACCESS`, and Playwright credentials.

### OAuth Setup

Before running the application, you must configure an OAuth 2.0 / OpenID Connect (OIDC) client in Ministry Platform.

Log in to your Ministry Platform instance as an administrator and navigate to **Administration > API Clients**.

Create a new API Client with the following configuration:

##### Basic Settings
- **Client ID**: `MPNextWidgets` (or your custom client ID)
- **Client Secret**: Generate a secure secret (save this securely — you'll need it for `.env.local`)
- **Display Name**: `MPNextWidgets` (or your preferred name)
- **Client User**: Create a scoped user or use API User
- **Authentication Flow**: use the default: Authorization Code, Implicit, Hybrid, Client Credentials, or Resource Owner

##### Redirect URIs (Required)
Add these authorized redirect URIs where users will be sent after authentication — separate each entry by ending with a semicolon (`;`):

**Development:**
```
http://localhost:3000/api/auth/oauth2/callback/ministry-platform
```

**Production:**
```
https://yourdomain.com/api/auth/oauth2/callback/ministry-platform
```

> **Important**: The redirect URI must match exactly (including protocol, domain, port, and path). Ministry Platform will reject any OAuth requests with mismatched redirect URIs. The callback path uses Better Auth's `genericOAuth` plugin convention: `/api/auth/oauth2/callback/{providerId}`.

##### Post-Logout Redirect URIs (Required)
Add these URIs where users will be redirected after signing out:

**Development:**
```
http://localhost:3000
```

**Production:**
```
https://yourdomain.com
```

> **Important**: Post-logout redirect URIs are **required** for proper logout functionality. The application implements OIDC RP-initiated logout to properly end Ministry Platform OAuth sessions. Without these configured, users will be auto-logged back in after clicking "Sign out" (SSO behavior).

#### Generate Auth Secrets

Generate secure secrets for Better Auth session signing **and** embed widget JWTs (each must be at least 32 characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copy the generated values to your `.env.local` as `BETTER_AUTH_SECRET` and `EMBED_JWT_SECRET`.

### 4. Generate Ministry Platform Types

Before running the application, generate TypeScript types from your Ministry Platform database schema:

```bash
pnpm mp:generate:models
```

This will:
- Connect to your Ministry Platform API
- Fetch all table metadata (300+ tables)
- Generate TypeScript interfaces for each table
- Generate Zod validation schemas for runtime validation
- Generate schema documentation with type file links
- Clean up any previously generated files
- Output to `src/lib/providers/ministry-platform/models/`

**Advanced options:**
```bash
# Generate types for specific tables only
pnpm tsx src/lib/providers/ministry-platform/scripts/generate-types.ts -s "Contact"

# Generate to a custom directory without Zod schemas
pnpm tsx src/lib/providers/ministry-platform/scripts/generate-types.ts -o ./types

# Detailed mode (samples records for better type inference)
pnpm tsx src/lib/providers/ministry-platform/scripts/generate-types.ts -d --sample-size 10

# See all options
pnpm tsx src/lib/providers/ministry-platform/scripts/generate-types.ts --help
```

> **Note**: Field names containing special characters (like `Allow_Check-in`) are automatically quoted in the generated types for valid TypeScript syntax.

### 5. Run the Development Server

Start the Next.js host app and the Vite widget demo together:

```bash
pnpm dev
```

| URL | What it serves |
|---|---|
| http://localhost:3000 | Next.js host app — sign-in, demo gallery, embed API endpoints |
| http://localhost:5173 | Vite demo gallery — each widget rendered against the local API |

1. Visit http://localhost:3000 and click **Sign In**
2. You'll be redirected to Ministry Platform login
3. After successful login, you'll be redirected back to the demo gallery
4. Visit http://localhost:5173 to exercise each widget in isolation

**Troubleshooting:**
- **"Redirect URI mismatch"**: Verify the redirect URI in MP matches exactly
- **"Invalid client"**: Check OAuth client ID and secret
- **Widget 401 / CORS error**: Confirm `EMBED_ALLOWED_ORIGINS` includes the host page origin and `EMBED_JWT_SECRET` is set
- **Auto-login after logout**: Verify post-logout redirect URIs are configured in the MP OAuth client (OIDC RP-initiated logout requires these)

### Production Deployment

When deploying to production:

1. Update `BETTER_AUTH_URL` to your production domain
2. Add production redirect URI (`https://yourdomain.com/api/auth/oauth2/callback/ministry-platform`) to the MP OAuth client
3. Add production post-logout redirect URIs
4. Add the external host site origin(s) to `EMBED_ALLOWED_ORIGINS`
5. Ensure all environment variables are set in your hosting provider
6. Enable HTTPS/SSL certificates
7. Run `pnpm build` to produce a hashed SDK bundle in `public/embed-sdk/`
8. Test the complete embed flow against a staging host page before going live

## Project Structure

```
MPNext-Widgets/
├── src/                                  # Next.js 16 host app (App Router)
│   ├── app/
│   │   ├── (demo)/demo/                  # Demo gallery (auth-gated)
│   │   │   ├── page.tsx                  # Widget catalog
│   │   │   └── [slug]/page.tsx           # Per-widget demo page
│   │   ├── api/
│   │   │   ├── auth/[...all]/            # Better Auth routes
│   │   │   └── embed/                    # Widget API endpoints
│   │   │       ├── session/              # Mint short-lived widget JWTs
│   │   │       ├── add-to-calendar/      # Subscribe to event reminders
│   │   │       ├── full-calendar/        # List + detail event endpoints
│   │   │       ├── invoices/             # List + invoice detail endpoints
│   │   │       ├── profile/              # Profile read/update + photo + password
│   │   │       └── subscriptions/        # Manage user subscriptions
│   │   ├── signin/                       # Sign-in page
│   │   ├── layout.tsx                    # Root layout
│   │   └── providers.tsx                 # App providers
│   │
│   ├── components/                       # React components (host app + demo)
│   ├── contexts/                         # React Context providers
│   │
│   ├── lib/
│   │   ├── auth.ts                       # Better Auth server config
│   │   ├── auth-client.ts                # Better Auth client (React hooks)
│   │   ├── embed/                        # Widget auth (separate from app auth)
│   │   │   ├── auth.ts                   # requireWidgetAuth()
│   │   │   ├── config.ts                 # Tenant configs + allowed origins
│   │   │   ├── jwt.ts                    # Widget JWT issue/verify
│   │   │   ├── recaptcha.ts              # Optional server-side reCAPTCHA
│   │   │   └── types.ts
│   │   └── providers/
│   │       └── ministry-platform/        # MP REST API provider
│   │           ├── auth/                 # OAuth client-credentials
│   │           ├── services/             # Table, Procedure, Communication, File, Metadata, Domain
│   │           ├── models/               # Generated types (300+ tables)
│   │           ├── scripts/              # Type generation CLI
│   │           ├── client.ts             # Core MP client
│   │           ├── helper.ts             # Public API (MPHelper)
│   │           └── index.ts              # Barrel export
│   │
│   ├── services/                         # Singleton services per widget
│   │   ├── addToCalendarService.ts
│   │   ├── fullCalendarService.ts
│   │   ├── invoiceService.ts
│   │   ├── profileService.ts
│   │   ├── subscriptionService.ts
│   │   └── userService.ts
│   │
│   ├── types/                            # Shared app-level types
│   └── proxy.ts                          # Next.js 16 proxy (route protection)
│
├── packages/
│   ├── embed-sdk/                        # @mpnext/embed-sdk (Vite library)
│   │   ├── src/
│   │   │   ├── components/               # Web Components
│   │   │   │   ├── user-menu.ts
│   │   │   │   ├── add-to-calendar.ts
│   │   │   │   ├── full-calendar*.ts     # Main + cards/list/mini-cal/modal/styles
│   │   │   │   ├── profile.ts
│   │   │   │   └── my-invoices.ts
│   │   │   ├── shared/                   # base-widget, api-client, cdn-loader
│   │   │   └── index.ts                  # SDK entry — auto-registers widgets
│   │   ├── demo-*.html                   # Per-widget Vite demo pages
│   │   └── vite.config.ts                # Library mode (ES + UMD)
│   │
│   └── types/                            # @mpnext/types — shared Zod + TS types
│       └── src/                          # add-to-calendar, full-calendar, invoices, profile, subscription
│
├── public/embed-sdk/                     # Deployed widget bundles (hashed) + brand CSS
├── scripts/
│   ├── setup.ts                          # Interactive setup CLI
│   ├── hash-sdk.js                       # Hash + rewrite SDK bundle filenames
│   └── copy-sdk.js                       # Copy build output into public/
├── .claude/commands/                     # Custom Claude Code commands
├── playwright.config.ts                  # Playwright E2E configuration
├── CLAUDE.md                             # Development guide
├── .env.example                          # Environment template
└── package.json                          # Monorepo root + scripts
```

## Widgets

Five framework-agnostic Web Components, each registered as a custom element by the embed SDK and rendered in Shadow DOM.

| Element | Purpose | Service | API route |
|---|---|---|---|
| `<next-user-menu>` | User profile dropdown with sign-in/out | `userService` | `/api/embed/session` |
| `<next-add-to-calendar>` | Subscribe to event reminders via email/SMS | `addToCalendarService` | `/api/embed/add-to-calendar` |
| `<next-full-calendar>` | Public events calendar (cards, list, mini-cal, modal) | `fullCalendarService` | `/api/embed/full-calendar` |
| `<next-profile>` | View and edit signed-in user profile | `profileService` | `/api/embed/profile` |
| `<next-my-invoices>` | List and view user invoices | `invoiceService` | `/api/embed/invoices` |

All five widgets share a base class (`packages/embed-sdk/src/shared/base-widget.ts`) that handles token fetching, automatic 401 refresh, and Shadow DOM lifecycle.

## Ministry Platform Integration

### MPHelper — Public API

The main entry point for interacting with Ministry Platform:

```typescript
import { MPHelper } from '@/lib/providers/ministry-platform';
import { ContactLogSchema } from '@/lib/providers/ministry-platform/models';

const mp = new MPHelper();

// Get contacts with query parameters
const contacts = await mp.getTableRecords({
  table: 'Contacts',
  filter: 'Contact_Status_ID=1',
  select: 'Contact_ID,Display_Name,Email_Address',
  orderBy: 'Last_Name',
  top: 50
});

// Create records with Zod validation (recommended)
await mp.createTableRecords('Contact_Log', [{
  Contact_ID: 12345,
  Contact_Date: new Date().toISOString(),
  Made_By: 1,
  Notes: 'Follow-up call completed'
}], {
  schema: ContactLogSchema,
  $userId: 1
});

// Execute stored procedures
const results = await mp.executeProcedureWithBody('api_Custom_Procedure', {
  '@ContactID': 12345
});

// File operations
const files = await mp.getFilesByRecord({
  tableName: 'Contacts',
  recordId: 12345
});
```

### Available Services

| Service | Purpose | Key Methods |
|---|---|---|
| **Table Service** | CRUD operations | `getTableRecords`, `createTableRecords`, `updateTableRecords`, `deleteTableRecords` |
| **Procedure Service** | Stored procedures | `getProcedures`, `executeProcedure`, `executeProcedureWithBody` |
| **Communication Service** | Email/SMS | `createCommunication`, `sendMessage` |
| **File Service** | File management | `getFilesByRecord`, `uploadFiles`, `updateFile`, `deleteFile` |
| **Metadata Service** | Schema info | `getTables`, `refreshMetadata` |
| **Domain Service** | Domain config | `getDomainInfo`, `getGlobalFilters` |

### Type Generation

Generate TypeScript interfaces and Zod schemas from your Ministry Platform database schema:

```bash
# Generate types for all tables with Zod schemas (recommended)
pnpm mp:generate:models

# Generate types for specific tables
pnpm tsx src/lib/providers/ministry-platform/scripts/generate-types.ts --search "Contact"

# See all options
pnpm tsx src/lib/providers/ministry-platform/scripts/generate-types.ts --help
```

**CLI Options:**
- `-o, --output <dir>` — Output directory
- `-s, --search <term>` — Filter tables by search term
- `-z, --zod` — Generate Zod schemas for runtime validation
- `-c, --clean` — Remove existing files before generating
- `-d, --detailed` — Sample records for better type inference (slower)
- `--sample-size <num>` — Number of records to sample in detailed mode

## Services

Application services live in `src/services/` and provide widget-scoped business logic over the Ministry Platform API. All follow the singleton pattern and wrap `MPHelper`.

| Service | File | Backing widget |
|---|---|---|
| **userService** | `userService.ts` | `<next-user-menu>` |
| **addToCalendarService** | `addToCalendarService.ts` | `<next-add-to-calendar>` |
| **fullCalendarService** | `fullCalendarService.ts` | `<next-full-calendar>` |
| **profileService** | `profileService.ts` | `<next-profile>` |
| **invoiceService** | `invoiceService.ts` | `<next-my-invoices>` |
| **subscriptionService** | `subscriptionService.ts` | profile + subscription management |

```typescript
import { ProfileService } from '@/services/profileService';

const svc = await ProfileService.getInstance();
const profile = await svc.getProfile({ contactId: 12345 });
```

## Embedding on an External Site

Once deployed, embed any widget by loading the SDK and dropping the custom element into your page:

```html
<!-- Load the SDK (the .js loader redirects to a hashed bundle for cache-busting) -->
<script type="module" src="https://your-host.com/embed-sdk/next-embed.js"></script>

<!-- Drop in widgets -->
<next-user-menu></next-user-menu>
<next-full-calendar></next-full-calendar>
<next-profile></next-profile>
```

The SDK auto-detects its own origin, wires up a token provider that calls `POST /api/embed/session`, and resolves widgets as soon as the DOM is ready.

For advanced cases (e.g. proxying tokens through your own backend), call `MPNextEmbed.init()` manually with a custom `tokenProvider`. See `packages/embed-sdk/src/index.ts` for the full API.

**Origin allowlist**: The host page's origin must be in `EMBED_ALLOWED_ORIGINS` (or in a tenant config in `src/lib/embed/config.ts`) — requests from anywhere else are rejected with 403.

## Testing

The project uses **Playwright** for end-to-end widget testing against the real Next.js + Vite demo stack.

### Test Account

A non-admin MP OAuth user with **MFA disabled** is required:

```env
PLAYWRIGHT_MP_USERNAME=
PLAYWRIGHT_MP_PASSWORD=
```

### Running Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run only the widget project
pnpm test:e2e:widget
```

Tests are configured in `playwright.config.ts`. The `test:widget` script (`pnpm test:widget`) launches the Next.js host and Vite demo gallery together — useful for manual widget exercising during test development.

## Development

### Common Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server + SDK demo (concurrently, ports 3000 + 5173) |
| `pnpm dev:next` | Next.js only (port 3000) |
| `pnpm dev:sdk` | Watch-build the embed SDK |
| `pnpm dev:demo` | Build SDK once then run Next.js (no Vite demo) |
| `pnpm test:widget` | Same as `pnpm dev` — Next + Vite demo together |
| `pnpm build` | Full production build (SDK first, then Next.js) |
| `pnpm build:sdk` | Build embed SDK + hash filenames + copy into `public/embed-sdk/` |
| `pnpm build:web` | Build Next.js only |
| `pnpm start` | Start the production Next.js server |
| `pnpm lint` | ESLint (flat config — `next lint` was removed in Next.js 16) |
| `pnpm test:e2e` | Playwright E2E tests |
| `pnpm test:e2e:widget` | Playwright widget project only |
| `pnpm mp:generate` | Generate MP types to a custom location |
| `pnpm mp:generate:models` | Regenerate MP types + Zod schemas into `src/lib/providers/ministry-platform/models/` (recommended) |
| `pnpm setup` | Interactive setup (prompts for env + builds the project) |
| `pnpm setup:check` | Validate environment without making changes |

### Building for Production

```bash
pnpm build
pnpm start
```

The build runs the SDK build first (Vite library mode → ES + UMD), hashes the output filenames, and copies the bundle into `public/embed-sdk/` so it is served alongside the Next.js app. The `next-embed.js` loader reads an `x-sdk-hash` header to redirect external host pages to the latest hashed bundle.

> **Note**: The build process includes TypeScript type checking. Ensure all generated types are up to date by running `pnpm mp:generate:models` before building.

## Claude Code Commands

This project includes custom [Claude Code](https://claude.ai/code) commands (skills) to streamline development workflows. Invoke them with the `/command` syntax in Claude Code.

| Command | Description |
|---|---|
| `/audit-deps` | Security and update audit for dependencies (runs `pnpm audit`, surfaces recent CVEs, categorizes updates) |
| `/security-audit` | Security audit of the pending changes on the current branch |
| `/release` | Cut a new release (version bump, changelog, tag) |
| `/release-finish` | Finalize an in-flight release |
| `/review` | Review a pull request |

Command definitions live in `.claude/commands/`. See [`CLAUDE.md`](./CLAUDE.md) for a deeper overview of architecture, services, brand colors, and conventions.

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Architecture overview, services, brand colors, key file map, code conventions
- **[Ministry Platform Provider](./src/lib/providers/ministry-platform/docs/README.md)** — Provider documentation
- **[Type Generator](./src/lib/providers/ministry-platform/scripts/README.md)** — CLI tool documentation
- **[.env.example](./.env.example)** — Full list of environment variables with inline documentation

## Code Style & Conventions

### Import Paths
Use the `@/*` path alias for app imports and the `@mpnext/*` workspace aliases for shared packages:
```typescript
import { MPHelper } from '@/lib/providers/ministry-platform';
import { requireWidgetAuth } from '@/lib/embed/auth';
import type { CalendarEvent } from '@mpnext/types';
```

### Component Style
- React Server Components by default
- Add `"use client"` only when needed for interactivity
- Web Components live in `packages/embed-sdk/src/components/` (one file per element)
- Use named exports (no default exports)

### Naming Conventions
- **PascalCase**: Component classes, types, interfaces
- **camelCase**: Functions, variables, service files
- **kebab-case**: Custom elements (`next-user-menu`), Web Component files, route folders
- **snake_case**: Ministry Platform API fields

### Embed-Side Conventions
- All widget API routes call `requireWidgetAuth(req, { widget: 'name' })` — never trust the client
- Tenant configuration (allowed origins, defaults) lives in `src/lib/embed/config.ts`
- Brand CSS for MP-hosted Shadow DOM widgets is injected from `public/embed-sdk/mp-widget-overrides.css` via the `customcss` attribute

### TypeScript
- Strict mode enabled
- Export interfaces from `@mpnext/types` for any data crossing the SDK ↔ API boundary
- Use Zod schemas for runtime validation on both sides

### Best Practices
1. **Regenerate types** after MP schema changes: `pnpm mp:generate:models`
2. **Use Zod schemas** when writing to MP — pass `schema:` to `createTableRecords()` / `updateTableRecords()` to catch validation errors before the API call
3. **Add new widgets in three places**: a Web Component in `packages/embed-sdk/src/components/`, a service in `src/services/`, an API route under `src/app/api/embed/`. Register the element in `packages/embed-sdk/src/index.ts` and add a demo page (`demo-<name>.html`).
4. **Add the host page origin** to `EMBED_ALLOWED_ORIGINS` (or a tenant config) before testing on a new external site
5. **Access fields with special characters** using bracket notation: `event["Allow_Check-in"]`
6. **Run lint** before committing: `pnpm lint`

## Contributing

This project follows strict TypeScript conventions and code style. Please review [CLAUDE.md](./CLAUDE.md) before contributing.

## License

Private

## Support

For Ministry Platform API documentation, refer to your instance's API documentation portal.
