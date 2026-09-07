# 24. A captured session-cache cookie keeps authorizing for 5 minutes after sign-out

**Depends on:** item 14 (merged) — the store this relies on exists now.
**Risk:** low-medium — needs a cookie the attacker already has, but sign-out
does not revoke it. **Size:** ~1 hour (needs a call on the cookie-cache
tradeoff).

> Found while browser-testing item 14 on 2026-09-07. **Pre-existing** — item 14
> shrank the window from 60 minutes to 5, it did not create it.

## The problem

`session.cookieCache` is enabled (`src/lib/auth.ts`, `strategy: "jwt"`,
`maxAge: 300`). When the cache cookie verifies, Better Auth's `getSession`
returns the cached session **without reading the store at all**
(`better-auth/dist/api/routes/session.mjs`), so nothing on that path can notice
that the session was revoked.

Sign-out deletes the session from the store and expires the cookies in the
caller's browser, which is enough for the caller. It is not enough for a copy
of the cookie taken beforehand.

Measured live, on the branch for item 14, against an out-of-process Redis:

| after `POST /api/auth/sign-out`, replaying the pre-sign-out cookies | result |
|---|---|
| `GET /api/auth/get-session?disableCookieCache=true` | `null` — the row really is gone |
| `GET /api/auth/get-session` | **200 with the full user** |
| `GET /demo` | **200, renders the signed-in catalog** |

`/demo` is the interesting one: `src/app/(demo)/layout.tsx` calls
`auth.api.getSession` without `disableCookieCache`, so the whole group-gated
demo surface accepts the replayed cookie until the cached JWT's own `exp`.

## Why it is not urgent

The cookies are `httpOnly` + `SameSite=Lax`, so this is a post-compromise
window, not a way in. It is bounded at 5 minutes and the MP tokens in
`better-auth.account_data` expire on their own schedule.

## Steps

1. Decide the tradeoff. Options, cheapest first:
   - **Pass `disableCookieCache` on the authorization path only** — the
     `(demo)` layout and anything else making an access decision — and leave
     the cache for cheap reads. Better Auth models exactly this: its own
     `getSessionFromCtx` passes `disableCookieCache: isStateful(ctx)`
     (`api/routes/session.mjs`), i.e. "check the store when there is a store".
     One Redis GET per gated render.
   - **Drop `session.cookieCache.enabled`** — simplest and strictest; every
     `getSession` costs a Redis GET.
   - **Keep it and shorten `maxAge` further** — cheap, but only shrinks the
     window; it never closes it.
2. Whatever is chosen, pin it: `src/lib/auth.test.ts` already asserts
   `cookieCache.maxAge`; add an assertion for the authorization path so a
   future edit cannot silently re-cache it.
3. Re-run the browser check above — the replayed-cookie `GET /demo` must stop
   returning the catalog.

## Done when

A session revoked in the store cannot authorize `/demo` (or any other
group-gated surface) with a replayed cookie, and the standard verification gate
passes.
