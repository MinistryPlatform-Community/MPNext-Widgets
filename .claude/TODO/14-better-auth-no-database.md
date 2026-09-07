# 14. Better Auth has no `database` — it silently runs on the in-memory adapter

**Depends on:** nothing.
**Risk:** medium — every app-session sign-in is lost on any process restart,
cold start, or instance switch. **Size:** half a day (needs a store decision).

> Found while browser-testing item 11 on 2026-09-07. **Pre-existing**, not
> related to the better-auth 1.7 upgrade.

## Symptom

Observed live in `pnpm dev`: after the `src/lib/auth.ts` module re-evaluated
(an HMR edit), a browser holding a perfectly good session cookie got

```
GET /api/auth/get-session?disableCookieCache=true   ->  null
GET /api/auth/session-tokens                        ->  200 (stale cookie cache)
```

The user row and session row were simply gone. Nothing was logged.

## Root cause

`betterAuth({ ... })` in `src/lib/auth.ts` sets no `database` option. Better
Auth 1.7 falls back to an in-process store —
`node_modules/better-auth/dist/db/adapter-base.mjs:12`:

```js
const { memoryAdapter } = await import("@better-auth/memory-adapter");
adapter = memoryAdapter(memoryDB)(options);
```

So the `user`, `session`, `account` and `verification` tables live in a plain
object in the Node process.

It is not obvious today because two things paper over it:

- `session.cookieCache` (`enabled: true`, `strategy: "jwt"`, `maxAge: 1h`)
  answers most `getSession` calls straight from the signed cookie, without
  touching the store.
- `account.storeAccountCookie` keeps the MP access/refresh/id tokens in a
  cookie too, so `/api/auth/session-tokens` keeps working.

## Consequences

- On Vercel, each lambda instance has its own store. As soon as the 1-hour
  cookie cache lapses — or a request lands on an instance that never saw the
  sign-in — `getSession` finds no row and the user is signed out mid-session.
- Anything that reads through the store rather than the cookie is unreliable:
  `disableCookieCache=true`, session revocation, `update-user`, and the
  `databaseHooks` added in item 11 (they run, but against a row that may not
  outlive the request's instance).
- `checkDemoAccess` depends on `session.user.userGuid`, which comes from the
  user row. A cold instance re-creates that row from the OAuth profile, so it
  currently self-heals — but only because sign-in is re-run.

## Steps

1. Decide the store. Options, cheapest first:
   - Reuse the Upstash Redis already wired for embed sessions
     (`EMBED_SESSION_STORE_URL`, `src/lib/embed/session-store.ts`) via Better
     Auth's `secondaryStorage`, and keep a real `database` for the user table.
   - A hosted Postgres (Neon/Supabase) with the Kysely adapter — `kysely` is
     already pinned in `pnpm.overrides`.
2. Add the adapter + connection env vars, and run Better Auth's schema
   generation/migration for `user`, `session`, `account`, `verification`
   (remember the `userGuid` / `imageGuid` additional fields).
3. Document the new env vars in the README and `scripts/setup-bootstrap.mjs`.
4. Re-check the `databaseHooks` from item 11 against the real adapter —
   `create.before` / `update.before` must still land both fields, and
   `overrideUserInfo: true` must still repair an existing row.
5. Consider whether `cookieCache.maxAge` should drop once the store is real.

## Testing

- Sign in, restart the server, and confirm `GET /api/auth/get-session` still
  returns the user (today it returns `null`).
- `GET /api/auth/get-session?disableCookieCache=true` returns the user with a
  populated `userGuid` and `imageGuid` after a restart.
- Sign out, then confirm the session row is gone and a stale cookie no longer
  authenticates.
- `src/lib/auth.test.ts` still passes (it asserts the hooks, not the store).

## Done when

Better Auth persists to a shared store, a server restart or instance switch no
longer signs users out, and the item 11 fields survive a restart.
