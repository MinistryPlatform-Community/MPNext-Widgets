import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, isPublicPath, config } from './proxy';
import { LOGOUT_RETURN_COOKIE } from '@/lib/embed/logout-return';

const getSessionCookie = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('better-auth/cookies', () => ({ getSessionCookie }));
vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

function request(pathname: string, cookies?: Record<string, string>): NextRequest {
  const req = new NextRequest(`http://localhost:3000${pathname}`);
  for (const [name, value] of Object.entries(cookies ?? {})) {
    req.cookies.set(name, value);
  }
  return req;
}

/**
 * The four URLs an external host site fetches for an embed. Sourced from
 * `public/embed-sdk/` + the loader's own imports.
 */
const EMBED_SDK_URLS = [
  '/embed-sdk/next-embed.js',
  '/embed-sdk/next-embed.2ba8f2b9.es.js',
  '/embed-sdk/next-embed.2ba8f2b9.es.js.map',
  '/embed-sdk/mp-widget-overrides.css',
  '/embed-sdk/mp-widget-overrides.856a46b3.css',
];

/**
 * The matcher is a path-to-regexp pattern whose body is a raw regex group, so
 * anchoring it is a faithful stand-in for what Next.js compiles it to. Only
 * the unescaped `.` in `favicon.ico` and `robots.txt` differs, which none of
 * these cases hit.
 */
const matcherRegex = new RegExp(`^${config.matcher[0]}$`);

beforeEach(() => {
  getSessionCookie.mockReset();
  getSessionCookie.mockReturnValue(null);
});

describe('isPublicPath', () => {
  it.each([
    '/api',
    '/api/embed/session',
    '/api/embed/auth/login',
    '/api/auth/callback/ministryplatform',
    '/signin',
    '/demo',
    '/demo/user-menu',
    '/embed-sdk',
    ...EMBED_SDK_URLS,
    // Root-level site chrome (TODO 26): served to crawlers and browsers with
    // no session, so a redirect to /signin is the wrong answer for both.
    '/favicon.ico',
    '/robots.txt',
  ])('allows %s', (pathname) => {
    expect(isPublicPath(pathname)).toBe(true);
  });

  it.each([
    '/',
    '/dashboard',
    '/admin/settings',
    // Prefix matching is segment-aware: these must not inherit the allowlist.
    '/apidocs',
    '/signin-help',
    '/demo-admin',
    '/embed-sdk-admin',
    '/embed-sdkx/next-embed.js',
    // Site chrome is matched exactly, not as a prefix.
    '/robots.txt/x',
    '/favicon.ico/x',
    '/robots.txt.bak',
    // `public/assets` never existed (TODO 26); the matcher no longer pretends
    // it does, and the allowlist never did.
    '/assets/icons/favicon.ico',
  ])('gates %s', (pathname) => {
    expect(isPublicPath(pathname)).toBe(false);
  });
});

describe('proxy() with no session cookie', () => {
  it.each(EMBED_SDK_URLS)('serves %s instead of redirecting to /signin', async (pathname) => {
    const res = await proxy(request(pathname));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });

  it.each([
    '/api/embed/session',
    '/api/embed/full-calendar/events',
    '/signin',
    '/demo',
    '/favicon.ico',
    '/robots.txt',
  ])(
    'lets %s through',
    async (pathname) => {
      const res = await proxy(request(pathname));
      expect(res.headers.get('location')).toBeNull();
    },
  );

  it.each(['/', '/dashboard', '/embed-sdk-admin'])('redirects %s to /signin', async (pathname) => {
    const res = await proxy(request(pathname));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/signin');
  });

  it('never reads the session cookie for a public path', async () => {
    await proxy(request('/embed-sdk/next-embed.js'));
    expect(getSessionCookie).not.toHaveBeenCalled();
  });
});

describe('proxy() with a session cookie', () => {
  it('lets a protected path through', async () => {
    getSessionCookie.mockReturnValue('a-session-cookie');
    const res = await proxy(request('/dashboard'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects to /signin when the cookie check throws', async () => {
    getSessionCookie.mockImplementation(() => {
      throw new Error('boom');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await proxy(request('/dashboard'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/signin');
    spy.mockRestore();
  });
});

describe('config.matcher', () => {
  it('excludes /embed-sdk/ so the proxy is never invoked for the SDK', () => {
    for (const pathname of EMBED_SDK_URLS) {
      expect(matcherRegex.test(pathname)).toBe(false);
    }
  });

  it.each(['/_next/static/chunks/main.js', '/_next/image?url=x', '/favicon.ico', '/robots.txt'])(
    'excludes %s',
    (pathname) => {
      expect(matcherRegex.test(pathname.split('?')[0])).toBe(false);
    },
  );

  /**
   * TODO 26. The matcher used to exclude `assets/` for a
   * `/assets/icons/favicon.ico` that `public/` never contained. The icon now
   * ships as `src/app/favicon.ico` (already excluded), so the exclusion is
   * gone and `/assets/...` is gated like any other unknown path.
   */
  it('no longer excludes assets/, which serves nothing', () => {
    expect(matcherRegex.test('/assets/icons/favicon.ico')).toBe(true);
  });

  it.each(['/', '/dashboard', '/demo', '/embed-sdk-admin'])('still runs for %s', (pathname) => {
    expect(matcherRegex.test(pathname)).toBe(true);
  });
});

/**
 * TODO 29. MP will not complete an end-session whose `post_logout_redirect_uri`
 * is not registered on its OAuth client, and an embed SDK's host pages cannot
 * all be registered. So the widget host sends MP its own registered `/signin`
 * and finishes the trip here, from the HttpOnly cookie
 * `GET /api/embed/auth/logout` left behind.
 */
describe('proxy() finishing an embed logout on /signin', () => {
  const HOST_PAGE = 'https://allowed.example.com/members';

  it('redirects to the host page and clears the cookie', async () => {
    const res = await proxy(request('/signin', { [LOGOUT_RETURN_COOKIE]: HOST_PAGE }));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(HOST_PAGE);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Cleared, so a stale cookie cannot bounce the next /signin visit.
    expect(res.cookies.get(LOGOUT_RETURN_COOKIE)?.value).toBe('');
  });

  it('renders /signin normally when there is no cookie', async () => {
    const res = await proxy(request('/signin'));
    expect(res.headers.get('location')).toBeNull();
  });

  it.each([
    ['an origin that is not embedded here', 'https://evil.example.net/pwn'],
    ['a lookalike suffix', 'https://allowed.example.com.evil.net/'],
    ['javascript:', 'javascript:alert(1)'],
    ['a relative path', '/dashboard'],
  ])('is not an open redirect: refuses %s and still clears the cookie', async (_why, value) => {
    const res = await proxy(request('/signin', { [LOGOUT_RETURN_COOKIE]: value }));
    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get(LOGOUT_RETURN_COOKIE)?.value).toBe('');
  });

  it('only fires on /signin -- the cookie cannot divert any other path', async () => {
    for (const pathname of ['/demo', '/dashboard', '/api/embed/session', '/signin/help']) {
      const res = await proxy(request(pathname, { [LOGOUT_RETURN_COOKIE]: HOST_PAGE }));
      expect(res.headers.get('location')).not.toBe(HOST_PAGE);
    }
  });
});
