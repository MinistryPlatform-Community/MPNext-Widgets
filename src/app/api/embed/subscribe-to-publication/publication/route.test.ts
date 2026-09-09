import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';

/**
 * `GET /api/embed/subscribe-to-publication/publication`.
 *
 * Two assertions carry the file. A publication that is not `Available_Online`
 * must be indistinguishable from one that does not exist, or the id space
 * becomes probeable for a church's internal mailing lists — and the response
 * must not carry `Congregation_ID`, which the service reads but the widget has
 * no use for.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const mockGetTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = vi.fn();
    updateTableRecords = vi.fn();
  },
}));

const ORIGIN = 'https://allowed.example.com';

async function publicToken(wid = 'subscribe-to-publication'): Promise<string> {
  return createWidgetToken({ sub: 'public', wid, origin: ORIGIN });
}

function get(token: string | null, query: string, ip = '198.51.100.7'): NextRequest {
  const headers: Record<string, string> = { Origin: ORIGIN, 'x-forwarded-for': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new NextRequest(
    `http://localhost:3000/api/embed/subscribe-to-publication/publication${query}`,
    { method: 'GET', headers }
  );
}

const ONLINE_ROW = {
  Publication_ID: 4,
  Title: 'Weekly Newsletter',
  Description: 'Church news every Thursday',
  Congregation_ID: 7,
};

describe('GET /api/embed/subscribe-to-publication/publication', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports GET and OPTIONS only', () => {
    // No POST here: the two write hops are separate routes with their own
    // limits and their own fail-closed posture.
    expect(Object.keys(route).sort()).toEqual(['GET', 'OPTIONS']);
  });

  it('answers the preflight with CORS headers', async () => {
    const res = await route.OPTIONS(
      new NextRequest(
        'http://localhost:3000/api/embed/subscribe-to-publication/publication',
        { method: 'OPTIONS', headers: { Origin: ORIGIN } }
      )
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('accepts a widget token whose subject is "public"', async () => {
    mockGetTableRecords.mockResolvedValueOnce([ONLINE_ROW]);
    const res = await route.GET(get(await publicToken(), '?publicationId=4'));
    expect(res.status).toBe(200);
  });

  it('rejects a request with no token, without saying why', async () => {
    const res = await route.GET(get(null, '?publicationId=4'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('auth_required');
    // "bad token" / "wrong origin" / "wrong widget" must be indistinguishable,
    // so the message is the same fixed sentence whatever the cause.
    expect(body.message).toBe('A valid widget token is required.');
  });

  it('returns the title and description', async () => {
    mockGetTableRecords.mockResolvedValueOnce([ONLINE_ROW]);
    const res = await route.GET(get(await publicToken(), '?publicationId=4'));

    expect(await res.json()).toEqual({
      publication: {
        Publication_ID: 4,
        Title: 'Weekly Newsletter',
        Description: 'Church news every Thursday',
      },
    });
  });

  it('does not return Congregation_ID', async () => {
    mockGetTableRecords.mockResolvedValueOnce([ONLINE_ROW]);
    const res = await route.GET(get(await publicToken(), '?publicationId=4'));
    const body = await res.json();
    expect(body.publication).not.toHaveProperty('Congregation_ID');
  });

  it('requires Available_Online in the MP filter', async () => {
    mockGetTableRecords.mockResolvedValueOnce([ONLINE_ROW]);
    await route.GET(get(await publicToken(), '?publicationId=4'));
    expect(mockGetTableRecords.mock.calls[0][0].filter).toBe(
      'Publication_ID = 4 AND Available_Online = 1'
    );
  });

  it('answers a non-online publication exactly like one that does not exist', async () => {
    // The flag is in the filter, so MP returns no row for either — but the
    // assertion is on the *serialised response*, because that is what a prober
    // can see.
    mockGetTableRecords.mockResolvedValue([]);

    const notOnline = await route.GET(get(await publicToken(), '?publicationId=1'));
    const missing = await route.GET(get(await publicToken(), '?publicationId=9999'));

    expect(notOnline.status).toBe(missing.status);
    expect(notOnline.status).toBe(404);
    expect(await notOnline.text()).toBe(await missing.text());
    expect((await route.GET(get(await publicToken(), '?publicationId=1')).then((r) => r.json())).error).toBe(
      'publication_not_found'
    );
  });

  it('rejects a missing, non-numeric or non-positive id before touching MP', async () => {
    for (const query of ['', '?publicationId=', '?publicationId=abc', '?publicationId=0', '?publicationId=-4']) {
      const res = await route.GET(get(await publicToken(), query));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_request');
    }
    expect(mockGetTableRecords).not.toHaveBeenCalled();
  });

  it('answers internal_error without echoing MP error text', async () => {
    mockGetTableRecords.mockRejectedValueOnce(new Error('MP said: login failed for user sa'));
    const res = await route.GET(get(await publicToken(), '?publicationId=4'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('login failed');
    expect(body.message).toBe('Internal server error');
  });

  it('sets no Cache-Control, so a withdrawn publication is not served from a cache', async () => {
    // `Available_Online` can be turned off at any moment, and a shared cache
    // serving a stale "yes, this is online" is the one caching failure that
    // matters on this route.
    mockGetTableRecords.mockResolvedValueOnce([ONLINE_ROW]);
    const res = await route.GET(get(await publicToken(), '?publicationId=4'));
    expect(res.headers.get('cache-control')).toBeNull();
  });
});
