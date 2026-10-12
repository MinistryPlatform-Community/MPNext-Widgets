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

Snapshot at 2026-10-11 (re-measured): **33** registered `next-*` elements, 32 demo
pages, 33 `src/app/api/embed/` route directories, 32 services.
- These are the same numbers as on 2026-09-11. The comparison-remediation epic
  (closed 2026-10-11) fixed widgets rather than adding them. `C`-numbers in code comments
  (C79, C81, …) name its findings; their write-ups are in git history
  (`git log --all -- .claude/TODO/Comparison`).
- What it added went into `shared/` primitives, base-class conventions, three
  `src/services/_shared/` helpers and guard tests. All of these are covered below.

The counts diverge on
purpose: `next-locale-selector` has no demo page, because it needs no API, no token and
no configuration to demonstrate — `<html lang="es">` on any existing demo page exercises
the whole localisation path. The service count no longer moves with the widget count
either: `next-subscribe-to-publication` extends `subscriptionService.ts` rather than
forking a second file for the same two MP tables, and `src/services/_shared/` is a
directory the `ls src/services/*.ts` glob does not reach. Route directories no longer run
*ahead* of elements: `auth/` and `session/` are route directories with no widget, and
`next-pre-check` owns one directory holding two routes (`pre-check/` and `pre-check/qr/`),
but `next-mission-trip-finder` and `next-my-mission-trips` now **share** one `mission-trips/`
directory holding four routes, which cancels the surplus out. That is the clearest
illustration of why the numbers are measured rather than reasoned about. (Earlier snapshots
said 26/25/27/27 and 30/29/31/30, each having already fallen behind — which is exactly why
the paragraph above says not to trust the number over the disk.)

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
├── services/                  # Singleton services wrapping MPHelper (one per widget domain)
└── services/_shared/          # mp-lookup.ts (sqlLiteral, clean, toNumberOrNull, cap, getIdByValue),
                               #   public-events.ts, id-batches.ts, household-contact.ts
packages/
├── embed-sdk/                 # @mpnext/embed-sdk (Vite library, ES output only)
│   ├── src/components/        # One `next-*` Web Component per widget, plus 5 `full-calendar-*`
│   │                          #   sub-modules (cards, list, mini-cal, modal, styles) that
│   │                          #   full-calendar.ts composes and that register no element
│   ├── src/shared/            # base-widget, api-client, auth-session, cdn-loader,
│   │                          #   form-validation, google-places, custom-form, card-link,
│   │                          #   dialog-focus, theme-tokens, html
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

**Guard tests.** Each one exists because a defect class survived when nothing checked for
it. Several are ratchets: they fail when a count goes over its budget, and also when it goes
under, so a fixing commit lowers or deletes its own entry. Never add to a ratchet.

| Guard | Fails when |
|---|---|
| `src/lib/no-template-concat.test.ts` | two template literals are joined with `+` (see Toolchain) |
| `packages/embed-sdk/src/components/observed-attributes.test.ts` | an `observedAttributes` entry is not kebab-case. `attributeAliases` values are exempt, and the `LEGACY_SPELLINGS` ratchet is empty (C79). |
| `packages/embed-sdk/src/shared/theme-tokens.test.ts` | a widget stylesheet writes a raw brand hex or the token font stack instead of a `--_nw-*` token. The ratchet reached zero and is now a plain assertion. |
| `packages/embed-sdk/src/components/no-raw-error-message.test.ts` | a catch block renders a caught `.message`, or a translated message is thrown as a plain `Error` instead of a `WidgetError` |
| `packages/embed-sdk/src/components/render-binds-listeners.test.ts` | `this.render();` is directly followed by `this.attach…Listeners();`. `render()` must re-bind its own listeners, because a locale switch re-renders through `render()` alone. |
| `src/lib/no-silent-empty-catch.test.ts` | a `catch` under `src/services/**` returns an empty result (`[]`, `null`, `{}`, a bare `return`, …) without a `console.*` call (C20) |
| `src/services/mp-url-length.test.ts` | a service's real read path builds an MP query string over IIS's 2048 limit. It drives the real `MPHelper` with `fetch` stubbed and a ≥120-char base URL (C50). |
| `src/services/mp-column-names.test.ts` | a service writes or `$select`s a column that is missing from the generated MP models. It scans every resolvable `{ table, select }` (C40, C83). |
| `packages/embed-sdk/src/i18n/*.test.ts` | the four i18n guards fail (see Widget Localisation) |

**E2E runs three Playwright projects** (`playwright.config.ts`). Auth mode is a per-origin
*server* decision, so one Next server serves three Vite demo origins:

| Project | Origin | Mode | Runs |
|---|---|---|---|
| `widget` | `:5173` | whatever `.env.local` configures | every spec except the two below |
| `widget-legacy` | `:5174` | pinned to `legacy` | `auth-only-widgets-signed-out.spec.ts` |
| `widget-dual` | `:5175` | pinned to `dual` | the signed-out spec, plus `signed-in-invoice-participants.spec.ts` |

The config passes `EMBED_ALLOWED_ORIGINS` and `EMBED_AUTH_MODE_ORIGINS` to the `next dev`
that it starts. Prerequisites:

1. **Let Playwright start the dev server.** A server you started yourself (picked up through
   `reuseExistingServer`) does not have that env. The `embedConfig` fixture then **fails
   loudly** with a 403 or a mode mismatch on `:5174`/`:5175`. That is deliberate: the
   alternative is silently testing the wrong mode.
2. **The signed-in specs need two things:**
   - the Playwright credentials (below);
   - `http://localhost:3000/api/embed/auth/callback` registered as a redirect URI on the MP
     `TM.Widgets` OAuth client. Without it, MP answers "redirect URI is not registered".
     `e2e/widget/mp-login.ts` reports that message instead of timing out.
3. **Accessibility probe.** `a11y-probe.spec.ts` covers every demo page: accessible names,
   no `role="link"` without an `href`, focus inside every `aria-modal`, and at least one
   heading per widget.

**Playwright test account**: `PLAYWRIGHT_MP_USERNAME` / `PLAYWRIGHT_MP_PASSWORD` in `.env.local`. This is a non-admin MP OAuth user with **MFA disabled**.

**Dev auth**: Widget session auth is origin-based — no tenant id or init token. The `/api/embed/session` route validates the request origin against `EMBED_ALLOWED_ORIGINS` (`src/lib/embed/config.ts`). Local dev origins: `localhost:3000`, `localhost:5173` (and 127.0.0.1 variants).

**Auth mode locally**: `EMBED_AUTH_MODE` defaults to `legacy` (demo pages use `<mpp-user-login>` from MPWidgets.js). To exercise the hardened flow, set `EMBED_AUTH_MODE=dual` (or `EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual` to switch only the Vite demo) and register `http://localhost:3000/api/embed/auth/callback` as a redirect URI on the MP OAuth client. No `UPSTASH_REDIS_REST_URL` → in-memory session store, which works out of the box (it is kept on `globalThis` so the RSC and route-handler bundles share it and HMR does not sign you out); sessions reset when the dev server restarts. No Redis or loopback shim is needed to sign in locally. Demo pages show the resolved mode in a banner. `e2e/widget/login-hardened.spec.ts` runs the full login only when the Playwright creds are set and the mode is not `legacy`.

## Toolchain & Pinned Versions

Node **24** (`.nvmrc`, `engines.node: 24.x`, CI). TypeScript **6.0.3**, Next **16.4.0**,
React **19.3.0**, Better Auth **1.7.7**, Vitest **5** + `@vitest/coverage-v8` **5** on
jsdom **30**, ESLint **10.12.0**, chalk **6**, `@testing-library/jest-dom` **7**, dotenv
**18**. `pnpm install` is warning-free.

`eslint-plugin-react`, `-import` and `-jsx-a11y` still declare peers that stop at ESLint 9.
Since 16.4.0, `eslint-config-next` wraps the first two in its own `fixupPluginRules`
(`dist/rule-context.js`), which restores the context methods ESLint 10 removed, so
`settings.react.version: "detect"` works again with no local workaround. The three
plugin→`eslint` peer edges are suppressed in `package.json` `pnpm.peerDependencyRules`,
scoped per plugin and pinned to `"10"`, so the warning returns at ESLint 11 and prompts a
re-check. Do not widen that pin to `"*"`. Do not move the rule into `pnpm-workspace.yaml`
either: pnpm exports workspace settings to the `preinstall` hook as npm config, which prints
`npm warn Unknown env config` on every install.

**One pin is deliberate — read the TODO before bumping it.** It was attempted and
reverted on 2026-09-07:

- `typescript` stays **6.0.3**. TS 7 is blocked upstream: `typescript-eslint` throws
  `does not support TS 7.0` inside `eslint-config-next`'s import chain, so `pnpm lint`
  fails outright. See `.claude/TODO/03-typescript-7.md`.

Do not bump `@types/node` off the 24 line (`^24.19.2`) — it matches the Node 24 runtime.

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
4. Token ladder: `#nextwidgets_auth` handoff code → `POST /api/embed/auth/exchange` → `sid` (localStorage `nextwidgets_sid`; sessionStorage with `session-scope="tab"`); then `POST /api/embed/session { wid, sid }` → JWT v2; `401 invalid_session` clears the sid. Outside `hardened`, a valid legacy `mpp-widgets_AuthToken` is sent as `mpUserToken` (v1 in `legacy`; silent upgrade to a `sid` in `dual`). Otherwise a public JWT.
5. JWT (5-min expiry) is cached in memory until 30s before `exp`; widgets render in Shadow DOM and call the API with Bearer + auto-refresh on 401
6. Sign In (dual/hardened) = top-level redirect to `/api/embed/auth/login` → MP authorize → `/api/embed/auth/callback` creates the encrypted server session and returns to the page with `#nextwidgets_auth=<code>`

**Design**: Web Components + Shadow DOM (no framework deps), JWT+CORS auth, multi-tenant origin allowlists, MP tokens only in the encrypted server session (never in the JWT or host-page storage in `hardened`). Widget forms use the shared `packages/embed-sdk/src/shared/form-validation.ts` (no native `reportValidity` popup).

**The element roster** (33 as of 2026-09-11 — this is the one place it is listed; re-measure with the command in Overview rather than trusting it):
`next-add-to-calendar`, `next-checkout`, `next-checkout-complete`, `next-contact-attributes`,
`next-custom-form`,
`next-event-details`, `next-event-finder`, `next-full-calendar`, `next-group-details`,
`next-group-finder`, `next-mission-trip-finder`,
`next-my-contribution-statement`, `next-my-giving`,
`next-my-groups`, `next-my-household`, `next-my-invoices`, `next-my-mission-trips`,
`next-my-pledges`,
`next-locale-selector`, `next-online-directory`, `next-opportunity-details`,
`next-opportunity-finder`,
`next-pay`, `next-plan-your-visit`, `next-prayer-feedback`, `next-pre-check`,
`next-pledge-campaign`,
`next-profile`, `next-statement-preferences`, `next-subscribe-to-publication`,
`next-subscriptions`, `next-unsubscribe`, `next-user-menu`.

**There is no `next-mission-trip` element, and that is deliberate.** Legacy's
`mpp-mission-trip` has no distinct behaviour: `api_MPPW_GetPledgeCampaign` declares an
`@IsMissionTrip bit` parameter and never references it in the body, and the two legacy
clients share the household "apply as" picker, the custom form, the has-pledged check and
the confirmation email. `next-pledge-campaign` is the mission-trip details page — the finder
links to it through the `id-parameter-name` attribute both elements share.

**MP widget styling**: `public/embed-sdk/mp-widget-overrides.css` injected into MP Shadow DOM widgets via `customcss` attribute. User-menu applies this automatically.

## Widget Building Blocks

These were built once, in the comparison-remediation epic's W0, so that no widget
hand-rolls them again. `.claude/references/widget-building-blocks.md` has the signatures
and a copy-ready snippet for each one. **Do not fork a primitive.** If
one is wrong, fix it in `shared/`.

**Signed-out is a state, not an error** (`MPNextWidget`, C81).
- Use `this.isNeedsAuth(resOrBody)` to detect it. It is true for a 401, or for an
  `auth_required` / `session_expired` / `invalid_session` body, but **only when the
  request's token was public**. A 401 that reaches a signed-in visitor is an error with
  Try Again.
- Render the state with `this.renderSignInRequired({ subject, message, className, buttonClass })`.
  - In `dual` / `hardened` it draws a **Sign In** button.
  - In `legacy` there is **no button**: MPWidgets.js's `<mpp-user-login>` owns sign-in. It
    says "use the sign-in link on this page" and fires a passive `loginRequired` once.
  - The base class delegates `[data-action="login"]`, so never bind it yourself.
  - The panel never shows Try Again.
- Auth-only widgets must branch on `isNeedsAuth` *before* their generic error path.

**Result cards are real links** (`shared/card-link.ts`, C05/C10/C22/C45).
- `cardLink({ href, className, body, attrs })` renders an `<a>`. With no `href` it renders
  `role="article"`, and it refuses `javascript:` and `data:` URLs.
- `cardButton(...)` is the button variant, for rows that act in place.
- `bindCardSelect(root, selector, onSelect)` emits the selection event without hijacking
  the navigation.
- Never write `role="link"` with `tabindex` and a `window.location` handler.

**Labelled form controls** (`shared/form-validation.ts`, C28/C29).
- `field({ name, label, type, required, idPrefix: this.instanceId, ... })` returns a real
  `<label for>` plus a control.
- `type: "tel"` adds `autocomplete="tel"` and `inputmode="tel"`.
- A missing required value reads "{label} is required."
- `this.instanceId` keeps ids unique when two widgets share a page.

**Dialogs and menus** (`shared/dialog-focus.ts`, C08/C54).
- Open with `dialogFocus(container, trigger, { onEscape, trapTab, restoreOnOutsideClick })`.
  It traps Tab, including through open shadow roots, and handles Escape.
- On close, `handle.release(reason)` returns focus to the trigger. An outside click does
  not steal it back.
- Pass `trapTab: false` for a `role="menu"`.
- Pass the trigger as a function if `render()` replaces it.

**Errors are thrown translated, rendered through `caughtText`** (`MPNextWidget`).
- A message the widget has already translated is thrown as `new WidgetError(this.errorText(...))`
  or `new WidgetError(this.t(...))`.
- A catch renders `this.caughtText(err, "errors.network")`. That shows a `WidgetError`'s text
  and sends anything else (the browser's "Failed to fetch", a `TypeError`) to `console.error`
  behind the catalogue fallback.
- Never interpolate a caught `.message` into markup. `no-raw-error-message.test.ts` enforces it.

**Headings honour `heading-level`** (`shared/heading-level.ts`).
- `headingTag(this.getAttribute("heading-level"), offset)` returns `h2` by default, or the level the page sets. Pair it with
  `HEADING_RESET_STYLES` so the swap from a `<div>` changes nothing visually.
- Every widget emits at least one heading in every state; the a11y probe checks.

**Late attribute changes reconfigure the widget** (`MPNextWidget`, C39).
- Set `this.painted = true` after the first paint, and override `protected reload()`.
- The base `attributeChangedCallback` → `reconfigure()` calls `reload()` once the widget is
  painted and connected.
- **Never guard on `oldValue !== null` or on "already loaded"**: that was the bug.
- An attribute that is read at the moment it is used (a template id, a return URL) needs no
  reload, which keeps a half-filled form intact.

**Attribute names are kebab-case** (C79; enforced by `observed-attributes.test.ts`).
- To rename an attribute, declare `static readonly attributeAliases = { "new-name": "oldname" }`.
- List `...Object.values(this.attributeAliases)` in `observedAttributes`.
- Read the value through `this.readAttr("new-name")`. It falls back to the alias and warns
  once per class.
- The five legacy spellings (`hidesoftcredits`, `hidegrouplife`, `hideaddhouseholdmember`,
  `hidecancelbuttonpledge`, `cancelpledgeemailtemplate`) are accepted for one release.
- A brand-new attribute gets no alias.

**`render()` re-binds its own listeners.**
- A locale switch, `setMessages()` or a `lang` edit re-renders through `render()` alone.
- A widget that binds in a separate `attachListeners()` called by its own call sites comes
  back with dead buttons.
- Either `render()` calls the binder, or the widget binds once by delegation.
- `render-binds-listeners.test.ts` enforces this.

**Escaping**: use `escapeHtml` / `escapeAttr` / `renderAttrs` from `shared/html.ts`.

## Theming Tokens (`--nw-*`)

`shared/theme-tokens.ts` declares 36 public tokens: colour, type, shape, space and
controls. `injectStyles()` prepends them to every widget sheet. README "Theming" documents
them as a **supported, versioned API**. `part=` hooks, a `custom-css` attribute and a
domain stylesheet are not planned. The
raw-value → token table for converting a stylesheet is in
`.claude/references/widget-building-blocks.md` §2.

- **Public input, private resolved name.**
  - A church sets `--nw-color-primary` (on `:root` or on the element).
  - The SDK never declares that name. On `:host` it declares
    `--_nw-color-primary: var(--nw-color-primary, #004C97)`.
  - Widget CSS reads **only `var(--_nw-…)`**.
  - Declaring the public name on `:host` would make the default beat an inherited `:root`
    override, so only rules aimed at the element itself would reach the widget.
- **Light-DOM portal styles use the public name with a fallback.** Some styles are appended
  to `document.head`, for example `user-menu` `getPortalStyles()`. No `--_nw-*` is defined there, so write
  `var(--nw-color-primary, #004C97)`. The guard ignores fallback hexes.
- **`full-calendar-styles.ts`** maps its brand `--fc-classic-*` defaults onto the tokens,
  keeping the old hex as the `var()` fallback. The `:host` contract described under
  Toolchain must stay complete.
- **A new colour role is a new token.** Add it to `theme-tokens.ts` and to README
  "Theming", rather than writing a raw hex. `theme-tokens.test.ts` allows no raw brand
  value at all. `--nw-color-warning` (pending/warning amber) exists separately from
  `--nw-color-accent` so a re-brand never recolours a payment status.
- **`injectStyles()` keeps host-adopted sheets.** The widget's own sheet goes first and is
  replaced in place, so a sheet a host adopts into the open shadow root survives
  re-render and wins on equal specificity.

## Widget Localisation

Ships **`en`, `es`, `pt-BR`**. Closes comparison findings C67 and C73. The
catalogue is **TypeScript in this repo - deliberately not MinistryPlatform**: a new
language is a developer step plus a deploy, and no church-authored copy is read from MP.
Full design and the deliberate limits: `WIDGET-I18N-PLAN.md`; customer-facing docs in
README "Widget Languages".

**Widgets never import the i18n module.** `shared/base-widget.ts` exposes `this.t`,
`this.fmt`, `this.locale` and `this.errorText`, the same way it owns the token plumbing.
Call `await this.initLocale()` at the top of `connectedCallback` and **before the first
`render()`** - that ordering is what stops a Spanish visitor seeing English swap to
Spanish, and it is nearly free because every widget already paints a loading state while
it fetches its own data.

```ts
connectedCallback() {
  this.injectStyles(this.getStyles());
  void this.initLocale().then(() => { this.render(); this.init(); });
}
```

**`en` defines the shape; every other locale `satisfies Messages`.** So a missing, extra
or misspelled key is a `tsc --noEmit` failure, and adding a language is "write the file
and let the compiler enumerate what is left". Catalogues are grouped one file per widget
domain (`core`, `events`, `groups`, `giving`, `people`, `account`) under
`packages/embed-sdk/src/i18n/locales/<code>/`. Reuse `common.*` / `fields.*` /
`errors.*` / `validation.*` before adding a namespaced key - "Try Again" alone had 17
copies before this landed.

**Message format is an ICU-*syntax* subset**, not an ICU implementation: `{name}`
interpolation plus plural selection through `Intl.PluralRules`, called as
`t(key, { count: n })`. ~60 lines, no dependency. Never hand-roll
`${n !== 1 ? "s" : ""}`. **A plural must supply every CLDR category the locale can
select**: `es` and `pt-BR` both report `many` (whole millions) as well as `one`/`other`,
so a two-branch plural fails `catalogue-parity.test.ts` for those locales.

**`en` is inlined; `es`/`pt-BR` are lazy chunks.** `registry.ts` reaches them through
`() => import("./locales/es")`, which rolldown code-splits. Two build facts go with that,
both load-bearing:
- `vite.config.ts` pins `chunkFileNames` to a **`next-embed`-prefixed** pattern, because
  `scripts/copy-sdk.js` publishes and prunes `public/embed-sdk/` by that prefix. A
  default-named chunk is built, never published, and 404s in production - and does *not*
  reproduce under `vite dev`, which serves the import off the filesystem.
- `vercel.json` needs a matching `source` entry for CORS. These chunks are fetched
  cross-origin from church sites; without it the SDK works locally and breaks everywhere.

**`formatters.ts` takes no `timeZone`, and must not.** MP returns wall-clock strings; the
widgets parse the calendar parts into a *local* `Date` and format with no zone, so the two
cancel and the wall clock survives. Adding the domain zone here would re-introduce exactly
the day-shift that parsing exists to avoid. This module changes the **locale only**.
`.claude/references/ministryplatform.datetimehandling.md` governs the server boundary,
which is a different problem.

**Locale resolution** (`i18n/locale-session.ts`, shaped like `shared/auth-session.ts`),
highest first: element `lang` -> `MPNextEmbed.setLocale()` -> visitor's stored `nextwidgets_locale`
-> nearest `[lang]` ancestor or `<html lang>` -> `navigator.languages` -> `en`. The
`<html lang>` rung is the one that matters in practice - a bilingual CMS already sets it,
so those sites need no snippet change.

**`lang` is watched with a `MutationObserver`, not `observedAttributes`** - no edit to 30
static attribute lists (11 components have none), and it sidesteps
`attributeChangedCallback`, several of which ignore the first set (C39). The base class
reflects the resolved locale back onto the host as `lang`/`dir` for assistive tech, and
`declaredLang()` distinguishes a page author's `lang` (an input, rung 1) from that
reflection (an output). Without that distinction the first render pins a widget's locale
forever. `dir` must be an attribute: `:host { all: initial }` resets `direction`.

**A subclass with its own `disconnectedCallback` must call
`super.disconnectedCallback()`** - the base class unsubscribes the locale listener and the
observer there, and six components define one.

**API errors are machine codes.** `src/app/api/embed/**` answers
`{ error: "<snake_case_code>", message: "<English>" }`. Widgets render
`this.errorText(payload)`; the English `message` is logged and **never** rendered, so a
congregant never reads "Missing formId or formGuid" in any language. An unmapped code
degrades to `errors.generic`. `invalid_session` and `invalid_code` are protocol signals the
SDK auth ladder reads - do not rename them. Codes whose catalogue key is spelled
differently are listed in `WIRE_CODE_KEYS` (`shared/base-widget.ts`) rather than
duplicated across three catalogues.

**MP-authored content is not translated and cannot be** by a file-based catalogue: event
titles and descriptions, group/opportunity names, congregation and ministry names, **MP
Custom Form field labels**, product and fund names, statement PDFs, MP's notification
emails, **`Attribute_Types` and `Attributes` names** (so `next-contact-attributes` renders
"Spiritual Gifts" as staff typed it on a Spanish page), and **`Pledge_Campaigns` campaign
names and descriptions** (so a mission trip keeps its MP title everywhere). Legacy `GetLabels` did not solve this either - it translated labels, not content.
Say so in customer migration notes.

**Tooling**
- `pnpm i18n:check` - missing / dead / **stale** keys. Staleness is the real failure mode
  here: English moves, the translation does not, and the result is a present, well-typed,
  confidently wrong sentence. Baselines live in `packages/embed-sdk/i18n-sources/`.
- `pnpm i18n:sync` - re-record those baselines after a translation pass.
- `MPNextEmbed.enablePseudoLocale()` - accents and pads every string in the browser.
  Unextracted literals stay plain ASCII; layouts that cannot take the 20-30% expansion
  Spanish and Portuguese cost break visibly.
- `MPNextEmbed.setMessages(scope, map)` - church label overrides (C67 part 1), a different
  thing from translation. Beats the catalogue and the English fallback.

**Four guard tests, and they are the reason this does not decay**
- `i18n/no-english-literals.test.ts` - per-file **ratchet**, failing both *over* budget (a
  regression) and *under* it (lower the number in the same commit). Finish line: every
  entry at 0, then collapse the table.
- `i18n/catalogue-parity.test.ts` - keyset, message kind, interpolation placeholders,
  plural-branch coverage.
- `i18n/error-codes.test.ts` - every code the routes can emit has a message in all three
  locales, and no route answers with English prose.
- `i18n/widget-locale.test.ts` - the resolution ladder, the reflected-vs-declared `lang`
  distinction, subscription cleanup, `errorText`.

`scripts/i18n-scan.mjs` backs the ratchet and the CLI so the number CI enforces cannot
drift from the one a developer sees. It scans **template literal bodies, recursively**,
and skips `console.*` arguments - three earlier drafts were wrong in instructive ways: a
whole-file scan reported `Promise<void>` generics as UI copy; a single-level scan missed
every string inside a nested ternary template, under-counting `my-invoices.ts` at 13 when
it had 27; and counting `console.warn` diagnostics treated developer messages as
congregant-facing copy.

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
`MPHelper` from a route — **unless the domain already has one**, which is why
`next-subscribe-to-publication` extends `subscriptionService.ts` rather than forking a
second file over the same two publication tables. `ls src/services/` is the roster; there
is no index to keep in sync.

`src/services/_shared/mp-lookup.ts` holds the helpers more than one service needs:
`sqlLiteral` (doubling a quote for an MP `$filter` literal), `clean`, `toNumberOrNull`,
`cap`, and `getIdByValue` — cached resolution of a lookup-table id from its
human-readable value, so no service hard-codes `Contact_Status_ID = 1` on a domain whose
conversion renumbered it. **Import `sqlLiteral` from there rather than writing a fourth
copy**; the three that existed were byte-identical and a divergence between them would
have been an injection bug, not a style inconsistency.

The comparison-remediation epic added three more shared helpers, plus two rules for the
services that use them.

- **`publicEventFilter(clause, prefix?)`** (`_shared/public-events.ts`, C06). This is the
  one definition of an event a public widget may show: `Cancelled = 0 AND
  Visibility_Level_ID = 4`. Every service that reads `Events` for a public token composes
  its `$filter` through it rather than restating the predicate. C06 was three routes
  drifting apart.
- **`readByIdBatches(ids, read)`**, built on `idBatches` and `inFilter(column, batch)`
  (`_shared/id-batches.ts`). Use it for any read keyed by a data-driven id list.
  - A filter of the form `X_ID = n OR …` crosses IIS's 2048-character query limit at about
    75 ids, and MP answers with a bare 404.
  - These helpers de-duplicate the ids, keep only integers, and write
    `IN (…)` lists of `MP_ID_BATCH` (100).
  - A failed batch fails the whole read, never silently drops rows.
  - `mp-url-length.test.ts` pins the result.
- **`canActAsContact(sub, contactId)`** (`_shared/household-contact.ts`, C21/C26). It is
  the one server-side check behind every "Respond As" / "Complete Form As" / sign-up
  picker.
  - The id is honoured only when it is the caller's own contact or a member of the
    caller's household. `"public"` never acts as anyone.
  - Denormalised name, email and phone are back-filled from MP with `getContactBasics()`.
    Never take them from the client.
- **Widget template attributes send through `MessageTemplateService`.** Examples are
  `*-email-template`, `receipt-template-id` and `user-notification-email-template-id`.
  - `sendMessageTemplate` reads `dp_Communications`; `sendCommunicationTemplate` reads
    `dp_Communication_Templates`. Merge values are HTML-escaped, with no opt-out.
  - Send *after* the row is written, and treat a template fault as soft: log it, and keep
    the write.
  - Where legacy's table is ambiguous, try one table and fall back to the other on
    `TemplateNotFoundError`, as C66 does.
  - Never write a second send mechanism.
- **Payments**:
  - **One status discriminant.** Payment responses answer
    `status: "received" | "pending" | "declined" | "error"` (`PaymentOutcomeStatus` in
    `@mpnext/types`). `components/checkout-status.ts` is the only place that maps it to a
    tone and copy (C41).
  - **Single-use request token.** `PaymentRequestToken` carries a `jti` that is recorded in
    the KV store when issued (`nw:kv:pay:req:<jti>`). A successful submit spends it with
    `kvGetDelete`, so exactly one caller wins; a decline only checks that it is open.
  - **Idempotent record path.** Recording is keyed on `Transaction_Code`, under a short
    claim.
  - **Overpay refused.** An amount over the balance is refused in whole cents before any
    processor sees it (C43). Do not weaken any of these.

## MP Date/Time Handling

**Convert all date/time values at the MP boundary** — use `DomainTimezoneService` (never raw `new Date(x).toISOString()` or `getFullYear()`) when sending or receiving datetime fields, since MP stores wall-clock values in the domain's time zone, not UTC. Server-side, route writes/filters through `DomainTimezoneService.getInstance().toMpSqlDatetime(...)`. Client-side, format MP values with `Intl.DateTimeFormat({ timeZone })` using the IANA zone from `getMpTimezone()` (`src/app/actions/domain.ts`).

See **[Date/Time Handling Reference](.claude/references/ministryplatform.datetimehandling.md)**.

## Code Conventions

- **Named exports only** (no default exports)
- **React Server Components** by default; `"use client"` only when needed
- **TypeScript strict mode**; path alias `@/*` = `src/*`
- **Naming**: PascalCase (types/components), camelCase (functions), kebab-case (files), snake_case (MP fields). Exception: `src/services/*Service.ts` is camelCase.
- **Widget attributes are kebab-case** (`hide-soft-credits`, never `hidesoftcredits`). A renamed attribute keeps its legacy spelling for one release: declare it in the class's `static attributeAliases`, observe both spellings, and read it via `this.readAttr(...)`, which warns once. `components/observed-attributes.test.ts` enforces this with a ratchet over the five pre-rule spellings.
- **No hardcoded user-facing copy in a widget** - route it through `this.t(...)` and the catalogue. A per-file ratchet test fails on new literals; see Widget Localisation.
- **No `+` between template literals** — one literal, or an array and `.join(...)`. The production minifier folds those chains and drops text (see Toolchain above); a guard test enforces it.
- **Widget attributes are kebab-case.** A rename keeps the old spelling through `attributeAliases` + `readAttr()` for one release. See Widget Building Blocks.
- **No raw brand colours or font stacks in widget CSS.** Read `var(--_nw-…)`, or `var(--nw-…, <default>)` in a light-DOM portal. See Theming Tokens.

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
- **Server sessions**: `EmbedSessionRecord` keyed by `sha256(sid)` in `EmbedSessionStore` (Upstash Redis REST via `UPSTASH_REDIS_REST_URL`, else in-memory — required in production, where `getSessionStore()` throws without it unless `REDIS_ALLOW_MEMORY_FALLBACK=1`). MP access/refresh/id tokens sealed with AES-256-GCM (`EMBED_SESSION_ENC_KEY`). Sliding idle + absolute TTLs. One-time 60s handoff codes bridge the OAuth callback to the SDK (`#nextwidgets_auth` fragment, never a query string).
- **Login routes** (`src/app/api/embed/auth/`): `login` (validates origin + same-origin `return_to`, signed state cookie `nextwidgets_oauth_state`, 302 to MP) → `callback` (state check, code exchange, userinfo, create session, handoff) → `exchange` (POST, single-use, origin-bound). `logout` deletes the session and returns the MP end-session URL; `me` reports the signed-in user for a v2 token. `login`/`callback` are top-level navigations (no CORS). Unauthenticated routes are rate-limited per IP (`checkRateLimit`).
- **MP OAuth client**: register `https://<widget-host>/api/embed/auth/callback` as redirect URI and `${BETTER_AUTH_URL}/signin` as the **only** post-logout URI. Host-site origins are deliberately **never** registered and never sent to MP: MP refuses to complete an end-session whose `post_logout_redirect_uri` it does not recognise (drops `id_token_hint`, shows a "Would you like to logout?" prompt, leaves the SSO session alive), and an embed SDK cannot enumerate its host pages. `buildEndSessionUrl()` is the one server-side builder and takes no destination argument. Embedded visitors get home via the widget host's own bounce — `src/lib/embed/logout-return.ts`: a sealed ticket → `GET /api/embed/auth/logout?t=` sets `nextwidgets_logout_return` → MP → `/signin`, where `src/proxy.ts` spends the cookie. `legacy` (browser-built end-session URL) uses the registered URI, advertised by `/api/embed/auth/config`. `EMBED_OAUTH_PKCE` off by default. `EMBED_PUBLIC_URL` pins the host used in `redirect_uri` behind proxies.
- **Client key naming**: every browser-visible key the SDK owns is `nextwidgets_*` —
  `nextwidgets_sid`, `nextwidgets_locale` (localStorage), `nextwidgets_oauth_state`,
  `nextwidgets_logout_return` (cookies), `nextwidgets_auth`, `nextwidgets_auth_error`
  (URL fragments). Renamed from `nw_*` on 2026-09-09. **Server-side Redis keys are a
  separate namespace and were deliberately left alone**: `nw:sess:`, `nw:handoff:`,
  `nw:lock:`, `nw:rl:`, `nw:kv:` (`src/lib/embed/session-store.ts`). Renaming those
  orphans every live session in Redis, including `nw:kv:ba:*` where Better Auth keeps
  the *app* sessions — i.e. it signs everyone out of the app too, not just the widgets.
  - **Two transitional read-fallbacks exist and should be deleted.**
    `LEGACY_SID_KEY` (`shared/auth-session.ts`) and `LEGACY_LOCALE_KEY`
    (`i18n/locale-session.ts`) adopt a value stored under the old key and migrate it
    forward on read. Without them the rename signs out every already-signed-in
    congregant on the deploy that ships it, because the `sid` lives in the *host church
    site's* localStorage. Both are covered by tests; remove them once every host page
    has loaded the SDK at least once after the rename.
  - The cookie and URL-fragment names have **no** fallback, deliberately. They only
    matter mid-flow, so the exposure is a login or logout started before the deploy and
    finishing after it — plus up to 5 minutes of a browser running the previous SDK
    from cache (`next-embed.js` is `max-age=300`). That fails closed and self-heals on
    retry; dual-writing two state cookies through the OAuth callback is more risk than
    the window is worth.
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
| `src/proxy.ts` | Deny-by-default route gate; `isPublicPath()` (segment-aware) and the `nextwidgets_logout_return` landing |
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
| `src/lib/embed/logout-return.ts` | Sealed return ticket + `nextwidgets_logout_return` cookie: gets an embedded visitor back to their church page without registering it with MP |
| `src/lib/embed/rate-limit.ts` | `checkRateLimit(key)` fixed 60s window on the session store |
| `src/lib/embed/types.ts` | `WidgetClaims` (v1/v2), `EmbedAuthMode`, `EmbedSessionRecord`, session request/response types |
| `src/app/api/embed/auth/*` | `config`, `login`, `callback`, `exchange`, `logout`, `me` routes (see Authentication) |
| `src/app/api/embed/session/route.ts` | Mints widget JWTs from `sid`, legacy `mpUserToken`, same-origin Better Auth session, or public |
| `packages/embed-sdk/src/index.ts` | SDK entry point -- registers widgets, token provider via `AuthSession`, `window.MPNextEmbed = { init, getAuthSession }` |
| `packages/embed-sdk/src/shared/auth-session.ts` | `AuthSession` singleton: mode discovery, `nextwidgets_sid` storage, `#nextwidgets_auth` handoff, JWT cache, `login`/`logout`/`me`/`onChange` |
| `packages/embed-sdk/src/i18n/locales/en/` | The English catalogue -- **source of truth for the shape of every locale** (`type Messages = typeof en`) |
| `packages/embed-sdk/src/i18n/registry.ts` | `SUPPORTED_LOCALES` (+ the lazy `import()` per locale), BCP-47 `resolveLocale`, `endonym` |
| `packages/embed-sdk/src/i18n/locale-session.ts` | Page-wide locale singleton: resolution ladder, catalogue loading, `onChange`, `nextwidgets_locale` |
| `packages/embed-sdk/src/i18n/t.ts` | `{name}` interpolation + `Intl.PluralRules` selection; overrides -> locale -> English -> key |
| `packages/embed-sdk/src/i18n/formatters.ts` | Memoised `Intl` wrappers. **No `timeZone`, by design** -- see Widget Localisation |
| `packages/embed-sdk/src/i18n/overrides.ts` | `MPNextEmbed.setMessages()` -- church label renames (C67 part 1) |
| `packages/embed-sdk/src/i18n/pseudo.ts` | Generated dev pseudo-locale over the override layer |
| `packages/embed-sdk/src/components/locale-selector.ts` | `next-locale-selector` -- endonym options from `Intl.DisplayNames`, so zero translated strings |
| `scripts/i18n-scan.mjs`, `scripts/i18n-check.mjs` | Literal scanner shared by the ratchet test and `pnpm i18n:check` / `i18n:sync` |
| `packages/embed-sdk/src/shared/base-widget.ts` | Abstract base class (Shadow DOM, token mgmt, fetch, `requestLogin()` → cancelable `loginRequired` then `authSession.login`). Also owns `isNeedsAuth` / `renderSignInRequired` (C81), `painted` / `reconfigure` / `reload` (C39), `attributeAliases` / `readAttr` (C79), and `instanceId` |
| `packages/embed-sdk/src/shared/cdn-loader.ts` | `loadScript(url, integrity?)` / `injectExternalCSS(root, url, integrity?)` -- SRI + `crossOrigin="anonymous"` for all four FullCalendar CDN assets |
| `packages/embed-sdk/src/shared/form-validation.ts` | Shared widget form validation (no native `reportValidity` popup), plus `field()` / `fieldId()`: a labelled control with `tel` autocomplete and inputmode |
| `packages/embed-sdk/src/shared/card-link.ts` | `cardLink` / `cardButton` / `bindCardSelect` / `isModifiedClick`: result cards as real anchors (C05/C10/C22/C45) |
| `packages/embed-sdk/src/shared/dialog-focus.ts` | `dialogFocus(container, trigger, opts)`: Tab trap that descends open shadow roots, Escape, focus return (C08/C54) |
| `packages/embed-sdk/src/shared/theme-tokens.ts` | The public `--nw-*` token table and the `--_nw-*` resolved block that `injectStyles()` prepends |
| `packages/embed-sdk/src/shared/html.ts` | `escapeHtml` / `escapeAttr` / `renderAttrs` |
| `packages/embed-sdk/src/components/checkout-status.ts` | The only payment `status` → tone/copy mapper, shared by `next-checkout` and `next-checkout-complete` (C41) |
| `packages/embed-sdk/src/components/giving-shared.ts` | Giving-family `givingSignedOut()` skeleton under the sign-in panel; re-exports `headingTag()` from `shared/heading-level.ts` |
| `src/services/_shared/public-events.ts` | `publicEventFilter` / `publicEventPredicate`: the one "public, not cancelled" event predicate (C06) |
| `src/services/_shared/id-batches.ts` | `idBatches` / `inFilter` / `readByIdBatches`: id-list reads kept under IIS's 2048-char query limit |
| `src/services/_shared/household-contact.ts` | `canActAsContact` / `getContactBasics`: the server-side "act as a household member" check and contact back-fill (C21/C26) |
| `src/services/messageTemplateService.ts` | `sendMessageTemplate` (`dp_Communications`) / `sendCommunicationTemplate` (`dp_Communication_Templates`), with merge values HTML-escaped. Every widget `*-template` attribute sends through it |
| `playwright.config.ts` | Three e2e projects: `widget` on :5173, plus `widget-legacy` on :5174 and `widget-dual` on :5175, each pinned through the env passed to `next dev` |
| `e2e/widget/auth-only-widgets-signed-out.spec.ts`, `signed-in-invoice-participants.spec.ts`, `a11y-probe.spec.ts` | W8's class tests: the signed-out panel in both modes (C81), signed-in invoice reads (C80), and an accessibility probe over every demo page |
| `src/lib/no-silent-empty-catch.test.ts`, `src/services/mp-url-length.test.ts`, `src/services/mp-column-names.test.ts` | Service guards: logged empty catches (C20), the IIS URL limit (C50), and MP column names in writes and selects (C40/C83) |
| `packages/embed-sdk/src/components/observed-attributes.test.ts`, `render-binds-listeners.test.ts`, `shared/theme-tokens.test.ts` | SDK guards: kebab-case attributes (C79), `render()` owning its listener re-bind, and the brand-value guard |
| `packages/embed-sdk/src/components/user-menu.ts` | Mode branches: `legacy` (MPWidgets.js `<mpp-user-login>`, REAUTH) vs `dual`/`hardened` (own Sign In, `/auth/me`, `/auth/logout`). `watchMpLoginRegistration()` re-inserts `<mpp-user-login>` until MPWidgets.js registers it -- both `legacy` and `dual` + `prefer-mp-login` bootstrap through that one watch (see MP widget styling below) |
| `packages/embed-sdk/src/components/full-calendar.ts` | Largest widget; composes the five `full-calendar-*` sub-modules and carries `FC_ASSETS` -- the four pinned FullCalendar 7 URLs and their hashes |
| `packages/embed-sdk/vite.config.ts` | Vite library mode (ES output only) + the canonical customer setup snippet injected into every demo page |
| `scripts/hash-sdk.js`, `scripts/copy-sdk.js` | Content-hash the SDK bundle and publish it plus the stable `next-embed.js` loader into `public/embed-sdk/`; `copy-sdk` deletes every build-owned file there that the current build did not emit (`mp-widget-overrides.css` is exempt — it is `hash-sdk`'s tracked **input**, and `hash-sdk` exits non-zero if it is missing) |
| `e2e/widget/login-hardened.spec.ts` | Playwright: full widget sign-in/out; skips unless creds set and mode != legacy |
| `WIDGET-AUTH-MIGRATION-PLAN.md` | Legacy → hardened migration plan, phases, per-customer cutover runbook |
| `public/embed-sdk/mp-widget-overrides.css` | Brand CSS for MP Shadow DOM widgets |
| `.claude/TODO/README.md` | Numbered deferred work + what was already attempted and reverted -- read before a dependency bump |
| `.claude/references/widget-building-blocks.md` | Signatures and snippets for the shared widget primitives (sign-in panel, `cardLink`, `field`, `dialogFocus`, reconfigure, attribute aliases) and how to convert CSS onto the `--nw-*` tokens |
| `.claude/references/ministryplatform.query-syntax.md` | MP REST API query syntax reference (`$filter`, `$select`, `_TABLE` traversal) |
| `.claude/references/ministryplatform.datetimehandling.md` | How to send/receive MP datetimes safely via `DomainTimezoneService`, anti-patterns, Windows↔IANA mapping, test guidance |
| `.claude/references/nextjs.build-hazards.md` | Faults that exist only in a minified production build — the `+`-joined template-literal fold, and how to grep the built chunk |
| `src/lib/no-template-concat.test.ts` | Repo-wide guard: fails if any source file joins two template literals with `+` |
| `src/services/_shared/mp-lookup.ts` | `sqlLiteral` / `clean` / `toNumberOrNull` / `cap` / `getIdByValue` — the helpers three MP-writing services each had a byte-identical copy of |
| `src/services/domainTimezoneService.ts` | Singleton: MP domain TZ → IANA, `toMpSqlDatetime`, `parseMpDatetime` |
| `src/services/contactAttributeService.ts` | `Contact_Attributes` read/write for `next-contact-attributes`. Visibility is `Attribute_Types.Available_Online` (a **type**-level flag; there is no `Attribute_Categories` table). Full-set PUT: the requested ids must be a subset of the visible universe or it throws **before any MP call** — legacy validated nothing there. Removal end-dates every active row (the table has no uniqueness constraint and real domains hold duplicates); re-selection reactivates the lowest `Contact_Attribute_ID` rather than inserting a second row |
| `src/services/missionTripService.ts` | The mission-trip domain. `visibleContactIds` is legacy's household rule (head of household sees the household); `mine()` is the single visibility source and its window therefore bounds `donors()` and `team()`. **`team()` throws unless a *visible* pledge on the campaign has `Trip_Leader = 1`** — "visible", not "the caller's own", so a head of household managing a child's trip is not locked out. Legacy's roster procedure has no leader predicate at all and both its gates ran in the browser. Per-procedure availability probe over one memoised `getProcedures()` call, because MP registers the four procs across two script eras |
| `src/app/actions/domain.ts` | `getMpTimezone()` server action for client-side `Intl.DateTimeFormat` rendering |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
