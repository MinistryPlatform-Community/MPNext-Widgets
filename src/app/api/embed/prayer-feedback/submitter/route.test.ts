import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { PrayerFeedbackService } from '@/services/prayerFeedbackService';

/**
 * `GET /api/embed/prayer-feedback/submitter` — legacy's "Provide Feedback As".
 *
 * The two properties worth guarding: it never reaches a shared cache (this is
 * per-household data, unlike `/types`), and it answers with a `hasEmail`
 * boolean rather than the household's addresses.
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

vi.mock('@/services/domainTimezoneService', () => ({
  DomainTimezoneService: { getInstance: () => ({ toMpSqlDatetime: async () => '' }) },
}));

const mockGetMembers = vi.fn();

vi.mock('@/services/householdService', () => ({
  HouseholdService: { getInstance: async () => ({ getMembers: mockGetMembers }) },
}));

const ORIGIN = 'https://allowed.example.com';
const GUID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

function get(token: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/prayer-feedback/submitter', {
    method: 'GET',
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
  });
}

describe('GET /api/embed/prayer-feedback/submitter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (PrayerFeedbackService as any).instance = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetMembers.mockResolvedValue([
      { contactId: 100, displayName: 'Smith, Doug', emailAddress: 'doug@example.com' },
      { contactId: 200, displayName: 'Smith, Marie', emailAddress: null },
    ]);
    mockGetTableRecords.mockImplementation(async (args: { table: string }) => {
      if (args.table === 'dp_Users') return [{ Contact_ID: 100 }];
      if (args.table === 'Contacts') {
        return [
          {
            Contact_ID: 100,
            First_Name: 'Doug',
            Last_Name: 'Smith',
            Display_Name: 'Smith, Doug',
            Email_Address: 'doug@example.com',
            Household_ID: 10,
          },
        ];
      }
      return [];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports GET and OPTIONS only', () => {
    expect(Object.keys(route).sort()).toEqual(['GET', 'OPTIONS']);
  });

  it('returns self plus household, with hasEmail rather than addresses', async () => {
    const token = await createWidgetToken({
      sub: GUID,
      wid: 'prayer-feedback',
      origin: ORIGIN,
    });
    const res = await route.GET(get(token));

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      self: { contactId: 100, displayName: 'Smith, Doug', hasEmail: true },
      household: [{ contactId: 200, displayName: 'Smith, Marie', hasEmail: false }],
    });
    // No address anywhere in the payload: the widget's only question is whether
    // to show the email field.
    expect(body).not.toContain('@');
  });

  it('never lets the response into a shared cache', async () => {
    const token = await createWidgetToken({
      sub: GUID,
      wid: 'prayer-feedback',
      origin: ORIGIN,
    });
    const res = await route.GET(get(token));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('refuses a public token — there is nothing to answer for a visitor', async () => {
    const token = await createWidgetToken({
      sub: 'public',
      wid: 'prayer-feedback',
      origin: ORIGIN,
    });
    const res = await route.GET(get(token));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_required');
  });

  it('answers contact_not_found for a user with no linked contact', async () => {
    mockGetTableRecords.mockResolvedValue([]);
    const token = await createWidgetToken({
      sub: GUID,
      wid: 'prayer-feedback',
      origin: ORIGIN,
    });
    const res = await route.GET(get(token));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('contact_not_found');
  });

  it('answers auth_required with no token', async () => {
    const res = await route.GET(
      new NextRequest('http://localhost:3000/api/embed/prayer-feedback/submitter', {
        headers: { Origin: ORIGIN },
      })
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_required');
  });
});
