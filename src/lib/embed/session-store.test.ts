import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MemorySessionStore,
  UpstashSessionStore,
  getSessionStore,
  __resetSessionStoreForTests,
} from './session-store';
import type { Entry } from './session-store';
import type { EmbedSessionRecord } from './types';

function makeRecord(overrides: Partial<EmbedSessionRecord> = {}): EmbedSessionRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    sidHash: 'hash-1',
    origin: 'https://example.com',
    user: { userGuid: 'g1', firstName: 'A', lastName: 'B', email: 'a@b.c', imageGuid: null },
    mpAccessTokenEnc: 'v1.iv.ct',
    mpRefreshTokenEnc: null,
    mpIdTokenEnc: null,
    mpExpiresAt: now + 3600,
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + 86400,
    ...overrides,
  };
}

describe('MemorySessionStore', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('sessions', () => {
    it('set/get/delete a record', async () => {
      const rec = makeRecord();
      await store.set(rec, 60);
      expect(await store.get('hash-1')).toEqual(rec);
      await store.delete('hash-1');
      expect(await store.get('hash-1')).toBeNull();
    });

    it('returns null for unknown keys', async () => {
      expect(await store.get('nope')).toBeNull();
    });

    it('expires records after the ttl', async () => {
      await store.set(makeRecord(), 10);
      vi.advanceTimersByTime(9_999);
      expect(await store.get('hash-1')).not.toBeNull();
      vi.advanceTimersByTime(2);
      expect(await store.get('hash-1')).toBeNull();
    });

    it('overwriting a record resets its ttl', async () => {
      await store.set(makeRecord(), 10);
      vi.advanceTimersByTime(8_000);
      await store.set(makeRecord({ lastSeenAt: 1 }), 10);
      vi.advanceTimersByTime(8_000);
      expect((await store.get('hash-1'))?.lastSeenAt).toBe(1);
    });

    it('stores a deep copy (JSON) so later mutation of the input does not leak', async () => {
      const rec = makeRecord();
      await store.set(rec, 60);
      rec.origin = 'https://mutated.example.com';
      expect((await store.get('hash-1'))?.origin).toBe('https://example.com');
    });

    it('delete is idempotent', async () => {
      await expect(store.delete('missing')).resolves.toBeUndefined();
    });
  });

  describe('handoff codes', () => {
    it('takeHandoff returns the value exactly once', async () => {
      await store.setHandoff('c1', { sid: 's', origin: 'https://o.com', wid: 'user-menu' }, 60);
      expect(await store.takeHandoff('c1')).toEqual({ sid: 's', origin: 'https://o.com', wid: 'user-menu' });
      expect(await store.takeHandoff('c1')).toBeNull();
    });

    it('returns null for unknown or expired codes', async () => {
      expect(await store.takeHandoff('unknown')).toBeNull();
      await store.setHandoff('c2', { sid: 's', origin: 'o', wid: 'w' }, 60);
      vi.advanceTimersByTime(60_001);
      expect(await store.takeHandoff('c2')).toBeNull();
    });

    it('handoff and session keys do not collide', async () => {
      await store.set(makeRecord({ sidHash: 'same' }), 60);
      await store.setHandoff('same', { sid: 's', origin: 'o', wid: 'w' }, 60);
      expect(await store.takeHandoff('same')).not.toBeNull();
      expect(await store.get('same')).not.toBeNull();
    });
  });

  describe('locks', () => {
    it('acquireLock is exclusive until released', async () => {
      expect(await store.acquireLock('refresh:x', 10)).toBe(true);
      expect(await store.acquireLock('refresh:x', 10)).toBe(false);
      await store.releaseLock('refresh:x');
      expect(await store.acquireLock('refresh:x', 10)).toBe(true);
    });

    it('locks expire after their ttl', async () => {
      expect(await store.acquireLock('refresh:y', 2)).toBe(true);
      vi.advanceTimersByTime(1_999);
      expect(await store.acquireLock('refresh:y', 2)).toBe(false);
      vi.advanceTimersByTime(2);
      expect(await store.acquireLock('refresh:y', 2)).toBe(true);
    });

    it('different lock keys are independent', async () => {
      expect(await store.acquireLock('a', 10)).toBe(true);
      expect(await store.acquireLock('b', 10)).toBe(true);
    });
  });

  describe('incr', () => {
    it('counts from 1 and keeps the original window expiry', async () => {
      expect(await store.incr('ip:1.2.3.4:100', 10)).toBe(1);
      expect(await store.incr('ip:1.2.3.4:100', 10)).toBe(2);
      vi.advanceTimersByTime(9_000);
      expect(await store.incr('ip:1.2.3.4:100', 10)).toBe(3);
      // Window started at t=0 with ttl 10s: at 10.001s it is gone regardless of later incr calls
      vi.advanceTimersByTime(1_001);
      expect(await store.incr('ip:1.2.3.4:100', 10)).toBe(1);
    });

    it('separate keys have separate counters', async () => {
      await store.incr('k1', 10);
      await store.incr('k1', 10);
      expect(await store.incr('k2', 10)).toBe(1);
    });
  });

  describe('generic kv (Better Auth secondaryStorage substrate)', () => {
    it('round-trips a value under the nw:kv namespace', async () => {
      await store.kvSet('ba:token-1', '{"session":1}', 60);
      expect(await store.kvGet('ba:token-1')).toBe('{"session":1}');
      await store.kvDelete('ba:token-1');
      expect(await store.kvGet('ba:token-1')).toBeNull();
    });

    it('does not collide with a session of the same key', async () => {
      await store.set(makeRecord({ sidHash: 'shared' }), 60);
      await store.kvSet('shared', 'kv-value', 60);
      expect((await store.get('shared'))?.origin).toBe('https://example.com');
      expect(await store.kvGet('shared')).toBe('kv-value');
    });

    it('expires a value after its ttl', async () => {
      await store.kvSet('k', 'v', 10);
      vi.advanceTimersByTime(9_999);
      expect(await store.kvGet('k')).toBe('v');
      vi.advanceTimersByTime(2);
      expect(await store.kvGet('k')).toBeNull();
    });

    it('stores without expiry when no ttl is given', async () => {
      await store.kvSet('forever', 'v');
      vi.advanceTimersByTime(10 * 365 * 24 * 60 * 60 * 1000);
      expect(await store.kvGet('forever')).toBe('v');
    });

    it('kvGetDelete reads once and is empty afterwards', async () => {
      await store.kvSet('once', 'v', 60);
      expect(await store.kvGetDelete('once')).toBe('v');
      expect(await store.kvGetDelete('once')).toBeNull();
    });

    it('kvIncrement counts in a fixed window', async () => {
      expect(await store.kvIncrement('rl', 10)).toBe(1);
      expect(await store.kvIncrement('rl', 10)).toBe(2);
      vi.advanceTimersByTime(9_000);
      expect(await store.kvIncrement('rl', 10)).toBe(3);
      // The window is anchored to the first call, so a later increment cannot
      // extend it -- otherwise a steady caller never resets and never expires.
      vi.advanceTimersByTime(1_001);
      expect(await store.kvIncrement('rl', 10)).toBe(1);
    });

    it('kvIncrement is separate from the embed rate-limit counter', async () => {
      await store.incr('same', 10);
      await store.incr('same', 10);
      expect(await store.kvIncrement('same', 10)).toBe(1);
    });
  });

  it('exposes size and clear for tests', async () => {
    await store.set(makeRecord(), 60);
    await store.setHandoff('c', { sid: 's', origin: 'o', wid: 'w' }, 60);
    expect(store.size).toBe(2);
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe('UpstashSessionStore', () => {
  const url = 'https://redis.example.upstash.io';
  const token = 'upstash-token';
  let calls: { url: string; init: RequestInit }[];
  let responder: (body: unknown, path: string) => unknown;

  beforeEach(() => {
    calls = [];
    responder = () => ({ result: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const u = String(input);
        calls.push({ url: u, init: init ?? {} });
        const path = u.slice(url.length);
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const result = responder(body, path);
        return new Response(JSON.stringify(result), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires url and token', () => {
    expect(() => new UpstashSessionStore('', token)).toThrow();
    expect(() => new UpstashSessionStore(url, '')).toThrow();
  });

  it('sends SET with EX ttl and a bearer token for set()', async () => {
    const store = new UpstashSessionStore(`${url}/`, token);
    responder = () => ({ result: 'OK' });
    const rec = makeRecord();
    await store.set(rec, 120);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(url);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual([
      'SET',
      'nw:sess:hash-1',
      JSON.stringify(rec),
      'EX',
      120,
    ]);
  });

  it('parses GET results and returns null for missing/invalid', async () => {
    const store = new UpstashSessionStore(url, token);
    const rec = makeRecord();
    responder = () => ({ result: JSON.stringify(rec) });
    expect(await store.get('hash-1')).toEqual(rec);
    expect(JSON.parse(String(calls[0].init.body))).toEqual(['GET', 'nw:sess:hash-1']);

    responder = () => ({ result: null });
    expect(await store.get('hash-1')).toBeNull();

    responder = () => ({ result: 'not-json' });
    expect(await store.get('hash-1')).toBeNull();

    responder = () => ({ result: JSON.stringify({ foo: 'bar' }) });
    expect(await store.get('hash-1')).toBeNull();
  });

  it('uses DEL for delete and releaseLock', async () => {
    const store = new UpstashSessionStore(url, token);
    responder = () => ({ result: 1 });
    await store.delete('h');
    await store.releaseLock('refresh:h');
    expect(JSON.parse(String(calls[0].init.body))).toEqual(['DEL', 'nw:sess:h']);
    expect(JSON.parse(String(calls[1].init.body))).toEqual(['DEL', 'nw:lock:refresh:h']);
  });

  it('uses GETDEL for single-use handoff', async () => {
    const store = new UpstashSessionStore(url, token);
    const value = { sid: 's', origin: 'https://o.com', wid: 'w' };
    responder = () => ({ result: JSON.stringify(value) });
    expect(await store.takeHandoff('code-hash')).toEqual(value);
    expect(JSON.parse(String(calls[0].init.body))).toEqual(['GETDEL', 'nw:handoff:code-hash']);

    responder = () => ({ result: null });
    expect(await store.takeHandoff('code-hash')).toBeNull();
  });

  it('setHandoff uses SET EX under the handoff prefix', async () => {
    const store = new UpstashSessionStore(url, token);
    responder = () => ({ result: 'OK' });
    await store.setHandoff('code-hash', { sid: 's', origin: 'o', wid: 'w' }, 60);
    expect(JSON.parse(String(calls[0].init.body))).toEqual([
      'SET',
      'nw:handoff:code-hash',
      JSON.stringify({ sid: 's', origin: 'o', wid: 'w' }),
      'EX',
      60,
    ]);
  });

  it('acquireLock uses SET NX EX and maps OK/null', async () => {
    const store = new UpstashSessionStore(url, token);
    responder = () => ({ result: 'OK' });
    expect(await store.acquireLock('refresh:h', 10)).toBe(true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual(['SET', 'nw:lock:refresh:h', '1', 'NX', 'EX', 10]);

    responder = () => ({ result: null });
    expect(await store.acquireLock('refresh:h', 10)).toBe(false);
  });

  it('incr uses the pipeline endpoint with INCR + EXPIRE', async () => {
    const store = new UpstashSessionStore(url, token);
    responder = (_body, path) => {
      expect(path).toBe('/pipeline');
      return [{ result: 7 }, { result: 1 }];
    };
    expect(await store.incr('ip:1.2.3.4:100', 65)).toBe(7);
    expect(JSON.parse(String(calls[0].init.body))).toEqual([
      ['INCR', 'nw:rl:ip:1.2.3.4:100'],
      ['EXPIRE', 'nw:rl:ip:1.2.3.4:100', 65],
    ]);
  });

  it('throws on non-2xx responses and on redis errors', async () => {
    const store = new UpstashSessionStore(url, token);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    await expect(store.get('h')).rejects.toThrow(/Session store request failed \(500\)/);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'WRONGTYPE' }), { status: 200 })),
    );
    await expect(store.get('h')).rejects.toThrow(/WRONGTYPE/);
  });

  describe('generic kv (Better Auth secondaryStorage substrate)', () => {
    it('kvSet sends SET with EX, and omits EX when no ttl is given', async () => {
      const store = new UpstashSessionStore(url, token);
      responder = () => ({ result: 'OK' });
      await store.kvSet('ba:tok', 'payload', 300);
      expect(JSON.parse(String(calls[0].init.body))).toEqual([
        'SET',
        'nw:kv:ba:tok',
        'payload',
        'EX',
        300,
      ]);

      await store.kvSet('ba:tok', 'payload');
      expect(JSON.parse(String(calls[1].init.body))).toEqual(['SET', 'nw:kv:ba:tok', 'payload']);
    });

    it('kvGet returns the raw string, or null when absent', async () => {
      const store = new UpstashSessionStore(url, token);
      responder = () => ({ result: 'payload' });
      expect(await store.kvGet('ba:tok')).toBe('payload');
      expect(JSON.parse(String(calls[0].init.body))).toEqual(['GET', 'nw:kv:ba:tok']);

      responder = () => ({ result: null });
      expect(await store.kvGet('ba:tok')).toBeNull();
    });

    it('kvDelete uses DEL and kvGetDelete uses GETDEL', async () => {
      const store = new UpstashSessionStore(url, token);
      responder = () => ({ result: 'payload' });
      await store.kvDelete('ba:tok');
      expect(JSON.parse(String(calls[0].init.body))).toEqual(['DEL', 'nw:kv:ba:tok']);
      expect(await store.kvGetDelete('ba:tok')).toBe('payload');
      expect(JSON.parse(String(calls[1].init.body))).toEqual(['GETDEL', 'nw:kv:ba:tok']);
    });

    it('kvIncrement pipelines INCR + EXPIRE NX so the window never slides', async () => {
      const store = new UpstashSessionStore(url, token);
      responder = (_body, path) => {
        expect(path).toBe('/pipeline');
        return [{ result: 4 }, { result: 0 }];
      };
      expect(await store.kvIncrement('ba:rl:key', 60)).toBe(4);
      expect(JSON.parse(String(calls[0].init.body))).toEqual([
        ['INCR', 'nw:kv:ba:rl:key'],
        ['EXPIRE', 'nw:kv:ba:rl:key', 60, 'NX'],
      ]);
    });
  });

  it('never puts the token in the URL', async () => {
    const store = new UpstashSessionStore(url, token);
    responder = () => ({ result: null });
    await store.get('h');
    expect(calls[0].url).not.toContain(token);
  });
});

describe('getSessionStore', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EMBED_JWT_SECRET', 'test-embed-jwt-secret-at-least-32-bytes-long-for-hs256');
    vi.stubEnv('EMBED_SESSION_STORE_URL', '');
    vi.stubEnv('EMBED_SESSION_STORE_TOKEN', '');
    __resetSessionStoreForTests();
  });

  it('returns a MemorySessionStore singleton when no store URL is configured', () => {
    __resetSessionStoreForTests();
    const a = getSessionStore();
    const b = getSessionStore();
    expect(a).toBeInstanceOf(MemorySessionStore);
    expect(a).toBe(b);
  });

  it('__resetSessionStoreForTests yields a fresh instance', () => {
    const a = getSessionStore();
    __resetSessionStoreForTests();
    expect(getSessionStore()).not.toBe(a);
  });

  it('returns an UpstashSessionStore when url + token are set', () => {
    vi.stubEnv('EMBED_SESSION_STORE_URL', 'https://redis.example.upstash.io');
    vi.stubEnv('EMBED_SESSION_STORE_TOKEN', 'tok');
    __resetSessionStoreForTests();
    expect(getSessionStore()).toBeInstanceOf(UpstashSessionStore);
  });

  it('throws in production when no store is configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    __resetSessionStoreForTests();
    expect(() => getSessionStore()).toThrow(/EMBED_SESSION_STORE_URL/);
    expect(() => getSessionStore()).toThrow(/EMBED_SESSION_STORE_ALLOW_MEMORY/);
  });

  it('throws in production when the url is set but the token is missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMBED_SESSION_STORE_URL', 'https://redis.example.upstash.io');
    vi.stubEnv('EMBED_SESSION_STORE_TOKEN', '');
    __resetSessionStoreForTests();
    expect(() => getSessionStore()).toThrow(/EMBED_SESSION_STORE_TOKEN is missing/);
  });

  it('does not cache the production failure, so fixing the env recovers', () => {
    vi.stubEnv('NODE_ENV', 'production');
    __resetSessionStoreForTests();
    expect(() => getSessionStore()).toThrow();
    vi.stubEnv('EMBED_SESSION_STORE_URL', 'https://redis.example.upstash.io');
    vi.stubEnv('EMBED_SESSION_STORE_TOKEN', 'tok');
    expect(getSessionStore()).toBeInstanceOf(UpstashSessionStore);
  });

  it('EMBED_SESSION_STORE_ALLOW_MEMORY opts back in, with a warning', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('EMBED_SESSION_STORE_ALLOW_MEMORY', '1');
    __resetSessionStoreForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getSessionStore()).toBeInstanceOf(MemorySessionStore);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/EMBED_SESSION_STORE_ALLOW_MEMORY is set/);
    warn.mockRestore();
  });

  it('warns once in development, where the fallback is actually used', () => {
    vi.stubEnv('NODE_ENV', 'development');
    __resetSessionStoreForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSessionStore();
    getSessionStore();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/in-memory session store/);
    warn.mockRestore();
  });

  it('does not warn when a real store is configured', () => {
    vi.stubEnv('EMBED_SESSION_STORE_URL', 'https://redis.example.upstash.io');
    vi.stubEnv('EMBED_SESSION_STORE_TOKEN', 'tok');
    __resetSessionStoreForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getSessionStore();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * The regression that made the in-memory store useless in the App Router
 * (TODO 31): Next 16 evaluates `session-store.ts` once for the RSC bundle and
 * again for the route-handler bundle, in the *same process*. A module-level
 * singleton therefore gave the two halves of the app two disjoint stores, and
 * signing in locally looped `/demo -> /signin -> /demo` forever.
 *
 * `vi.resetModules()` plus a second dynamic import reproduces exactly that
 * shape: two independent evaluations of the module, one shared `globalThis`.
 * The old implementation fails every assertion below.
 */
describe('getSessionStore across separate module graphs (TODO 31)', () => {
  const MODULE = './session-store';

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('EMBED_SESSION_STORE_URL', '');
    vi.stubEnv('EMBED_SESSION_STORE_TOKEN', '');
    __resetSessionStoreForTests();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    __resetSessionStoreForTests();
  });

  /** Two independent evaluations of the module, as Next's two bundles produce. */
  async function loadTwoGraphs() {
    vi.resetModules();
    const graphA = await import(MODULE);
    vi.resetModules();
    const graphB = await import(MODULE);
    expect(graphA).not.toBe(graphB); // genuinely separate module instances
    graphA.__resetSessionStoreForTests();
    return { graphA, graphB };
  }

  it('hands both module instances the same store object', async () => {
    const { graphA, graphB } = await loadTwoGraphs();
    expect(graphA.getSessionStore()).toBe(graphB.getSessionStore());
  });

  it('a write in one graph is visible in the other', async () => {
    const { graphA, graphB } = await loadTwoGraphs();
    // Better Auth's session path goes through `kv*` (auth-secondary-storage.ts),
    // which is the exact traffic that used to land in the wrong Map.
    await graphA.getSessionStore().kvSet('ba:session-token', 'the-session', 60);
    expect(await graphB.getSessionStore().kvGet('ba:session-token')).toBe('the-session');

    const rec = makeRecord({ sidHash: 'cross-graph' });
    await graphB.getSessionStore().set(rec, 60);
    expect(await graphA.getSessionStore().get('cross-graph')).toEqual(rec);
  });

  it('a reset in one graph is seen by the other (one registry, not two)', async () => {
    const { graphA, graphB } = await loadTwoGraphs();
    const before = graphA.getSessionStore();
    graphB.__resetSessionStoreForTests();
    expect(graphA.getSessionStore()).not.toBe(before);
  });

  it('data survives a module re-evaluation, as HMR produces on every save', async () => {
    vi.resetModules();
    const first = await import(MODULE);
    first.__resetSessionStoreForTests();
    await first.getSessionStore().kvSet('ba:session-token', 'still-signed-in', 60);

    // HMR: the file is re-evaluated into a fresh module instance mid-session.
    vi.resetModules();
    const afterHmr = await import(MODULE);
    expect(await afterHmr.getSessionStore().kvGet('ba:session-token')).toBe('still-signed-in');
  });
});

describe('MemorySessionStore backing map', () => {
  it('two stores over one map share rows', async () => {
    const shared = new Map<string, Entry>();
    const a = new MemorySessionStore(shared);
    const b = new MemorySessionStore(shared);
    await a.kvSet('k', 'v', 60);
    expect(await b.kvGet('k')).toBe('v');
    await b.kvDelete('k');
    expect(await a.kvGet('k')).toBeNull();
  });

  it('defaults to a private map, so unit tests stay isolated', async () => {
    const a = new MemorySessionStore();
    const b = new MemorySessionStore();
    await a.kvSet('k', 'v', 60);
    expect(await b.kvGet('k')).toBeNull();
  });
});
