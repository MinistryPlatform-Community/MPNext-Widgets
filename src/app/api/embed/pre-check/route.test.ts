import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';

/**
 * `GET /api/embed/pre-check`.
 *
 * The assertion that carries this file is the first one: **a `public` subject
 * is refused.** Every other Tier 1 widget in this batch is anonymous-write and
 * rides `withAnonymousWrite`, which accepts `sub === "public"` by design. This
 * route reads a named household's attendance, so it must not — and the way that
 * protection would realistically be lost is someone "harmonising" it with its
 * three siblings.
 *
 * Second: the household id is **never** read from the request. There is a test
 * below that passes `?householdId=`, `?contactId=` and `?participantId=` and
 * asserts the service was still called with the session's household.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const mockExecuteProcedure = vi.fn();
const mockGetProcedures = vi.fn();
const mockGetTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    executeProcedure = mockExecuteProcedure;
    getProcedures = mockGetProcedures;
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
  const headers: Record<string, string> = { Origin: ORIGIN, 'x-forwarded-for': '198.51.100.9' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return new NextRequest(`http://localhost:3000/api/embed/pre-check${query}`, {
    method: 'GET',
    headers,
  });
}

const PROC_ROWS = [
  {
    Contact_ID: 9,
    Participant_Record: 4,
    Display_Name: 'Check-me-in, Daddy ',
    Event_ID: 2,
    Event_Title: 'Sample Check-in1',
    Event_Start_Date: '2018-06-12T17:00:00',
    Group_Participant_ID: 17,
    Group_ID: 2,
    Group_Name: 'Babies (Sample)',
    Role_Title: 'Group Leader',
    Event_Participant_ID: null,
    Participation_Status_ID: null,
  },
  {
    Contact_ID: 12,
    Participant_Record: 6,
    Display_Name: 'Check-me-in, FemaleChild ',
    Event_ID: 2,
    Event_Title: 'Sample Check-in1',
    Event_Start_Date: '2018-06-12T17:00:00',
    Group_Participant_ID: 15,
    Group_ID: 2,
    Group_Name: 'Babies (Sample)',
    Role_Title: 'Group Member',
    Event_Participant_ID: null,
    Participation_Status_ID: null,
  },
];

describe('GET /api/embed/pre-check', () => {
  beforeEach(async () => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockGetProcedures.mockResolvedValue([{ Name: 'api_MPPW_GetPreCheckEvents' }]);
    mockExecuteProcedure.mockResolvedValue([PROC_ROWS]);
    mockResolveUser.mockResolvedValue({
      userId: 771,
      contactId: 9,
      householdId: 5,
      isHeadOfHousehold: true,
    });

    // The service memoises its `/procs` answer on a module singleton, so a
    // test that wants the probe to run must clear it.
    const { PreCheckService } = await import('@/services/preCheckService');
    const svc = await PreCheckService.getInstance();
    (svc as unknown as { available: boolean | undefined }).available = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports GET, POST and OPTIONS only', () => {
    // A stray non-handler export from a `route.ts` is a Next.js build error,
    // and it is an easy one to add by accident when extracting a helper.
    expect(Object.keys(route).sort()).toEqual(['GET', 'OPTIONS', 'POST']);
  });

  it('answers the preflight with CORS headers', async () => {
    const res = await route.OPTIONS(get(null));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  // ── Auth ──

  it('refuses a public subject with auth_required', async () => {
    // THE test in this file. `withAnonymousWrite` would have allowed this, and
    // this route reads a household's attendance.
    const res = await route.GET(get(await token('public')));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'auth_required' });
    expect(mockExecuteProcedure).not.toHaveBeenCalled();
  });

  it('refuses a missing token with auth_required', async () => {
    const res = await route.GET(get(null));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'auth_required' });
  });

  it('refuses a token minted for another widget', async () => {
    const res = await route.GET(get(await token(USER_GUID, 'event-finder')));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'auth_required' });
    expect(mockExecuteProcedure).not.toHaveBeenCalled();
  });

  // ── Input ──

  it('rejects a non YYYY-MM-DD eventDate with invalid_request', async () => {
    for (const bad of [
      '2025-05-18T00:00:00Z',
      '2025-5-18',
      '18/05/2025',
      'today',
      '2025-05-18 00:00:00',
    ]) {
      const res = await route.GET(get(await token(), `?eventDate=${encodeURIComponent(bad)}`));
      expect(res.status, bad).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: 'invalid_request' });
    }
    expect(mockExecuteProcedure).not.toHaveBeenCalled();
  });

  it('defaults the date server-side, in the domain zone, when none is given', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-19T02:30:00Z'));
    try {
      const res = await route.GET(get(await token()));
      expect(res.status).toBe(200);
      // Still 2025-05-18 in New York. The browser never gets a say.
      await expect(res.json()).resolves.toMatchObject({ eventDate: '2025-05-18' });
      expect(mockExecuteProcedure).toHaveBeenCalledWith('api_MPPW_GetPreCheckEvents', {
        '@HouseholdID': 5,
        '@EventDate': '2025-05-18',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the requested date through as a bare wall-clock string', async () => {
    await route.GET(get(await token(), '?eventDate=2018-06-12'));
    expect(mockExecuteProcedure).toHaveBeenCalledWith('api_MPPW_GetPreCheckEvents', {
      '@HouseholdID': 5,
      '@EventDate': '2018-06-12',
    });
  });

  // ── Household resolution ──

  it('answers household_not_found when the account has no household', async () => {
    mockResolveUser.mockResolvedValue({ userId: 771, contactId: 9, householdId: null, isHeadOfHousehold: false });
    const res = await route.GET(get(await token()));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'household_not_found' });
    expect(mockExecuteProcedure).not.toHaveBeenCalled();
  });

  it('answers household_not_found when there is no dp_Users row', async () => {
    mockResolveUser.mockResolvedValue(null);
    const res = await route.GET(get(await token()));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'household_not_found' });
  });

  it('ignores every household-ish query parameter a caller supplies', async () => {
    // The authorisation invariant, stated as a test: identity comes from the
    // JWT and from nowhere else.
    await route.GET(
      get(await token(), '?eventDate=2018-06-12&householdId=999&contactId=999&participantId=999')
    );

    expect(mockResolveUser).toHaveBeenCalledWith(USER_GUID);
    expect(mockExecuteProcedure).toHaveBeenCalledWith('api_MPPW_GetPreCheckEvents', {
      '@HouseholdID': 5,
      '@EventDate': '2018-06-12',
    });
  });

  // ── Happy path ──

  it('groups rows by member and reports the domain time zone', async () => {
    const res = await route.GET(get(await token(), '?eventDate=2018-06-12'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.eventDate).toBe('2018-06-12');
    expect(body.timeZone).toBe('America/New_York');
    expect(body.householdId).toBe(5);
    expect(body.members).toHaveLength(2);
    expect(body.members[0]).toMatchObject({
      contactId: 9,
      participantName: 'Check-me-in, Daddy',
    });
    expect(body.members[0].rows[0]).toMatchObject({
      rowKey: '9|4|2|0|2|17',
      eventName: 'Sample Check-in1',
      eventStart: '2018-06-12T17:00:00',
      isRegistered: false,
      isLocked: false,
    });
  });

  it('answers 200 with no members for a day that has no check-in events', async () => {
    // Not an error: a Tuesday has no Sunday classes, and MP's own
    // `Search_Results = 3` rule legitimately hides a whole household.
    mockExecuteProcedure.mockResolvedValue([[]]);
    const res = await route.GET(get(await token(), '?eventDate=2025-05-20'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ members: [] });
  });

  // ── Degraded domains and failures ──

  it('answers precheck_unavailable when the proc is not installed', async () => {
    mockGetProcedures.mockResolvedValue([]);
    const res = await route.GET(get(await token()));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'precheck_unavailable' });
    expect(mockExecuteProcedure).not.toHaveBeenCalled();
  });

  it('answers 500 internal_error — never 502 — when MP fails', async () => {
    mockExecuteProcedure.mockRejectedValue(new Error('MP exploded'));
    const res = await route.GET(get(await token(), '?eventDate=2018-06-12'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: 'internal_error' });
  });

  it('never leaks MP error text to the caller', async () => {
    mockExecuteProcedure.mockRejectedValue(new Error('Invalid column name Household_Secret'));
    const res = await route.GET(get(await token(), '?eventDate=2018-06-12'));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('Household_Secret');
  });

  it('answers every failure as { error, message } with a snake_case code', async () => {
    const cases = [
      get(await token('public')),
      get(await token(), '?eventDate=nope'),
    ];
    for (const req of cases) {
      const res = await route.GET(req);
      const body = await res.json();
      expect(typeof body.error).toBe('string');
      expect(body.error).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
    }
  });
});

/**
 * `POST /api/embed/pre-check`.
 *
 * The service owns the authorisation decision and
 * `preCheckService.save.test.ts` proves it. What this block covers is the
 * request envelope the route is responsible for: that the public subject is
 * refused **before** any MP call, that a rejected selection writes nothing and
 * answers `403 invalid_pre_check_selection`, that the date window closes the
 * "walk the calendar backwards writing Cancelled" shape, and that the limiter
 * is keyed per user and fails closed because this endpoint writes.
 */
describe('POST /api/embed/pre-check', () => {
  const mockCreateTableRecords = vi.fn();
  const mockUpdateTableRecords = vi.fn();

  function post(tok: string | null, body: unknown, ip = '198.51.100.9'): NextRequest {
    const headers: Record<string, string> = {
      Origin: ORIGIN,
      'x-forwarded-for': ip,
      'Content-Type': 'application/json',
    };
    if (tok) headers.Authorization = `Bearer ${tok}`;
    return new NextRequest('http://localhost:3000/api/embed/pre-check', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  const wrote = () =>
    mockCreateTableRecords.mock.calls.length > 0 ||
    mockUpdateTableRecords.mock.calls.length > 0;

  beforeEach(async () => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockGetProcedures.mockResolvedValue([{ Name: 'api_MPPW_GetPreCheckEvents' }]);
    mockExecuteProcedure.mockResolvedValue([PROC_ROWS]);
    mockCreateTableRecords.mockResolvedValue([{ Participant_ID: 99 }]);
    mockUpdateTableRecords.mockResolvedValue([]);
    mockResolveUser.mockResolvedValue({
      userId: 771,
      contactId: 9,
      householdId: 5,
      isHeadOfHousehold: true,
    });

    const { PreCheckService } = await import('@/services/preCheckService');
    const svc = await PreCheckService.getInstance();
    (svc as unknown as { available: boolean | undefined }).available = true;
    // Point the singleton's MPHelper at this block's write spies.
    (svc as unknown as { mp: Record<string, unknown> }).mp = {
      getTableRecords: mockGetTableRecords,
      executeProcedure: mockExecuteProcedure,
      getProcedures: mockGetProcedures,
      createTableRecords: mockCreateTableRecords,
      updateTableRecords: mockUpdateTableRecords,
    };

    // The fixture day is "today" for the window check.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2018-06-12T15:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Auth ──

  it('refuses a public subject with auth_required, before any MP call', async () => {
    const res = await route.POST(
      post(await token('public'), { eventDate: '2018-06-12', selected: [] })
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'auth_required' });
    expect(mockExecuteProcedure).not.toHaveBeenCalled();
    expect(wrote()).toBe(false);
  });

  it('refuses a missing token', async () => {
    const res = await route.POST(post(null, { eventDate: '2018-06-12', selected: [] }));
    expect(res.status).toBe(401);
    expect(wrote()).toBe(false);
  });

  it('refuses a token minted for another widget', async () => {
    const res = await route.POST(
      post(await token(USER_GUID, 'my-household'), { eventDate: '2018-06-12', selected: [] })
    );
    expect(res.status).toBe(401);
    expect(wrote()).toBe(false);
  });

  // ── Body shape ──

  it('rejects a malformed body with validation_failed', async () => {
    for (const bad of [
      { selected: [] },
      { eventDate: '2018-06-12', selected: 'nope' },
      { eventDate: 'today', selected: [] },
      { eventDate: '2018-06-12', selected: [123] },
    ]) {
      const res = await route.POST(post(await token(), bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: 'validation_failed' });
    }
    expect(wrote()).toBe(false);
  });

  it('rejects unparseable JSON with validation_failed', async () => {
    const res = await route.POST(post(await token(), '{not json'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'validation_failed' });
    expect(wrote()).toBe(false);
  });

  it('caps the selection list at 500 entries', async () => {
    const selected = Array.from({ length: 501 }, (_, i) => `9|4|2|0|2|${i}`);
    const res = await route.POST(post(await token(), { eventDate: '2018-06-12', selected }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'validation_failed' });
    expect(wrote()).toBe(false);
  });

  it('accepts a body carrying only eventDate and selected — no ids', async () => {
    const res = await route.POST(
      post(await token(), { eventDate: '2018-06-12', selected: ['9|4|2|0|2|17'] })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ registered: 1, cancelled: 0, locked: [] });
  });

  it('ignores extra body fields a caller bolts on', async () => {
    // The Zod schema strips them, so nothing downstream can see a
    // `householdId` even when one is posted.
    const res = await route.POST(
      post(await token(), {
        eventDate: '2018-06-12',
        selected: [],
        householdId: 999,
        contactId: 999,
        userId: 999,
      })
    );
    expect(res.status).toBe(200);
    expect(mockExecuteProcedure).toHaveBeenCalledWith('api_MPPW_GetPreCheckEvents', {
      '@HouseholdID': 5,
      '@EventDate': '2018-06-12',
    });
  });

  // ── The selection guard ──

  it('answers 403 invalid_pre_check_selection with NO MP write', async () => {
    const res = await route.POST(
      post(await token(), { eventDate: '2018-06-12', selected: ['4242|4243|2|0|2|17'] })
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_pre_check_selection',
    });
    expect(wrote()).toBe(false);
  });

  it('does not echo the rejected keys', async () => {
    const res = await route.POST(
      post(await token(), { eventDate: '2018-06-12', selected: ['4242|4243|2|0|2|17'] })
    );
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('4242');
  });

  // ── The window ──

  it('answers 409 pre_check_closed for a date too far in the past', async () => {
    const res = await route.POST(
      post(await token(), { eventDate: '2017-01-01', selected: [] })
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'pre_check_closed' });
    expect(wrote()).toBe(false);
  });

  it('answers 409 pre_check_closed for a date too far ahead', async () => {
    const res = await route.POST(
      post(await token(), { eventDate: '2019-01-01', selected: [] })
    );
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'pre_check_closed' });
  });

  it('accepts yesterday and 90 days ahead, the window edges', async () => {
    for (const date of ['2018-06-11', '2018-09-10']) {
      const res = await route.POST(post(await token(), { eventDate: date, selected: [] }));
      expect(res.status, date).toBe(200);
    }
  });

  it('rejects two days back and 91 days ahead', async () => {
    for (const date of ['2018-06-10', '2018-09-11']) {
      const res = await route.POST(post(await token(), { eventDate: date, selected: [] }));
      expect(res.status, date).toBe(409);
    }
  });

  it('measures the window against the domain zone, not the server', async () => {
    // 2018-06-13T02:30Z is still 2018-06-12 in New York, so 2018-06-11 is
    // still "yesterday" and inside the window.
    vi.setSystemTime(new Date('2018-06-13T02:30:00Z'));
    const res = await route.POST(
      post(await token(), { eventDate: '2018-06-11', selected: [] })
    );
    expect(res.status).toBe(200);
  });

  // ── Household ──

  it('answers household_not_found when the account has no household', async () => {
    mockResolveUser.mockResolvedValue({
      userId: 771,
      contactId: 9,
      householdId: null,
      isHeadOfHousehold: false,
    });
    const res = await route.POST(
      post(await token(), { eventDate: '2018-06-12', selected: [] })
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'household_not_found' });
    expect(wrote()).toBe(false);
  });

  // ── Rate limiting ──

  it('answers 429 past 20 saves in the window, keyed per user', async () => {
    const tok = await token();
    for (let i = 0; i < 20; i++) {
      const res = await route.POST(post(tok, { eventDate: '2018-06-12', selected: [] }));
      expect(res.status, `call ${i}`).toBe(200);
    }
    const res = await route.POST(post(tok, { eventDate: '2018-06-12', selected: [] }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ error: 'rate_limited' });
  });

  it('does not throttle a different user sharing the same IP', async () => {
    // A household shares one IP with itself: an IP bucket would throttle a
    // family of five faster than a family of one.
    const a = await token();
    for (let i = 0; i < 20; i++) {
      await route.POST(post(a, { eventDate: '2018-06-12', selected: [] }));
    }
    expect(
      (await route.POST(post(a, { eventDate: '2018-06-12', selected: [] }))).status
    ).toBe(429);

    const b = await token('99999999-2222-3333-4444-555555555555');
    const res = await route.POST(post(b, { eventDate: '2018-06-12', selected: [] }));
    expect(res.status).toBe(200);
  });

  // ── Degraded domain and failures ──

  it('answers precheck_unavailable when the proc is not installed', async () => {
    const { PreCheckService } = await import('@/services/preCheckService');
    const svc = await PreCheckService.getInstance();
    (svc as unknown as { available: boolean | undefined }).available = false;

    const res = await route.POST(
      post(await token(), { eventDate: '2018-06-12', selected: [] })
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'precheck_unavailable' });
    expect(wrote()).toBe(false);
  });

  it('answers 500 save_failed — never 502 — when MP refuses the write', async () => {
    mockCreateTableRecords.mockRejectedValue(new Error('MP write exploded'));
    const res = await route.POST(
      post(await token(), { eventDate: '2018-06-12', selected: ['9|4|2|0|2|17'] })
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: 'save_failed' });
  });

  it('never leaks MP error text to the caller', async () => {
    mockCreateTableRecords.mockRejectedValue(new Error('Invalid column Household_Secret'));
    const res = await route.POST(
      post(await token(), { eventDate: '2018-06-12', selected: ['9|4|2|0|2|17'] })
    );
    expect(JSON.stringify(await res.json())).not.toContain('Household_Secret');
  });

  it('answers every failure as { error, message } with a snake_case code', async () => {
    const cases: NextRequest[] = [
      post(await token('public'), { eventDate: '2018-06-12', selected: [] }),
      post(await token(), { eventDate: 'nope', selected: [] }),
      post(await token(), { eventDate: '2017-01-01', selected: [] }),
      post(await token(), { eventDate: '2018-06-12', selected: ['4242|1|2|0|0|0'] }),
    ];
    for (const req of cases) {
      const res = await route.POST(req);
      const body = await res.json();
      expect(body.error).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
    }
  });
});
