import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, isPublicPath, config } from './proxy';

const getSessionCookie = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('better-auth/cookies', () => ({ getSessionCookie }));

function request(pathname: string): NextRequest {
  return new NextRequest(`http://localhost:3000${pathname}`);
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
 * the unescaped `.` in `favicon.ico` differs, which none of these cases hit.
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

  it.each(['/api/embed/session', '/api/embed/full-calendar/events', '/signin', '/demo'])(
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

  it.each(['/_next/static/chunks/main.js', '/_next/image?url=x', '/favicon.ico', '/assets/icons/favicon.ico'])(
    'excludes %s',
    (pathname) => {
      expect(matcherRegex.test(pathname.split('?')[0])).toBe(false);
    },
  );

  it.each(['/', '/dashboard', '/demo', '/embed-sdk-admin'])('still runs for %s', (pathname) => {
    expect(matcherRegex.test(pathname)).toBe(true);
  });
});
