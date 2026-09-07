/**
 * Two ways to read the Better Auth session, and which one a call site owes.
 *
 * `session.cookieCache` is on (`src/lib/auth.ts`). When the signed cache
 * cookie verifies, `getSession` returns the session it carries and **never
 * touches the store** (`better-auth/dist/api/routes/session.mjs`, the
 * `sessionDataPayload?.session` branch). Nothing on that path can notice that
 * the session was signed out or revoked, so a cookie copied before sign-out
 * kept authorizing for up to `cookieCache.maxAge` -- measured live at 5
 * minutes, including a full `/demo` render (TODO 24).
 *
 * Better Auth models the fix rather than banning the cache: its own
 * `getAuthoritativeSessionFromCtx` re-reads the store when one exists
 * (`disableCookieCache: isStateful(ctx)`), and its `sensitiveSessionMiddleware`
 * -- used for password changes, account deletion, account linking -- goes
 * through it. Everything else keeps the cache. These two helpers are the same
 * split, named so a call site has to choose.
 *
 * Cost of the authoritative read: exactly one `secondaryStorage.get(token)`
 * (`internalAdapter.findSession` short-circuits on the denormalised session
 * record and never joins a user row), i.e. one Redis GET. That is the price of
 * revocation being immediate, and it is charged only on the paths below --
 * item 14's optimisation still covers every other read.
 */

import { auth } from "@/lib/auth";

type SessionResult = Awaited<ReturnType<typeof auth.api.getSession>>;

/**
 * Authoritative read: bypasses the cookie cache and asks the session store.
 *
 * Use wherever staleness is a security property -- an access decision, or the
 * issuing of any credential that outlives the request:
 *
 * - `src/app/(demo)/layout.tsx` -- the group-membership gate for the whole
 *   `/demo` surface.
 * - `src/app/api/auth/session-tokens/route.ts` -- hands the caller the live MP
 *   access / refresh / id tokens.
 * - `src/app/api/embed/session/route.ts` -- mints a widget JWT and opens a
 *   server-side embed session with its own idle + absolute TTL.
 *
 * Costs one store round trip per call. That is the point.
 */
export async function getAuthoritativeSession(
  headers: Headers,
): Promise<SessionResult> {
  return auth.api.getSession({ headers, query: { disableCookieCache: true } });
}

/**
 * Cached read: answers from the signed cache cookie when it is valid.
 *
 * Only for reads that grant nothing and sit behind a gate that already made
 * the authoritative call -- rendering the signed-in user's name, or reading an
 * id_token in order to *end* a session. A revoked session showing a stale name
 * for a few minutes is a cosmetic bug; a revoked session passing a gate is not.
 *
 * If you are about to reach for this to make an access decision, you want
 * {@link getAuthoritativeSession} instead.
 */
export async function getCachedSession(
  headers: Headers,
): Promise<SessionResult> {
  return auth.api.getSession({ headers });
}

/**
 * Rewrites an inbound `GET /api/auth/get-session` so it reads the store.
 *
 * That endpoint is credential-issuing here, not a cheap read: the
 * `customSession` plugin in `src/lib/auth.ts` decorates the session with the
 * MP `accessToken` / `refreshToken` / `idToken` lifted off the account cookie.
 * Measured on a replayed pre-sign-out cookie against a real store: the session
 * row was gone, `?disableCookieCache=true` returned `null`, and the plain call
 * still returned 200 with all three MP tokens. Forcing the flag is what makes
 * sign-out mean signed out on the wire (TODO 24).
 *
 * Only this one path, and only real HTTP traffic. Server-side reads through
 * `auth.api.getSession` never pass through the route handler, so
 * {@link getCachedSession} still costs zero store round trips. In practice the
 * added cost is nil: the only caller of the HTTP endpoint is `/signin`, which
 * already asks for an authoritative read.
 *
 * Applied to GET only -- it has no body to forward, and better-auth answers
 * POST /get-session with METHOD_NOT_ALLOWED unless `deferSessionRefresh` is
 * on, which this app does not set.
 */
export function forceAuthoritativeSessionRead(request: Request): Request {
  const url = new URL(request.url);
  // Better Auth resolves the endpoint from the trailing path segment.
  if (!url.pathname.endsWith("/get-session")) return request;
  if (url.searchParams.get("disableCookieCache") === "true") return request;

  url.searchParams.set("disableCookieCache", "true");
  return new Request(url, {
    method: request.method,
    headers: request.headers,
  });
}
