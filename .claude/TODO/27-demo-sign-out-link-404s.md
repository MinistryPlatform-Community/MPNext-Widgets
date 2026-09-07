# 27. The `/demo` "Sign Out" link 404s — Better Auth's `/sign-out` is POST-only

**Depends on:** nothing. **Risk:** low — cosmetic, but the only visible way to
sign out of the demo app does nothing. **Size:** ~20 minutes.

> Found while browser-testing item 24 on 2026-09-07. **Pre-existing** — the
> anchor dates to `8118c08`, long before items 13/14/24 touched this area.

## The problem

`src/app/(demo)/demo/page.tsx` renders sign-out as a plain navigation:

```tsx
<a href="/api/auth/sign-out" ...>Sign Out</a>
```

Better Auth 1.7.3 registers that endpoint as **POST only**
(`better-auth/dist/api/routes/sign-out.mjs`: `createAuthEndpoint("/sign-out",
{ method: "POST", ... })`), so the GET falls through the `[...all]` catch-all
and 404s. Measured live against a real store:

| request | result |
|---|---|
| `GET /api/auth/sign-out` (what the link does) | **404**, session row untouched |
| `POST /api/auth/sign-out` | 200 `{"success":true}`, session row deleted |

The user stays signed in and gets a 404 page. Nothing in the suite catches it
because the anchor is markup, not a call.

## Notes for whoever picks this up

- The widget path already does this correctly and is the model to follow:
  `TokenBridge` (item 13) intercepts `next-user-menu`'s cancelable
  `userLogout` and `POST`s to `/api/auth/logout`, which reads the `id_token`,
  calls `auth.api.signOut`, and returns MP's end-session URL. Verified working
  in the same session.
- So the fix is probably not "make the link a POST form" but "route the demo
  header's Sign Out through `/api/auth/logout`" — otherwise a bare
  `POST /api/auth/sign-out` ends the Better Auth session while leaving the MP
  IdP session alive, and the next `/demo` visit silently signs the user
  straight back in (observed: `/demo` → `/signin` → MP already authenticated →
  back to `/demo`, no prompt).
- A small client component with an `onClick` that POSTs and then follows the
  returned `redirectUrl` matches what `TokenBridge` already does.

## Done when

Clicking Sign Out on `/demo` ends both the Better Auth session (row gone from
the session store) and the MP session (browser lands on MP's end-session /
login page), and a test pins that the header no longer points at a GET-only
endpoint.
