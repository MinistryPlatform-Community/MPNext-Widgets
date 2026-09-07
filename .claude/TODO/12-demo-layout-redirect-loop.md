# 12. `/demo` infinite redirect loop when a session field is missing

**Depends on:** nothing. Item 11 (now **done**) removed the current trigger;
this item is the underlying failure mode, still latent.
**Risk:** low. **Size:** 30 min.

> Found while live-testing item 5 on 2026-09-07. **Pre-existing** — reproduced
> identically against a 1.6.30 baseline and 1.7.3.

## Symptom

After a **successful** sign-in, `/demo` bounces forever:

```
GET /api/auth/callback/ministryplatform  302  ->  /
GET /                                    307  ->  /demo
GET /demo                                307  ->  /signin?callbackUrl=/demo
GET /signin                              200       (session exists, so it
GET /demo                                307       redirects to callbackUrl)
GET /signin?callbackUrl=/demo            200       ... and around again
```

The browser spins with no error message. The session is valid the whole time —
`GET /api/auth/get-session` returns the user, and `/api/auth/session-tokens`
returns 200 with access, id and refresh tokens.

## Root cause

`src/app/(demo)/layout.tsx:20`:

```ts
const session = await auth.api.getSession({ headers: await headers() });

if (!session?.user?.userGuid) {
  redirect("/signin?callbackUrl=/demo");
}
```

The guard conflates two different states:

- **not signed in** → redirecting to `/signin` is correct
- **signed in, but `userGuid` is missing** → redirecting to `/signin` is a loop,
  because `/signin` sees a valid session and sends the user straight back

Item 11 has since made `userGuid` reliably present, so the loop no longer fires
on a normal sign-in (it was reproduced on demand during that fix by suppressing
the field). But the loop is a latent bug in its own right: any future gap in
that field reproduces it, and the failure mode is a hang with no diagnostic
rather than a message.

Note `src/proxy.ts` is **not** involved — it early-returns for any path starting
with `/demo` (`src/proxy.ts:8`), so this is entirely the route group's own guard.

## Fix

Split the two cases in `src/app/(demo)/layout.tsx`:

- `!session?.user` → `redirect("/signin?callbackUrl=/demo")` (unchanged).
- `session?.user` but no `userGuid` → **do not redirect.** Render the existing
  `AccessDenied` component (already imported for the no-group case) or a
  similar explanatory state, and `console.error` server-side so the cause is
  visible in logs rather than silent.

Consider the same split anywhere else a signed-in user can fail a secondary
check — grep for `redirect("/signin` before assuming this is the only one.

## Testing

- With `userGuid` artificially suppressed (item 11 is fixed, so force the
  field to null), confirm `/demo` renders an explanatory page instead of
  looping.
- Normally, confirm `/demo` renders the catalog.
- Signed out, confirm `/demo` still redirects to `/signin?callbackUrl=/demo`.
- Signed in without demo group membership (and `DEMO_PUBLIC_ACCESS` unset),
  confirm `AccessDenied` still renders — that path must not regress.

## Done when

No sign-in state produces a redirect loop: a signed-in user who fails a
secondary check sees an explanation, and only genuinely unauthenticated
requests are sent to `/signin`.
