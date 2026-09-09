import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  withAnonymousWrite,
  isReturnUrlAllowed,
  buildReturnUrl,
  errorResponse,
  type AnonymousWriteContext,
} from './anonymous-write';
import { __resetSessionStoreForTests } from './session-store';
import * as auth from './auth';
import type { WidgetClaims } from './types';

const ORIGIN = 'https://church.example';

const PUBLIC_CLAIMS = {
  sub: 'public',
  origin: ORIGIN,
  widget: 'prayer-feedback',
  ver: 2,
} as unknown as WidgetClaims;

function makeRequest(method = 'POST', origin = ORIGIN): NextRequest {
  return new NextRequest('https://widgets.example/api/embed/prayer-feedback/submit', {
    method,
    headers: { origin, authorization: 'Bearer token' },
  });
}

/** A handler that records that it ran and returns 200. */
function okHandler() {
  return vi.fn(async ({ cors }: AnonymousWriteContext) =>
    NextResponse.json({ status: 'ok' }, { status: 200, headers: cors })
  );
}

describe('withAnonymousWrite', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.spyOn(auth, 'requireWidgetAuth').mockResolvedValue(PUBLIC_CLAIMS);
    vi.spyOn(auth, 'getCorsHeaders').mockReturnValue({ 'access-control-allow-origin': ORIGIN });
    vi.spyOn(auth, 'buildFallbackCorsHeaders').mockReturnValue({});
    vi.spyOn(auth, 'resolveRequestOrigin').mockReturnValue(ORIGIN);
    vi.spyOn(auth, 'getClientIp').mockReturnValue('1.2.3.4');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetSessionStoreForTests();
  });

  it('runs the handler with verified claims and CORS headers', async () => {
    const handler = okHandler();
    const res = await withAnonymousWrite(
      makeRequest(),
      { widget: 'prayer-feedback', limits: [] },
      handler
    );

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      claims: PUBLIC_CLAIMS,
      origin: ORIGIN,
      ip: '1.2.3.4',
    });
  });

  it('accepts a public subject — that is the point', async () => {
    const handler = okHandler();
    await withAnonymousWrite(makeRequest(), { widget: 'prayer-feedback', limits: [] }, handler);

    expect(handler.mock.calls[0][0].claims.sub).toBe('public');
  });

  describe('a widget JWT is still required', () => {
    it('401s when auth fails', async () => {
      vi.spyOn(auth, 'requireWidgetAuth').mockRejectedValue(new Error('Missing Authorization header'));
      const handler = okHandler();

      const res = await withAnonymousWrite(
        makeRequest(),
        { widget: 'prayer-feedback', limits: [] },
        handler
      );

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: 'auth_required',
        message: 'A valid widget token is required.',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not echo why auth failed', async () => {
      // "Origin not allowed" vs "bad signature" vs "wrong widget" is a probe
      // oracle for an unauthenticated caller.
      vi.spyOn(auth, 'requireWidgetAuth').mockRejectedValue(
        new Error('Origin https://evil.example is not allowed for tenant acme')
      );

      const res = await withAnonymousWrite(
        makeRequest(),
        { widget: 'prayer-feedback', limits: [] },
        okHandler()
      );

      const body = JSON.stringify(await res.json());
      expect(body).not.toContain('evil.example');
      expect(body).not.toContain('acme');
    });
  });

  describe('POST only', () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
      it(`rejects ${method}`, async () => {
        const handler = okHandler();
        const res = await withAnonymousWrite(
          makeRequest(method),
          { widget: 'prayer-feedback', limits: [] },
          handler
        );

        expect(res.status).toBe(405);
        expect((await res.json()).error).toBe('method_not_allowed');
        expect(handler).not.toHaveBeenCalled();
      });
    }

    it('checks the method before authenticating', async () => {
      const spy = vi.spyOn(auth, 'requireWidgetAuth');
      await withAnonymousWrite(
        makeRequest('GET'),
        { widget: 'prayer-feedback', limits: [] },
        okHandler()
      );

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('429s once a bucket is exhausted', async () => {
      const handler = okHandler();
      const options = {
        widget: 'prayer-feedback',
        limits: [{ key: 'pf:ip:1.2.3.4', limit: 2 }],
      };

      expect((await withAnonymousWrite(makeRequest(), options, handler)).status).toBe(200);
      expect((await withAnonymousWrite(makeRequest(), options, handler)).status).toBe(200);

      const blocked = await withAnonymousWrite(makeRequest(), options, handler);
      expect(blocked.status).toBe(429);
      expect((await blocked.json()).error).toBe('rate_limited');
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('runs limits before the handler, so before any MP call or email', async () => {
      const handler = okHandler();
      const options = {
        widget: 'prayer-feedback',
        limits: [{ key: 'pf:ip:blocked', limit: 1 }],
      };

      await withAnonymousWrite(makeRequest(), options, handler);
      await withAnonymousWrite(makeRequest(), options, handler);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('reports one code for every bucket, so the limit hit is not an oracle', async () => {
      // Saying "you hit the per-email limit" reveals that the submitted address
      // has been seen before.
      const options = {
        widget: 'prayer-feedback',
        limits: [
          { key: 'pf:ip:1.2.3.4', limit: 100 },
          { key: 'pf:email:hash', limit: 1, windowSeconds: 3600 },
        ],
      };

      await withAnonymousWrite(makeRequest(), options, okHandler());
      const blocked = await withAnonymousWrite(makeRequest(), options, okHandler());

      expect(await blocked.json()).toEqual({ error: 'rate_limited', message: 'Too many requests.' });
    });

    it('supports a per-hour bucket alongside a per-minute one', async () => {
      const options = {
        widget: 'prayer-feedback',
        limits: [
          { key: 'pf:ip:1.2.3.4', limit: 5 },
          { key: 'pf:email:hash', limit: 3, windowSeconds: 3600 },
        ],
      };

      for (let i = 0; i < 3; i++) {
        expect((await withAnonymousWrite(makeRequest(), options, okHandler())).status).toBe(200);
      }
      expect((await withAnonymousWrite(makeRequest(), options, okHandler())).status).toBe(429);
    });

    it('fails closed by default when the store is down', async () => {
      const { getSessionStore } = await import('./session-store');
      vi.spyOn(getSessionStore(), 'incr').mockRejectedValue(new Error('redis down'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const handler = okHandler();

      const res = await withAnonymousWrite(
        makeRequest(),
        { widget: 'prayer-feedback', limits: [{ key: 'pf:ip:1.2.3.4', limit: 5 }] },
        handler
      );

      expect(res.status).toBe(429);
      expect(handler).not.toHaveBeenCalled();
      err.mockRestore();
    });

    it('can be told to fail open for a route that neither writes nor emails', async () => {
      const { getSessionStore } = await import('./session-store');
      vi.spyOn(getSessionStore(), 'incr').mockRejectedValue(new Error('redis down'));
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await withAnonymousWrite(
        makeRequest(),
        {
          widget: 'prayer-feedback',
          limits: [{ key: 'pf:ip:1.2.3.4', limit: 5 }],
          failClosed: false,
        },
        okHandler()
      );

      expect(res.status).toBe(200);
      err.mockRestore();
    });
  });

  it('turns a thrown handler error into an opaque internal_error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await withAnonymousWrite(
      makeRequest(),
      { widget: 'prayer-feedback', limits: [] },
      async () => {
        throw new Error('MP said: Invalid column name Amount_Paid');
      }
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'internal_error', message: 'Internal server error' });
    expect(JSON.stringify(body)).not.toContain('Amount_Paid');
    err.mockRestore();
  });
});

describe('errorResponse', () => {
  it('emits the machine-code envelope every embed route uses', async () => {
    const res = errorResponse('validation_failed', 'Email is required.', 422, {});
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'validation_failed',
      message: 'Email is required.',
    });
  });
});

describe('isReturnUrlAllowed', () => {
  it('accepts a same-origin https URL', () => {
    expect(isReturnUrlAllowed('https://church.example/prayer', ORIGIN)).toBe(true);
    expect(isReturnUrlAllowed('https://church.example/prayer?page=2', ORIGIN)).toBe(true);
  });

  it('rejects a different host — the open-redirect case', () => {
    // The church's own domain sends the mail, so the link inherits its
    // credibility. This is the check that stops that being aimed elsewhere.
    expect(isReturnUrlAllowed('https://evil.example/phish', ORIGIN)).toBe(false);
  });

  it('rejects a subdomain of the allowed origin', () => {
    expect(isReturnUrlAllowed('https://sub.church.example/x', ORIGIN)).toBe(false);
  });

  it('rejects a host that merely starts with the origin host', () => {
    expect(isReturnUrlAllowed('https://church.example.evil.test/x', ORIGIN)).toBe(false);
  });

  it('rejects a different port', () => {
    expect(isReturnUrlAllowed('https://church.example:8443/x', ORIGIN)).toBe(false);
  });

  it('rejects credentials in the URL', () => {
    // `https://church.example@evil.example` is same-origin to nobody's eye but
    // a parser's — and the parser says the host is evil.example.
    expect(isReturnUrlAllowed('https://church.example@evil.example/x', ORIGIN)).toBe(false);
    expect(isReturnUrlAllowed('https://user:pw@church.example/x', ORIGIN)).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isReturnUrlAllowed('javascript:alert(1)', ORIGIN)).toBe(false);
    expect(isReturnUrlAllowed('data:text/html,<script>1</script>', ORIGIN)).toBe(false);
    expect(isReturnUrlAllowed('file:///etc/passwd', ORIGIN)).toBe(false);
  });

  it('rejects plain http on a real host', () => {
    expect(isReturnUrlAllowed('http://church.example/x', 'http://church.example')).toBe(false);
  });

  it('allows http on localhost, so a dev page still works', () => {
    expect(isReturnUrlAllowed('http://localhost:5173/demo.html', 'http://localhost:5173')).toBe(true);
    expect(isReturnUrlAllowed('http://127.0.0.1:3000/x', 'http://127.0.0.1:3000')).toBe(true);
  });

  it('rejects empty or unparseable input', () => {
    expect(isReturnUrlAllowed('', ORIGIN)).toBe(false);
    expect(isReturnUrlAllowed('not a url', ORIGIN)).toBe(false);
    expect(isReturnUrlAllowed('https://church.example/x', '')).toBe(false);
    expect(isReturnUrlAllowed('https://church.example/x', 'null')).toBe(false);
  });
});

describe('buildReturnUrl', () => {
  it('adds the parameter to a bare URL', () => {
    expect(buildReturnUrl('https://church.example/prayer', 'mpp-verify-id', 'abc')).toBe(
      'https://church.example/prayer?mpp-verify-id=abc'
    );
  });

  it('preserves query parameters the host page already had', () => {
    expect(buildReturnUrl('https://church.example/p?page=2', 'token', 'abc')).toBe(
      'https://church.example/p?page=2&token=abc'
    );
  });

  it('encodes the value exactly once', () => {
    // A hand-rolled `?`/`&` chain plus encodeURIComponent double-encodes a JWT
    // often enough to be worth a test.
    const jwt = 'a.b-c_d';
    const out = buildReturnUrl('https://church.example/p', 'token', jwt);
    expect(new URL(out).searchParams.get('token')).toBe(jwt);
  });

  it('replaces rather than duplicates an existing value', () => {
    expect(buildReturnUrl('https://church.example/p?token=old', 'token', 'new')).toBe(
      'https://church.example/p?token=new'
    );
  });

  it('keeps the fragment', () => {
    expect(buildReturnUrl('https://church.example/p#section', 'token', 'abc')).toBe(
      'https://church.example/p?token=abc#section'
    );
  });
});
