import { NextResponse, NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { LOGOUT_RETURN_COOKIE, isAllowedReturnTarget } from '@/lib/embed/logout-return';

/**
 * Paths that must resolve without a Better Auth session cookie.
 *
 * The proxy is deny-by-default: anything that reaches `proxy()` and is not
 * listed here is redirected to `/signin`. Keep this list exact — prefixes are
 * matched as path *segments* (`/demo` or `/demo/...`), never as bare
 * `startsWith`, so a future `/demo-admin` route stays gated.
 *
 * - `/api`       — every API route authenticates itself. `/api/embed/*` in
 *                  particular is called cross-origin by the widgets with a
 *                  Bearer widget JWT (`requireWidgetAuth`) and would never
 *                  carry the `SameSite=Lax` app cookie.
 * - `/signin`    — the sign-in page itself; gating it would loop.
 * - `/demo`      — the demo library gates itself server-side in
 *                  `(demo)/layout.tsx`, which also checks demo access, not
 *                  merely the presence of a cookie.
 * - `/embed-sdk` — the published embed SDK: the loader, the content-hashed
 *                  bundle + sourcemap, and the MP override stylesheets. These
 *                  are static files under `public/` that external host sites
 *                  fetch anonymously and cross-origin (`vercel.json` already
 *                  serves them with `Access-Control-Allow-Origin: *` and
 *                  immutable caching). Redirecting them to `/signin` handed
 *                  host pages an HTML document where a JS module or a
 *                  stylesheet was expected, so no `<next-*>` element ever
 *                  upgraded.
 */
const PUBLIC_PATH_PREFIXES = ['/api', '/signin', '/demo', '/embed-sdk'] as const;

/**
 * Root-level site chrome: exact paths, never prefixes.
 *
 * These are not application routes and expose nothing, but a crawler or a
 * browser asks for them unauthenticated. Answering with a `307` to `/signin`
 * is wrong for both — a crawler reads a redirected `/robots.txt` as "no policy"
 * and a browser gets an HTML document where an image was expected. If either
 * file is ever removed, Next.js's own `404` is the correct answer, which is
 * also why they are matched exactly: `/robots.txt/anything` stays gated.
 *
 * The matcher below already keeps the proxy from running for them. This is the
 * guarantee if the matcher is ever loosened, the same belt-and-braces
 * `/embed-sdk` gets.
 */
const PUBLIC_EXACT_PATHS = ['/favicon.ico', '/robots.txt'] as const;

/**
 * True when `pathname` is the allowlisted path itself or a descendant of it.
 * Exported for tests: this allowlist is the app's entire authentication
 * boundary, so it is pinned rather than trusted.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    (PUBLIC_EXACT_PATHS as readonly string[]).includes(pathname) ||
    PUBLIC_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

/**
 * The registered `post_logout_redirect_uri` MinistryPlatform returns to after
 * ending its session, and therefore the one path that can be carrying a
 * pending embed logout (`src/lib/embed/logout-return.ts`).
 */
const LOGOUT_LANDING_PATH = '/signin';

/**
 * Last leg of the embed logout bounce.
 *
 * A widget on a church site cannot name its own page as MP's
 * `post_logout_redirect_uri` — MP only honours URIs registered on the OAuth
 * client, and an unregistered one leaves the SSO session alive behind a
 * "Would you like to logout?" prompt (TODO 29). So the widget host takes MP's
 * redirect on its own registered `/signin` and finishes the trip here.
 *
 * Returns null unless this really is that landing: `/signin`, carrying the
 * HttpOnly cookie only `GET /api/embed/auth/logout` sets, naming an origin
 * still on the embed allowlist. Without those three the request is an ordinary
 * `/signin` visit and must render the sign-in page. The cookie is cleared on
 * the way out either way, so a stale one cannot bounce the next visit.
 */
function embedLogoutReturn(request: NextRequest): NextResponse | null {
  if (request.nextUrl.pathname !== LOGOUT_LANDING_PATH) return null;
  const target = request.cookies.get(LOGOUT_RETURN_COOKIE)?.value;
  if (!target) return null;

  const res = isAllowedReturnTarget(target)
    ? NextResponse.redirect(target, 302)
    : NextResponse.next();
  res.cookies.delete(LOGOUT_RETURN_COOKIE);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const logoutReturn = embedLogoutReturn(request);
  if (logoutReturn) return logoutReturn;

  // Early returns for public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  try {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/signin', request.url));
    }
    return NextResponse.next();
  } catch (error) {
    console.error('Proxy: Error checking session:', error);
    return NextResponse.redirect(new URL('/signin', request.url));
  }
}

/**
 * Without a matcher the proxy runs on every request, including `public/`
 * files. The negative lookahead skips the static surface entirely so the
 * proxy is never even invoked for it:
 *
 * - `_next/static`, `_next/image` — framework output.
 * - `favicon.ico`, `robots.txt` — root-level site chrome, see
 *   `PUBLIC_EXACT_PATHS`. Both are real files now: `src/app/favicon.ico` and
 *   `src/app/robots.ts` (the App Router metadata conventions). There is no
 *   `assets/` exclusion any more — nothing was ever served from `public/assets`
 *   (TODO 26), so it excluded a path that did not exist.
 * - `embed-sdk/` — the published SDK, see `PUBLIC_PATH_PREFIXES`. It is listed
 *   here *and* in the early return: the matcher is the cheap path, the early
 *   return is the guarantee if the matcher is ever loosened.
 *
 * Matcher values must be statically analyzable string literals, so this cannot
 * be built from the lists above.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|embed-sdk/).*)',
  ],
};
