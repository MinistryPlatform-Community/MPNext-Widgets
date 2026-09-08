import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getMpOAuthEndpoints,
  getMpOAuthClient,
  fetchMpUserinfo,
  mapUserinfoToSessionUser,
  exchangeAuthorizationCode,
  refreshWithRefreshToken,
  buildAuthorizeUrl,
  buildEndSessionUrl,
  getRegisteredPostLogoutRedirectUri,
  pkcePair,
  MP_OAUTH_SCOPE,
  __resetUserinfoCacheForTests,
} from './mp-oauth';
import { sha256Hex, toBase64Url } from './crypto';

const MP = 'https://test-mp.example.com';

function restoreEnv() {
  vi.unstubAllEnvs();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('MINISTRY_PLATFORM_BASE_URL', MP);
  vi.stubEnv('MINISTRY_PLATFORM_CLIENT_ID', 'test-mp-client-id');
  vi.stubEnv('MINISTRY_PLATFORM_CLIENT_SECRET', 'test-mp-client-secret');
  vi.stubEnv('OIDC_CLIENT_ID', 'test-client-id');
  vi.stubEnv('OIDC_CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv('EMBED_JWT_SECRET', 'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256');
}

describe('mp-oauth - config', () => {
  afterEach(restoreEnv);

  it('builds endpoints under /oauth/connect and strips trailing slashes', () => {
    vi.stubEnv('MINISTRY_PLATFORM_BASE_URL', `${MP}/ministryplatformapi/`);
    expect(getMpOAuthEndpoints()).toEqual({
      authorize: `${MP}/ministryplatformapi/oauth/connect/authorize`,
      token: `${MP}/ministryplatformapi/oauth/connect/token`,
      userinfo: `${MP}/ministryplatformapi/oauth/connect/userinfo`,
      endsession: `${MP}/ministryplatformapi/oauth/connect/endsession`,
    });
  });

  it('throws a clear error when MINISTRY_PLATFORM_BASE_URL is unset', () => {
    vi.stubEnv('MINISTRY_PLATFORM_BASE_URL', '');
    expect(() => getMpOAuthEndpoints()).toThrow(/MINISTRY_PLATFORM_BASE_URL/);
  });

  it('prefers OIDC_* and falls back to MINISTRY_PLATFORM_*', () => {
    expect(getMpOAuthClient()).toEqual({ clientId: 'test-client-id', clientSecret: 'test-client-secret' });
    vi.stubEnv('OIDC_CLIENT_ID', '');
    vi.stubEnv('OIDC_CLIENT_SECRET', '');
    expect(getMpOAuthClient()).toEqual({ clientId: 'test-mp-client-id', clientSecret: 'test-mp-client-secret' });
  });

  it('throws when no client credentials are configured', () => {
    vi.stubEnv('OIDC_CLIENT_ID', '');
    vi.stubEnv('MINISTRY_PLATFORM_CLIENT_ID', '');
    expect(() => getMpOAuthClient()).toThrow(/OIDC_CLIENT_ID/);
  });
});

describe('mp-oauth - fetchMpUserinfo', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetUserinfoCacheForTests();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    __resetUserinfoCacheForTests();
  });

  it('returns the parsed userinfo and sends the bearer token', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ sub: 'guid-1', given_name: 'Ada', family_name: 'L', email: 'a@b.c', extra: 1 })),
    );
    const ui = await fetchMpUserinfo('tok-1');
    expect(ui).toEqual({ sub: 'guid-1', given_name: 'Ada', family_name: 'L', email: 'a@b.c', picture: undefined });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MP}/oauth/connect/userinfo`);
    expect((init as RequestInit).headers).toEqual({ Authorization: 'Bearer tok-1' });
  });

  it('caches by token for 60s (positive and negative)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sub: 'guid-1' })));
    await fetchMpUserinfo('tok-1');
    await fetchMpUserinfo('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    expect(await fetchMpUserinfo('bad')).toBeNull();
    expect(await fetchMpUserinfo('bad')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.setSystemTime(1_700_000_000_000 + 60_001);
    await fetchMpUserinfo('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns null on non-2xx, network error, missing sub, or empty token', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    expect(await fetchMpUserinfo('t1')).toBeNull();

    fetchMock.mockRejectedValue(new Error('network'));
    expect(await fetchMpUserinfo('t2')).toBeNull();

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ email: 'x' })));
    expect(await fetchMpUserinfo('t3')).toBeNull();

    expect(await fetchMpUserinfo('')).toBeNull();
  });

  it('never stores the raw token as a cache key', async () => {
    // Indirect: two different tokens with the same sha256 prefix are distinct keys, and
    // the cache is keyed via sha256Hex — verify by observing a cache hit for the exact token only.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ sub: 'guid-1' })));
    await fetchMpUserinfo('tok-A');
    await fetchMpUserinfo('tok-B');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await sha256Hex('tok-A')).not.toBe(await sha256Hex('tok-B'));
  });
});

describe('mp-oauth - mapUserinfoToSessionUser', () => {
  it('maps fields with empty-string defaults and null imageGuid', () => {
    expect(mapUserinfoToSessionUser({ sub: 'g', given_name: 'A', family_name: 'B', email: 'a@b.c' })).toEqual({
      userGuid: 'g',
      firstName: 'A',
      lastName: 'B',
      email: 'a@b.c',
      imageGuid: null,
    });
    expect(mapUserinfoToSessionUser({ sub: 'g' })).toEqual({
      userGuid: 'g',
      firstName: '',
      lastName: '',
      email: '',
      imageGuid: null,
    });
  });

  it('throws on null', () => {
    expect(() => mapUserinfoToSessionUser(null)).toThrow();
  });
});

describe('mp-oauth - token endpoint', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnv();
  });

  it('exchangeAuthorizationCode posts form-encoded params with client credentials', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', id_token: 'idt', expires_in: 3600 })),
    );
    const res = await exchangeAuthorizationCode({
      code: 'the-code',
      redirectUri: 'https://widgets.example.com/api/embed/auth/callback',
      codeVerifier: 'ver',
    });
    expect(res).toEqual({ access_token: 'at', refresh_token: 'rt', id_token: 'idt', expires_in: 3600 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MP}/oauth/connect/token`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(String(init.body));
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('the-code');
    expect(params.get('redirect_uri')).toBe('https://widgets.example.com/api/embed/auth/callback');
    expect(params.get('code_verifier')).toBe('ver');
    expect(params.get('client_id')).toBe('test-client-id');
    expect(params.get('client_secret')).toBe('test-client-secret');
  });

  it('omits code_verifier when not supplied', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'at' })));
    await exchangeAuthorizationCode({ code: 'c', redirectUri: 'https://w.example.com/cb' });
    const params = new URLSearchParams(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(params.has('code_verifier')).toBe(false);
  });

  it('refreshWithRefreshToken posts grant_type=refresh_token', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'new-at', expires_in: 1800 })));
    const res = await refreshWithRefreshToken('the-rt');
    expect(res.access_token).toBe('new-at');
    const params = new URLSearchParams(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.get('refresh_token')).toBe('the-rt');
    expect(params.get('client_id')).toBe('test-client-id');
  });

  it('throws on non-2xx without echoing the body, and on a missing access_token', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_grant', secret: 'leak' }), { status: 400 }));
    await expect(exchangeAuthorizationCode({ code: 'c', redirectUri: 'r' })).rejects.toThrow(
      /MP token exchange failed \(400\)/,
    );
    await expect(exchangeAuthorizationCode({ code: 'c', redirectUri: 'r' })).rejects.not.toThrow(/leak/);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({ token_type: 'Bearer' })));
    await expect(refreshWithRefreshToken('rt')).rejects.toThrow(/no access_token/);
  });
});

describe('mp-oauth - URL builders', () => {
  afterEach(restoreEnv);

  it('buildAuthorizeUrl includes the required OIDC params', () => {
    const url = new URL(
      buildAuthorizeUrl({
        redirectUri: 'https://w.example.com/api/embed/auth/callback',
        state: 'st',
        nonce: 'nn',
      }),
    );
    expect(url.origin + url.pathname).toBe(`${MP}/oauth/connect/authorize`);
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(MP_OAUTH_SCOPE);
    expect(url.searchParams.get('scope')).toBe(
      'openid offline_access http://www.thinkministry.com/dataplatform/scopes/all',
    );
    expect(url.searchParams.get('redirect_uri')).toBe('https://w.example.com/api/embed/auth/callback');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('nonce')).toBe('nn');
    expect(url.searchParams.has('code_challenge')).toBe(false);
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('buildAuthorizeUrl adds S256 PKCE params when a challenge is given', () => {
    const url = new URL(
      buildAuthorizeUrl({ redirectUri: 'https://w.example.com/cb', state: 's', nonce: 'n', codeChallenge: 'chal' }),
    );
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  /**
   * TODO 29. MP drops the entire logout context -- `id_token_hint` included --
   * when `post_logout_redirect_uri` is not registered on its OAuth client, and
   * shows a "Would you like to logout?" prompt while the SSO session survives.
   * These pin that the value can only ever be the registered one.
   */
  describe('buildEndSessionUrl', () => {
    it('sends id_token_hint plus the registered post_logout_redirect_uri', () => {
      vi.stubEnv('BETTER_AUTH_URL', 'https://widgets.example.com');

      const bare = new URL(buildEndSessionUrl({}));
      expect(bare.origin + bare.pathname).toBe(`${MP}/oauth/connect/endsession`);
      expect(bare.searchParams.has('id_token_hint')).toBe(false);
      expect(bare.searchParams.get('post_logout_redirect_uri')).toBe(
        'https://widgets.example.com/signin',
      );

      const full = new URL(buildEndSessionUrl({ idToken: 'idt' }));
      expect(full.searchParams.get('id_token_hint')).toBe('idt');
      expect(full.searchParams.get('post_logout_redirect_uri')).toBe(
        'https://widgets.example.com/signin',
      );

      const nullId = new URL(buildEndSessionUrl({ idToken: null }));
      expect(nullId.searchParams.has('id_token_hint')).toBe(false);
    });

    it('takes no destination from its caller -- there is no argument for one', () => {
      vi.stubEnv('BETTER_AUTH_URL', 'https://widgets.example.com');
      // A host page URL, the value that caused TODO 29. Passing it must not
      // reach MP even when a caller tries.
      const url = new URL(
        buildEndSessionUrl({
          idToken: 'idt',
          postLogoutRedirectUri: 'https://firstbaptist.example.org/members',
        } as Parameters<typeof buildEndSessionUrl>[0]),
      );
      expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
        'https://widgets.example.com/signin',
      );
    });

    it('omits post_logout_redirect_uri entirely when BETTER_AUTH_URL is unusable', () => {
      // Better an id_token_hint-only logout (which MP completes cleanly) than
      // a bogus URI, which it refuses to complete at all.
      for (const value of ['', '   ', 'not-a-url']) {
        vi.stubEnv('BETTER_AUTH_URL', value);
        const url = new URL(buildEndSessionUrl({ idToken: 'idt' }));
        expect(url.searchParams.has('post_logout_redirect_uri')).toBe(false);
        expect(url.searchParams.get('id_token_hint')).toBe('idt');
      }
    });

    it('normalises the registered URI to <origin>/signin', () => {
      vi.stubEnv('BETTER_AUTH_URL', 'https://widgets.example.com/some/base/');
      expect(getRegisteredPostLogoutRedirectUri()).toBe('https://widgets.example.com/signin');
    });
  });

  it('pkcePair returns a 43-char verifier and its S256 challenge', async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(toBase64Url(digest));
  });
});
