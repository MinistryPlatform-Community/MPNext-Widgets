# 13. `TokenBridge` never mounts on any reachable route

**Depends on:** nothing (items 11/12 make `/demo` reachable again, but do not
fix this). **Risk:** medium — it silently disables server-side sign-out.
**Size:** ~1 hour.

> Found while browser-testing former item 9 (the `token-bridge` lint warning) on
> 2026-09-07. **Pre-existing** — not introduced by that change.

## Symptom

`TokenBridge` does two things: it bridges the Better Auth session's MP tokens
into `localStorage` as `mpp-widgets_*`, and it intercepts the widget's
`userLogout` event so logout goes through `POST /api/auth/logout` (which calls
`auth.api.signOut()`) before redirecting to MP's end-session endpoint.

In the running app, neither happens: the component is never mounted on a route
a user can actually land on.

## Root cause

`TokenBridge` is rendered only by `src/app/(app)/layout.tsx:17`.

The `(app)` route group contains exactly one page, `src/app/(app)/page.tsx`,
and that page is:

```ts
function Home() {
  redirect('/demo');
}
```

`redirect()` in a Server Component page aborts the render of the whole request,
so `(app)/layout.tsx` never reaches the client and `TokenBridge` never mounts.
`/demo` lives in a different route group, `(demo)`, whose layout
(`src/app/(demo)/layout.tsx`) renders `MPWidgetsLoader` but **not**
`TokenBridge`.

Verified in the browser on 2026-09-07: with a temporary page added under
`(app)`, `TokenBridge` mounts and both behaviours work correctly (tokens
bridged, `userLogout` canceled and handled). Remove the temporary page and the
`(app)` layout is unreachable again.

## Consequences

1. **Server session is never signed out on logout.** `next-user-menu` dispatches
   a *cancelable* `userLogout`
   (`packages/embed-sdk/src/components/user-menu.ts:550`,`:1266`). With no
   listener the event is not canceled, so the widget falls through to its own
   `window.location.href = endSessionUrl`. MP's session ends, but the Better
   Auth cookie survives — the user still has a valid app session.
2. `postLogoutRedirectUri` handling in `token-bridge.tsx` is dead code.
3. The `localStorage` token bridge is dead code on `/demo`; the demo pages get
   `mpp-widgets_*` from whatever else writes them.

## Fix (pick one)

- **Preferred:** move `<TokenBridge />` (and the `next-embed.es.js` `<Script>`,
  if the demo pages need it) into `src/app/(demo)/layout.tsx`, or hoist both into
  the root `src/app/layout.tsx` so every authenticated route gets them. Note
  `TokenBridge` is a client component that renders `null`, so hoisting is cheap.
- **Or:** delete the `(app)` route group's redirect-only page and make `/demo`
  the real home, then confirm nothing else depended on `(app)`.

Whichever way, make sure only **one** copy mounts — two listeners on `document`
would fire `POST /api/auth/logout` twice.

## Testing

- Sign in, land on `/demo`, confirm `localStorage` gains `mpp-widgets_AuthToken`
  / `_IdToken` / `_Refresh` / `_ExpiresAfter` from the bridge.
- Click Sign Out in `next-user-menu` and confirm:
  - the `userLogout` event is canceled (`defaultPrevented === true`),
  - `POST /api/auth/logout` is issued,
  - the browser lands on MP's end-session URL,
  - and after the round trip `GET /api/auth/get-session` returns **no** session
    (this is the part that is broken today).
- Force the logout API to fail and confirm the fallback still lands on `/signin`.
- Confirm the handler is registered exactly once (`userLogout` should produce a
  single `POST /api/auth/logout` in the network log).

## Done when

`TokenBridge` mounts on the routes users actually reach, signing out clears the
Better Auth session as well as the MP session, and the `userLogout` handler is
registered exactly once.
