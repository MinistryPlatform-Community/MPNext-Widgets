/**
 * The app's logout endpoint (TODO 27) and the destination it hands MP (TODO 29).
 *
 * `/demo`'s header Sign Out and the widget path via `TokenBridge` both land
 * here. The widget used to pass its own page URL through as
 * `post_logout_redirect_uri`; MP is not willing to complete a logout it cannot
 * redirect out of, so it dropped the whole context and left the SSO session
 * alive behind a confirmation prompt. The route now takes no destination at
 * all — these tests pin that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signOut = vi.hoisted(() => vi.fn(async () => undefined));
const getCachedSession = vi.hoisted(() =>
  vi.fn(async () => ({ session: { idToken: 'the-id-token' } })),
);

vi.mock('@/lib/auth', () => ({ auth: { api: { signOut } } }));
vi.mock('@/lib/auth-session', () => ({ getCachedSession }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { POST } = await import('./route');

const ENDSESSION = 'https://test-mp.example.com/oauth/connect/endsession';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('MINISTRY_PLATFORM_BASE_URL', 'https://test-mp.example.com');
  vi.stubEnv('BETTER_AUTH_URL', 'https://widgets.example.com');
  signOut.mockClear();
  getCachedSession.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/auth/logout', () => {
  it('signs out and returns MP end-session with the registered redirect', async () => {
    const res = await POST();
    expect(signOut).toHaveBeenCalledTimes(1);

    const url = new URL((await res.json()).redirectUrl);
    expect(url.origin + url.pathname).toBe(ENDSESSION);
    expect(url.searchParams.get('id_token_hint')).toBe('the-id-token');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://widgets.example.com/signin',
    );
  });

  it('accepts no destination from the caller: POST takes no arguments', () => {
    // A route handler that reads `req.json()` is a route that can be told
    // where to send MP. This one cannot be.
    expect(POST.length).toBe(0);
  });

  it('still returns an end-session URL when the session carries no id_token', async () => {
    getCachedSession.mockResolvedValueOnce({ session: {} } as never);
    const url = new URL((await (await POST()).json()).redirectUrl);
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://widgets.example.com/signin',
    );
  });
});
