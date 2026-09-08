import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createEmbedSession,
  getEmbedSession,
  deleteEmbedSession,
  getMpUserAccessToken,
  refreshMpTokens,
  createHandoffCode,
  redeemHandoffCode,
  getSessionTtls,
} from './embed-session';
import { __resetSessionStoreForTests, getSessionStore, MemorySessionStore } from './session-store';
import { open, sha256Hex } from './crypto';
import type { EmbedSessionUser, WidgetClaims } from './types';

const ORIGIN = 'https://church.example.com';
const user: EmbedSessionUser = {
  userGuid: 'guid-123',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  imageGuid: null,
};

function tokenResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function store(): MemorySessionStore {
  return getSessionStore() as MemorySessionStore;
}

describe('embed-session', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('MINISTRY_PLATFORM_BASE_URL', 'https://test-mp.example.com');
    vi.stubEnv('OIDC_CLIENT_ID', 'test-client-id');
    vi.stubEnv('OIDC_CLIENT_SECRET', 'test-client-secret');
    vi.stubEnv('EMBED_JWT_SECRET', 'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('EMBED_SESSION_STORE_URL', '');
    vi.stubEnv('EMBED_SESSION_STORE_TOKEN', '');
    vi.stubEnv('EMBED_SESSION_ENC_KEY', '');
    __resetSessionStoreForTests();
  });

  describe('createEmbedSession', () => {
    it('returns a raw sid, stores only its hash, and seals every MP token', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      const now = 1_700_000_000;

      const { sid, record } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'mp-access',
        mpRefreshToken: 'mp-refresh',
        mpIdToken: 'mp-id',
        mpExpiresIn: 1800,
      });

      expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(record.sidHash).toBe(await sha256Hex(sid));
      expect(record.origin).toBe(ORIGIN);
      expect(record.user).toEqual(user);
      expect(record.createdAt).toBe(now);
      expect(record.lastSeenAt).toBe(now);
      expect(record.mpExpiresAt).toBe(now + 1800);
      expect(record.absoluteExpiresAt).toBe(now + getSessionTtls().absolute);

      // Sealed, not plaintext
      expect(record.mpAccessTokenEnc).not.toContain('mp-access');
      expect(record.mpAccessTokenEnc.startsWith('v1.')).toBe(true);
      expect(await open(record.mpAccessTokenEnc)).toBe('mp-access');
      expect(await open(record.mpRefreshTokenEnc as string)).toBe('mp-refresh');
      expect(await open(record.mpIdTokenEnc as string)).toBe('mp-id');

      // Persisted under the hash; raw sid never appears in the store
      const stored = await store().get(record.sidHash);
      expect(stored).toEqual(record);
      expect(JSON.stringify(stored)).not.toContain(sid);
    });

    it('defaults mpExpiresIn to 3600 and null-fills missing tokens', async () => {
      const { record } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      expect(record.mpExpiresAt - record.createdAt).toBe(3600);
      expect(record.mpRefreshTokenEnc).toBeNull();
      expect(record.mpIdTokenEnc).toBeNull();
    });

    it('honors EMBED_SESSION_ABSOLUTE_TTL and EMBED_SESSION_IDLE_TTL', async () => {
      vi.stubEnv('EMBED_SESSION_ABSOLUTE_TTL', '1000');
      vi.stubEnv('EMBED_SESSION_IDLE_TTL', '100');
      expect(getSessionTtls()).toEqual({ idle: 100, absolute: 1000 });
      const { record } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      expect(record.absoluteExpiresAt - record.createdAt).toBe(1000);
    });

    it('rejects missing required input', async () => {
      await expect(createEmbedSession({ origin: '', user, mpAccessToken: 'at' })).rejects.toThrow(/origin/);
      await expect(createEmbedSession({ origin: ORIGIN, user, mpAccessToken: '' })).rejects.toThrow(/mpAccessToken/);
      await expect(
        createEmbedSession({ origin: ORIGIN, user: { ...user, userGuid: '' }, mpAccessToken: 'at' }),
      ).rejects.toThrow(/userGuid/);
    });

    it('generates distinct sids per session', async () => {
      const a = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      const b = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      expect(a.sid).not.toBe(b.sid);
    });
  });

  describe('getEmbedSession', () => {
    it('returns the record for a valid sid + origin', async () => {
      const { sid, record } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      expect(await getEmbedSession(sid, ORIGIN)).toEqual(record);
    });

    it('returns null for unknown / empty sids', async () => {
      expect(await getEmbedSession('nope', ORIGIN)).toBeNull();
      expect(await getEmbedSession('', ORIGIN)).toBeNull();
    });

    it('returns null on origin mismatch without deleting the session', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { sid, record } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      expect(await getEmbedSession(sid, 'https://attacker.example.net')).toBeNull();
      expect(await store().get(record.sidHash)).not.toBeNull();
      expect(warn).toHaveBeenCalledWith('embed session origin mismatch', expect.any(Object));
      // Never logs the sid
      expect(JSON.stringify(warn.mock.calls)).not.toContain(sid);
      warn.mockRestore();
    });

    it('enforces absolute expiry on read and deletes the record', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      vi.stubEnv('EMBED_SESSION_ABSOLUTE_TTL', '100');
      vi.stubEnv('EMBED_SESSION_IDLE_TTL', '100000'); // idle > absolute so the store TTL alone would not evict
      const { sid, record } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });

      // Force the store entry to outlive the absolute expiry to prove the read-side check
      await store().set(record, 10_000);
      vi.setSystemTime(1_700_000_000_000 + 101_000);

      expect(await getEmbedSession(sid, ORIGIN)).toBeNull();
      expect(await store().get(record.sidHash)).toBeNull();
    });

    it('bumps lastSeenAt at most once per 60s (sliding TTL)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      const { sid, record } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      const setSpy = vi.spyOn(store(), 'set');

      vi.setSystemTime(1_700_000_000_000 + 30_000);
      expect((await getEmbedSession(sid, ORIGIN))?.lastSeenAt).toBe(record.lastSeenAt);
      expect(setSpy).not.toHaveBeenCalled();

      vi.setSystemTime(1_700_000_000_000 + 60_000);
      const bumped = await getEmbedSession(sid, ORIGIN);
      expect(bumped?.lastSeenAt).toBe(record.lastSeenAt + 60);
      expect(setSpy).toHaveBeenCalledTimes(1);
      // TTL passed to the store is capped by idle ttl and the remaining absolute window
      const ttlArg = setSpy.mock.calls[0][1];
      expect(ttlArg).toBe(Math.min(getSessionTtls().idle, record.absoluteExpiresAt - (record.lastSeenAt + 60)));

      vi.setSystemTime(1_700_000_000_000 + 90_000);
      await getEmbedSession(sid, ORIGIN);
      expect(setSpy).toHaveBeenCalledTimes(1);
    });

    it('sliding expiry: an idle session disappears from the store after EMBED_SESSION_IDLE_TTL', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      vi.stubEnv('EMBED_SESSION_IDLE_TTL', '120');
      const { sid } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });

      vi.setSystemTime(1_700_000_000_000 + 100_000);
      expect(await getEmbedSession(sid, ORIGIN)).not.toBeNull(); // touched at +100s

      vi.setSystemTime(1_700_000_000_000 + 210_000); // +110s after touch: still inside 120s window
      expect(await getEmbedSession(sid, ORIGIN)).not.toBeNull();

      vi.setSystemTime(1_700_000_000_000 + 210_000 + 121_000);
      expect(await getEmbedSession(sid, ORIGIN)).toBeNull();
    });
  });

  describe('deleteEmbedSession', () => {
    it('removes the session and returns the decrypted id token', async () => {
      const { sid, record } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'at',
        mpIdToken: 'the-id-token',
      });
      expect(await deleteEmbedSession(sid)).toEqual({ idToken: 'the-id-token' });
      expect(await store().get(record.sidHash)).toBeNull();
      expect(await getEmbedSession(sid, ORIGIN)).toBeNull();
    });

    it('is idempotent and returns null id token when absent', async () => {
      const { sid } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      expect(await deleteEmbedSession(sid)).toEqual({ idToken: null });
      expect(await deleteEmbedSession(sid)).toEqual({ idToken: null });
      expect(await deleteEmbedSession('unknown')).toEqual({ idToken: null });
      expect(await deleteEmbedSession('')).toEqual({ idToken: null });
    });
  });

  describe('getMpUserAccessToken', () => {
    const baseClaims: WidgetClaims = { sub: 'guid-123', wid: 'my-invoices', origin: ORIGIN };

    it('v1: returns claims.mpAccessToken, or null when empty/missing', async () => {
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 1, mpAccessToken: 'legacy-token' })).toBe('legacy-token');
      expect(await getMpUserAccessToken({ ...baseClaims, mpAccessToken: 'no-ver-token' })).toBe('no-ver-token');
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 1, mpAccessToken: '' })).toBeNull();
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2 })).toBeNull();
    });

    it('v2: returns the decrypted access token for a live session without calling MP', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { sid } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'live-token', mpExpiresIn: 3600 });
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid })).toBe('live-token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('v2: returns null for an unknown sid or an origin mismatch', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { sid } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'live-token' });
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid: 'unknown' })).toBeNull();
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid, origin: 'https://other.example.com' })).toBeNull();
    });

    it('v2: refreshes within 60s of expiry when a refresh token exists and re-seals the new tokens', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      const fetchMock = vi.fn().mockResolvedValue(
        tokenResponse({ access_token: 'new-at', refresh_token: 'new-rt', id_token: 'new-idt', expires_in: 1800 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const { sid, record } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'old-at',
        mpRefreshToken: 'old-rt',
        mpIdToken: 'old-idt',
        mpExpiresIn: 30, // inside the 60s refresh skew
      });

      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid })).toBe('new-at');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://test-mp.example.com/oauth/connect/token');
      const params = new URLSearchParams(String(init.body));
      expect(params.get('grant_type')).toBe('refresh_token');
      expect(params.get('refresh_token')).toBe('old-rt');
      expect(params.get('client_id')).toBe('test-client-id');
      expect(params.get('client_secret')).toBe('test-client-secret');

      const updated = await store().get(record.sidHash);
      expect(updated).not.toBeNull();
      expect(updated!.mpExpiresAt).toBe(1_700_000_000 + 1800);
      expect(await open(updated!.mpAccessTokenEnc)).toBe('new-at');
      expect(await open(updated!.mpRefreshTokenEnc as string)).toBe('new-rt');
      expect(await open(updated!.mpIdTokenEnc as string)).toBe('new-idt');
      expect(updated!.absoluteExpiresAt).toBe(record.absoluteExpiresAt); // absolute cap never moves

      // Lock released afterwards
      expect(await store().acquireLock(`refresh:${record.sidHash}`, 1)).toBe(true);
    });

    it('v2: keeps the old refresh/id token when MP does not return new ones', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({ access_token: 'new-at' })));
      const { sid, record } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'old-at',
        mpRefreshToken: 'old-rt',
        mpIdToken: 'old-idt',
        mpExpiresIn: 10,
      });
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid })).toBe('new-at');
      const updated = await store().get(record.sidHash);
      expect(await open(updated!.mpRefreshTokenEnc as string)).toBe('old-rt');
      expect(await open(updated!.mpIdTokenEnc as string)).toBe('old-idt');
      expect(updated!.mpExpiresAt - Math.floor(Date.now() / 1000)).toBeGreaterThanOrEqual(3590); // default 3600
    });

    it('v2: falls back to the still-valid old token when the refresh call fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400)));
      const { sid, record } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'old-at',
        mpRefreshToken: 'old-rt',
        mpExpiresIn: 30,
      });
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid })).toBe('old-at');
      expect(warn).toHaveBeenCalledWith('MP token refresh failed', expect.stringMatching(/400/));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('old-rt');
      // Lock released even on failure
      expect(await store().acquireLock(`refresh:${record.sidHash}`, 1)).toBe(true);
      warn.mockRestore();
    });

    it('v2: returns null when expired and the refresh fails', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse({ error: 'invalid_grant' }, 400)));
      const { sid } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'old-at',
        mpRefreshToken: 'old-rt',
        mpExpiresIn: 30,
      });
      vi.setSystemTime(1_700_000_000_000 + 31_000);
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid })).toBeNull();
    });

    it('v2: no refresh token — returns the token while still valid, then null once expired, never calling MP', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { sid } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at', mpExpiresIn: 30 });

      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid })).toBe('at');
      vi.setSystemTime(1_700_000_000_000 + 31_000);
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid })).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('v2: when another caller holds the refresh lock, waits for their refresh and uses it', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { sid, record } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'old-at',
        mpRefreshToken: 'old-rt',
        mpExpiresIn: 30,
      });

      // Simulate a concurrent refresher: it holds the lock and lands a newer record shortly.
      expect(await store().acquireLock(`refresh:${record.sidHash}`, 10)).toBe(true);
      const otherRefresh = (async () => {
        await new Promise((r) => setTimeout(r, 350));
        const fresh = await refreshMpTokensViaMockedMp(record);
        await store().set(fresh, 1000);
      })();

      const token = await getMpUserAccessToken({ ...baseClaims, ver: 2, sid });
      await otherRefresh;
      expect(token).toBe('other-new-at');
      expect(fetchMock).not.toHaveBeenCalled(); // we never refreshed ourselves
    });

    it('v2: when the lock is held and no refresh lands within 2s, returns whatever is there', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { sid, record } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'old-at',
        mpRefreshToken: 'old-rt',
        mpExpiresIn: 30,
      });
      expect(await store().acquireLock(`refresh:${record.sidHash}`, 10)).toBe(true);

      const started = Date.now();
      const token = await getMpUserAccessToken({ ...baseClaims, ver: 2, sid });
      const elapsed = Date.now() - started;
      expect(token).toBe('old-at');
      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(elapsed).toBeLessThan(4000);
      expect(fetchMock).not.toHaveBeenCalled();
    }, 10_000);

    it('v2: the lock holder re-reads and skips its own refresh if someone already refreshed', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { sid, record } = await createEmbedSession({
        origin: ORIGIN,
        user,
        mpAccessToken: 'old-at',
        mpRefreshToken: 'old-rt',
        mpExpiresIn: 30,
      });
      // Make acquireLock succeed but have the store already contain a newer record by then.
      const s = store();
      const realAcquire = s.acquireLock.bind(s);
      vi.spyOn(s, 'acquireLock').mockImplementation(async (key, ttl) => {
        const fresh = await refreshMpTokensViaMockedMp(record);
        await s.set(fresh, 1000);
        return realAcquire(key, ttl);
      });
      expect(await getMpUserAccessToken({ ...baseClaims, ver: 2, sid })).toBe('other-new-at');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('refreshMpTokens', () => {
    it('throws when the record has no refresh token', async () => {
      const { record } = await createEmbedSession({ origin: ORIGIN, user, mpAccessToken: 'at' });
      await expect(refreshMpTokens(record)).rejects.toThrow(/no refresh token/);
    });
  });

  describe('handoff codes', () => {
    it('creates a single-use, origin-bound code', async () => {
      const code = await createHandoffCode('the-sid', ORIGIN, 'user-menu');
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

      expect(await redeemHandoffCode(code, ORIGIN)).toEqual({ sid: 'the-sid', wid: 'user-menu' });
      expect(await redeemHandoffCode(code, ORIGIN)).toBeNull(); // single use
    });

    it('rejects a code redeemed from a different origin and burns it', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const code = await createHandoffCode('the-sid', ORIGIN, 'user-menu');
      expect(await redeemHandoffCode(code, 'https://attacker.example.net')).toBeNull();
      // Atomic take: the code is consumed even on mismatch, so it cannot be retried
      expect(await redeemHandoffCode(code, ORIGIN)).toBeNull();
      warn.mockRestore();
    });

    it('stores only the code hash', async () => {
      const setHandoff = vi.spyOn(store(), 'setHandoff');
      const code = await createHandoffCode('the-sid', ORIGIN, 'user-menu');
      expect(setHandoff).toHaveBeenCalledTimes(1);
      const [codeHash, value, ttl] = setHandoff.mock.calls[0];
      expect(codeHash).toBe(await sha256Hex(code));
      expect(codeHash).not.toBe(code);
      expect(value).toEqual({ sid: 'the-sid', origin: ORIGIN, wid: 'user-menu' });
      expect(ttl).toBe(60);
    });

    it('expires after 60s', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      const code = await createHandoffCode('the-sid', ORIGIN, 'user-menu');
      vi.setSystemTime(1_700_000_000_000 + 60_001);
      expect(await redeemHandoffCode(code, ORIGIN)).toBeNull();
    });

    it('returns null for unknown or empty codes', async () => {
      expect(await redeemHandoffCode('nope', ORIGIN)).toBeNull();
      expect(await redeemHandoffCode('', ORIGIN)).toBeNull();
    });
  });
});

/**
 * Build a "refreshed by someone else" record without going through fetch, so
 * tests can assert we did not call MP ourselves.
 */
async function refreshMpTokensViaMockedMp(record: Awaited<ReturnType<typeof createEmbedSession>>['record']) {
  const { seal } = await import('./crypto');
  const now = Math.floor(Date.now() / 1000);
  return {
    ...record,
    mpAccessTokenEnc: await seal('other-new-at'),
    mpExpiresAt: now + 3600,
    lastSeenAt: now,
  };
}
