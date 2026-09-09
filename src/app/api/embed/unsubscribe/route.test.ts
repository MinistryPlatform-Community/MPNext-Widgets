import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { createActionToken } from '@/lib/embed/action-token';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import type { UnsubscribeOutcome } from '@/services/subscriptionService';

/**
 * POST /api/embed/unsubscribe — the anonymous, capability-addressed opt-out.
 *
 * The assertions that matter most here are the *negative* ones: no GET export
 * (a state-changing GET in an email gets fetched by mail scanners), no
 * Set-Cookie (holding a Contact_GUID must never become a session), and no
 * observable difference between a known and an unknown GUID (or the route is an
 * oracle for "is this GUID a live contact").
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const mockUnsubscribe = vi.fn<(args: { contactGuid: string; publicationId?: number | null }) => Promise<UnsubscribeOutcome>>();
const mockResubscribe = vi.fn<(args: { contactGuid: string; publicationId?: number | null }) => Promise<UnsubscribeOutcome>>();

vi.mock('@/services/subscriptionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/subscriptionService')>();
  return {
    ...actual,
    SubscriptionService: {
      getInstance: async () => ({
        unsubscribeByContactGuid: mockUnsubscribe,
        resubscribeByContactGuid: mockResubscribe,
      }),
    },
  };
});

const ORIGIN = 'https://allowed.example.com';
const CG = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER_CG = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

const MATCHED: UnsubscribeOutcome = {
  matched: true,
  emailMasked: 'j•••@g•••.com',
  wasAlreadyOptedOut: false,
  changed: 1,
};
const NO_MATCH: UnsubscribeOutcome = {
  matched: false,
  emailMasked: null,
  wasAlreadyOptedOut: false,
  changed: 0,
};

async function publicToken(wid = 'unsubscribe'): Promise<string> {
  return createWidgetToken({ sub: 'public', wid, origin: ORIGIN });
}

function post(token: string, body: unknown, ip = '198.51.100.7'): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/unsubscribe', {
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

describe('POST /api/embed/unsubscribe', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    mockUnsubscribe.mockResolvedValue(MATCHED);
    mockResubscribe.mockResolvedValue({ ...MATCHED, wasAlreadyOptedOut: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('method surface', () => {
    it('exports no GET handler', () => {
      // A state-changing GET is fetched by mailbox link scanners and
      // URL-rewriting gateways, which is how a whole congregation gets
      // unsubscribed without anyone clicking. The emailed link must land on an
      // HTML page; only the mounted widget POSTs.
      expect('GET' in route).toBe(false);
      expect((route as Record<string, unknown>).GET).toBeUndefined();
    });

    it('exports POST and OPTIONS only', () => {
      expect(Object.keys(route).sort()).toEqual(['OPTIONS', 'POST']);
    });

    it('answers the preflight with CORS headers', async () => {
      const res = await route.OPTIONS(
        new NextRequest('http://localhost:3000/api/embed/unsubscribe', {
          method: 'OPTIONS',
          headers: { Origin: ORIGIN },
        })
      );
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    });
  });

  describe('authentication', () => {
    it('accepts a widget token whose subject is "public"', async () => {
      const res = await route.POST(post(await publicToken(), { cg: CG, pubid: 4 }));
      expect(res.status).toBe(200);
    });

    it('accepts a next-subscriptions token (the Phase 5 link-out)', async () => {
      const res = await route.POST(post(await publicToken('subscriptions'), { cg: CG }));
      expect(res.status).toBe(200);
    });

    it('rejects a token minted for an unrelated widget', async () => {
      const res = await route.POST(post(await publicToken('profile'), { cg: CG }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('auth_required');
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('rejects a request with no Authorization header', async () => {
      const req = new NextRequest('http://localhost:3000/api/embed/unsubscribe', {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cg: CG }),
      });
      const res = await route.POST(req);
      expect(res.status).toBe(401);
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('the per-publication path', () => {
    it('unsubscribes the publication and reports canUndo', async () => {
      const res = await route.POST(post(await publicToken(), { cg: CG, pubid: 4 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        scope: 'publication',
        publicationId: 4,
        email: 'j•••@g•••.com',
        canUndo: true,
      });
      expect(mockUnsubscribe).toHaveBeenCalledWith({ contactGuid: CG, publicationId: 4 });
    });

    it('accepts a numeric-string pubid, as a query string produces', async () => {
      await route.POST(post(await publicToken(), { cg: CG, pubid: '4' }));
      expect(mockUnsubscribe).toHaveBeenCalledWith({ contactGuid: CG, publicationId: 4 });
    });
  });

  describe('the bulk path', () => {
    it.each([
      ['absent', {}],
      ['empty', { pubid: '' }],
      ['zero', { pubid: 0 }],
      ['the string zero', { pubid: '0' }],
    ])('treats a %s pubid as bulk email opt-out', async (_label, extra) => {
      const res = await route.POST(post(await publicToken(), { cg: CG, ...extra }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ scope: 'bulk', publicationId: null });
      expect(mockUnsubscribe).toHaveBeenCalledWith({ contactGuid: CG, publicationId: null });
    });
  });

  describe('no existence disclosure', () => {
    it('answers an unknown GUID identically to a known one, once email is nulled', async () => {
      const known = await route.POST(post(await publicToken(), { cg: CG, pubid: 4 }));
      const knownBody = await known.json();

      __resetSessionStoreForTests();
      mockUnsubscribe.mockResolvedValue(NO_MATCH);
      const unknown = await route.POST(post(await publicToken(), { cg: OTHER_CG, pubid: 4 }));
      const unknownBody = await unknown.json();

      expect(unknown.status).toBe(known.status);
      expect({ ...unknownBody, email: null, canUndo: null }).toEqual({
        ...knownBody,
        email: null,
        canUndo: null,
      });
      // Never a 404: it would make the route an oracle over Contacts.
      expect(unknown.status).toBe(200);
      expect(unknownBody.success).toBe(true);
    });

    it('offers no Undo for a contact who was already opted out', async () => {
      mockUnsubscribe.mockResolvedValue({ ...MATCHED, wasAlreadyOptedOut: true, changed: 0 });
      const res = await route.POST(post(await publicToken(), { cg: CG }));
      expect((await res.json()).canUndo).toBe(false);
    });

    it('offers no Undo for an unknown capability', async () => {
      mockUnsubscribe.mockResolvedValue(NO_MATCH);
      const res = await route.POST(post(await publicToken(), { cg: CG }));
      expect(await res.json()).toEqual({
        success: true,
        scope: 'bulk',
        publicationId: null,
        email: null,
        canUndo: false,
      });
    });

    it('never reports whether a pubid names a real publication', async () => {
      mockUnsubscribe.mockResolvedValue(NO_MATCH);
      const res = await route.POST(post(await publicToken(), { cg: CG, pubid: 999999 }));
      expect(res.status).toBe(200);
      // The echoed id is the caller's own input; no title, no existence flag.
      expect(await res.json()).toMatchObject({ publicationId: 999999, scope: 'publication' });
    });

    it('never leaks the internal outcome fields', async () => {
      const res = await route.POST(post(await publicToken(), { cg: CG }));
      const body = await res.json();
      expect(body).not.toHaveProperty('matched');
      expect(body).not.toHaveProperty('changed');
      expect(body).not.toHaveProperty('wasAlreadyOptedOut');
    });
  });

  describe('undo', () => {
    it('replays the same capability with action: resubscribe', async () => {
      const res = await route.POST(
        post(await publicToken(), { cg: CG, pubid: 4, action: 'resubscribe' })
      );
      expect(res.status).toBe(200);
      expect(mockResubscribe).toHaveBeenCalledWith({ contactGuid: CG, publicationId: 4 });
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('never offers an undo of the undo', async () => {
      mockResubscribe.mockResolvedValue({ ...MATCHED, wasAlreadyOptedOut: false });
      const res = await route.POST(post(await publicToken(), { cg: CG, action: 'resubscribe' }));
      expect((await res.json()).canUndo).toBe(false);
    });
  });

  describe('errors', () => {
    it('invalid_request (422) for a malformed cg', async () => {
      const res = await route.POST(post(await publicToken(), { cg: 'not-a-guid' }));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        error: 'invalid_request',
        message: expect.any(String),
      });
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('invalid_request (422) for an injection attempt, before any MP call', async () => {
      const res = await route.POST(
        post(await publicToken(), { cg: `${CG}' OR '1'='1` })
      );
      expect(res.status).toBe(422);
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('invalid_request (422) when no capability is present at all', async () => {
      const res = await route.POST(post(await publicToken(), { pubid: 4 }));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('invalid_request');
    });

    it('validation_failed (400) for an unknown action', async () => {
      const res = await route.POST(post(await publicToken(), { cg: CG, action: 'delete' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('validation_failed');
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('validation_failed (400) for a non-numeric pubid', async () => {
      // A typo'd pubid must not silently degrade to "unsubscribe from
      // everything".
      const res = await route.POST(post(await publicToken(), { cg: CG, pubid: 'abc' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('validation_failed');
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('save_failed (500) when the MP write is refused', async () => {
      mockUnsubscribe.mockRejectedValue(new Error('MP said no'));
      const res = await route.POST(post(await publicToken(), { cg: CG, pubid: 4 }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('save_failed');
    });

    it('never echoes MP error detail, and never logs the GUID', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockUnsubscribe.mockRejectedValue(new Error('Contact 98 update rejected'));
      const res = await route.POST(post(await publicToken(), { cg: CG }));
      const body = await res.json();
      expect(JSON.stringify(body)).not.toContain('Contact 98');
      const logged = errorSpy.mock.calls.flat().map(String).join(' ');
      expect(logged).not.toContain(CG);
    });
  });

  describe('rate limiting', () => {
    it('caps a single capability at 5 per minute and answers rate_limited', async () => {
      const token = await publicToken();
      for (let i = 0; i < 5; i++) {
        expect((await route.POST(post(token, { cg: CG }))).status).toBe(200);
      }
      const res = await route.POST(post(token, { cg: CG }));
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: 'rate_limited', message: expect.any(String) });
    });

    it('caps a single IP at 10 per minute across different capabilities', async () => {
      const token = await publicToken();
      // Ten distinct GUIDs, so no per-capability bucket is anywhere near its
      // limit of 5 — only the IP bucket can be what trips.
      for (let i = 0; i < 10; i++) {
        const cg = `3f2504e0-4f89-41d3-9a0c-0305e82c33${String(10 + i)}`;
        expect((await route.POST(post(token, { cg }))).status).toBe(200);
      }
      const res = await route.POST(
        post(token, { cg: '3f2504e0-4f89-41d3-9a0c-0305e82c3399' })
      );
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe('rate_limited');
    });

    it('does not let one IP exhaust another IP\'s budget', async () => {
      const token = await publicToken();
      for (let i = 0; i < 10; i++) {
        const cg = `3f2504e0-4f89-41d3-9a0c-0305e82c33${String(10 + i)}`;
        await route.POST(post(token, { cg }, '203.0.113.1'));
      }
      const res = await route.POST(post(token, { cg: CG }, '203.0.113.2'));
      expect(res.status).toBe(200);
    });

    it('reports one code for either bucket, so the bucket hit is not an oracle', async () => {
      const token = await publicToken();
      for (let i = 0; i < 5; i++) await route.POST(post(token, { cg: CG }));
      const capLimited = await route.POST(post(token, { cg: CG }));

      __resetSessionStoreForTests();
      for (let i = 0; i < 10; i++) {
        const cg = `3f2504e0-4f89-41d3-9a0c-0305e82c33${String(10 + i)}`;
        await route.POST(post(token, { cg }));
      }
      const ipLimited = await route.POST(post(token, { cg: CG }));

      expect(await capLimited.json()).toEqual(await ipLimited.json());
      expect(capLimited.status).toBe(ipLimited.status);
    });

    it('rate-limits before any MP read', async () => {
      const token = await publicToken();
      for (let i = 0; i < 5; i++) await route.POST(post(token, { cg: CG }));
      mockUnsubscribe.mockClear();
      await route.POST(post(token, { cg: CG }));
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });
  });

  describe('response headers', () => {
    it('carries CORS headers on success', async () => {
      const res = await route.POST(post(await publicToken(), { cg: CG }));
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    });

    it('carries CORS headers on a validation error', async () => {
      const res = await route.POST(post(await publicToken(), { cg: 'nope' }));
      expect(res.status).toBe(422);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    });

    it('carries CORS headers on an auth failure', async () => {
      const res = await route.POST(post(await publicToken('profile'), { cg: CG }));
      expect(res.status).toBe(401);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    });

    it('sets no cookie on any path', async () => {
      // Holding a Contact_GUID must never become an authenticated session.
      const token = await publicToken();
      const responses = [
        await route.POST(post(token, { cg: CG })),
        await route.POST(post(token, { cg: 'nope' })),
        await route.POST(post(token, { cg: CG, action: 'resubscribe' })),
        await route.POST(post(await publicToken('profile'), { cg: CG })),
      ];
      for (const res of responses) {
        expect(res.headers.get('set-cookie')).toBeNull();
      }
    });
  });
  describe('the sealed token path', () => {
    const TOKEN_CG = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

    async function token(
      data: Record<string, unknown> = { contactGuid: TOKEN_CG, publicationId: 7 },
      expirySeconds?: number
    ): Promise<string> {
      return createActionToken('unsubscribe', data, expirySeconds);
    }

    it('a valid t wins over a cg sent alongside it', async () => {
      const res = await route.POST(
        post(await publicToken(), { cg: CG, pubid: 4, token: await token() })
      );
      expect(res.status).toBe(200);
      // The token is the narrower capability, so it decides both the contact
      // and the publication — a tampered `pubid` in the URL cannot widen it.
      expect(mockUnsubscribe).toHaveBeenCalledWith({
        contactGuid: TOKEN_CG,
        publicationId: 7,
      });
      expect(await res.json()).toMatchObject({ scope: 'publication', publicationId: 7 });
    });

    it('a token carrying no publication takes the bulk path', async () => {
      const res = await route.POST(
        post(await publicToken(), { pubid: 4, token: await token({ contactGuid: TOKEN_CG }) })
      );
      expect(res.status).toBe(200);
      expect(mockUnsubscribe).toHaveBeenCalledWith({
        contactGuid: TOKEN_CG,
        publicationId: null,
      });
    });

    it('a token carrying publicationId 0 takes the bulk path', async () => {
      await route.POST(
        post(await publicToken(), {
          token: await token({ contactGuid: TOKEN_CG, publicationId: 0 }),
        })
      );
      expect(mockUnsubscribe).toHaveBeenCalledWith({
        contactGuid: TOKEN_CG,
        publicationId: null,
      });
    });

    it('an expired t falls back to the cg beside it', async () => {
      // This fallback is why there are two paths at all: `cg` never expires,
      // and a recipient digging up a six-month-old email must still get out.
      const res = await route.POST(
        post(await publicToken(), { cg: CG, pubid: 4, token: await token(undefined, -60) })
      );
      expect(res.status).toBe(200);
      expect(mockUnsubscribe).toHaveBeenCalledWith({ contactGuid: CG, publicationId: 4 });
    });

    it('a tampered t falls back to the cg beside it', async () => {
      const tampered = `${await token()}x`;
      const res = await route.POST(
        post(await publicToken(), { cg: CG, token: tampered })
      );
      expect(res.status).toBe(200);
      expect(mockUnsubscribe).toHaveBeenCalledWith({ contactGuid: CG, publicationId: null });
    });

    it('link_expired (422) for an expired t with no cg', async () => {
      const res = await route.POST(
        post(await publicToken(), { token: await token(undefined, -60) })
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        error: 'link_expired',
        message: expect.any(String),
      });
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('link_expired (422) for a tampered t with no cg', async () => {
      const res = await route.POST(post(await publicToken(), { token: 'not.a.jwt' }));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('link_expired');
    });

    it('link_expired (422) when the t is minted for another flow', async () => {
      // The cross-`typ` guard. Without it, a token handed out to confirm an
      // email address would be replayable here and every flow's tokens would
      // become capability for every other flow.
      const wrongTyp = await createActionToken('pyv-verify', {
        contactGuid: TOKEN_CG,
        publicationId: 7,
      });
      const res = await route.POST(post(await publicToken(), { token: wrongTyp }));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('link_expired');
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('does not distinguish wrong-type from expired', async () => {
      // Saying "that token belongs to another flow" tells the bearer what else
      // they hold.
      const wrongTyp = await createActionToken('pyv-verify', { contactGuid: TOKEN_CG });
      const expired = await token(undefined, -60);

      const a = await route.POST(post(await publicToken(), { token: wrongTyp }));
      const b = await route.POST(post(await publicToken(), { token: expired }));

      expect(a.status).toBe(b.status);
      expect(await a.json()).toEqual(await b.json());
    });

    it('rejects a token whose payload GUID is not GUID-shaped', async () => {
      const bad = await createActionToken('unsubscribe', { contactGuid: "' OR 1=1 --" });
      const res = await route.POST(post(await publicToken(), { token: bad }));
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('link_expired');
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('a token payload cannot override its own typ', async () => {
      // `createActionToken` spreads the caller's data and then writes `typ`, so
      // a payload key called `typ` cannot smuggle a different flow through.
      const sneaky = await createActionToken('pyv-verify', {
        contactGuid: TOKEN_CG,
        typ: 'unsubscribe',
      });
      const res = await route.POST(post(await publicToken(), { token: sneaky }));
      expect(res.status).toBe(422);
      expect(mockUnsubscribe).not.toHaveBeenCalled();
    });

    it('meters the token, not the cg, in the per-capability bucket', async () => {
      const t = await token();
      const auth = await publicToken();
      for (let i = 0; i < 5; i++) {
        expect((await route.POST(post(auth, { token: t }))).status).toBe(200);
      }
      expect((await route.POST(post(auth, { token: t }))).status).toBe(429);
      // The same IP still has budget, and a bare `cg` hashes to a different
      // bucket, so it is not caught by the token's exhausted one.
      expect((await route.POST(post(auth, { cg: CG }))).status).toBe(200);
    });

    it('replays the token for the undo', async () => {
      const t = await token();
      const res = await route.POST(
        post(await publicToken(), { token: t, action: 'resubscribe' })
      );
      expect(res.status).toBe(200);
      expect(mockResubscribe).toHaveBeenCalledWith({
        contactGuid: TOKEN_CG,
        publicationId: 7,
      });
    });
  });
});
