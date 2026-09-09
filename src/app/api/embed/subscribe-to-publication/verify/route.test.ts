import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { createActionToken } from '@/lib/embed/action-token';
import { createPendingAction } from '@/lib/embed/pending-action';
import { getSessionStore, __resetSessionStoreForTests } from '@/lib/embed/session-store';
import type { PublicationVerifyData } from '@mpnext/types';

/**
 * `POST /api/embed/subscribe-to-publication/verify` — the hop that writes.
 *
 * The single most important assertion in the file is the single-use one. A
 * replayable handle would silently **resurrect an unsubscribe**: the write is
 * idempotent in the subscribe direction, so anything that re-fetches an old
 * confirmation link after the visitor has opted out puts them back on the list
 * — a mail prefetcher or a security scanner is enough, no attacker required.
 * Idempotency, which is what makes replay look harmless, is exactly what makes
 * it harmful once `Unsubscribed` can have been flipped in between.
 *
 * The other four are the `consumePendingAction` outcomes, and the one that
 * would be easiest to get backwards is `unavailable`: a store error must never
 * read as a successful write.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com', 'https://other.example.com'],
}));

const mockGetOnlinePublication = vi.fn();
const mockSubscribe = vi.fn();

vi.mock('@/services/subscriptionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/subscriptionService')>();
  return {
    ...actual,
    SubscriptionService: {
      getInstance: async () => ({
        getOnlinePublication: mockGetOnlinePublication,
        subscribeEmailToPublication: mockSubscribe,
      }),
    },
  };
});

const ORIGIN = 'https://allowed.example.com';
const OTHER_ORIGIN = 'https://other.example.com';

const PENDING: PublicationVerifyData = {
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  publicationId: 4,
  origin: ORIGIN,
};

const PUBLICATION = {
  Publication_ID: 4,
  Title: 'Weekly Newsletter',
  Description: null,
  Congregation_ID: 7,
};

async function publicToken(wid = 'subscribe-to-publication'): Promise<string> {
  return createWidgetToken({ sub: 'public', wid, origin: ORIGIN });
}

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function post(token: string, body: unknown, ip = freshIp()): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/subscribe-to-publication/verify', {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

/** Seal a payload the way `send-verification` would have. */
async function mint(data: Partial<PublicationVerifyData> = {}): Promise<string> {
  return createPendingAction('publication-verify', { ...PENDING, ...data }, 300);
}

describe('POST /api/embed/subscribe-to-publication/verify', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    mockGetOnlinePublication.mockResolvedValue(PUBLICATION);
    mockSubscribe.mockResolvedValue({
      contactId: 501,
      contactCreated: true,
      alreadySubscribed: false,
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('method surface', () => {
    it('exports no GET handler', () => {
      // A state-changing GET is fetched by mailbox link scanners and
      // URL-rewriting gateways, which here would subscribe someone who never
      // clicked. The emailed link lands on a page; only the widget POSTs.
      expect('GET' in route).toBe(false);
      expect(Object.keys(route).sort()).toEqual(['OPTIONS', 'POST']);
    });

    it('answers the preflight with CORS headers', async () => {
      const res = await route.OPTIONS(
        new NextRequest('http://localhost:3000/api/embed/subscribe-to-publication/verify', {
          method: 'OPTIONS',
          headers: { Origin: ORIGIN },
        })
      );
      expect(res.status).toBe(204);
    });
  });

  describe('the happy path', () => {
    it('subscribes with the handle\'s own data and echoes the address', async () => {
      const res = await route.POST(post(await publicToken(), { token: await mint() }));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        subscribed: true,
        publicationTitle: 'Weekly Newsletter',
        email: 'ada@example.com',
        alreadySubscribed: false,
      });
      expect(mockSubscribe).toHaveBeenCalledWith({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        publicationId: 4,
      });
    });

    it('reports alreadySubscribed without changing the sentence it implies', async () => {
      // For a host page's analytics only. Safe to report, because the caller
      // has already proved control of the mailbox.
      mockSubscribe.mockResolvedValue({
        contactId: 42,
        contactCreated: false,
        alreadySubscribed: true,
      });
      const res = await route.POST(post(await publicToken(), { token: await mint() }));

      expect(res.status).toBe(200);
      expect((await res.json()).alreadySubscribed).toBe(true);
    });

    it('returns no contact id', async () => {
      const res = await route.POST(post(await publicToken(), { token: await mint() }));
      const body = await res.json();
      expect(body).not.toHaveProperty('contactId');
      expect(JSON.stringify(body)).not.toContain('501');
    });
  });

  describe('single use — the resurrect-an-unsubscribe guard', () => {
    it('writes once for two presentations of the same handle', async () => {
      const token = await mint();
      const first = await route.POST(post(await publicToken(), { token }));
      const second = await route.POST(post(await publicToken(), { token }));

      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect((await second.json()).error).toBe('verification_used');
      // The assertion the whole design rests on.
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('the four redemption outcomes', () => {
    it('maps an expired envelope to verification_expired, with no store read', async () => {
      const token = await createPendingAction('publication-verify', PENDING, -1);
      const res = await route.POST(post(await publicToken(), { token }));

      expect(res.status).toBe(410);
      expect((await res.json()).error).toBe('verification_expired');
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('maps a forged handle to verification_invalid', async () => {
      const res = await route.POST(
        post(await publicToken(), { token: 'not.a.token' })
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('verification_invalid');
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('refuses a handle minted for the unsubscribe flow', async () => {
      // The `typ` check is the only thing keeping a subscribe capability and an
      // unsubscribe capability apart on the same `dp_Contact_Publications` row.
      const token = await createActionToken('unsubscribe', { jti: 'abcdef' }, 300);
      const res = await route.POST(post(await publicToken(), { token }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('verification_invalid');
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('never reveals which flow a wrong-typed handle belonged to', async () => {
      const wrongFlow = await createActionToken('unsubscribe', { jti: 'abcdef' }, 300);
      const forged = 'not.a.token';

      const a = await route.POST(post(await publicToken(), { token: wrongFlow }));
      const b = await route.POST(post(await publicToken(), { token: forged }));

      expect(await a.text()).toBe(await b.text());
    });

    it('maps a store outage to internal_error and writes nothing', async () => {
      // Never a successful write on a store error, and the record is *not*
      // burned — so the widget's retry re-POSTs the same handle.
      const token = await mint();
      vi.spyOn(getSessionStore(), 'kvGetDelete').mockRejectedValue(new Error('redis down'));

      const res = await route.POST(post(await publicToken(), { token }));

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('internal_error');
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('is retryable after a store outage, because the record survived it', async () => {
      const token = await mint();
      const spy = vi
        .spyOn(getSessionStore(), 'kvGetDelete')
        .mockRejectedValueOnce(new Error('redis down'));

      const failed = await route.POST(post(await publicToken(), { token }));
      expect(failed.status).toBe(500);

      spy.mockRestore();
      const retried = await route.POST(post(await publicToken(), { token }));
      expect(retried.status).toBe(200);
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('cross-origin replay', () => {
    it('refuses a handle minted on another allowlisted origin', async () => {
      // Both origins are on the allowlist, so `requireWidgetAuth` cannot catch
      // this — the sealed `origin` claim is what does.
      const token = await mint({ origin: OTHER_ORIGIN });
      const res = await route.POST(post(await publicToken(), { token }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('verification_invalid');
      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('answers a cross-origin replay exactly like a forged handle', async () => {
      // Deliberately not its own code: a distinct answer would tell a prober
      // that the handle was otherwise valid.
      const crossOrigin = await route.POST(
        post(await publicToken(), { token: await mint({ origin: OTHER_ORIGIN }) })
      );
      const forged = await route.POST(post(await publicToken(), { token: 'not.a.token' }));

      expect(crossOrigin.status).toBe(forged.status);
      expect(await crossOrigin.text()).toBe(await forged.text());
    });

    it('burns the record even though the origin check fails', async () => {
      // Containment, not collateral damage: a handle presented from the wrong
      // origin is evidence it has leaked.
      const token = await mint({ origin: OTHER_ORIGIN });
      await route.POST(post(await publicToken(), { token }));
      const second = await route.POST(post(await publicToken(), { token }));

      expect((await second.json()).error).toBe('verification_used');
    });
  });

  describe('the publication can change between the two hops', () => {
    it('answers publication_not_found when it is taken offline, and writes nothing', async () => {
      // Three days apart, so this is a real case rather than a theoretical one.
      mockGetOnlinePublication.mockResolvedValue(null);
      const res = await route.POST(post(await publicToken(), { token: await mint() }));

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('publication_not_found');
      expect(mockSubscribe).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('maps an MP write failure to save_failed, at 500 not 502', async () => {
      mockSubscribe.mockRejectedValue(new Error('MP said: FK violation on Contact_ID'));
      const res = await route.POST(post(await publicToken(), { token: await mint() }));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('save_failed');
      expect(JSON.stringify(body)).not.toContain('FK violation');
    });

    it('never logs the address on the failure path', async () => {
      mockSubscribe.mockRejectedValue(new Error('MP rejected'));
      await route.POST(post(await publicToken(), { token: await mint() }));

      const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .flat()
        .map((arg) => String(arg))
        .join(' ');
      expect(logged).not.toContain('ada@example.com');
    });

    it('rejects a body with no handle', async () => {
      const res = await route.POST(post(await publicToken(), {}));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_request');
    });

    it('rejects an oversized handle', async () => {
      const res = await route.POST(post(await publicToken(), { token: 'a'.repeat(1025) }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_request');
    });

    it('rejects a request with no widget token', async () => {
      const res = await route.POST(
        new NextRequest('http://localhost:3000/api/embed/subscribe-to-publication/verify', {
          method: 'POST',
          headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'x' }),
        })
      );
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('auth_required');
    });
  });

  describe('rate limiting', () => {
    it('does not meter a handle that costs nothing to reject', async () => {
      // Link scanners and stale bookmarks must not exhaust the budget of the
      // visitors holding real handles: a forged envelope is answered from the
      // signature alone, with no store round-trip and no MP call.
      const ip = freshIp();
      const token = await publicToken();
      for (let i = 0; i < 25; i += 1) {
        const res = await route.POST(post(token, { token: 'not.a.token' }, ip));
        expect(res.status).toBe(400);
      }

      const real = await route.POST(post(token, { token: await mint() }, ip));
      expect(real.status).toBe(200);
    });

    it('caps redemptions at 20 per minute per IP', async () => {
      const ip = freshIp();
      const token = await publicToken();
      for (let i = 0; i < 20; i += 1) {
        const res = await route.POST(post(token, { token: await mint() }, ip));
        expect(res.status).toBe(200);
      }

      const capped = await route.POST(post(token, { token: await mint() }, ip));
      expect(capped.status).toBe(429);
      expect((await capped.json()).error).toBe('rate_limited');
    });

    it('fails closed on a rate-limit store outage', async () => {
      const token = await mint();
      vi.spyOn(getSessionStore(), 'incr').mockRejectedValue(new Error('redis down'));

      const res = await route.POST(post(await publicToken(), { token }));

      expect(res.status).toBe(429);
      expect(mockSubscribe).not.toHaveBeenCalled();
    });
  });
});
