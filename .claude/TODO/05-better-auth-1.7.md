# 5. better-auth 1.6→1.7

**Depends on:** nothing — but has an **external dependency** (MP OAuth client redirect URI).
**Risk:** medium-high — touches the sign-in path *and* requires an IdP config change.
**Size:** ~15 line diff, but dominated by MP-side coordination + manual verification.

> **Revised 2026-09-07** after inspecting the `better-auth@1.7.3` and
> `@better-auth/core@1.7.3` tarballs directly. The earlier version of this file
> claimed "the server side is fine as-is… this is a client-plugin migration
> only." **That was wrong.** See "What actually breaks" below.

## Current state and why it's pinned

Root `package.json` has `"better-auth": "~1.6.30"` — a **tilde, deliberately**, to
hold the minor at 1.6.x. Do not "fix" it to a caret without doing the work below.

1.6.30 **does** carry both security fixes that drove the bump, so there is no open
vulnerability blocking on this:

- `>=1.6.13` — stored XSS via `javascript:` `redirect_uri` in oidc-provider/mcp (high)
- `>=1.6.22` — account takeover via pre-account hijacking on magic-link / email-OTP (high)

But 1.6.x will stop receiving fixes, so this shouldn't sit indefinitely.

## What actually breaks

`genericOAuth` was **rewritten** in 1.7. It no longer registers any endpoints of
its own — no `/sign-in/oauth2`, no `/oauth2/callback/:providerId`, no
`/oauth2/link`. It is now an `init()` hook that injects providers into core as
first-class social providers. From `dist/plugins/generic-oauth/index.d.mts:63-66`:

> Providers are used through the standard `signIn.social` and `callback/:id`
> core endpoints — no plugin-specific endpoints needed.

`genericOAuthClient` is gone because it has nothing left to wrap — not moved, not
replaced by `InferServerPlugin`. Verified: zero occurrences of
`genericOAuthClient` anywhere in the 1.7.3 `dist/`, and no
`dist/plugins/generic-oauth/client.mjs`. `customSessionClient` is still exported
from `better-auth/client/plugins`.

### A. The redirect URI changes — external MP config, do this first

| version | callback URL |
|---------|--------------|
| 1.6.30  | `{BETTER_AUTH_URL}/api/auth/oauth2/callback/ministry-platform` |
| 1.7.3   | `{BETTER_AUTH_URL}/api/auth/callback/ministryplatform` |

1.6 built its own (`dist/plugins/generic-oauth/index.mjs`:
`` `oauth2/callback/${c.providerId}` ``); 1.7 uses the core social callback.
**Register the new URI on the MP OAuth client in every environment before
deploying.** Both can be registered simultaneously — add the new one, deploy,
then remove the old one after the cutover window. This is unrelated to the
widget OAuth client, which uses `/api/embed/auth/callback` and is unaffected.

The trailing path segment is the `providerId`, which is also the `:id` in
better-auth's `/callback/:id` route — the two cannot be decoupled. Setting the
config's `redirectURI` does not help: it only changes what is sent to the IdP,
so MP would redirect to a path with no matching handler.

### A2. Rename the provider id `ministry-platform` → `ministryplatform`

Dropping the hyphen from the callback URI means renaming the provider id. Do it
**in the same commit as the 1.7 upgrade**, never separately: on 1.6 the path is
`/api/auth/oauth2/callback/{providerId}`, so a standalone rename would force two
MP-side redirect-URI changes instead of one.

The literal lives in exactly two places — `src/lib/auth.ts:43` and
`src/app/signin/page.tsx:28`. (`scripts/setup.ts:77` is the
`src/lib/providers/ministry-platform/` **directory path**; leave it alone. So are
most `ministry-platform` hits in `README.md` — only lines 242, 248 and 354 are
callback URLs.)

**Why this is safe here.** Renaming `providerId` normally re-keys persisted
`account` rows and orphans existing accounts. This app configures no `database`,
so better-auth falls back to an in-process memory adapter
(`dist/db/adapter-base.mjs:6-12` — builds `memoryDB` from the table list and
calls `memoryAdapter`). There are no durable rows keyed by the old id. The
account cookie does carry `providerId`
(`dist/cookies/session-store.d.mts:20`), but `src/lib/auth.ts` only reads tokens
off it and never compares the id, so pre-rename cookies stay valid until expiry.

The only exposure is a user mid-flow at deploy time — already redirected to MP
with the old `redirect_uri`. Keeping the old URI registered through the cutover
window (§A) covers that.

### B. Client call site — `src/app/signin/page.tsx:27`

```diff
- await authClient.signIn.oauth2({ providerId: "ministry-platform", callbackURL });
+ await authClient.signIn.social({ provider: "ministryplatform", callbackURL });
```

The field is **`provider`**, not `providerId` — confirmed against the
`signInSocial` body schema in `dist/api/index.d.mts:89`, which types it as
`(string & {}) | "github" | …`, so an arbitrary provider id passes.
`signIn.social` also gained `additionalParams`, an alternative route for `realm`
if `authorizationUrlParams` ever proves awkward.

### C. `src/lib/auth-client.ts`

Drop the `genericOAuthClient` import and plugin entry; keep `customSessionClient`.
The whole file becomes 8 lines.

### D. Provider logout is now wired into `signOut()`

`dist/plugins/generic-oauth/index.mjs:152-156`: unless `disableProviderLogout` is
set, 1.7 resolves `end_session_endpoint` from the discovery document and performs
RP-initiated logout on sign-out. `src/app/api/auth/logout/route.ts` **already**
hand-rolls the MP endsession URL *and* calls `auth.api.signOut()`. Pick one:

- **Recommended (smaller blast radius):** set `disableProviderLogout: true` on the
  provider config, preserving today's behavior exactly.
- Or delete the hand-rolled route and configure `endSessionEndpoint` /
  `postLogoutRedirectURI` on the provider. Larger change, defer it.

Do not end up with both.

### E. `id_token` nonce binding is on by default — highest-risk unknown

New `disableIdTokenNonceBinding` (default `false`). With `discoveryUrl` and a
published JWKS, better-auth sends a server-generated `nonce` and **rejects a
callback whose `id_token` does not echo it** (OIDC Core 1.0 §3.1.3.7). Whether
MP echoes `nonce` on the authorization-code flow must be confirmed live.

In-repo evidence suggests it does: the hand-rolled embed flow already sends a
nonce (`buildAuthorizeUrl({ …, nonce })` in `src/lib/embed/mp-oauth.ts`, called
from `src/app/api/embed/auth/login/route.ts`). Leave the option unset for the
first test run; only add `disableIdTokenNonceBinding: true` if the callback
fails with a nonce error, and note in the commit that it removes `id_token`
replay protection.

Also new and related: `requireIdTokenVerification` (default `false`, leave it).

### F. Config-type changes to check at `tsc` time

| option | 1.6.30 | 1.7.3 | impact here |
|---|---|---|---|
| `pkce` | `@default false` | `@default true` | none — set explicitly to `false`. **Do not drop that line.** |
| `authorizationUrlParams` | `Record \| ((ctx) => Record)` | `Record<string,string>` only | none — object form (`{ realm: "realm" }`) survives |
| `mapProfileToUser` return | `Partial<User>` | `OAuthMappedUser` | recheck the `as Record<string, unknown>` cast still compiles and that `userGuid`/`imageGuid` still reach `user.additionalFields` |
| `getUserInfo` return | `OAuth2UserInfo \| null` | `GenericOAuthUserInfo \| null` (`id` optional, `sub` accepted) | likely fine — we return `id: profile.sub` |
| `issuer`, `requireIssuerValidation` | present | **removed** | none — unused |
| `providerId` | `string` | generic `ID extends string` | none |

New `accountSubject` resolver: OIDC-discovery providers now default account
identity to the verified profile's `sub`. Our `getUserInfo` already maps
`sub` → `id`, so this should be a no-op — but a shift here would orphan existing
accounts, so verify a **returning** user is matched, not duplicated (see testing).

## Verified unchanged (no action needed)

- `better-auth/cookies` still exports `getAccountCookie` (`src/lib/auth.ts`) and
  `getSessionCookie` (`src/proxy.ts`).
- `account.storeStateStrategy: "cookie"` and `account.storeAccountCookie` still
  exist — `@better-auth/core@1.7.3` `dist/types/init-options.d.mts:1161,1175`.
- `session.cookieCache` still takes a `strategy` option.
- Subpaths `better-auth/plugins`, `better-auth/plugins/generic-oauth`,
  `better-auth/client/plugins`, `better-auth/next-js`, `better-auth/react` all
  still exported.
- `src/app/api/embed/auth/login/route.ts:93` — the comment "Matches the Better
  Auth genericOAuth config (authorizationUrlParams)" stays accurate. The entire
  embed OAuth flow is hand-rolled and untouched by this upgrade.

## Steps

1. Branch `chore/better-auth-1.7`.
2. **Register `{host}/api/auth/callback/ministryplatform` on the MP OAuth client
   for dev, staging and prod.** Leave the old `oauth2/callback/ministry-platform`
   URI in place. This is the only step with an external dependency — if it can't
   be done, stop.
3. `pnpm add better-auth@^1.7.3 -w` (restores the caret).
4. `src/lib/auth-client.ts` — remove `genericOAuthClient`.
5. `src/app/signin/page.tsx` — `signIn.oauth2` → `signIn.social`, and
   `providerId: "ministry-platform"` → `provider: "ministryplatform"` (§B, §A2).
6. `src/lib/auth.ts` — `providerId: "ministryplatform"` (§A2); keep `pkce: false`;
   add `disableProviderLogout: true` (§D).
7. `README.md` lines 242, 248, 354 — update the documented callback URLs.
8. `npx tsc --noEmit`; fix `mapProfileToUser` / `getUserInfo` fallout without
   widening to `any`.
9. Standard verification gate (see `README.md`).
10. Manual auth testing below.
11. After the cutover window, remove the stale
    `oauth2/callback/ministry-platform` redirect URI from the MP OAuth client.

## Testing — do not merge on green CI alone

Only `src/app/api/embed/session/route.test.ts` touches `@/lib/auth`; nothing
automated covers the Better Auth sign-in path. Manually verify:

- `/signin` → MP → back → session established. Confirm in the network tab that
  the callback is `/api/auth/callback/ministryplatform` — no `oauth2/` segment
  and no hyphen (proves §A and §A2 landed).
- **New** user first sign-in: `mapProfileToUser` fetches `Image_GUID` from
  `dp_Users`; `userGuid` / `imageGuid` reach the session.
- **Returning** user sign-in: account is matched, not duplicated (§F,
  `accountSubject`).
- `GET /api/auth/session-tokens` returns real `accessToken` / `refreshToken` /
  `idToken` — exercises `getAccountCookie` + the `offline_access` scope.
- `POST /api/auth/logout` produces **one** MP endsession redirect, not two (§D).
- `POST /api/embed/session` same-origin Better Auth branch still mints a widget
  JWT (`src/app/api/embed/session/route.ts:156`); `route.test.ts` passes.
- `e2e/widget/login-hardened.spec.ts` — needs `PLAYWRIGHT_MP_USERNAME` /
  `PLAYWRIGHT_MP_PASSWORD` and `EMBED_AUTH_MODE != legacy`. This covers the
  hand-rolled embed flow, which this change does not touch, so treat it as a
  regression check rather than validation of the upgrade.

## Rollback

Revert the commit and `pnpm add better-auth@~1.6.30 -w`. Because the old redirect
URI stays registered through the cutover window, rollback needs no MP-side change.

## Done when

Standard verification gate passes, every manual check above passes, the range is
back to a caret, and the stale redirect URI has been removed from the MP OAuth
client.
