# 31. The in-memory session store is not a working fallback — `/demo` redirect-loops locally

**Depends on:** nothing.
**Risk:** developer experience, not production (every deployed environment sets
`EMBED_SESSION_STORE_URL`). But it is a hard blocker locally: with no store URL
you **cannot sign in at all**, so any work that needs a signed-in user is gated
on standing up an Upstash-REST endpoint first.
**Size:** ~1-2 hours (a loopback in-process REST shim), or ~15 minutes if the
answer is "document that a store URL is mandatory and make the fallback fail
loudly".

> Written up by the item-29 agent while browser-testing widget logout on
> 2026-09-07. **Pre-existing** and unrelated to that fix.

## The problem

With `EMBED_SESSION_STORE_URL` unset, `getSessionStore()`
(`src/lib/embed/session-store.ts`) hands back a `MemorySessionStore`. Signing in
locally then never completes: `/signin` reports a session, the `(demo)` layout
does not, and the browser bounces `/demo → /signin → /demo …` until it gives up.

The Better Auth session is stored there too — `betterAuthSecondaryStorage()`
(`src/lib/auth-secondary-storage.ts`) namespaces Better Auth's whole session
path into the same store under `nw:kv:ba:*` — so "the session store" and "am I
signed in" are the same question, and the two halves of the app disagree
about it.

## Root cause

`MemorySessionStore` keeps its data in a module-level `Map`, and
`getSessionStore()` memoises the instance in a module-level `instance`
variable. Both are per-**module-instance** state, and on this Next version the
App Router does not give the whole app one module instance: the React Server
Component graph and the route-handler / proxy graph are separate bundles, each
with its own evaluation of `src/lib/embed/session-store.ts`.

So there are two `MemorySessionStore`s with two disjoint `Map`s:

- `POST /api/auth/...` (route handler graph) writes the session row into Map A.
- `src/app/(demo)/layout.tsx` (RSC graph) reads Map B, finds nothing, and
  redirects to `/signin`.
- `/signin` — depending on which graph the check it runs lands in — sees Map A,
  finds the session, and redirects to `/demo`.

Nothing is wrong with the sign-in flow itself; the two sides are just looking at
different objects. An external store (Upstash REST, or anything reached over the
network) has no such problem, which is why this has never been seen in a
deployed environment.

This also means the in-memory branch of `getSessionStore()` is **not** the
fallback its comment claims (`"dev/test only (single process)"`). It works in
unit tests, where there is exactly one module graph, and nowhere else.

## Notes for whoever picks this up

- Do **not** "fix" this by hoisting the Map onto `globalThis` without checking
  it actually crosses the graphs on this Next version — measure first
  (log `process.pid` and a per-instance random id from both a route handler and
  the `(demo)` layout). If the graphs are separate *processes* rather than
  separate module instances, no in-process trick can work and the loopback
  option below is the only one.
- The option that is known to work today is a **loopback Upstash-REST helper**:
  a tiny local server that speaks the Upstash REST dialect
  (`UpstashSessionStore` in `src/lib/embed/session-store.ts` is the only
  consumer, so the surface is small — `GET`/`SET`/`DEL`/`EXPIRE`/pipeline) and
  is pointed at by `EMBED_SESSION_STORE_URL` in `.env.local`. Everything then
  goes over HTTP and both graphs agree. Items 24, 27 and 29 were all verified
  this way.
- Whatever the fix, the fallback should stop being silent. Today the only
  warning is gated on `NODE_ENV === "production"`, which is precisely the
  environment where it never fires, and in dev the user gets a redirect loop
  with no explanation.
- `src/app/(demo)/layout.tsx` already distinguishes "not signed in" from
  "signed in but incomplete" (item 12) — a third case, "the store disagrees
  with itself", would be worth a distinct message rather than another redirect.

## Steps

1. Reproduce: unset `EMBED_SESSION_STORE_URL` in `.env.local`, `pnpm dev`, sign
   in at `/signin`, observe the `/demo ↔ /signin` loop in the network panel.
2. Instrument both graphs with a per-module-instance id to confirm the split
   (and to find out whether it is two module instances or two processes).
3. Pick the fix: shared in-process state if the measurement allows it, else
   ship the loopback REST helper as a dev script and require a store URL.
4. Make the in-memory fallback warn in **development** too, with a one-line
   pointer at whichever local-store path step 3 chose.
5. Note the requirement in `README.md`'s "Widget Authentication" runbook and in
   `CLAUDE.md`'s dev-auth section, both of which currently say "no
   `EMBED_SESSION_STORE_URL` → in-memory session store" as though that works.

## Testing

- Unit tests cannot see this — they run in one module graph, which is the whole
  point — so a unit test is not the evidence here. The verification is manual:
  sign in locally end to end with the chosen configuration and reach `/demo`.
- If a loopback helper ships, exercise it against `UpstashSessionStore`'s full
  surface, including the pipeline path and TTL expiry, not just `GET`/`SET`.
- Re-run the standard verification gate.

## Done when

A developer with a fresh clone and no external Redis can sign in locally and
land on `/demo` by following a documented step — or, if that is judged not worth
building, the in-memory branch fails fast with a message naming the required
setup instead of producing a silent redirect loop, and both `README.md` and
`CLAUDE.md` say so.
