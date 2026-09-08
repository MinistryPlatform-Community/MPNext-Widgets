import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { MP_WIDGET_STORAGE_KEYS, clearMpWidgetStorage, requestAppLogout } from './app-logout';

/**
 * Cover for TODO 27.
 *
 * The `/demo` header signed out with `<a href="/api/auth/sign-out">`. Better
 * Auth registers that endpoint POST-only, so the GET 404'd and the session
 * survived — and the obvious "make it a POST" fix would still have been wrong,
 * because it ends the Better Auth session only and leaves the MP IdP session
 * to sign the user straight back in on the next `/demo` visit.
 *
 * These tests pin the two halves of the fix:
 *   - `requestAppLogout` is the app's single logout mechanism, and it goes to
 *     `POST /api/auth/logout` (which ends *both* sessions), and
 *   - no source file can reintroduce a GET navigation to an auth API route.
 */

const repoRoot = resolve(import.meta.dirname, '../..');
const srcDir = resolve(repoRoot, 'src');

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = collectSourceFiles(srcDir);

/**
 * Source with comments removed, so a doc comment *about* an endpoint (like the
 * one at the top of `app-logout.ts`) is not mistaken for a call to it.
 */
function code(file: string): string {
  return readFileSync(file, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Line comments, but not the `//` inside a URL such as `https://…`.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('logout is a single mechanism', () => {
  it('no source file navigates to Better Auth /sign-out', () => {
    // POST-only upstream (`better-auth/dist/api/routes/sign-out.mjs`), so any
    // `href`/`action`/`location` pointing at it is a 404 — and even a correct
    // POST would leave the MP session alive.
    const offenders = sourceFiles.filter((f) => code(f).includes('/api/auth/sign-out'));
    expect(offenders.map((f) => relative(repoRoot, f))).toEqual([]);
  });

  it('no source file puts an auth API route behind a plain href', () => {
    // An `href` is a GET. Every `/api/auth/*` endpoint this app owns is POST.
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      for (const [match] of code(file).matchAll(/href=["'`]\/api\/auth\/[^"'`]*["'`]/g)) {
        offenders.push(`${relative(repoRoot, file)} → ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only app-logout.ts calls the logout endpoint', () => {
    // Two divergent logout paths is how "ends one session but not the other"
    // comes back. `TokenBridge` and `SignOutButton` both go through here.
    const callers = sourceFiles.filter(
      (f) => code(f).includes('"/api/auth/logout"') || code(f).includes("'/api/auth/logout'"),
    );
    expect(callers.map((f) => relative(repoRoot, f)).sort()).toEqual([
      join('src', 'lib', 'app-logout.ts'),
    ]);
  });

  /**
   * TODO 29. Two hand-rolled end-session builders drifted apart: the app route
   * defaulted to the registered `${BETTER_AUTH_URL}/signin` and worked, the
   * widget path passed `window.location.href` and did not. One builder now, so
   * `post_logout_redirect_uri` has exactly one possible value server-side.
   */
  it('only mp-oauth.ts builds an MP end-session URL', () => {
    const builders = sourceFiles.filter((f) => code(f).includes('endsession'));
    expect(builders.map((f) => relative(repoRoot, f)).sort()).toEqual([
      join('src', 'lib', 'embed', 'mp-oauth.ts'),
    ]);
  });

  it('no source file offers a post-logout destination to MP', () => {
    // The parameter may only be set by `buildEndSessionUrl`, from
    // `getRegisteredPostLogoutRedirectUri()`. Anywhere else means a URL the MP
    // OAuth client has never heard of.
    const offenders = sourceFiles
      .filter((f) => code(f).includes('post_logout_redirect_uri'))
      .map((f) => relative(repoRoot, f))
      .sort();
    expect(offenders).toEqual([join('src', 'lib', 'embed', 'mp-oauth.ts')]);
  });

  it('the demo header renders the SignOutButton', () => {
    const page = readFileSync(resolve(srcDir, 'app/(demo)/demo/page.tsx'), 'utf-8');
    expect(page).toContain('<SignOutButton />');
  });
});

describe('requestAppLogout', () => {
  let calls: { url: string; method: string; body: unknown }[];
  let response: () => Response | Promise<Response>;

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  beforeEach(() => {
    calls = [];
    response = () => json({ redirectUrl: 'https://mp.example.com/oauth/connect/endsession' });
    localStorage.clear();
    sessionStorage.clear();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return response();
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the app logout endpoint and returns MP end-session URL', async () => {
    const url = await requestAppLogout();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/auth/logout');
    expect(calls[0].method).toBe('POST');
    expect(url).toBe('https://mp.example.com/oauth/connect/endsession');
  });

  it('sends no destination at all -- MP only accepts a registered one', async () => {
    // TODO 29: the widget path used to forward `window.location.href` here.
    // MP is not willing to complete a logout it cannot redirect out of, so an
    // unregistered URI left the SSO session alive behind a confirmation
    // prompt. The server picks the destination now.
    await requestAppLogout();

    expect(calls[0].body).toBeUndefined();
    expect(requestAppLogout.length).toBe(0);
  });

  it('clears the browser-held MP tokens before it calls out', async () => {
    MP_WIDGET_STORAGE_KEYS.forEach((key) => localStorage.setItem(key, 'stale'));
    sessionStorage.setItem('userObj', '{}');

    await requestAppLogout();

    for (const key of MP_WIDGET_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(sessionStorage.getItem('userObj')).toBeNull();
  });

  it('returns null when the endpoint fails, so the caller can fall back', async () => {
    response = () => {
      throw new Error('network down');
    };

    await expect(requestAppLogout()).resolves.toBeNull();
  });

  it('returns null when the endpoint answers without a redirectUrl', async () => {
    response = () => json({});

    await expect(requestAppLogout()).resolves.toBeNull();
  });

  it('clears storage even when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => clearMpWidgetStorage()).not.toThrow();

    spy.mockRestore();
  });
});
