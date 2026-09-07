import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { MemorySessionStore } from '@/lib/embed/session-store';

/**
 * Cover for TODO 14: `betterAuth()` had no `database` and no
 * `secondaryStorage`, so Better Auth fell back to an in-process memory
 * adapter. Every user / session row lived in one Node process, and a restart,
 * a cold start, or a request landing on another serverless instance signed the
 * user out once the cookie cache lapsed.
 *
 * The fix points `secondaryStorage` at the Redis the widget sessions already
 * use. These tests pin the two halves of that: the adapter itself (key
 * namespacing and delegation), and -- the part that actually matters -- that a
 * session minted by one Better Auth instance is readable by a *different*
 * instance that shares only the store, with the item-11 `userGuid` /
 * `imageGuid` fields intact.
 */

const store = new MemorySessionStore();

vi.mock('@/lib/embed/session-store', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/embed/session-store')>();
  return { ...actual, getSessionStore: () => store };
});

// Imported after the mock so `getSessionStore` resolves to the shared store.
const { betterAuthSecondaryStorage } = await import('@/lib/auth-secondary-storage');

describe('betterAuthSecondaryStorage', () => {
  beforeEach(() => {
    store.clear();
  });

  it('namespaces every key under nw:kv:ba: so it cannot collide with widget sessions', async () => {
    const storage = betterAuthSecondaryStorage();
    await storage.set('some-session-token', 'payload', 60);

    // Reads back through the same prefix...
    expect(await storage.get('some-session-token')).toBe('payload');
    // ...but is invisible to the embed session/handoff/lock namespaces.
    expect(await store.get('some-session-token')).toBeNull();
    expect(await store.takeHandoff('some-session-token')).toBeNull();
    expect(await store.kvGet('ba:some-session-token')).toBe('payload');
  });

  it('delete removes the value', async () => {
    const storage = betterAuthSecondaryStorage();
    await storage.set('k', 'v', 60);
    await storage.delete('k');
    expect(await storage.get('k')).toBeNull();
  });

  it('getAndDelete is single-use', async () => {
    const storage = betterAuthSecondaryStorage();
    await storage.set('k', 'v', 60);
    expect(await storage.getAndDelete('k')).toBe('v');
    expect(await storage.getAndDelete('k')).toBeNull();
  });

  it('increment counts, which is what secondary-storage rate limiting needs', async () => {
    const storage = betterAuthSecondaryStorage();
    expect(await storage.increment('rl:ip', 60)).toBe(1);
    expect(await storage.increment('rl:ip', 60)).toBe(2);
  });

  it('resolves the store lazily, per call, not at module load', async () => {
    const storage = betterAuthSecondaryStorage();
    await storage.set('k', 'v', 60);
    store.clear();
    // A store swapped out from under it must be observed, not cached.
    expect(await storage.get('k')).toBeNull();
  });
});

/**
 * The regression itself: two Better Auth instances, sharing nothing but the
 * secondary storage, standing in for "before the restart" and "after it".
 */
describe('a session survives a Better Auth instance swap', () => {
  const secret = 'test-better-auth-secret-at-least-32-bytes-long';

  function makeAuth() {
    return betterAuth({
      baseURL: 'http://localhost:3000',
      secret,
      // Deliberately no `database` -- exactly the production shape.
      secondaryStorage: betterAuthSecondaryStorage(),
      session: { cookieCache: { enabled: true, maxAge: 60 * 5, strategy: 'jwt' } },
      emailAndPassword: { enabled: true },
      user: {
        additionalFields: {
          userGuid: { type: 'string', required: false, input: false },
          imageGuid: { type: 'string', required: false, input: false },
        },
      },
      // Same shape as production: the only writer of the two fields.
      databaseHooks: {
        user: {
          create: {
            before: async () => ({
              data: { userGuid: 'mp-user-guid', imageGuid: 'mp-image-guid' },
            }),
          },
        },
      },
    } satisfies BetterAuthOptions);
  }

  let cookie: string;

  beforeEach(async () => {
    store.clear();
    const signUp = await makeAuth().api.signUpEmail({
      body: {
        email: 'restart@example.com',
        password: 'correct-horse-battery-staple',
        name: 'Ada Lovelace',
      },
      returnHeaders: true,
    });
    cookie = (signUp.headers.getSetCookie() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');
    expect(cookie).toContain('better-auth.session_token');
  });

  afterEach(() => {
    store.clear();
  });

  it('writes the session into the shared store, not just the cookie', async () => {
    // `nw:kv:ba:<token>` plus `nw:kv:ba:active-sessions-<userId>`.
    expect(store.size).toBeGreaterThanOrEqual(2);
  });

  it('a fresh instance reads the session back, cookie cache disabled', async () => {
    // `disableCookieCache` forces the store read -- this is the exact call
    // that returned null before the fix.
    const session = await makeAuth().api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    });

    expect(session?.user.email).toBe('restart@example.com');
  });

  it('carries userGuid / imageGuid across the swap', async () => {
    const session = await makeAuth().api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    });

    expect(session?.user).toMatchObject({
      userGuid: 'mp-user-guid',
      imageGuid: 'mp-image-guid',
    });
  });

  it('signing out on one instance revokes the session on the other', async () => {
    await makeAuth().api.signOut({ headers: new Headers({ cookie }) });

    const session = await makeAuth().api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    });

    expect(session).toBeNull();
  });

  it('an emptied store means no session -- proving the read really goes there', async () => {
    store.clear();

    const session = await makeAuth().api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    });

    expect(session).toBeNull();
  });
});
