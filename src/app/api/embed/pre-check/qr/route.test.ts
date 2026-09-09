import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';

/**
 * `GET /api/embed/pre-check/qr`.
 *
 * Two assertions carry this file:
 *
 *   - **the household id cannot be overridden by a query parameter.** The
 *     payload names a household, so an endpoint that minted one for an
 *     arbitrary id would be a household-enumeration oracle wearing a picture.
 *   - **the payload matches legacy byte for byte**, including the culture-
 *     dependent short date `.ToShortDateString()` produced on MP's own en-US
 *     servers. A scanner reading `18/05/2025` reads a different code.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const mockGetTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    executeProcedure = vi.fn();
    getProcedures = vi.fn();
    createTableRecords = vi.fn();
    updateTableRecords = vi.fn();
  },
}));

vi.mock('@/services/domainTimezoneService', () => ({
  DomainTimezoneService: {
    getInstance: () => ({
      getMpTimezone: async () => 'America/New_York',
      toMpSqlDatetime: async (v: Date | string) =>
        new Date(v).toISOString().replace('T', ' ').slice(0, 19),
    }),
  },
}));

const mockResolveUser = vi.fn();

vi.mock('@/services/householdService', () => ({
  HouseholdService: {
    getInstance: async () => ({ resolveUser: mockResolveUser }),
  },
}));

const ORIGIN = 'https://allowed.example.com';
const USER_GUID = '11111111-2222-3333-4444-555555555555';

async function token(sub = USER_GUID, wid = 'pre-check'): Promise<string> {
  return createWidgetToken({ sub, wid, origin: ORIGIN });
}

function get(tok: string | null, query = ''): NextRequest {
  const headers: Record<string, string> = {
    Origin: ORIGIN,
    'x-forwarded-for': '198.51.100.11',
  };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return new NextRequest(`http://localhost:3000/api/embed/pre-check/qr${query}`, {
    method: 'GET',
    headers,
  });
}

describe('GET /api/embed/pre-check/qr', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockResolveUser.mockResolvedValue({
      userId: 771,
      contactId: 9,
      householdId: 5,
      isHeadOfHousehold: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports GET and OPTIONS only', () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'OPTIONS']);
  });

  it('answers the preflight with CORS headers', async () => {
    const res = await route.OPTIONS(get(null));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  // ── Auth ──

  it('refuses a public subject', async () => {
    const res = await route.GET(get(await token('public')));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'auth_required' });
    expect(mockResolveUser).not.toHaveBeenCalled();
  });

  it('refuses a missing token', async () => {
    const res = await route.GET(get(null));
    expect(res.status).toBe(401);
  });

  it('refuses a token minted for another widget', async () => {
    const res = await route.GET(get(await token(USER_GUID, 'my-household')));
    expect(res.status).toBe(401);
  });

  // ── The household id ──

  it('takes the household from the session, not from a query parameter', async () => {
    // THE test in this file. A caller who could name the household would have a
    // working enumeration oracle.
    const res = await route.GET(
      get(await token(), '?eventDate=2025-05-18&householdId=4242&household=4242')
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.payload).toBe('pre|5/18/2025|5');
    expect(body.payload).not.toContain('4242');
    expect(mockResolveUser).toHaveBeenCalledWith(USER_GUID);
  });

  it('answers household_not_found when the account has no household', async () => {
    mockResolveUser.mockResolvedValue({
      userId: 771,
      contactId: 9,
      householdId: null,
      isHeadOfHousehold: false,
    });
    const res = await route.GET(get(await token(), '?eventDate=2025-05-18'));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'household_not_found' });
  });

  // ── The payload ──

  it('matches the legacy format byte for byte', async () => {
    // `EventsApiController.cs:216`:
    //   $"pre|{eventDate.ToShortDateString()}|{currentUserHouseholdId}"
    // en-US `M/d/yyyy`, no leading zeros.
    const res = await route.GET(get(await token(), '?eventDate=2025-05-18'));
    await expect(res.json()).resolves.toMatchObject({ payload: 'pre|5/18/2025|5' });
  });

  it('strips leading zeros from month and day', async () => {
    for (const [date, expected] of [
      ['2025-11-05', 'pre|11/5/2025|5'],
      ['2025-01-01', 'pre|1/1/2025|5'],
      ['2025-12-31', 'pre|12/31/2025|5'],
      ['2025-05-18', 'pre|5/18/2025|5'],
    ] as const) {
      const res = await route.GET(get(await token(), `?eventDate=${date}`));
      await expect(res.json(), date).resolves.toMatchObject({ payload: expected });
    }
  });

  // ── The date ──

  it('rejects a non YYYY-MM-DD eventDate', async () => {
    for (const bad of ['2025-5-18', '18/05/2025', '2025-05-18T00:00:00Z', 'today']) {
      const res = await route.GET(get(await token(), `?eventDate=${encodeURIComponent(bad)}`));
      expect(res.status, bad).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: 'invalid_request' });
    }
  });

  it('defaults to the domain-zone today when no date is given', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-19T02:30:00Z'));
    try {
      const res = await route.GET(get(await token()));
      const body = await res.json();
      // Still 2025-05-18 in New York.
      expect(body.eventDate).toBe('2025-05-18');
      expect(body.payload).toBe('pre|5/18/2025|5');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── The SVG ──

  it('returns a single-root SVG in JSON, not an image response', async () => {
    // `<img src>` cannot carry a Bearer header, so an image response would
    // force a blob URL and its revoke lifecycle.
    const res = await route.GET(get(await token(), '?eventDate=2025-05-18'));
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body.svg.startsWith('<svg ')).toBe(true);
    expect(body.svg.endsWith('</svg>')).toBe(true);
    expect(body.svg).not.toContain('<script');
  });

  it('echoes the date it encoded', async () => {
    const res = await route.GET(get(await token(), '?eventDate=2025-05-18'));
    await expect(res.json()).resolves.toMatchObject({ eventDate: '2025-05-18' });
  });

  it('is deterministic for the same household and date', async () => {
    const a = await (await route.GET(get(await token(), '?eventDate=2025-05-18'))).json();
    const b = await (await route.GET(get(await token(), '?eventDate=2025-05-18'))).json();
    expect(a.svg).toBe(b.svg);
  });

  it('does not cache the response', async () => {
    // A shared cache serving one family's code to another is the caching
    // failure that matters here.
    const res = await route.GET(get(await token(), '?eventDate=2025-05-18'));
    expect(res.headers.get('cache-control')).toBeNull();
  });

  // ── Failures ──

  it('answers 500 internal_error — never 502 — when the household read fails', async () => {
    mockResolveUser.mockRejectedValue(new Error('MP exploded'));
    const res = await route.GET(get(await token(), '?eventDate=2025-05-18'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: 'internal_error' });
  });

  it('never leaks MP error text', async () => {
    mockResolveUser.mockRejectedValue(new Error('Invalid column Household_Secret'));
    const res = await route.GET(get(await token(), '?eventDate=2025-05-18'));
    expect(JSON.stringify(await res.json())).not.toContain('Household_Secret');
  });

  it('answers every failure as { error, message } with a snake_case code', async () => {
    const cases = [get(await token('public')), get(await token(), '?eventDate=nope')];
    for (const req of cases) {
      const body = await (await route.GET(req)).json();
      expect(body.error).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
    }
  });
});
