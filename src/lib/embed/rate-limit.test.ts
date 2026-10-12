import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __resetRateLimitLogForTests, checkRateLimit, getDefaultRateLimit } from './rate-limit';
import { __resetSessionStoreForTests, getSessionStore, MemorySessionStore } from './session-store';

describe('rate-limit', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    __resetRateLimitLogForTests();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000); // aligned-ish; we compute windows relative to this
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EMBED_JWT_SECRET', 'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('EMBED_SESSION_STORE_URL', '');
    vi.stubEnv('EMBED_SESSION_STORE_TOKEN', '');
    __resetSessionStoreForTests();
  });

  it('allows requests up to the limit and rejects beyond it', async () => {
    for (let i = 1; i <= 3; i++) {
      const r = await checkRateLimit('ip:1.2.3.4', 3);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(3 - i);
    }
    const blocked = await checkRateLimit('ip:1.2.3.4', 3);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('keys are independent', async () => {
    await checkRateLimit('ip:a', 1);
    expect((await checkRateLimit('ip:a', 1)).ok).toBe(false);
    expect((await checkRateLimit('ip:b', 1)).ok).toBe(true);
  });

  it('resets on the next minute window', async () => {
    // Move to the start of a minute so the whole test stays in one window until we jump
    const nowMs = Date.now();
    const alignedMs = nowMs - (nowMs % 60_000);
    vi.setSystemTime(alignedMs);

    await checkRateLimit('ip:w', 1);
    expect((await checkRateLimit('ip:w', 1)).ok).toBe(false);

    vi.setSystemTime(alignedMs + 59_000);
    expect((await checkRateLimit('ip:w', 1)).ok).toBe(false);

    vi.setSystemTime(alignedMs + 60_000);
    expect((await checkRateLimit('ip:w', 1)).ok).toBe(true);
  });

  it('uses EMBED_SESSION_RATE_LIMIT as the default limit (fallback 120)', async () => {
    expect(getDefaultRateLimit()).toBe(120);
    vi.stubEnv('EMBED_SESSION_RATE_LIMIT', '2');
    expect(getDefaultRateLimit()).toBe(2);
    await checkRateLimit('ip:d');
    await checkRateLimit('ip:d');
    expect((await checkRateLimit('ip:d')).ok).toBe(false);

    vi.stubEnv('EMBED_SESSION_RATE_LIMIT', 'not-a-number');
    expect(getDefaultRateLimit()).toBe(120);
    vi.stubEnv('EMBED_SESSION_RATE_LIMIT', '0');
    expect(getDefaultRateLimit()).toBe(120);
  });

  it('fails open when the store throws', async () => {
    const store = getSessionStore() as MemorySessionStore;
    vi.spyOn(store, 'incr').mockRejectedValue(new Error('redis down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await checkRateLimit('ip:x', 5);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(5);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('allowing request'), 'redis down');
    err.mockRestore();
  });

  it('writes counters under the nw:rl prefix with the window length and start', async () => {
    const nowMs = Date.now();
    const alignedMs = nowMs - (nowMs % 60_000);
    vi.setSystemTime(alignedMs);
    const store = getSessionStore() as MemorySessionStore;
    const spy = vi.spyOn(store, 'incr');
    await checkRateLimit('ip:1.2.3.4', 10);
    expect(spy).toHaveBeenCalledWith(`ip:1.2.3.4:60:${alignedMs / 1000}`, 65);
  });

  describe('custom windows', () => {
    it('expresses a per-hour limit, which the 60s window cannot', async () => {
      // What an endpoint that emails a submitted address needs: a per-minute
      // cap alone lets one mailbox be bombed steadily all day.
      for (let i = 0; i < 3; i++) {
        expect((await checkRateLimit('email:abc', 3, { windowSeconds: 3600 })).ok).toBe(true);
      }
      expect((await checkRateLimit('email:abc', 3, { windowSeconds: 3600 })).ok).toBe(false);

      // Still blocked half an hour later — the window has not rolled.
      vi.setSystemTime(Date.now() + 1_800_000);
      expect((await checkRateLimit('email:abc', 3, { windowSeconds: 3600 })).ok).toBe(false);
    });

    it('rolls when the longer window elapses', async () => {
      await checkRateLimit('email:abc', 1, { windowSeconds: 3600 });
      expect((await checkRateLimit('email:abc', 1, { windowSeconds: 3600 })).ok).toBe(false);

      vi.setSystemTime(Date.now() + 3_600_000);
      expect((await checkRateLimit('email:abc', 1, { windowSeconds: 3600 })).ok).toBe(true);
    });

    it('keeps windows of different lengths on separate counters', async () => {
      // The window length is in the key precisely so a per-minute and a
      // per-hour limit on the same subject cannot share one counter.
      await checkRateLimit('same:key', 1, { windowSeconds: 60 });
      expect((await checkRateLimit('same:key', 1, { windowSeconds: 60 })).ok).toBe(false);
      expect((await checkRateLimit('same:key', 1, { windowSeconds: 3600 })).ok).toBe(true);
    });

    it('puts the window length in the counter key', async () => {
      const nowMs = Date.now();
      const alignedMs = nowMs - (nowMs % 3_600_000);
      vi.setSystemTime(alignedMs);
      const store = getSessionStore() as MemorySessionStore;
      const spy = vi.spyOn(store, 'incr');

      await checkRateLimit('email:abc', 3, { windowSeconds: 3600 });
      expect(spy).toHaveBeenCalledWith(`email:abc:3600:${alignedMs / 1000}`, 3605);
    });
  });

  describe('failClosed', () => {
    it('denies the request when the store is down', async () => {
      // The default fail-open is right for a read. It is wrong for an
      // unauthenticated send: it turns a store outage into an open relay.
      const store = getSessionStore() as MemorySessionStore;
      vi.spyOn(store, 'incr').mockRejectedValueOnce(new Error('redis down'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});

      const r = await checkRateLimit('ip:1.2.3.4', 10, { failClosed: true });

      expect(r).toEqual({ ok: false, remaining: 0 });
      expect(err).toHaveBeenCalledWith(expect.stringContaining('denying request'), 'redis down');
      err.mockRestore();
    });

    it('still fails open by default', async () => {
      const store = getSessionStore() as MemorySessionStore;
      vi.spyOn(store, 'incr').mockRejectedValueOnce(new Error('redis down'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect((await checkRateLimit('ip:1.2.3.4', 10)).ok).toBe(true);
      err.mockRestore();
    });
  });

  describe('outage logging is throttled', () => {
    // A store outage fails every rate-limited request the same way. One line
    // per request floods the log and buries the first one, which is the one
    // that matters.
    function storeDown() {
      const store = getSessionStore() as MemorySessionStore;
      return vi.spyOn(store, 'incr').mockRejectedValue(new Error('redis down'));
    }

    it('logs one line for many failures in one interval, with results unchanged', async () => {
      storeDown();
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});

      const open = [];
      const closed = [];
      for (let i = 0; i < 50; i++) {
        open.push(await checkRateLimit(`ip:${i}`, 10));
        closed.push(await checkRateLimit(`ip:${i}`, 10, { failClosed: true }));
        vi.advanceTimersByTime(500);
      }

      expect(open.every((r) => r.ok && r.remaining === 10)).toBe(true);
      expect(closed.every((r) => !r.ok && r.remaining === 0)).toBe(true);
      expect(err).toHaveBeenCalledTimes(1);
      expect(err).toHaveBeenCalledWith(expect.stringContaining('allowing request'), 'redis down');
      err.mockRestore();
    });

    it('logs a summary with suppressed counts once the interval elapses', async () => {
      storeDown();
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});

      await checkRateLimit('ip:a', 10); // logged
      await checkRateLimit('ip:a', 10); // suppressed (allowed)
      await checkRateLimit('ip:a', 10, { failClosed: true }); // suppressed (denied)
      vi.advanceTimersByTime(60_000);
      await checkRateLimit('ip:a', 10); // summary

      expect(err).toHaveBeenCalledTimes(2);
      expect(err).toHaveBeenLastCalledWith(
        expect.stringMatching(/still unavailable after 60s; 1 allowed and 1 denied/),
        'redis down',
      );

      vi.advanceTimersByTime(30_000);
      await checkRateLimit('ip:a', 10); // inside the new interval: suppressed
      expect(err).toHaveBeenCalledTimes(2);
      err.mockRestore();
    });

    it('logs recovery once, then a later outage is logged in full again', async () => {
      const incr = storeDown();
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await checkRateLimit('ip:r', 10);
      await checkRateLimit('ip:r', 10);
      vi.advanceTimersByTime(12_000);
      incr.mockRestore();

      expect((await checkRateLimit('ip:r', 10)).ok).toBe(true);
      expect((await checkRateLimit('ip:r', 10)).ok).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/recovered after 12s; 1 allowed and 0 denied/),
      );

      storeDown();
      await checkRateLimit('ip:r', 10);
      expect(err).toHaveBeenCalledTimes(2);
      expect(err).toHaveBeenLastCalledWith(expect.stringContaining('allowing request'), 'redis down');
      err.mockRestore();
      warn.mockRestore();
    });

    it('logs nothing on a healthy store', async () => {
      // Create the store first: the in-memory fallback announces itself once
      // with its own console.warn, which is not this module's line.
      getSessionStore();
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (let i = 0; i < 5; i++) await checkRateLimit('ip:h', 10);
      expect(err).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      err.mockRestore();
      warn.mockRestore();
    });
  });
});
