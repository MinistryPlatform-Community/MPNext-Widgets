# 11. `userGuid` / `imageGuid` silently dropped from the Better Auth session

**Depends on:** nothing. Independent of the better-auth 1.7 upgrade (item 5).
**Risk:** medium — the fix touches an authorization input. **Size:** 1–2 hours.

> Found while live-testing item 5 on 2026-09-07. **Pre-existing, not a 1.7
> regression** — reproduced identically on a 1.6.30 baseline run and on
> 1.7.3. Item 12 is the user-visible symptom of this bug.

## Symptom

After a successful Better Auth sign-in, the session user is missing both
custom fields:

```
email: chris.kehayias@acst.com | name: Christopher Kehayias
firstName: Christopher | lastName: Kehayias     <- customSession works
userGuid: undefined | imageGuid: undefined      <- both dropped
```

`GET /api/auth/session-tokens` correspondingly returns `imageGuid: null`
(`src/app/api/auth/session-tokens/route.ts:21`). No error is logged anywhere —
it fails completely silently.

## Root cause

`src/lib/auth.ts` declares both fields with `input: false`:

```ts
user: {
  additionalFields: {
    userGuid:  { type: "string", required: false, input: false },
    imageGuid: { type: "string", required: false, input: false },
  },
},
```

and populates them from `mapProfileToUser`. But Better Auth strips exactly
those fields when building a user from an OAuth provider profile —
`better-auth/dist/db/schema.mjs`, `parseAdditionalUserInputFromProviderProfile`:

```js
for (const key of Object.keys(profile)) {
  if (schema[key]?.input === false) continue;   // <- silently skipped
  allowedProfileFields[key] = profile[key];
}
```

So `mapProfileToUser` runs and returns the right values (it is called at
`plugins/generic-oauth/index.mjs:229` and its result *is* spread into the user
object), and they are then discarded by the input filter before the user is
created. `input: false` means "not settable from input" and the provider
profile is treated as input.

## Why the obvious fix is not safe on its own

Flipping to `input: true` makes the fields client-writable through
`updateUser`. `userGuid` is an **authorization input**:

- `src/app/(demo)/layout.tsx:24` → `checkDemoAccess(session.user.userGuid)`
- `src/app/(demo)/demo/_lib/check-demo-access.ts:39` resolves that GUID to a
  `dp_Users.User_ID` and checks group membership against
  `DEMO_ACCESS_GROUP_IDS`.

A user who can set their own `userGuid` can impersonate another MP user for the
demo-access check. Do not simply remove `input: false`.

## Options

1. **Preferred — populate via a database hook.** Set the fields in a
   `databaseHooks.user.create.before` (and `update.before` if a refresh is
   wanted) hook, which writes to the record directly and bypasses the input
   filter. Keeps `input: false`, so the fields stay non-writable by clients.
2. `input: true` **plus** an explicit server-side block on these fields in
   `updateUser` (e.g. a `before` hook that rejects them). More moving parts, and
   easier to get wrong than option 1.

Whichever route, keep the fields non-writable from the client — that property is
what `checkDemoAccess` depends on.

## Scope note

Only the **Better Auth app session** is affected. The widget/embed flow is
hand-rolled and resolves the image itself —
`src/app/api/embed/auth/callback/route.ts:137` calls `lookupImageGuid(...)`
(`src/app/api/embed/auth/_lib/auth-route-helpers.ts:138`) — so widget login,
`/api/embed/auth/me`, and the `sub` on widget JWTs are unaffected and already
carry a real `userGuid`.

## Testing

No automated test covers this; the existing `userGuid` assertions in
`src/app/api/embed/auth/*.test.ts` all exercise the embed flow, not Better Auth.

- Sign in through `/signin` against a live MP domain, then check
  `GET /api/auth/get-session` reports a real `userGuid` **and** `imageGuid`.
- `GET /api/auth/session-tokens` returns a non-null `imageGuid`.
- `/demo` loads instead of bouncing (this is item 12).
- Attempt to set `userGuid` via the client `updateUser` and confirm it is
  rejected or ignored.
- Add a regression test for whichever mechanism is chosen — this bug is
  invisible to `tsc` and to all 808 existing tests.

## Done when

A fresh sign-in yields a populated `userGuid` and `imageGuid` on the session,
those fields cannot be set by a client, and a test covers it.
