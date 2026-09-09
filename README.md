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
- [Prayer & Feedback Intake](#prayer--feedback-intake)
- [Newsletter Sign-Up](#newsletter-sign-up)
- [Event Pre Check-In](#event-pre-check-in)
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

**30 framework-agnostic Web Components**, each registered as a custom element by the embed
SDK and rendered in Shadow DOM. They share a base class
(`packages/embed-sdk/src/shared/base-widget.ts`) that handles token fetching, automatic 401
refresh, localisation and the Shadow DOM lifecycle.

Every widget has a demo page at `packages/embed-sdk/demo-<name>.html` except
`next-locale-selector`, which needs no API, no token and no configuration to demonstrate —
setting `<html lang="es">` on any other demo page exercises the whole localisation path.

To re-measure this roster rather than trusting the count:

```bash
grep -rho 'customElements\.define(\s*"next-[a-z-]*' packages/embed-sdk/src | sort -u
```

### Events

| Element | Purpose | Service | API route |
|---|---|---|---|
| `<next-event-finder>` | Search and filter public events | `eventFinderService` | `/api/embed/event-finder` |
| `<next-event-details>` | One event, with registration | `eventDetailsService` | `/api/embed/event-details` |
| `<next-full-calendar>` | Events calendar (cards, list, mini-cal, modal) | `fullCalendarService` | `/api/embed/full-calendar` |
| `<next-add-to-calendar>` | Add an event to Google / Outlook / Yahoo / `.ics` | `addToCalendarService` | `/api/embed/add-to-calendar` |
| `<next-pre-check>` | Household pre-check for a service date, with check-in QR | `preCheckService` | `/api/embed/pre-check` |

### Groups and serving

| Element | Purpose | Service | API route |
|---|---|---|---|
| `<next-group-finder>` | Search and filter groups | `groupsService` | `/api/embed/group-finder` |
| `<next-group-details>` | One group, with inquiry and sign-up | `groupsService` | `/api/embed/group-details` |
| `<next-my-groups>` | The signed-in user's groups | `myGroupsService` | `/api/embed/my-groups` |
| `<next-opportunity-finder>` | Search serving opportunities | `opportunityFinderService` | `/api/embed/opportunity-finder` |
| `<next-opportunity-details>` | One opportunity, with response | `opportunityDetailsService` | `/api/embed/opportunity-details` |

### Giving and payments

| Element | Purpose | Service | API route |
|---|---|---|---|
| `<next-my-giving>` | Giving history and by-month chart | `myGivingService` | `/api/embed/my-giving` |
| `<next-my-pledges>` | Pledges, with cancel | `myPledgesService` | `/api/embed/my-pledges` |
| `<next-pledge-campaign>` | Make a pledge to a campaign | `pledgeCampaignService` | `/api/embed/pledge-campaign` |
| `<next-my-contribution-statement>` | Contribution statements | `contributionStatementService` | `/api/embed/contribution-statements` |
| `<next-statement-preferences>` | Paperless statement opt-in | `statementPreferencesService` | `/api/embed/statement-preferences` |
| `<next-my-invoices>` | List and view invoices | `invoiceService` | `/api/embed/invoices` |
| `<next-checkout>` | Cart checkout | `checkoutService` | `/api/embed/checkout` |
| `<next-checkout-complete>` | Post-payment confirmation | `checkoutService` | `/api/embed/checkout` |
| `<next-pay>` | Payment capture | `paymentService` | `/api/embed/pay`, `/api/embed/payment` |

### People and account

| Element | Purpose | Service | API route |
|---|---|---|---|
| `<next-user-menu>` | Profile dropdown with sign-in/out | `userService` | `/api/embed/session`, `/api/embed/auth/*` |
| `<next-profile>` | View and edit the signed-in profile | `profileService` | `/api/embed/profile` |
| `<next-my-household>` | Household members | `householdService` | `/api/embed/household` |
| `<next-online-directory>` | Church member directory | `onlineDirectoryService` | `/api/embed/online-directory` |
| `<next-plan-your-visit>` | Anonymous first-visit registration, email-verified | `planYourVisitService` | `/api/embed/plan-your-visit` |
| `<next-prayer-feedback>` | Prayer and feedback intake → `Feedback_Entries` | `prayerFeedbackService` | `/api/embed/prayer-feedback` |
| `<next-custom-form>` | Renders an MP Custom Form | `customFormService` | `/api/embed/custom-form` |

### Publications

| Element | Purpose | Service | API route |
|---|---|---|---|
| `<next-subscribe-to-publication>` | Anonymous newsletter opt-in, double opt-in by email | `subscriptionService` | `/api/embed/subscribe-to-publication` |
| `<next-subscriptions>` | Signed-in subscription management | `subscriptionService` | `/api/embed/subscriptions` |
| `<next-unsubscribe>` | One-click unsubscribe from an emailed link | `subscriptionService` | `/api/embed/unsubscribe` |

### Cross-cutting

| Element | Purpose | Service | API route |
|---|---|---|---|
| `<next-locale-selector>` | Language picker (`en`, `es`, `pt-BR`) | — | — |

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


## Prayer & Feedback Intake

`<next-prayer-feedback>` writes MinistryPlatform's **Feedback Entries** — prayer
requests, praise reports and general comments. It is the counterpart of the
legacy `mpp-prayer-feedback-form`, and for many churches it is the first thing
on the website that writes to MP.

**A hand-built Custom Form is not a substitute.** It writes `Form_Responses`,
populates no Feedback Type and no Program, and never appears in the tools staff
use to work a prayer queue — so the submissions land somewhere the prayer team
does not look. That is a different record in a different table, not a
configuration difference.

### Setup

The page's origin must be in `EMBED_ALLOWED_ORIGINS` (`src/lib/embed/config.ts`),
or `/api/embed/session` mints no token and every visitor sees an error. **This is
setup failure number one.**

```html
<next-prayer-feedback verification-email-template-id="5125"></next-prayer-feedback>
```

`verification-email-template-id` is a `dp_Communications` id whose **Body must
render `[mpp_verify_email_url]`**. It is required for signed-out submissions,
which is nearly all of them: with it absent the widget renders a configuration
notice instead of a submit button, so a misconfigured page fails visibly at load
rather than after a visitor has typed 2000 characters.

| Attribute | Required | Meaning |
|---|---|---|
| `verification-email-template-id` | for signed-out visitors | `dp_Communications` id. Must render `[mpp_verify_email_url]`. Also merges `[mpp_contact_first_name]` and `[mpp_contact_last_name]` — legacy's exact three tokens, so an existing template drops straight in. |
| `acknowledgement-email-template-id` | no | Sent once the entry is written, on **both** paths. Merges `[mpp_contact_first_name]`, `[mpp_contact_last_name]`, `[mpp_feedback_type]`, `[mpp_feedback_summary]`, `[mpp_date_submitted]`. |
| `feedback-type-ids` | no | Comma-separated `Feedback_Type_ID` allowlist for the dropdown. See the migration note below — the default changed. |
| `program-id` | no | `Feedback_Entries.Program_ID`. A positive integer; omitted from the write when absent. |
| `return-url` | no | Where the emailed link lands. Defaults to the current page with its query string stripped, so the common case needs no attribute. Must be **same-origin** with the page. |
| `verify-param-name` | no | Defaults to `mpp-verify-id`, legacy's spelling, so an existing MP template and an old bookmark keep working. |
| `default-private` | no | `"true"` pre-ticks Private. |
| `hide-private-option` | no | `"true"` hides the checkbox and forces the value from `default-private` — for a page whose whole framing is confidential pastoral care. |

### What a submission actually does

**Signed out** — nothing is written to MP. The submission is sealed server-side,
a one-time link is emailed, and the `Feedback_Entries` row (plus, for an address
MP has never seen, a `Households` + `Contacts` pair) is created only when that
link is opened. That double opt-in is what makes creating a contact safe:
without it an unauthenticated POST could mint rows in the CRM as fast as a script
can manage, and MP has no good bulk undo.

**Signed in** — the entry is written immediately, with no verification email. The
member may file for themselves or for a household member ("Provide Feedback As");
household membership is re-checked server-side on every write, so the picker is a
convenience rather than the boundary. Choosing "Someone else" takes the emailed
round-trip, because a signed-in member's verified identity says nothing about a
third party whose details they have just typed.

Either way the entry is written with `Approved = false` and, unless Private is
ticked, `Visibility_Level_ID = 4` (Public). Private submissions get
`Visibility_Level_ID = 2` (Staff Only).

### Migrating from `mpp-prayer-feedback-form` — four things changed

1. **A Custom Form is still not equivalent** (see above). If a church built one
   as a workaround, its historical submissions stay in `Form_Responses`; only new
   submissions reach the prayer queue.
2. **Omitting `feedback-type-ids` no longer offers every type.** Legacy offered
   all five, including `User Removal Request` — a GDPR erasure workflow wearing a
   prayer-form costume, which no church should be offering website visitors by
   accident. The default is now every `Feedback_Types` row *except* the removal
   type, excluded by both its stock id and a `/removal/i` name match so the guard
   survives a domain that renumbered the lookup. **List it explicitly
   (`feedback-type-ids="1,2,5"`) to get it back** — an explicit configuration is
   honoured, with one warning in the server log. It is a safety default, not a
   control: a determined caller can post the id directly, because MP's own
   foreign key accepts it.
3. **Signed-in submitters get no verification email** — only the acknowledgement,
   if one is configured. Fewer emails is the intended behaviour, not a broken
   template.
4. **A prayer-wall page must filter on `Approved = 1 AND Visibility_Level_ID = 4`,
   never on visibility alone.** Nothing publishes automatically, because
   `Approved` is always `false` at intake and there is deliberately no attribute
   to change that — an `auto-approve` flag would be a one-attribute path to
   unmoderated text on a church's website. A wall that filters on visibility
   only would expose unreviewed submissions.

Two smaller legacy behaviours also changed, both fixes:

- **The full 2000-character description survives.** Legacy's textarea allowed
  2000 and both its token and its insert cut at 1000, so a congregant's last
  thousand characters vanished silently.
- **A member's `Email_Address` is never overwritten.** Legacy rewrote it
  unconditionally with whatever the form held, so a typo in a public prayer form
  silently broke that member's giving statements and every other email MP sent
  them. The submitted address is now written **only** when the contact has none
  on file — which is the case legacy's own UI was built for.

### Notes for whoever reviews this later

- **The signed-out path performs zero MP writes.** That is the property the
  match-or-create design rests on, and it is asserted directly in
  `src/app/api/embed/prayer-feedback/submit/route.test.ts`.
- **No email-existence oracle.** `POST /submit` answers
  `{ status: "verification_sent" }` with the same body and status whether or not
  the address matches a contact — a deliberate divergence from
  `plan-your-visit`, which answers `contactExists: true`.
- **No entry against another person.** A contact id is never accepted from an
  unauthenticated caller. Legacy's `SendVerificationEmail` was `[AllowAnonymous]`
  and took `ContactId` off the form, so posting a stranger's id made the server
  harvest their real name and address and mail them a link that would file a
  prayer request against them.
- **The redemption is a POST**, so the handle never lands in an access log, a
  `Referer`, or a mail scanner's fetch of the emailed URL. The link resolves to a
  page that only renders; the widget on it issues the write. The handle is also
  single-use by construction (an atomic read-and-burn in the session store),
  which replaces legacy's duplicate guard — that guard interpolated user text
  into SQL and never matched for any entry over 1000 characters.
- Rate limits: **5/min per IP** and **3/hour per submitted address** (hashed),
  both checked before any MP call and any send.
- **Merge values are HTML-escaped.** A prayer summary is congregant-authored free
  text going into a template body that lands in a staff mailbox; legacy
  substituted it raw.
- The acknowledgement deliberately **does not merge the description**. A prayer
  request echoed back into an unencrypted mailbox is a disclosure the submitter
  did not ask for, and the summary identifies which request it confirms.


## Newsletter Sign-Up

`<next-subscribe-to-publication>` is the anonymous way onto one publication:
a signed-out visitor types a name and an email address, receives a confirmation
link, and clicking it subscribes them. It is the counterpart of legacy's
`mpp-subscribe-to-publication`, and it fills the gap `next-subscriptions` cannot
— that one is a signed-in management surface whose route refuses anonymous
callers outright, so before this the only route onto a mailing list was to
already have an MP account.

**Nothing is written until the link is opened.** Submitting the form validates
the input, seals it in the session store and sends one email. It does not read a
`Contacts` row, let alone write one. Opening the link creates the
`dp_Contact_Publications` row and, for an address MinistryPlatform has never
seen, a `Contacts` + `Households` pair.

### Setup

1. **Pick the publication.** It must be `Available_Online` in
   `dp_Publications`. A publication that is not flagged behaves exactly like one
   that does not exist — deliberately, so the id space cannot be probed for
   internal lists.
2. **Author the verification email** as a `dp_Communications` record. Its Body
   must render `[mpp_verify_email_url]`, or the visitor has no way to confirm.
   Three more tokens are available: `[mpp_contact_first_name]`,
   `[mpp_contact_last_name]` and `[mpp_publication_title]`. The template needs a
   From contact with an email address.
3. **Host the page on an allowlisted origin.** Its origin must be in
   `EMBED_ALLOWED_ORIGINS`, exactly as for every other widget — and here it is
   load-bearing twice over, because the confirmation link must be same-origin
   with the page that requested it.

```html
<next-subscribe-to-publication
  publication-id="4"
  verification-email-template-id="5125"
></next-subscribe-to-publication>
```

| Attribute | Required | Meaning |
|---|---|---|
| `publication-id` | **yes** | `dp_Publications.Publication_ID`. Must be `Available_Online`. |
| `verification-email-template-id` | **yes** | `dp_Communications.Communication_ID`. Its Body must render `[mpp_verify_email_url]`. |
| `return-url` | no | Where the confirmation link lands. Defaults to the current page URL with the query string stripped. Must be `https:` (localhost excepted), same-origin with the page, and carry no embedded credentials — otherwise the request is refused and **no email is sent**. |
| `verify-param-name` | no | The query parameter carrying the handle. Defaults to `nextwidgets_verify`. |
| `my-subscriptions-url` | no | Where "Manage all your email preferences" points. Rendered on the confirmed and already-confirmed states; omitted when unset. Use the same URL as `<next-unsubscribe>`'s. |
| `api-host` | no | Standard across the SDK. |

Events: `verificationSent { email }`, `subscribed { publicationId, email,
alreadySubscribed }`, `subscribeFailed { code }`.

### What a sign-up actually does

| Step | MinistryPlatform |
|---|---|
| The page loads | reads one `dp_Publications` row |
| The visitor submits | **nothing** — the submission is sealed in the session store and one email is sent |
| The visitor opens the link | resolves the address to a contact, or creates `Contacts` + `Households`; creates or un-flags the `dp_Contact_Publications` row |
| The visitor opens the link again | **nothing** — the handle is single-use |

A created contact carries `Email_Verified = true` (the double opt-in is exactly
the evidence that column records), `Contact_Status_ID` = Active,
`Household_Position_ID` = Head of Household, and a household whose
`Household_Source` is **Website** and whose congregation is the publication's, so
staff can tell a widget-created record from a hand-typed one. No participant row
and no milestone: a newsletter subscriber is not a participant.

### Migrating from `mpp-subscribe-to-publication` — five things changed

1. **The query parameter is `nextwidgets_verify`, not `mpp-verify-id`.** Every
   browser-visible key this SDK owns carries the `nextwidgets_` prefix. If a
   template already in the wild hard-codes the old spelling, set
   `verify-param-name="mpp-verify-id"` on the element rather than editing every
   link already in an inbox.
2. **The confirmation link is single-use, and lives three days** instead of
   being replayable for twenty-four hours. A second click says "you're all set"
   rather than confirming again. That is not politeness: a replayable link
   silently *re-subscribes* anyone who has unsubscribed in the meantime, and a
   mail-client prefetcher or a security scanner is enough to trigger it.
3. **A contact's `Email_Address` is never overwritten.** Legacy set it to
   whatever the public form held, for whatever contact id the caller named —
   which let anyone move a stranger's account to an address they controlled.
4. **The mobile-phone field is not ported.** A newsletter opt-in needs a
   mailbox; writing `Mobile_Phone` from an anonymous form interacts with texting
   consent in ways a subscription form should not decide. Ask if you want it
   back — it is a small change.
5. **The signed-in "Subscribe As" household dropdown is not ported.** A member
   managing a household member's subscriptions has `<next-subscriptions>`, and
   dropping it is what lets the confirmation handle name only an email address
   rather than a contact row.

Also improved: the publication is matched **by address alone**, where legacy
required first name, last name and address to agree — so "Bob Smith" signing up
when MinistryPlatform holds "Robert Smith" at the same address no longer creates
a duplicate contact.

### Notes for whoever reviews this later

- **The first hop reads no `Contacts` row at all.** Not "looks the address up
  and hides the answer" — it does not perform the query, so there is no branch
  to leak and no timing difference to measure. A known address, an unknown one
  and an already-subscribed one produce byte-identical responses, asserted on
  the serialised body in
  `src/app/api/embed/subscribe-to-publication/send-verification/route.test.ts`.
- **The handle names an address, never a contact.** That is the structural half
  of the takeover fix above: a token naming a contact row would be a
  contact-scoped write credential sitting in an inbox.
- **The handle also carries the origin it was minted on**, checked on
  redemption, so a link minted on one allowlisted church site cannot be redeemed
  from another. A mismatch answers exactly what a forged handle answers.
- **The redemption is a POST.** A state-changing GET is fetched by mailbox link
  scanners and URL-rewriting gateways — which here would subscribe someone who
  never clicked. The emailed link resolves to a page that only renders; the
  widget on it issues the write.
- Rate limits: **5/min per IP** and **3/hour per submitted address** (hashed),
  both checked before any MinistryPlatform call and any send, and both
  fail-closed — failing open on an endpoint that emails a submitted address
  turns a store outage into an open relay.
- **`return-url` is validated against the request origin.** The church's own
  domain sends the mail, so an unvalidated link inherits its credibility;
  legacy interpolated the attribute straight into the email with no check of any
  kind.
- **Merge values are HTML-escaped**, unconditionally, by
  `messageTemplateService`.
- Not implemented yet: the `recaptcha-site-key` opt-in bot check. The server
  accepts and verifies a `recaptchaToken` when one is posted, but the element
  does not render a challenge.


## Event Pre Check-In

`<next-pre-check>` lets a family check itself in for a day's check-in events
before it arrives, so the household is already on the check-in station's
*expected* list on Sunday morning. It replaces legacy's `mpp-pre-check`.

**This widget requires a signed-in MP user.** It reads and writes a household's
attendance, so unlike the newsletter and prayer widgets it will not work for an
anonymous visitor — a signed-out page renders a sign-in prompt instead.

### Before it will work: what your MP domain needs

Four things. The first is the only one that is not usually already true.

1. **The stored procedure `api_MPPW_GetPreCheckEvents` must be installed and
   granted to your API client.** It ships in MinistryPlatform's own widget
   database scripts, in the same registration and grant block as eight
   procedures this SDK already uses (`api_MPPW_GetMyPledges`,
   `api_MPPW_GetEvents`, `api_MPPW_SearchGroups`, …) — so if any of the event,
   giving or group widgets work for you, this one almost certainly will too.
   If it is missing, the widget renders *"Check-in is not set up for this site
   yet. Please contact the church."* and writes nothing. Ask your MP
   administrator to run the widget database scripts.
2. **Your events must have Allow Check-in ticked.** The widget only ever lists
   events on the chosen date with that flag set. An event without it is
   invisible here, which is the intended behaviour, not a fault.
3. **Understand the Search Results setting on each event**, because it decides
   who is listed and it is the single most common reason a family sees an empty
   page on a day that definitely has services:

   | Event's *Search Results* | Who the widget lists |
   |---|---|
   | Allow Guests (Show Everyone) | every member of the household |
   | Allow Expected Only (Show Everyone) | every member of the household |
   | **Allow Expected Only (Show Expected Only)** | **only members who already belong to one of the event's groups, or who already have a registration for it** |

   The third is MP's default on many check-in events. With it, a household whose
   children are not in that event's groups sees nobody — correctly. If parents
   report "the page is blank", check the event's groups before anything else.
4. **The API client's user needs write access to `Event_Participants`** (and to
   `Participants`, for the case below). The widget writes as your API client,
   attributing each change to the signed-in parent for the audit trail.

### Adding it to a page

```html
<!-- Defaults to today in your MP domain's time zone, resolved on the server -->
<next-pre-check></next-pre-check>
```

That is the whole production form. The date is resolved server-side in the
church's own time zone, so a visitor in another zone still gets the church's
idea of today.

| Attribute | Default | What it does |
|---|---|---|
| `event-date` | today, in the MP domain's zone | Pin a specific day. Must be `YYYY-MM-DD`. |
| `allow-date-picker` | `false` | Show a date field so a visitor can move between days without a new URL. |
| `read-query-string` | `false` | Opt back into legacy's `?eventDate=` host-page query parameter. Off by default because silently obeying an arbitrary URL parameter is a surprise on a shared CMS page. |
| `show-qr` | `false` | Render the check-in QR code. **See the warning below before turning this on.** |
| `api-host` | auto | Standard across the SDK. |

### The QR code is off by default, deliberately

Legacy always drew a QR code encoding `pre|M/d/yyyy|householdId`. This widget
can produce a byte-identical one, but ships with it **off**, and you should
leave it off until you have tested it.

The reason: that payload predates MP's newer `Allow QR Check-in` /
`QR Redirect URL` event fields, which are a different (URL-redirect) mechanism.
Whether a *current* check-in station still scans the older barcode can only be
answered at a physical station, not from any source code. **Print one, scan it
at your own check-in station, and turn `show-qr="true"` on only if it works.**

Nothing is lost by leaving it off. The pre-check submission is what actually
shortens the queue — it writes the registration rows that put the family on the
station's expected list — and it works with or without a code on screen.

### What a submission actually does

Ticking a box and pressing *Check In* writes an `Event_Participants` row at
status **02 Registered** for that person and event, creating one or updating the
existing one. Unticking a box sets the existing row to **05 Cancelled**.

- **No row is ever deleted.** A cancellation is a status change, so the history
  of who had planned to come survives.
- **A person a station has already scanned in cannot be changed.** Rows at
  *03 Attended* or *04 Confirmed* render checked and greyed out, and the server
  refuses to write them in either direction. This is a deliberate fix to a
  legacy defect: `mpp-pre-check` would overwrite an attendance record with
  *Cancelled* if a parent opened the page after check-in and unticked the box.
- **A household member with no Participant record gets one**, created with the
  participant type from your `PORTAL` / `DefaultParticipantTypeID` configuration
  setting and noted `Created by Web Widget` — the same thing legacy did.
- Nothing else is written. `Time In`, `Room`, `Check-in Station` and RSVP status
  are the station's to set; a pre-check must not look like an attendance.

**Check for your own Processes and Webhooks on `Event_Participants` before you
launch this.** One household submitting on a Saturday night can write a dozen
rows in a second. Nothing MP ships reacts to these rows, but a church-authored
automation would fire once per row.

### Migrating from `mpp-pre-check` — five things changed

1. **Signed-out visitors get a way in.** Legacy printed *"You need to log in"*
   with no login control at all. This renders a sign-in prompt — with a working
   Sign In button in `dual`/`hardened` auth mode, and instructions pointing at
   your page's own sign-in link in `legacy` mode, where the SDK cannot start a
   sign-in itself.
2. **The date no longer depends on the visitor's time zone.** Legacy read
   `?eventDate=` and ran it through the browser's clock, so a visitor west of
   UTC opening the page on a Saturday evening asked the server for Sunday. The
   date is now resolved on the server in the church's zone.
3. **Times display in the visitor's language.** Legacy hardcoded US English
   formatting, so a Spanish-speaking parent read `9:00 AM` where `9:00` is
   correct.
4. **A submission can only ever touch the signed-in user's own household.**
   Legacy's server accepted six record ids from the browser and wrote them
   without checking any of them. Nothing sent by the browser is now used as an
   id.
5. **The `?eventDate=` URL parameter is off unless you ask for it.** Set
   `read-query-string="true"` if you are porting a page that already links with
   it.

### What this widget cannot translate

Event titles, group names and role titles come from MinistryPlatform and are
shown exactly as your staff entered them. Only the widget's own labels are
available in Spanish and Portuguese.

### Notes for whoever reviews this later

- `MPHelper.getProcedures()` searches by **exact name**, not substring — the
  availability probe passes the full `api_MPPW_GetPreCheckEvents`. A friendlier
  partial term returns an empty list on every domain, installed or not, and
  would make the widget permanently report itself unavailable.
- On the reference sample domain the only date where household 5 (the
  `Check-me-in` family) resolves rows is `2018-06-12` — event 2 is the one
  check-in event whose *Search Results* is `Allow Guests`. The 2025 Sunday and
  Tuesday class series are `Show Expected Only` and their groups do not overlap
  that household's, so they correctly list nobody. `demo-pre-check.html` pins
  that date for exactly this reason.
- The QR encoder is `src/lib/qr/encode.ts`, written here rather than taken as a
  dependency. Its tests decode their own output, so a change that breaks
  scannability fails the suite rather than shipping a picture nobody can read.


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
