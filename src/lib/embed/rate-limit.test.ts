import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, getDefaultRateLimit } from './rate-limit';
import { __resetSessionStoreForTests, getSessionStore, MemorySessionStore } from './session-store';

describe('rate-limit', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000); // aligned-ish; we compute windows relative to this
  });

  afterEach(() => {
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

  it('writes counters under the nw:rl prefix with the window start', async () => {
    const nowMs = Date.now();
    const alignedMs = nowMs - (nowMs % 60_000);
    vi.setSystemTime(alignedMs);
    const store = getSessionStore() as MemorySessionStore;
    const spy = vi.spyOn(store, 'incr');
    await checkRateLimit('ip:1.2.3.4', 10);
    expect(spy).toHaveBeenCalledWith(`ip:1.2.3.4:${alignedMs / 1000}`, 65);
  });
});
