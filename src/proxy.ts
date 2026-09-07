import { NextResponse, NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

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
 * True when `pathname` is the allowlisted path itself or a descendant of it.
 * Exported for tests: this allowlist is the app's entire authentication
 * boundary, so it is pinned rather than trusted.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
 * - `_next/static`, `_next/image`, `favicon.ico`, `assets/` — framework and
 *   app chrome (`assets/icons/favicon.ico` is referenced by the root layout).
 * - `embed-sdk/` — the published SDK, see `PUBLIC_PATH_PREFIXES`. It is listed
 *   here *and* in the early return: the matcher is the cheap path, the early
 *   return is the guarantee if the matcher is ever loosened.
 *
 * Matcher values must be statically analyzable string literals, so this cannot
 * be built from the list above.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|embed-sdk/).*)',
  ],
};
