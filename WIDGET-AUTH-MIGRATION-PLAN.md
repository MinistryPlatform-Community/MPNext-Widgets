# Migration Plan: Hardened Widget Authentication

> Plan to replace the MPWidgets.js / localStorage token model with a
> backend-for-frontend (BFF) session on the widget host, while letting every
> customer stay on the current model until they are ready to switch. Written
> against the code on `feature/legacy_widgets` as of this document's commit.

## 0. Why

Today the credential that authorizes a visitor is a **full-scope MP OAuth access
token stored in localStorage on the church's origin** (the `mpp-widgets_*` keys
written by MP's login widget). Anything that runs JavaScript on the church site
can read it and use it directly against MP. The SDK reads that token, POSTs it to
`/api/embed/session`, and the server re-wraps it, in cleartext, inside a 5-minute
HS256 JWT that then rides on every widget request.

The target state moves the MP tokens to the server. The browser holds only a
short-lived widget JWT in memory and, at most, an **opaque, revocable session
handle** that is useless against MP directly.

Full findings are in the security review that produced this plan; the ones that
drive the design are:

| # | Finding | Fixed in |
|---|---------|----------|
| 1 | MP access + refresh token in host-page localStorage | Phase 2 (opt-in), Phase 4 (final) |
| 2 | Raw MP access token in the widget JWT payload | Phase 1 |
| 3 | Wildcard origin match is a suffix match (`evilcalvaryccm.com` passes `*.calvaryccm.com`; plain `http` passes) | Phase 0 |
| 4 | JWT `origin` claim never compared to request origin; `wid` is self-declared | Phase 0 |
| 5 | SDK mints a new JWT per request; session route calls MP userinfo per request; no rate limit | Phase 0 |
| 6 | Hand-rolled JWT (non-constant-time compare, no `iss`/`aud`, unused `jti`) | Phase 0 |
| 7 | Same-origin `session-tokens` route returns the refresh token to page JS | Phase 4 |

## 1. What touches legacy auth today

The blast radius is small. Every other widget derives login state from server
401s, so it is already auth-mode agnostic.

| File | Legacy role |
|------|-------------|
| `packages/embed-sdk/src/index.ts` | Token provider reads `mpp-widgets_AuthToken` and sends it as `mpUserToken` |
| `packages/embed-sdk/src/components/user-menu.ts` | Injects `<mpp-user-login>`; polls localStorage; rebuilds MP's REAUTH renewal; writes `mpp-widgets_*`; logout via MP endsession |
| `packages/embed-sdk/src/shared/base-widget.ts` | Calls token provider per request (no cache) |
| `src/app/api/embed/session/route.ts` | Accepts `mpUserToken`; validates via MP userinfo; embeds `mpAccessToken` in JWT |
| `src/lib/embed/jwt.ts`, `types.ts` | `WidgetClaims.mpAccessToken` |
| `src/lib/embed/auth.ts` | `isOriginAllowed` wildcard bug; no origin-claim binding |
| `src/app/api/auth/session-tokens/route.ts` | Same-origin route that hands OAuth tokens (incl. refresh) to page JS |
| `src/components/token-bridge/` | Same-origin demo app copies Better Auth tokens into `mpp-widgets_*` |
| `src/app/api/embed/profile/change-password/route.ts` | Uses `claims.mpAccessToken` |
| `src/app/api/embed/invoices/**`, `src/services/invoiceService.ts` | Uses `claims.mpAccessToken` for product lookups |
| `packages/embed-sdk/demo-*.html` | Load `MPWidgets.js` for login |

## 2. Target architecture

### 2.1 Components

- **Widget host is the OAuth client.** Authorization Code flow, server-side code
  exchange with client secret (PKCE added if the tenant's MP client allows it;
  `src/lib/auth.ts` currently sets `pkce: false`, so verify per tenant).
  Redirect URI: `https://<widget-host>/api/embed/auth/callback`.
- **Server session store** holding MP tokens encrypted at rest. Keyed by
  `sha256(sid)`; the raw `sid` never touches the store. Recommended: Upstash Redis
  (REST client works on Vercel serverless/edge). A Postgres table is an acceptable
  alternative. Ship an in-memory adapter for tests and local dev.
- **Opaque session handle (`sid`)**: 256-bit random, URL-safe. Bound to the
  issuing origin. Sliding expiry (default 30 days idle) plus absolute cap
  (default 90 days or the MP refresh-token lifetime, whichever is shorter).
- **Widget JWT v2** (jose, HS256 now, key-rotatable via `kid`): claims
  `iss`, `aud`, `sub` (user GUID or `public`), `sid`, `wid`, `origin`, `iat`,
  `exp` (5 min), `jti`. **No MP token.** Held in SDK memory only.
- **MP token access on the server** goes through one helper,
  `getMpUserAccessToken(claims)`, which loads the session, refreshes via MP if
  within 60 s of expiry (with a short store-level lock to prevent refresh
  stampedes), and returns the access token. Only the two route families that need
  the user's own token call it (change-password, invoice product lookups).
  Everything else keeps the current service-account plus ownership-filter pattern.

### 2.2 Flows

**Login**
1. Widget renders its own Sign In control. Click navigates top-level to
   `GET /api/embed/auth/login?origin=<page origin>&return_to=<page URL>&wid=<id>`.
2. Server validates `origin` against the allowlist and requires `return_to` to be
   same-origin with it. Generates `state` (+ PKCE verifier), stores them in a
   short-lived `HttpOnly; Secure; SameSite=Lax` cookie on the widget host. This
   is a top-level navigation, so the cookie is first-party and works in Safari.
3. 302 to MP `/oauth/connect/authorize` with `redirect_uri` on the widget host,
   scopes `openid offline_access <dataplatform all>`.
4. `GET /api/embed/auth/callback`: verify `state` cookie, exchange code
   server-side, call userinfo, create the session, mint a **single-use handoff
   code** (60 s TTL, bound to `origin`), 302 to `return_to#nw_auth=<code>`.
   Fragment, not query, so the code never reaches the church site's server logs.
5. SDK boot sees `#nw_auth`, strips it from the URL, and
   `POST /api/embed/auth/exchange { code, wid }` → `{ sid, token, expiresIn }`.
   Stores `sid`; keeps `token` in memory.

**Token mint / refresh**
- `POST /api/embed/session { wid, sid }` → validates `sid`, checks
  `session.origin === request origin`, bumps `lastSeenAt`, returns JWT v2.
- SDK caches the JWT and re-mints 30 s before `exp` or on a 401. No `sid` → mints
  a `sub: "public"` JWT (public widgets keep working).

**Logout**
- `POST /api/embed/auth/logout { sid }` → deletes the session, returns MP
  endsession URL (with `id_token_hint`). SDK clears `sid` and navigates there.

### 2.3 Where the `sid` lives in the browser

Default: `localStorage` on the church origin, key `nw_sid`, because members
expect to stay signed in across tabs and reloads. This is still XSS-readable, but
what leaks is now a revocable handle to the widget API, origin-bound, with a
finite life, rather than a self-refreshing full-scope MP token. Host pages can
opt into `sessionStorage` via `<next-user-menu session-scope="tab">` for kiosk
or shared-device pages. Third-party cookies are deliberately not used: Safari
blocks them and Chrome partitions them, so a cookie session would silently fail
for a large share of visitors.

### 2.4 Same-origin demo app

The Next.js app's own pages are just another host origin. `TokenBridge` goes
away. When the page is same-origin and a Better Auth session exists, the session
route creates an embed session server-side from the Better Auth account tokens
and returns a `sid`, so the demo pages sign in exactly like a church site does.

## 3. Coexistence model

A single deployment and a single SDK bundle must serve customers in different
states. Mode is a **server** setting; the SDK discovers it at runtime, so host
pages do not change when a customer flips.

```
EMBED_AUTH_MODE = legacy | dual | hardened     (default: legacy until Phase 2 ships, then dual)
EMBED_AUTH_MODE_ORIGINS = https://www.calvaryccm.com=hardened,https://other.church=legacy   (optional per-origin override)
```

| Mode | Session route accepts | Login UI | localStorage `mpp-widgets_*` |
|------|----------------------|----------|-------------------------------|
| `legacy` | `mpUserToken` only | `<mpp-user-login>` (MPWidgets.js) | read + written by SDK (today's behavior) |
| `dual` | `sid` **or** `mpUserToken` | Own Sign In button; also honors an existing MP login if MPWidgets.js is present | read for **silent upgrade** only; never written |
| `hardened` | `sid` only | Own Sign In button | ignored |

**Silent upgrade (dual mode).** If the SDK finds no `sid` but does find a valid
`mpp-widgets_AuthToken`, it POSTs `{ wid, mpUserToken }` once; the server
validates it via userinfo, creates a server session, and returns `{ token, sid }`.
The visitor is migrated without re-authenticating. No refresh token is available
on that path, so the session's MP token expires at its natural time and the
visitor then signs in through the new flow once.

**Why a customer would stay in `legacy` or `dual`:** pages that still mix MP's
own portal widgets (`mpp-*`) with `next-*` widgets. Those MP widgets read the
`mpp-widgets_*` keys themselves; once the SDK stops writing them, MP widgets on
the same page will show as logged out. Cutover to `hardened` is safe when every
authenticated widget on the customer's site is a `next-*` widget.

**Discovery.** `GET /api/embed/auth/config` (public, cached 5 min, CORS-open to
allowed origins) returns `{ mode, loginUrl, logoutUrl }` resolved for the caller's
origin. The SDK calls it once at boot.

## 4. Phases

### Phase 0: Harden what exists (no behavior change for customers)

Ship independently of the rest; every customer benefits immediately.

- [ ] `isOriginAllowed`: parse the origin, require `https:` outside development,
      match `hostname === domain || hostname.endsWith("." + domain)`. Add tests for
      `https://evilcalvaryccm.com`, `http://www.calvaryccm.com`, and
      `https://www.calvaryccm.com.attacker.net` against `*.calvaryccm.com`.
- [ ] Replace `simpleJWT` in `src/lib/embed/jwt.ts` with `jose` (`SignJWT` /
      `jwtVerify`, `algorithms: ["HS256"]`, `issuer`, `audience`, `clockTolerance: 5`).
      Keep `verify-token.ts` on `jose` too so both share one implementation.
- [ ] `requireWidgetAuth`: compare `claims.origin` to the resolved request origin.
- [ ] SDK token provider: cache the JWT in memory until 30 s before `exp`
      (decode `exp` client-side, no signature check needed). `refresh()` busts the
      cache. This alone removes one round trip and one MP userinfo call per widget request.
- [ ] Session route: cache userinfo results for 60 s keyed by `sha256(mpUserToken)`;
      add per-IP and per-origin rate limiting (Upstash Ratelimit or an equivalent).
- [ ] Stop logging token material anywhere in error paths.
- [ ] Exit: `pnpm test:run` green; manual run of every demo page in legacy mode.

### Phase 1: Server foundations (dark launch, flag default `legacy`)

- [ ] `src/lib/embed/session-store.ts`: `EmbedSessionStore` interface
      (`create`, `get`, `touch`, `updateTokens`, `delete`, `withRefreshLock`) with
      Upstash Redis and in-memory adapters. Session record: `sidHash`, `userGuid`,
      `origin`, `mpAccessTokenEnc`, `mpRefreshTokenEnc`, `mpIdTokenEnc`,
      `mpExpiresAt`, `createdAt`, `lastSeenAt`, `absoluteExpiresAt`.
- [ ] `src/lib/embed/crypto.ts`: AES-256-GCM seal/open using `EMBED_SESSION_ENC_KEY`
      (32 bytes, base64url). Distinct from `EMBED_JWT_SECRET`.
- [ ] `src/lib/embed/auth-mode.ts`: resolve mode from env + per-origin overrides.
- [ ] New routes under `src/app/api/embed/auth/`: `login`, `callback`, `exchange`,
      `logout`, `config`. `callback` and `login` are top-level navigations, so they
      return redirects, not JSON, and set no CORS headers.
- [ ] `src/lib/embed/mp-user-token.ts`: `getMpUserAccessToken(claims)` with the
      v1 (`claims.mpAccessToken`) and v2 (`sid` lookup + refresh) branches. Switch
      change-password and invoice routes to it.
- [ ] Session route: accept `{ wid, sid }`; keep `{ wid, mpUserToken }`; in `dual`
      return `sid` alongside `token` on the silent-upgrade path. JWT v2 shape for
      `sid` sessions; JWT v1 shape (still carrying `mpAccessToken`) only when the
      caller used `mpUserToken` and mode is not `hardened`.
- [ ] Telemetry: structured log or metric `embed_session_issued{mode, credential}`
      and `embed_login_completed{mode}`. This is the data that tells you when a
      customer can be cut over.
- [ ] Env: `EMBED_AUTH_MODE`, `EMBED_AUTH_MODE_ORIGINS`, `EMBED_SESSION_ENC_KEY`,
      `UPSTASH_REDIS_REST_URL` / token, `EMBED_SESSION_IDLE_TTL`,
      `EMBED_SESSION_ABSOLUTE_TTL`. Document in `.env.example` and README.
- [ ] Per-tenant MP config step documented: register
      `https://<widget-host>/api/embed/auth/callback` as a redirect URI and
      `https://<widget-host>/api/embed/auth/logged-out` as a post-logout URI on
      the OAuth client used by `OIDC_CLIENT_ID`. Nothing works in `dual` or
      `hardened` until this is done, so it is the first item on the cutover runbook.
- [ ] Exit: unit tests for store adapters, crypto, state/handoff single-use,
      origin binding on `exchange` and `session`, refresh lock. Legacy demo pages
      unchanged.

### Phase 2: SDK dual mode (flag default becomes `dual`)

- [ ] `packages/embed-sdk/src/shared/auth-session.ts`: `sid` storage
      (`localStorage` default, `sessionStorage` opt-in), handoff-fragment parsing,
      in-memory JWT cache, `login()` / `logout()` helpers.
- [ ] `index.ts` token provider: fetch `/api/embed/auth/config` once; in `dual`
      or `hardened`, mint with `sid`; in `dual` with no `sid` but a legacy MP token
      present, run the silent upgrade once; in `legacy`, keep today's path.
- [ ] `user-menu.ts`: render own Sign In button in `dual` / `hardened`; inject
      `<mpp-user-login>` only in `legacy` (or in `dual` when the host has
      MPWidgets.js loaded and the `prefer-mp-login` attribute is set). Remove the
      REAUTH replication and `saveMppTokens` from the `hardened` code path; keep
      them behind the `legacy` branch until Phase 4. Logout calls the new route.
- [ ] Other widgets: `loginRequired` events resolve to `authSession.login()` in
      `dual` / `hardened` instead of relying on the host page.
- [ ] Demo pages: add a mode banner and a toggle that sets `EMBED_AUTH_MODE_ORIGINS`
      for `localhost:5173` so both paths can be exercised locally.
- [ ] Playwright: `login-hardened.spec.ts` (redirect → MP login with the
      MFA-disabled test account → callback → widget authenticated → logout);
      `silent-upgrade.spec.ts` (seed `mpp-widgets_AuthToken`, assert `sid` appears
      and no `mpp-widgets_*` writes occur).
- [ ] Exit: pilot customer (this repo's own deployment first) runs `dual` for two
      weeks with zero customer-facing regressions and telemetry showing
      `credential=sid` climbing.

### Phase 3: Per-customer cutover

Runbook, executed per customer, in this order:

1. Confirm every authenticated widget on their pages is `next-*` (no `mpp-*`
   except `mpp-user-login`). If not, they stay in `dual`.
2. Register the redirect and post-logout URIs on their MP OAuth client.
3. Set `EMBED_AUTH_MODE_ORIGINS` to `dual` for their origins. Verify sign-in,
   sign-out, a change-password, and an invoice detail on their site.
4. Watch telemetry until `credential=mpUserToken` for their origins is zero for
   14 consecutive days (silent upgrade has drained the legacy sessions).
5. Flip their origins to `hardened`. Remove the `MPWidgets.js` script tag from
   their pages if nothing else needs it.
6. When every origin is `hardened`, set the deployment-wide `EMBED_AUTH_MODE=hardened`
   and delete the per-origin overrides.

### Phase 4: Remove legacy auth

Start when no deployment has issued a `mpUserToken`-based session for 30 days.

- [ ] Session route: drop `mpUserToken`; reject with 400 and a message pointing
      at the new flow.
- [ ] Delete `WidgetClaims.mpAccessToken`, the JWT v1 branch, and the v1 branch
      of `getMpUserAccessToken`.
- [ ] `user-menu.ts`: delete `<mpp-user-login>` injection, `startAuthPoll`,
      `hasLocalStorageAuth`, `attemptSilentReauth`, `getMpAuthConfig`,
      `saveMppTokens`, `clearAllMppTokens`, `tryBetterAuthRenewal`, and the
      `storage` listener.
- [ ] `index.ts`: delete the `mpp-widgets_AuthToken` read and the silent-upgrade path.
- [ ] Delete `src/components/token-bridge/` and `src/app/api/auth/session-tokens/`.
- [ ] Delete `EMBED_AUTH_MODE` / `EMBED_AUTH_MODE_ORIGINS` and `auth-mode.ts`.
- [ ] Remove `MPWidgets.js` from every demo page and from README setup snippets.
- [ ] Update CLAUDE.md "Authentication" and "Widget Architecture" sections.
- [ ] Exit: `grep -r "mpp-widgets_" src packages` returns nothing; tests green;
      `pnpm build` clean.

## 5. Change inventory

| Area | Phase 0 | Phase 1 | Phase 2 | Phase 4 |
|------|---------|---------|---------|---------|
| `src/lib/embed/auth.ts` | fix wildcard, bind origin | | | |
| `src/lib/embed/jwt.ts`, `verify-token.ts` | jose, iss/aud | v2 claims | | drop v1 |
| `src/lib/embed/types.ts` | | `sid` claim, session types | | drop `mpAccessToken` |
| `src/lib/embed/session-store.ts`, `crypto.ts`, `auth-mode.ts`, `mp-user-token.ts` | | new | | drop `auth-mode.ts` |
| `src/app/api/embed/session/route.ts` | userinfo cache, rate limit | accept `sid`, dual | | drop `mpUserToken` |
| `src/app/api/embed/auth/{login,callback,exchange,logout,config}` | | new | | |
| `src/app/api/embed/profile/change-password`, `invoices/**`, `invoiceService.ts` | | use helper | | |
| `src/app/api/auth/session-tokens`, `src/components/token-bridge` | | | | delete |
| `packages/embed-sdk/src/index.ts` | JWT cache | | mode discovery, sid, upgrade | drop legacy read |
| `packages/embed-sdk/src/shared/auth-session.ts` | | | new | |
| `packages/embed-sdk/src/components/user-menu.ts` | | | own login, mode branches | delete legacy branches |
| Demo pages, README, CLAUDE.md, `.env.example` | | env docs | mode toggle | remove MPWidgets.js |
| Tests | origin + jwt | store, crypto, routes | Playwright login + upgrade | remove legacy specs |

## 6. Host-site guidance (what a church changes)

- **In `legacy` and `dual`:** nothing. Existing `<script id="MPWidgets">` and
  `<next-user-menu mp-base-url="...">` keep working.
- **When moving to `hardened`:** remove `MPWidgets.js` if it was only there for
  login. `mp-base-url` stays (used for the endsession URL and userinfo display
  fallback). Optionally add `session-scope="tab"` on shared devices.
- **Content Security Policy:** if the site sets one, allow `connect-src` and
  `script-src` for the widget host. Unchanged from today.

## 7. Risks and open questions

| Risk | Mitigation |
|------|------------|
| Tenant MP OAuth client does not allow the widget-host redirect URI or PKCE | Redirect URI registration is step 1 of the cutover runbook; PKCE is optional and negotiated per tenant |
| Session store outage takes down authenticated widgets | Public widgets never touch the store; store client has short timeouts; alert on error rate. In-memory fallback is for dev only |
| Silent upgrade creates sessions with no refresh token | Expected: they expire naturally and the member signs in once through the new flow |
| Church pages that still use `mpp-*` portal widgets lose login when SDK stops writing `mpp-widgets_*` | Documented gate in Phase 3 step 1; those customers stay `dual` |
| Multi-tab logout | `storage` event on `nw_sid` removal re-renders other tabs |
| Future multi-tenant widget host | Everything is keyed by origin already; a tenant lookup by origin slots in front of `getMpHost()` without changing this design |
| Stolen `sid` replay | Origin binding + revocation cover most cases; DPoP is a later add-on if needed |

## 8. Suggested sequencing

Phases 0 and 1 can be built in parallel and shipped together as a single release
with `EMBED_AUTH_MODE=legacy`. Phase 2 follows as its own release with the default
moved to `dual`. Phase 3 is operational and customer-paced. Phase 4 is a single
cleanup release once telemetry says nobody is left on the legacy credential.
