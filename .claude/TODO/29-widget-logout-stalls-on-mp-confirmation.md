# 29. Widget logout stalls on MP's "Would you like to logout?" prompt

**Depends on:** nothing (item 27 landed the shared logout path this rides on).
**Risk:** medium — the MP IdP session survives, so the next `/demo` visit
silently signs the user back in. **Size:** ~30 minutes + an MP OAuth client
change.

> Found while browser-testing item 27 on 2026-09-07. **Pre-existing** — the
> behaviour dates to item 13 (PR #30) and is unchanged by item 27, which only
> moved the shared `fetch` into `src/lib/app-logout.ts`.

## The problem

`next-user-menu` sends its own post-logout destination:

```ts
// packages/embed-sdk/src/components/user-menu.ts:531
const postLogoutRedirectUri =
  this.getAttribute("post-logout-redirect-uri") || window.location.href;
```

On `/demo/user-menu` that is `http://localhost:3000/demo/user-menu`, which is
**not** a registered post-logout redirect URI on the MP OAuth client. MP's
IdentityServer will not auto-complete an end-session it cannot redirect out of,
so instead of finishing it renders an interstitial:

> **Logout** — Would you like to logout of Platform OAuth 2.0 / OpenID Connect
> Server?  `[ Yes ]`

The user is left on a bare IdentityServer page with a button nobody told them
to press. Navigating away instead leaves the MP session alive.

Measured side by side in one browser session, both through the same
`POST /api/auth/logout` (which returned a correct `id_token_hint` in both
cases, 1003 chars):

| caller | `post_logout_redirect_uri` | MP lands on | outcome |
|---|---|---|---|
| `/demo` header Sign Out (item 27) | `http://localhost:3000/signin` (server default) | `oauth/logout?id=<sid>` → auto-redirect | signed out; next `/demo` shows the MP login form |
| `next-user-menu` Log out | `http://localhost:3000/demo/user-menu` | `oauth/logout` (no `id`) + Yes/No prompt | Better Auth row deleted, **MP session alive**; next `/demo` silently re-signs in |

So the Better Auth half always works (`nw:kv:ba:*` row gone in both rows above).
It is only MP's half that depends on the redirect URI being registered.

## Notes for whoever picks this up

- This is the same class of failure item 27 fixed for the header, and the
  reason item 27's button deliberately sends **no** `postLogoutRedirectUri`:
  the server default `${BETTER_AUTH_URL}/signin` is registered.
- Two candidate fixes, and they are not exclusive:
  1. **Register the host-page origins.** Every site that embeds
     `next-user-menu` must have its page URL (or at least its origin) added as
     a post-logout redirect URI on the MP OAuth client. That is already the
     documented requirement in `CLAUDE.md` ("register … each host-site origin
     as post-logout URI") — it is simply not done for the demo host. Note MP
     appears to match the **full URI**, not the origin, so a per-page
     `window.location.href` default may be unregisterable in practice.
  2. **Stop defaulting to `window.location.href`.** Have the widget send
     nothing unless `post-logout-redirect-uri` is set explicitly, and let
     `src/app/api/auth/logout/route.ts` fall back to its registered default.
     Cheaper, and it makes the widget path behave like the header path.
- Whatever is chosen, `packages/embed-sdk/src/components/user-menu.ts:1260`
  builds a *second* end-session URL for the un-bridged (no-`TokenBridge`) case
  with the same `window.location.href` default — fix both or neither.

## Done when

Logging out from `next-user-menu` on `/demo/user-menu` ends the MP session
without an interstitial, navigating to `/demo` afterwards lands on the MP login
form rather than silently re-authenticating, and a test or the e2e spec pins
the destination the widget sends.
