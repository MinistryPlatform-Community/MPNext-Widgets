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
  - [Quick Setup (Automated)](#quick-setup-automated)
  - [Manual Setup](#manual-setup)
  - [OAuth Setup](#oauth-setup)
- [Project Structure](#project-structure)
- [Widgets](#widgets)
- [Ministry Platform Integration](#ministry-platform-integration)
- [Services](#services)
- [Embedding on an External Site](#embedding-on-an-external-site)
- [Widget Authentication](#widget-authentication)
  - [Auth Modes](#auth-modes)
  - [Endpoints](#endpoints)
  - [MP OAuth Client Setup for Widgets](#mp-oauth-client-setup-for-widgets)
  - [Host Page API](#host-page-api)
  - [Cutover Runbook](#cutover-runbook)
  - [Troubleshooting Widget Auth](#troubleshooting-widget-auth)
- [Widget Languages](#widget-languages)
- [Widget Unsubscribe Links](#widget-unsubscribe-links)
- [Testing](#testing)
- [Development](#development)
- [Claude Code Commands](#claude-code-commands)
- [Documentation](#documentation)
- [Code Style & Conventions](#code-style--conventions)

## Features

- **Five embeddable widgets**: `next-user-menu`, `next-add-to-calendar`, `next-full-calendar`, `next-profile`, `next-my-invoices` — each a framework-agnostic Web Component rendered in Shadow DOM
- **Framework-agnostic SDK**: Single `<script type="module">` tag loads `next-embed.js` (the loader); no React, jQuery, or build tooling required on the host site
- **Hardened widget auth**: Short-lived (5-min) widget JWTs (HS256 via `jose`, `iss`/`aud`, origin-bound) gated by a CORS origin allowlist, with automatic refresh on 401. MP tokens live in an encrypted server session; the browser holds only an opaque, revocable session id. Three server-selected modes (`legacy` / `dual` / `hardened`) let each customer move at their own pace — see [Widget Authentication](#widget-authentication)
- **Authentication**: Better Auth with Ministry Platform OAuth (via `genericOAuth` plugin) and OIDC RP-initiated logout
- **Type-Safe API**: Shared `@mpnext/types` package with Zod schemas + TypeScript types used on both sides of the wire
- **Next.js 16**: App Router with React Server Components, Turbopack, and a demo gallery for every widget
- **Cache-busting loader**: `next-embed.js` is a tiny static loader (regenerated at each build) that imports the content-hashed bundle so external pages always pick up the latest build
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
next-embed.js (loader)        Static loader generated by scripts/hash-sdk.js; imports next-embed.<hash>.es.js
   │
   ▼
next-embed.<hash>.es.js       Auto-registers <next-*> custom elements
   │                          Auto-wires a token provider backed by AuthSession:
   │                            GET  /api/embed/auth/config   → auth mode for this origin
   │                            POST /api/embed/auth/exchange → sid (after an OAuth return)
   │                            POST /api/embed/session       → 5-min widget JWT (cached in memory)
   ▼
<next-user-menu> etc.         Renders in Shadow DOM
   │                          Bearer-authenticates calls to /api/embed/* with the JWT
   ▼
/api/embed/*                  requireWidgetAuth() → MP REST API via MPHelper
                              (user-scoped calls resolve the MP token server-side
                               from the encrypted session via getMpUserAccessToken)
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
| Embed widgets on external sites | Widget host acts as the MP OAuth client; MP tokens are held in an encrypted server session and the browser gets a 5-min HS256 widget JWT + an opaque `sid`. CORS origin allowlist. Legacy MPWidgets.js token flow still supported behind `EMBED_AUTH_MODE` | `src/lib/embed/{auth,auth-mode,jwt,embed-session,session-store,crypto,mp-oauth,config}.ts`, `src/app/api/embed/auth/*` |

The widget flow, its three modes, and the per-customer migration are described in [Widget Authentication](#widget-authentication).

**App session storage.** `betterAuth()` runs with **no `database` adapter, on
purpose**, and a `secondaryStorage` pointed at the same Upstash Redis the widget
sessions use (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, wired in
`src/lib/auth-secondary-storage.ts` under the `nw:kv:ba:*` key prefix). Better
Auth 1.7 serves the entire session path — create, find, update, delete, list,
with a denormalised copy of the user row and its additional fields — from
`secondaryStorage` and never reads the adapter for it, so a sign-in survives a
restart, a cold start, and a request landing on another serverless instance.
Rate limiting moves to the same store automatically. Only the `user` and
`account` rows stay in Better Auth's in-process memory adapter; nothing here
persists data keyed by the Better Auth `user.id` (`checkDemoAccess` authorises
on `userGuid`, re-read from MP on every sign-in), so the sole visible effect is
that a returning user signing in on a cold instance gets a fresh `user.id` —
sessions already minted stay valid. Anything that needs a durable `user.id`
needs a real `database` adapter first.

**`UPSTASH_REDIS_REST_URL` / `_TOKEN` are required in production, even if
every widget origin is in `legacy` mode.** `getSessionStore()`
(`src/lib/embed/session-store.ts`) **throws** in production when neither is
configured, naming the missing variables, instead of falling back to the
in-memory store — because that fallback loses app sign-ins on every restart and
never shares them between instances, which is the failure this design already
exists to prevent. The throw is lazy (first use of the store, not module load),
so `next build` is unaffected. If a deploy genuinely wants the memory store,
set `REDIS_ALLOW_MEMORY_FALLBACK=1`; it still warns. These three were called
`EMBED_SESSION_STORE_URL` / `_TOKEN` / `_ALLOW_MEMORY` until the store outgrew
the widget sessions; the old spellings are still read as a fallback and log a
deprecation warning when they are the ones supplying the value.
`session.cookieCache` is 5 minutes: with a shared store the cache is only a
read optimisation, and its cost is how long a signed-out session keeps
authorizing.

**Locally you need nothing.** With no store URL the app uses the in-memory
store, which is a genuine fallback: the instance and its backing Map are kept
on `globalThis`, so the RSC bundle and the route-handler bundle — which Next 16
evaluates as **separate module instances in one process** — share one store,
and an HMR re-evaluation does not sign you out. Before that (TODO 31) the two
halves of the app held disjoint Maps: `/signin` saw a session, the `(demo)`
layout did not, and signing in locally looped `/demo ↔ /signin` forever.
Sessions still reset when the dev server restarts.

## Prerequisites

- **Node.js**: v20.9 or higher (required by Next.js 16; CI runs on Node 22)
- **Package Manager**: **pnpm 10.x** (the `preinstall` guard refuses `npm install` / `yarn install`). The version is pinned via `packageManager` in `package.json` — enable it with **`corepack enable`** (Corepack ships with Node) and the correct pnpm is fetched automatically. No manual install needed.
- **Ministry Platform**: Active instance with API credentials and an OAuth client configured (see [OAuth Setup](#oauth-setup))

## Getting Started

### Quick Setup (Automated)

An interactive setup command walks you through the whole process. The bootstrap entry point needs **only Node** (already a prerequisite) — it enables pnpm via Corepack, installs dependencies, then launches setup, so this works on a clean machine with nothing but Node and Git:

```bash
git clone https://github.com/MinistryPlatform-Community/MPNext-Widgets.git
cd MPNext-Widgets
node scripts/setup-bootstrap.mjs
```

> **Already have pnpm?** `corepack enable && pnpm setup` (or just `pnpm setup`) runs the exact same flow. The `node` command above is the cold-start path because it doesn't presuppose pnpm is installed.

The interactive setup command will:
1. Verify Node.js version (v20.9+ required)
2. Check the git origin (offer to fork or re-init if it's still the template repo)
3. Check git status (warn on uncommitted changes)
4. Create `.env.local` from `.env.example` (if needed)
5. Prompt for environment variables (MP host, OAuth client, secrets) and auto-generate `BETTER_AUTH_SECRET` / `EMBED_JWT_SECRET`
6. Install workspace dependencies (`pnpm install`)
7. Optionally update dependencies (only with `--update`; skipped by default to preserve the lockfile)
8. Generate Ministry Platform types (a warning, not a failure, when committed types already exist)
9. Run a production build to verify configuration

**Additional setup options** (flags forward to either entry point — e.g. `node scripts/setup-bootstrap.mjs --clean`):
```bash
pnpm setup:check            # Validation only (no changes)
pnpm setup -- --clean       # Clean install (delete node_modules first)
pnpm setup -- --skip-install # Skip pnpm install
pnpm setup -- --update      # Also run pnpm update (mutates the lockfile)
pnpm setup -- --verbose     # Extra output
pnpm setup -- --help        # Show all options
```

**Headless / CI:** `--yes` (or `--non-interactive`) runs the full flow without prompts — it keeps existing `.env.local` values, auto-generates any missing secrets, and applies defaults. It's also auto-enabled when stdin isn't a TTY, so it won't hang in a pipeline. Provide MP credentials via `.env.local` (or your CI secret store) beforehand:

```bash
node scripts/setup-bootstrap.mjs --yes
```

Once setup completes, run `pnpm dev` and visit http://localhost:3000 (host app) and http://localhost:5173 (widget demo gallery).

---

### Manual Setup

If you prefer to run each step yourself instead of the automated setup:

#### 1. Clone the Repository

```bash
git clone https://github.com/MinistryPlatform-Community/MPNext-Widgets.git
cd MPNext-Widgets
```

#### 2. Install Dependencies

If you don't already have pnpm, enable it via Corepack (installs the version pinned in `package.json`):

```bash
corepack enable
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

# Organization name baked into the embed SDK at build time (e.g. SMS opt-in
# consent text). Unset falls back to "our organization". Consumed by Vite.
VITE_ORG_NAME=

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
http://localhost:3000/api/auth/callback/ministryplatform;
http://localhost:3000/api/embed/auth/callback
```

**Production:**
```
https://yourdomain.com/api/auth/callback/ministryplatform;
https://yourdomain.com/api/embed/auth/callback
```

> **Important**: The redirect URI must match exactly (including protocol, domain, port, and path). Ministry Platform will reject any OAuth requests with mismatched redirect URIs. The first path uses Better Auth's core social-callback convention (`/api/auth/callback/{providerId}`, where `providerId` is `ministryplatform`) and signs users into the Next.js app. The second (`/api/embed/auth/callback`) is the **widget** login callback; it is only exercised when `EMBED_AUTH_MODE` (or a per-origin override) is `dual` or `hardened`, but registering it up front costs nothing and is step 1 of the [cutover runbook](#cutover-runbook).

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
>
> **Host church sites need no entry of their own.** MP only completes an end-session whose `post_logout_redirect_uri` is registered, and an embed SDK's host pages are an open-ended set belonging to other people, so no church page URL is ever sent to MP. `${BETTER_AUTH_URL}/signin` is the single registered value, and the widget host returns the visitor to their church page itself afterwards — see [Widget Authentication](#widget-authentication).

#### Generate Auth Secrets

Generate secure secrets for Better Auth session signing **and** embed widget JWTs (each must be at least 32 characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copy the generated values to your `.env.local` as `BETTER_AUTH_SECRET` and `EMBED_JWT_SECRET`.

### 4. Generate Ministry Platform Types

> **Note**: A full set of generated models is **committed to the repo**, so the project builds and runs without a live MP connection. They come from a **reference tenant**, so a first build always succeeds — but on a fork pointed at a different MP instance they may not match your schema (custom fields, table differences). The build will compile against the committed types either way, so **regenerate against your own instance before relying on the types**:
>
> ```bash
> pnpm mp:generate:models
> ```
>
> The automated setup attempts this for you; if it fails (unreachable/throttled tenant) it warns and keeps the committed models rather than aborting.

To regenerate TypeScript types from your Ministry Platform database schema:

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
- **Auto-login after logout**: `${BETTER_AUTH_URL}/signin` must be registered as a post-logout redirect URI on the MP OAuth client. MP refuses to complete an end-session it cannot redirect out of — it drops the whole logout context, shows a "Would you like to logout?" prompt, and leaves the SSO session alive, so the next visit signs the user straight back in
- **Widget shows `<mpp-user-login>` although you set `EMBED_AUTH_MODE=dual`**: the SDK falls back to `legacy` whenever `GET /api/embed/auth/config` fails — check the browser console for a CORS/network error on that request and that the page origin is in `EMBED_ALLOWED_ORIGINS`. See [Troubleshooting Widget Auth](#troubleshooting-widget-auth) for more
- **Native build script errors (esbuild / sharp / unrs-resolver)**: pnpm 10 blocks dependency build scripts by default. If a postinstall step is required (e.g. `sharp` for some Next.js image paths), approve them with `pnpm approve-builds`

### Production Deployment

When deploying to production:

1. Update `BETTER_AUTH_URL` to your production domain
2. Add production redirect URIs (`https://yourdomain.com/api/auth/callback/ministryplatform` and `https://yourdomain.com/api/embed/auth/callback`) to the MP OAuth client
3. Add `https://yourdomain.com/signin` as a post-logout redirect URI. That one entry covers the app **and** every embedded church site — host page URLs are never sent to MP (see [Widget Authentication](#widget-authentication))
4. Add the external host site origin(s) to `EMBED_ALLOWED_ORIGINS`
5. Ensure all environment variables are set in your hosting provider. **The Upstash Redis store (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) is required** — it backs both the Better Auth app session and the widget sessions, the in-memory fallback is dev-only (users get signed out on every restart and instance switch), and the app throws in production without it (override with `REDIS_ALLOW_MEMORY_FALLBACK=1`). On Vercel, connecting the Upstash integration injects both names for you. For `dual` / `hardened` widget auth also set `EMBED_SESSION_ENC_KEY`
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
│   │   │   ├── auth/
│   │   │   │   ├── [...all]/             # Better Auth catch-all routes
│   │   │   │   ├── logout/               # OIDC RP-initiated logout
│   │   │   │   └── session-tokens/       # Surfaces OAuth tokens to the app
│   │   │   └── embed/                    # Widget API endpoints
│   │   │       ├── session/              # Mint short-lived widget JWTs (sid, legacy mpUserToken, or public)
│   │   │       ├── auth/                 # Widget login (see "Widget Authentication")
│   │   │       │   ├── config/           # GET  mode + login/logout/me URLs for the caller's origin
│   │   │       │   ├── login/            # GET  top-level redirect to MP authorize (state cookie)
│   │   │       │   ├── callback/         # GET  OAuth redirect URI → server session → #nextwidgets_auth handoff
│   │   │       │   ├── exchange/         # POST one-time handoff code → { sid, token }
│   │   │       │   ├── logout/           # POST delete session → URL to navigate to; GET bounce home
│   │   │       │   └── me/               # GET  signed-in user for a v2 widget JWT
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
│   │
│   ├── lib/
│   │   ├── auth.ts                       # Better Auth server config
│   │   ├── auth-client.ts                # Better Auth client (React hooks)
│   │   ├── embed/                        # Widget auth (separate from app auth)
│   │   │   ├── auth.ts                   # requireWidgetAuth(), isOriginAllowed(), getClientIp()
│   │   │   ├── auth-mode.ts              # resolveAuthMode(origin) from EMBED_AUTH_MODE(_ORIGINS)
│   │   │   ├── config.ts                 # Tenant configs + allowed origins
│   │   │   ├── crypto.ts                 # AES-256-GCM seal/open, randomToken, sha256Hex
│   │   │   ├── embed-session.ts          # create/get/delete sessions, handoff codes, getMpUserAccessToken()
│   │   │   ├── jwt.ts                    # Widget JWT issue/verify (jose) + OAuth state token
│   │   │   ├── mp-oauth.ts               # MP authorize/token/userinfo/endsession helpers
│   │   │   ├── logout-return.ts          # Sealed return ticket + nextwidgets_logout_return bounce
│   │   │   ├── rate-limit.ts             # Fixed-window per-IP limiter on public routes
│   │   │   ├── recaptcha.ts              # Optional server-side reCAPTCHA
│   │   │   ├── session-store.ts          # EmbedSessionStore: Upstash Redis + in-memory
│   │   │   └── types.ts                  # WidgetClaims (v1/v2), session records
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
│   │   │   │   └── auth-session.ts       # AuthSession: mode discovery, sid, handoff, JWT cache, login/logout
│   │   │   └── index.ts                  # SDK entry — auto-registers widgets, exposes MPNextEmbed
│   │   ├── demo-*.html                   # Per-widget Vite demo pages
│   │   └── vite.config.ts                # Library mode (ES + UMD)
│   │
│   └── types/                            # @mpnext/types — shared Zod + TS types
│       └── src/                          # add-to-calendar, full-calendar, invoices, profile, subscription
│
├── public/embed-sdk/                     # Deployed widget bundles (hashed) + brand CSS
├── scripts/
│   ├── setup-bootstrap.mjs               # Zero-dep entry for `pnpm setup` (ensures pnpm + deps, then runs setup.ts)
│   ├── setup.ts                          # Interactive setup CLI
│   ├── hash-sdk.js                       # Hash + rewrite SDK bundle filenames
│   └── copy-sdk.js                       # Copy build output into public/
├── e2e/widget/                           # Playwright specs (user-menu, login-hardened)
├── .claude/commands/                     # Custom Claude Code commands
├── playwright.config.ts                  # Playwright E2E configuration
├── WIDGET-AUTH-MIGRATION-PLAN.md         # Legacy → hardened widget auth migration plan
├── CLAUDE.md                             # Development guide
├── .env.example                          # Environment template
└── package.json                          # Monorepo root + scripts
```

## Widgets

Five framework-agnostic Web Components, each registered as a custom element by the embed SDK and rendered in Shadow DOM.

| Element | Purpose | Service | API route |
|---|---|---|---|
| `<next-user-menu>` | User profile dropdown with sign-in/out | `userService` | `/api/embed/session`, `/api/embed/auth/*` |
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
| **domainTimezoneService** | `domainTimezoneService.ts` | MP domain time-zone conversion (used by all services) |

```typescript
import { ProfileService } from '@/services/profileService';

const svc = await ProfileService.getInstance();
const profile = await svc.getProfileByUserGuid(userGuid);
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

The SDK auto-detects its own origin, wires up a token provider that calls `POST /api/embed/session`, and resolves widgets as soon as the DOM is ready. Sign-in is handled by the widget host (see [Widget Authentication](#widget-authentication)); pages still running the legacy flow keep their `MPWidgets.js` script tag.

For advanced cases (e.g. proxying tokens through your own backend), call `MPNextEmbed.init()` manually with a custom `tokenProvider`. See `packages/embed-sdk/src/index.ts` for the full API.

**Origin allowlist**: The host page's origin must be in `EMBED_ALLOWED_ORIGINS` (parsed in `src/lib/embed/config.ts`, plus Vercel-detected URLs) — requests from anywhere else are rejected with 403. Wildcards (`*.church.org`) match the apex and its subdomains over `https` only.

## Widget Authentication

The widget host is the OAuth client. A visitor signs in through a top-level redirect to Ministry Platform; the host exchanges the code server-side, stores the MP access/refresh/id tokens **encrypted in a server session**, and hands the browser two things only:

- an **opaque session id (`sid`)** — 256-bit random, bound to the page origin, revocable, sliding 30-day idle / 90-day absolute lifetime (`EMBED_SESSION_IDLE_TTL` / `EMBED_SESSION_ABSOLUTE_TTL`);
- a **widget JWT** (`jose` HS256, `iss`/`aud`, `exp` 5 min, `origin` and `wid` claims, kept in SDK memory only) minted from that `sid` by `POST /api/embed/session` and re-minted 30 s before expiry or on a 401.

No MP token ever reaches host-page JavaScript. Routes that need the user's own MP token (change-password, invoice product lookups) call `getMpUserAccessToken(claims)` on the server, which reads the session and refreshes via MP when the token is within 60 s of expiry.

The previous model — MP's `MPWidgets.js` login widget writing a full-scope MP access token to `localStorage` (`mpp-widgets_*`), which the SDK forwarded as `mpUserToken` — is still supported behind a mode flag so existing customers keep working until they are cut over. The full rationale and phased plan are in [WIDGET-AUTH-MIGRATION-PLAN.md](./WIDGET-AUTH-MIGRATION-PLAN.md).

### Auth Modes

Mode is a **server** setting. The SDK discovers it at boot (`GET /api/embed/auth/config`), so host pages do not change when a customer is switched.

```env
EMBED_AUTH_MODE=legacy                       # legacy | dual | hardened  (default: legacy)
EMBED_AUTH_MODE_ORIGINS=https://www.church.org=hardened,https://other.church=legacy   # optional per-origin override; wins over EMBED_AUTH_MODE
```

| Mode | `POST /api/embed/session` accepts | `<next-user-menu>` when signed out | Legacy `mpp-widgets_*` keys |
|---|---|---|---|
| `legacy` | `mpUserToken` only (MP token from MPWidgets.js) → JWT v1 | Injects `<mpp-user-login>`; host page must load `MPWidgets.js` | Read and written by the SDK (today's behavior) |
| `dual` | `sid` **or** `mpUserToken` → JWT v2 + `sid` | Own **Sign In** button (`.nw-login-btn`). Add `prefer-mp-login` to keep `<mpp-user-login>` when `MPWidgets.js` is present | Read once for the **silent upgrade**; never written; removed on logout |
| `hardened` | `sid` only; `mpUserToken` is ignored (public token) | Own **Sign In** button | Ignored |

Every mode also issues a `sub: "public"` JWT when no credential is present, so public widgets (calendar, event finder, …) work regardless of mode. Invalid mode values fall back to `legacy` with a one-time warning.

**Silent upgrade (`dual`).** When the SDK finds no `sid` but a valid `mpp-widgets_AuthToken`, it POSTs `{ wid, mpUserToken }` once; the server validates the token against MP userinfo, creates a server session (no refresh token is available on this path) and returns `{ token, sid }`. The visitor is migrated without re-authenticating; when that MP token expires naturally they sign in once through the new flow. `logout()` outside `hardened` also removes the `mpp-widgets_*` keys so a signed-out visitor is not silently re-upgraded from a stale token.

**Where the `sid` lives.** `localStorage` on the host origin under the key `nextwidgets_sid` by default, so members stay signed in across tabs and reloads (other tabs re-render on the `storage` event). Add `session-scope="tab"` to `<next-user-menu>` to use `sessionStorage` instead on kiosk or shared-device pages. Third-party cookies are deliberately not used (Safari blocks them, Chrome partitions them).

### Endpoints

All JSON routes send CORS headers for allowed origins and never log token material. `login` and `callback` are top-level navigations (redirects, no CORS).

| Route | Purpose |
|---|---|
| `GET /api/embed/auth/config` | `{ mode, loginUrl, logoutUrl, meUrl, postLogoutRedirectUri? }` resolved for the caller's origin. `Cache-Control: public, max-age=300`. The SDK treats any failure as `legacy`. `postLogoutRedirectUri` is the host's one registered end-session destination, used only by `legacy` (which builds MP's end-session URL in the browser). |
| `GET /api/embed/auth/login?origin=&return_to=&wid=` | Validates `origin` (allowlist) and that `return_to` is same-origin with it; signs `state`/`nonce` (+ optional PKCE verifier) into an `HttpOnly; SameSite=Lax` cookie `nextwidgets_oauth_state` (10 min, `Path=/api/embed/auth`); 302 to MP `/oauth/connect/authorize` with `redirect_uri=<publicUrl>/api/embed/auth/callback`. |
| `GET /api/embed/auth/callback?code=&state=` | Verifies the state cookie (constant-time), exchanges the code server-side, calls userinfo, creates the session, mints a **single-use handoff code** (60 s, origin-bound) and 302s to `return_to#nextwidgets_auth=<code>` — a fragment, so the code never reaches the church site's server logs. Failures redirect to `return_to#nextwidgets_auth_error=<short_code>`. |
| `POST /api/embed/auth/exchange` `{ code, wid }` | Redeems the handoff code (once, origin must match) → `{ sid, token, expiresIn, mode }`. Rate-limited. `400 { error: "invalid_code" }` on reuse/expiry. |
| `POST /api/embed/session` `{ wid, sid? \| mpUserToken? }` | Mints the widget JWT. `sid` → v2 token, or **`401 { error: "invalid_session" }`** when the session is missing, expired, or bound to another origin (the SDK then clears the `sid` and falls back to public). `mpUserToken` → v1 (`legacy`) or v2 + `sid` (`dual`). Same-origin Better Auth sessions (the demo gallery) are turned into an embed session the same way. Rate-limited per IP (`EMBED_SESSION_RATE_LIMIT`, default 120/min). |
| `POST /api/embed/auth/logout` `{ sid, postLogoutRedirectUri? }` | Deletes the session (idempotent) → `{ endSessionUrl }`, the URL the SDK navigates to. With a valid `postLogoutRedirectUri` (must be same-origin with the request origin, else dropped) that is `GET /api/embed/auth/logout?t=<sealed ticket>` on this host, **not** MP: the church page is never sent to MP, which would refuse it. |
| `GET /api/embed/auth/logout?t=` | Second leg of that bounce. Opens the sealed ticket, remembers the church page in an `HttpOnly; SameSite=Lax` cookie `nextwidgets_logout_return` (5 min, `Path=/`), then 302s to MP end-session with `id_token_hint` and the registered `post_logout_redirect_uri`. MP lands back on `/signin`, where `src/proxy.ts` spends the cookie and redirects to the church page. A missing or tampered ticket still ends the MP session, just without the return trip. |
| `GET /api/embed/auth/me` (Bearer widget JWT) | `{ authenticated: true, user: { userGuid, firstName, lastName, email, imageGuid } }` for a `sid`-backed token; `{ authenticated: false }` otherwise (401 for public tokens). |

Server-side building blocks live in `src/lib/embed/`: `auth-mode.ts` (mode resolution), `crypto.ts` (AES-256-GCM via WebCrypto, keyed by `EMBED_SESSION_ENC_KEY`), `session-store.ts` (Upstash Redis REST or in-memory; keys `nw:sess:<sha256(sid)>`, `nw:handoff:*`, `nw:lock:*`, `nw:rl:*`, and a generic `nw:kv:*` namespace the Better Auth app session borrows), `embed-session.ts` (create/get/delete, handoff codes, refresh under a store lock), `mp-oauth.ts` (authorize/token/userinfo/endsession URLs, PKCE), `rate-limit.ts`.

### MP OAuth Client Setup for Widgets

Nothing works in `dual` or `hardened` until the OAuth client referenced by `OIDC_CLIENT_ID` (falling back to `MINISTRY_PLATFORM_CLIENT_ID`) knows about the widget host:

1. **Redirect URI**: add `https://<widget-host>/api/embed/auth/callback` (and `http://localhost:3000/api/embed/auth/callback` for local dev). `<widget-host>` is `EMBED_PUBLIC_URL` when set, otherwise the origin of the incoming request.
2. **Post-logout redirect URI**: add `https://<widget-host>/signin` — i.e. `${BETTER_AUTH_URL}/signin` — and `http://localhost:3000/signin` for local dev. This is the **only** post-logout entry needed, in every mode. Church site origins are deliberately *not* registered: MP matches the URI it is handed against this list and refuses to finish a logout it does not recognise (dropping `id_token_hint` and showing a "Would you like to logout?" prompt with the SSO session still alive), and an embed SDK cannot enumerate its host pages. So no host page URL is ever sent to MP. `dual`/`hardened` return the visitor to their church page through the widget host's own bounce (`nextwidgets_logout_return`, see the route table above); `legacy` builds the end-session URL in the browser and uses the registered URI directly, which the config route advertises to it.
3. **PKCE**: off by default (`EMBED_OAUTH_PKCE=false`, matching the app's Better Auth config). Set `EMBED_OAUTH_PKCE=true` only if the client accepts a `code_challenge`; the flow is otherwise identical.
4. **Scopes** requested: `openid offline_access http://www.thinkministry.com/dataplatform/scopes/all` (`offline_access` supplies the refresh token that keeps long sessions alive).
5. **Server secrets**: set `EMBED_SESSION_ENC_KEY` (32 random bytes, base64url — distinct from `EMBED_JWT_SECRET`) and, in production, an Upstash Redis store (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). Without a store URL the host would use an in-memory store that loses sessions on restart and is not shared across serverless instances, so `getSessionStore()` refuses it in production and throws (opt out with `REDIS_ALLOW_MEMORY_FALLBACK=1`). The same store backs the Better Auth app session (`src/lib/auth-secondary-storage.ts`), so it is required regardless of the widget auth mode. Locally you need none of this — the in-memory store works out of the box.

### Host Page API

What a church page can use in `dual` / `hardened`. In `legacy` the existing `<script id="MPWidgets">` + `<next-user-menu mp-base-url="…">` setup keeps working unchanged.

**`<next-user-menu>` attributes**

| Attribute | Effect |
|---|---|
| `mp-base-url` | MP host (still needed: end-session URL and userinfo display fallback) |
| `post-logout-redirect-uri` | Where the visitor lands after sign-out. `dual`/`hardened`: any page on an allowed embedding origin, defaults to the current page, and needs nothing registered with MP — the widget host bounces the browser back itself. `legacy`: passed to MP directly, so it must be registered on the MP OAuth client; leave it unset and the widget uses the host's registered URI instead |
| `session-scope="tab"` | Keep the `sid` in `sessionStorage` instead of `localStorage` (shared devices). Does not migrate an existing `localStorage` sid |
| `prefer-mp-login` | `dual` only: keep injecting `<mpp-user-login>` when `MPWidgets.js` is on the page; the resulting MP token is silently upgraded to a `sid`. The widget appends the tag itself and keeps re-inserting it until MPWidgets.js registers it (a placeholder stands in meanwhile), so the page needs no `mpp-*` markup of its own. If the script is absent, or MP does not register the element within ~6 s, it falls back to the Sign In button and warns once |
| `prevent-login-widget` | Render a `<slot>` instead of the Sign In button so the page supplies its own control (call `MPNextEmbed.getAuthSession().login({ wid })`) |

**Events** (bubble, composed)

| Event | Detail | Notes |
|---|---|---|
| `loginRequired` | `{ wid }` | Cancelable. Fired by every widget's Sign In control before the SDK navigates to the login route; `preventDefault()` to run your own sign-in |
| `userLogout` | `{ endSessionUrl, postLogoutRedirectUri }` | Cancelable. If not prevented and `endSessionUrl` is non-null the SDK navigates there |
| `accountModalOpen` / `accountModalClose` | `{ tab }` / `{}` | Unchanged |

**JavaScript** — `window.MPNextEmbed` exposes `{ init, getAuthSession }`; the same classes are named exports of the SDK bundle module itself. `@mpnext/embed-sdk` is a private workspace package — it is never published to a registry, and the only supported way to load it is the `/embed-sdk/next-embed.js` loader.

```js
const auth = MPNextEmbed.getAuthSession();
await auth.getConfig();              // { mode, loginUrl, logoutUrl, meUrl }; getMode() is sync afterwards
auth.isAuthenticated();              // sid present (or, outside hardened, a valid legacy MP token)
auth.getSid();                       // opaque handle or null — never an MP token
auth.login({ wid: "user-menu", returnTo: location.href });   // top-level redirect to MP
const endSessionUrl = await auth.logout({ postLogoutRedirectUri: location.origin }); // clears sid; navigate yourself
await auth.me();                     // { authenticated, user? } — cached per sid, no request when signed out
auth.getAuthError();                 // "invalid_code" etc. from #nextwidgets_auth_error or a failed exchange
const off = auth.onChange(() => render());  // sid set/cleared here or in another tab
```

`getToken(wid)` / `refreshToken(wid)` back the built-in token provider and follow one ladder: pending `#nextwidgets_auth` handoff → `sid` → (not `hardened`) legacy MP token → public. Concurrent calls share one in-flight mint; the JWT is cached until 30 s before `exp` and invalidated whenever the underlying credential changes.

### Cutover Runbook

Per customer, in this order (details in [WIDGET-AUTH-MIGRATION-PLAN.md §4 Phase 3](./WIDGET-AUTH-MIGRATION-PLAN.md#phase-3-per-customer-cutover)):

1. Confirm every authenticated widget on their pages is a `next-*` widget. Pages still mixing MP's own `mpp-*` portal widgets must stay in `dual` — those widgets read `mpp-widgets_*` themselves and will show as logged out once the SDK stops writing the keys.
2. Register the redirect URI and post-logout URIs on their MP OAuth client ([above](#mp-oauth-client-setup-for-widgets)).
3. Set `EMBED_AUTH_MODE_ORIGINS=<their origin>=dual`. Verify sign-in, sign-out, a change-password and an invoice detail on their site. Members already signed in are silently upgraded.
4. Watch telemetry until no `mpUserToken`-based session has been issued for their origins for 14 consecutive days.
5. Flip their origins to `hardened`; remove the `MPWidgets.js` script tag from their pages if nothing else needs it.
6. When every origin is `hardened`, set `EMBED_AUTH_MODE=hardened` deployment-wide and delete the overrides.

### Troubleshooting Widget Auth

- **Widgets stay in legacy mode / `<mpp-user-login>` still renders**: the SDK resolves `legacy` whenever `GET /api/embed/auth/config` fails or returns an unknown mode. Open the request in DevTools — a CORS or 403 error means the page origin is not in `EMBED_ALLOWED_ORIGINS`; a 404 means the widget host is older than the SDK bundle. The demo pages show the resolved mode in a banner.
- **`legacy` mode renders no login button at all** — the slotted `<mpp-user-login>` sits at `0 × 0` with no shadow root: MPWidgets.js is a *loader*. On its own `DOMContentLoaded` handler it scans the page for the widget tags it knows and fetches `/widgets/dist/UserLogin.js` (the script that calls `customElements.define`) only for the tags it found; it re-scans from a `MutationObserver` on `document`, but installs that observer after an awaited CSRF round-trip in the same handler, so a tag inserted in between is seen by neither. `<next-user-menu>` appends `<mpp-user-login>` once `GET /api/embed/auth/config` resolves, which lands in that window, so it re-inserts the element every 300ms for up to 6s until MP registers it (each re-insertion is the childList mutation MP's re-scan needs). If the console warns that MPWidgets.js “did not register `<mpp-user-login>`” after that, MP genuinely never loaded `UserLogin.js` — check the network tab for `MPWidgets.js` **and** `UserLogin.js`, and that the MP host is reachable. This is not an origin allowlist matter: MP paints on any origin, including `localhost:5173`.
- **`401 { error: "invalid_session" }` from `/api/embed/session`**: the `sid` is unknown, past its absolute TTL, revoked by logout, or was issued to another origin. This is expected after a logout in another tab or a store restart with the in-memory store; the SDK clears `nextwidgets_sid` and continues as public. Persisting in production → check `UPSTASH_REDIS_REST_URL`/`_TOKEN` and that all instances share the store.
- **MP shows "invalid redirect URI" after Sign In**: `https://<widget-host>/api/embed/auth/callback` is not registered on the OAuth client, or `EMBED_PUBLIC_URL` does not match the registered host (proxy/CDN rewriting the Host header).
- **Return to the page with `#nextwidgets_auth_error=<code>`**: the callback failed after MP redirected back. Usual causes, in order: the `nextwidgets_oauth_state` cookie was missing or expired (cookies blocked on the widget host, or the 10-minute window passed), the code exchange was rejected (client id/secret, or a PKCE mismatch — check `EMBED_OAUTH_PKCE` against the MP client), or userinfo failed. The SDK strips the fragment; `MPNextEmbed.getAuthSession().getAuthError()` returns the short code and the server log has the detail.
- **`400 { error: "invalid_code" }` on `/auth/exchange`**: the handoff code was already redeemed (two SDK copies on one page), expired (60 s), or the page origin differs from the one that started login.
- **Signed out but MP signs you straight back in**, or logout stops on MP's "Would you like to logout? [Yes]" page: MP was handed a `post_logout_redirect_uri` it does not recognise, so it discarded the logout context (`id_token_hint` included) and never ended the SSO session. Register `${BETTER_AUTH_URL}/signin` on the OAuth client. If it is registered, something is still sending a host page URL — in `legacy` that means a `post-logout-redirect-uri` attribute pointing at an unregistered page; remove it. A completed logout is recognisable by MP redirecting through `oauth/logout?id=<sid>` rather than rendering the prompt.
- **`EMBED_SESSION_ENC_KEY` errors at startup**: the key must decode to exactly 32 bytes of base64url. It is required in production for any non-legacy mode.
- **`Error: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are required in production`**: exactly what it says — the deploy has no Redis store. Set both to an Upstash Redis REST endpoint (the Vercel Upstash integration sets them for you). The in-memory store is a development fallback and is refused in production because it loses every app sign-in on a restart, a cold start, or an instance switch; `REDIS_ALLOW_MEMORY_FALLBACK=1` accepts that deliberately. (Before this became an error, the symptom was the far more confusing "sessions vanish on every deploy".)

## Widget Languages

The widgets ship in **English, Spanish and Brazilian Portuguese**. There is no
MinistryPlatform configuration to do and nothing to switch on: a page that
declares its language gets translated widgets automatically.

### The zero-configuration path

Set `lang` on the page, which most bilingual CMS setups (WordPress/Polylang and
friends) already do:

```html
<html lang="es">
```

That is the whole integration. Every widget on the page renders in Spanish,
including dates, numbers and currency. `es-MX`, `es-US`, `es-419` and any other
`es-*` tag resolve to the Spanish catalogue; `pt`, `pt-BR` and `pt-PT` all
resolve to Brazilian Portuguese; anything else falls back to English.

### Other ways to choose

Resolution runs highest-priority first, so a more specific setting always wins:

| Priority | Source | Use it when |
|---|---|---|
| 1 | `lang` on the widget element | One widget differs from the page: `<next-event-finder lang="es">` |
| 2 | `MPNextEmbed.setLocale("es")` | Your page decides the language in JavaScript |
| 3 | The visitor's own choice | Set by `<next-locale-selector>`; persists in `localStorage` |
| 4 | `lang` on the page or nearest ancestor | The zero-configuration path above |
| 5 | The browser's language preference | No declaration anywhere |
| 6 | English | Nothing matched |

A `lang` on any ancestor works too, so a bilingual section of an otherwise
English page renders correctly:

```html
<section lang="es">
  <next-group-finder></next-group-finder>
</section>
```

### Letting visitors choose

For a page that cannot set `lang`, or that wants to offer the choice explicitly:

```html
<next-locale-selector></next-locale-selector>

<!-- a row of buttons instead of a dropdown -->
<next-locale-selector variant="inline"></next-locale-selector>

<!-- offer only some languages, and hide the visible label -->
<next-locale-selector locales="en,es" hide-label></next-locale-selector>
```

Options are labelled in their own language ("English", "Español", "Português
(Brasil)"). The choice persists and applies to every widget on the page.

### Renaming labels

Separate from translation: use your own ministry vocabulary without forking
anything. Keys are `<widget>.<label>`; scope `"*"` applies to every language.

```html
<script type="module" src="https://your-host.com/embed-sdk/next-embed.js"></script>
<script>
  MPNextEmbed.setMessages("*",  { "groupFinder.title": "Find a Small Group" });
  MPNextEmbed.setMessages("es", { "groupFinder.title": "Encuentra un Grupo Pequeño" });
</script>
```

Overrides beat both the translation and the English fallback. Values are always
rendered as text, so markup in an override cannot affect the page.

### What is not translated

The widgets translate their own labels, buttons, headings, validation messages
and error text. They **cannot** translate content that lives in
MinistryPlatform, because that content only exists in whatever language your
staff entered it:

- event titles and descriptions, group and opportunity names
- congregation, ministry, program and event-type names
- **Custom Form field labels and help text**
- product, fund and publication names
- contribution statement PDFs and the notification emails MP sends

So a Spanish visitor sees Spanish chrome around English content unless your
staff also enter that content in Spanish. This is the same limit the legacy
`mpp-*` widgets had — MP's `GetLabels` translated labels, not content.

### Adding a language

A developer step plus a deploy, deliberately — the catalogue is TypeScript in
this repo, not a database table:

1. Add an entry to `SUPPORTED_LOCALES` in
   `packages/embed-sdk/src/i18n/registry.ts`.
2. Copy `packages/embed-sdk/src/i18n/locales/en/` to the new code and translate.
   Run `pnpm exec tsc --noEmit` from `packages/embed-sdk` — it lists every key
   still missing, so there is no spreadsheet to reconcile.
3. Add a `vercel.json` header entry only if the chunk filename shape changed.
4. `pnpm i18n:sync` to record the English each translation was made from, then
   deploy.

`pnpm i18n:check` reports missing keys, dead keys, and — most usefully —
**stale** translations, where the English has changed since the translation was
written. That is the failure mode a file-based catalogue has: the key is
present, the types are fine, and the sentence is quietly wrong.

### Checking your layout

Spanish and Portuguese run 20-30% longer than English. From the browser console
on any page running the SDK:

```js
MPNextEmbed.enablePseudoLocale()   // [Ŝéàŕćĥ évéñtŝ ······]
MPNextEmbed.disablePseudoLocale()
```

Everything still rendering in plain English is a string that was never
translated; anything overflowing its container will overflow in Spanish too.


## Widget Unsubscribe Links

`<next-unsubscribe>` is the landing page for the unsubscribe link in a bulk
email. It needs no sign-in — that is the entire point — and it identifies the
recipient from the link they arrived on.

**MinistryPlatform generates no unsubscribe link of its own, and the legacy
widget stack did not either.** Every stock template's footer is a
MailChimp-inherited `mc:edit="unsubscribe"` region holding inert boilerplate:
no link, no merge token. Measured on the reference domain, **0 of 1047**
communications contain `unsubscribe.aspx` or `pubid=`, and the legacy stack's
1,922 lines of database scripts contain no unsubscribe URL and no
`[Contact_GUID]` token. So **a church that skips step 3 below has no
unsubscribe at all** — not a degraded one.

### 1. Host the landing page on an allowlisted origin — do this first

The page's origin must be in `EMBED_ALLOWED_ORIGINS`
(`src/lib/embed/config.ts`), or `/api/embed/session` will not mint a token and
every visitor sees an error. **This is setup failure number one.**

### 2. The page itself

The standard SDK snippet (see [Embedding on an External
Site](#embedding-on-an-external-site)) plus:

```html
<next-unsubscribe
  my-subscriptions-url="https://www.example.church/email-preferences">
</next-unsubscribe>
```

No sign-in and no `<next-user-menu>`. One is harmless but pointless.

| Attribute | Required | Meaning |
|---|---|---|
| `my-subscriptions-url` | no | Absolute URL of the page carrying `<next-subscriptions>`. Renders the "Manage all my email preferences" link; omitted when unset. `http:`/`https:` only — anything else is dropped with one console warning. |
| `cg-param` | no | Name of the query parameter carrying the contact GUID. Default `cg`. For a CMS that already owns `cg`. |
| `pubid-param` | no | Default `pubid`. |
| `token-param` | no | Default `t`. The sealed-token path. |
| `show-email` | no | `"false"` drops the masked-address line entirely. Default shows it masked (`j•••@g•••.com`) — never in full. |
| `api-host` | no | Standard across the SDK. |
| `lang` | no | Standard across the SDK. |

There is deliberately **no `publication-id` attribute**: the publication comes
from the link, so one landing page serves every publication.

Events: `unsubscribed` (`{ scope, publicationId }`), `resubscribed`,
`unsubscribeError`.

### 3. Add the footer to every bulk-email template

```html
<a href="https://www.example.church/unsubscribe?cg=[Contact_GUID]&amp;pubid=4">
  Unsubscribe from the Weekly Newsletter
</a>
&nbsp;|&nbsp;
<a href="https://www.example.church/unsubscribe?cg=[Contact_GUID]">
  Stop all bulk email
</a>
```

- `[Contact_GUID]` is merged per recipient. MP's own stock template
  (*"[Nickname], your User Account for MPI!"*) uses exactly this token in
  exactly this position: `my_user_account.aspx?dg=[Domain_GUID]&cg=[Contact_GUID]`.
- **`pubid` is hardcoded per template**, to the `dp_Publications.Publication_ID`
  that template is sent for. There is no `[Publication_ID]` merge token: a
  communication's publication is a property of the *send*, not of the recipient
  row the merge runs over. So it is **one footer per publication template**, and
  this is the one fiddly part of the setup.
- Omit `pubid` (or set `0`) for the "stop all bulk email" link, which writes
  `Contacts.Bulk_Email_Opt_Out`.
- **Escape the ampersand as `&amp;`** inside MP's HTML editor. A raw `&` in an
  `href` there is a real and repeated failure mode.
- **Before editing templates at scale, send one test bulk email to a selection
  of one and check the merged link.** The `[Contact_GUID]` evidence above comes
  from a stock *template*; no *sent* message body in the reference domain
  contains `cg=`, because that template is triggered by user-account setup
  rather than by a publication send. Five minutes, and it de-risks the feature
  before any template is touched in bulk.

### 4. Already-sent emails keep working

The parameter names are unchanged from legacy `mpp-unsubscribe`
(`?cg=&pubid=`), so a church that re-points its existing unsubscribe page — or
adds a redirect from it — at the new widget keeps every link already sitting in
a recipient's inbox alive. MP's Portal `dg=[Domain_GUID]` parameter is read and
ignored, so an MP-shaped link can be pasted unchanged.

### What the recipient sees

The widget acts **on load**, with no confirm click: following the link
completes the opt-out, which is what RFC 8058 and every mailbox provider expect,
and a confirmation step is measurable drop-off on the one flow a sender is
obliged to make easy. It then offers **Undo** for the life of the rendered page.

Undo is offered only when there is something to undo, so someone who was
already opted out before they clicked is never shown a button that would opt
them back in. A link whose GUID matches no contact is answered exactly like a
successful unsubscribe — deliberately, so the page cannot be used to test
whether a GUID is a live contact.

A *malformed or incomplete* link is a different case and says so, with a link to
full preferences as the way out. It makes no request at all.

### Notes for whoever reviews this later

- The write is a **POST issued by JavaScript**, never a GET. The emailed link
  resolves to a page that renders and changes nothing, so mail scanners,
  URL-rewriting gateways (Proofpoint, Mimecast) and link previews cannot
  unsubscribe anybody. The POST additionally needs a widget JWT, obtainable only
  from an allowlisted origin.
- The address comes back **masked, masked server-side**, so the full value never
  reaches a response body or an HTTP cache.
- `Contact_GUID` is accepted **at `/api/embed/unsubscribe` and nowhere else**.
  It is ~122 bits of unguessable bearer capability, but it never expires; the
  route is narrow enough for that trade and the pattern must not be generalised.
  The widget strips it out of the address bar as soon as it has read it.
- Rate limits: 10/min per IP and 5/min per hashed capability, both before any MP
  read.
- **RFC 8058 one-click is out of scope.** The mailbox-provider "Unsubscribe"
  button needs a `List-Unsubscribe` / `List-Unsubscribe-Post` header on the
  outbound message, emitted by MP's SMTP path, which this stack does not
  control. The link in the body is the supported path.


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

`e2e/widget/login-hardened.spec.ts` drives the full widget sign-in (Sign In → MP login → callback → avatar → logout). It self-skips unless `PLAYWRIGHT_MP_USERNAME` / `PLAYWRIGHT_MP_PASSWORD` are set **and** `EMBED_AUTH_MODE` is `dual` or `hardened` (export it in the shell that runs Playwright, and register `http://localhost:3000/api/embed/auth/callback` on the MP client). It is not part of CI.

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

The build runs the SDK build first (Vite library mode → ES + UMD), hashes the output filenames, and copies the bundle into `public/embed-sdk/` so it is served alongside the Next.js app. `scripts/hash-sdk.js` regenerates the small `next-embed.js` loader so it imports the latest content-hashed bundle.

> **Note**: The build process includes TypeScript type checking. Ensure all generated types are up to date by running `pnpm mp:generate:models` before building.

## Claude Code Commands

This project includes custom [Claude Code](https://claude.ai/code) commands (skills) to streamline development workflows. Invoke them with the `/command` syntax in Claude Code.

| Command | Description |
|---|---|
| `/audit-deps` | Security and update audit for dependencies (runs `pnpm audit`, surfaces recent CVEs, categorizes updates) |
| `/security-audit` | Security audit of the pending changes on the current branch |
| `/branch-commit` | Create a branch and commit the current changes |
| `/pr` | Open a pull request for the current branch |
| `/release` | Cut a new release (version bump, changelog, tag) |

Command definitions live in `.claude/commands/`. See [`CLAUDE.md`](./CLAUDE.md) for a deeper overview of architecture, services, brand colors, and conventions.

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — Architecture overview, services, brand colors, key file map, code conventions
- **[WIDGET-AUTH-MIGRATION-PLAN.md](./WIDGET-AUTH-MIGRATION-PLAN.md)** — Why and how widget auth moves from MPWidgets.js localStorage tokens to server sessions; phased plan and per-customer cutover
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
- Allowed origins and embed config live in `src/lib/embed/config.ts` (`EMBED_ALLOWED_ORIGINS`)
- Brand CSS for MP-hosted Shadow DOM widgets is injected from `public/embed-sdk/mp-widget-overrides.css` via the `customcss` attribute

### TypeScript
- Strict mode enabled
- Export interfaces from `@mpnext/types` for any data crossing the SDK ↔ API boundary
- Use Zod schemas for runtime validation on both sides

### Best Practices
1. **Regenerate types** after MP schema changes: `pnpm mp:generate:models`
2. **Use Zod schemas** when writing to MP — pass `schema:` to `createTableRecords()` / `updateTableRecords()` to catch validation errors before the API call
3. **Add new widgets in three places**: a Web Component in `packages/embed-sdk/src/components/`, a service in `src/services/`, an API route under `src/app/api/embed/`. Register the element in `packages/embed-sdk/src/index.ts` and add a demo page (`demo-<name>.html`).
4. **Add the host page origin** to `EMBED_ALLOWED_ORIGINS` before testing on a new external site
5. **Access fields with special characters** using bracket notation: `event["Allow_Check-in"]`
6. **Run lint** before committing: `pnpm lint`

## Contributing

This project follows strict TypeScript conventions and code style. Please review [CLAUDE.md](./CLAUDE.md) before contributing.

## License

Licensed to MinistryPlatform customers for use, modification, and extension — no resale. © 2026 ACS Technologies (ACST). All other rights reserved. See [LICENSE](./LICENSE).

## Support

For Ministry Platform API documentation, refer to your instance's API documentation portal.
