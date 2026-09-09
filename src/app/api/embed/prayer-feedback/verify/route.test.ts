import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { createActionToken } from '@/lib/embed/action-token';
import { createPendingAction } from '@/lib/embed/pending-action';
import { getSessionStore, __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { PrayerFeedbackService } from '@/services/prayerFeedbackService';

/**
 * `POST /api/embed/prayer-feedback/verify` — the redemption that finally writes.
 *
 * Every one of the four `consumePendingAction` outcomes has a test here,
 * because each is a different sentence for the visitor and the two that are
 * easiest to conflate — expired and already-used — are the two whose confusion
 * sends someone looking for an email they never opened.
 *
 * The fail-closed test is the one that matters most: a store error must never
 * be reported as a successful redemption, or a retry writes a duplicate prayer
 * entry every time.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const mockGetTableRecords = vi.fn();
const mockCreateTableRecords = vi.fn();
const mockUpdateTableRecords = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = mockCreateTableRecords;
    updateTableRecords = mockUpdateTableRecords;
  },
}));

vi.mock('@/services/domainTimezoneService', () => ({
  DomainTimezoneService: {
    getInstance: () => ({
      toMpSqlDatetime: async (v: Date | string) =>
        new Date(v).toISOString().replace('T', ' ').slice(0, 19),
    }),
  },
}));

vi.mock('@/services/householdService', () => ({
  HouseholdService: { getInstance: async () => ({ getMembers: async () => [] }) },
}));

const mockSendMessageTemplate = vi.fn();

vi.mock('@/services/messageTemplateService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/messageTemplateService')>();
  return {
    ...actual,
    MessageTemplateService: {
      getInstance: async () => ({ sendMessageTemplate: mockSendMessageTemplate }),
    },
  };
});

const ORIGIN = 'https://allowed.example.com';

const PENDING = {
  contactId: null,
  firstName: 'Doug',
  lastName: 'Smith',
  email: 'doug@example.com',
  mobilePhone: null,
  feedbackTypeId: 1,
  summary: 'Please pray for my family',
  description: 'We are going through a hard season.',
  isPrivate: false,
  programId: null,
  acknowledgementEmailTemplateId: null,
};

async function publicToken(): Promise<string> {
  return createWidgetToken({ sub: 'public', wid: 'prayer-feedback', origin: ORIGIN });
}

function post(token: string, body: unknown, ip = '198.51.100.7'): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/prayer-feedback/verify', {
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

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

function stubMp() {
  mockGetTableRecords.mockImplementation(async (args: { table: string }) => {
    if (args.table === 'Feedback_Types') {
      return [{ Feedback_Type_ID: 1, Feedback_Type: 'Prayer Request', Description: null }];
    }
    if (args.table === 'Household_Sources') return [{ Id: 19 }];
    if (args.table === 'Contact_Statuses') return [{ Id: 1 }];
    if (args.table === 'Household_Positions') return [{ Id: 1 }];
    return [];
  });
}

describe('POST /api/embed/prayer-feedback/verify', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (PrayerFeedbackService as any).instance = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockSendMessageTemplate.mockResolvedValue(undefined);
    mockCreateTableRecords.mockImplementation(async (table: string) => {
      if (table === 'Households') return [{ Household_ID: 900 }];
      if (table === 'Contacts') return [{ Contact_ID: 901 }];
      if (table === 'Feedback_Entries') return [{ Feedback_Entry_ID: 555 }];
      return [];
    });
    mockUpdateTableRecords.mockResolvedValue([]);
    stubMp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports POST and OPTIONS only', () => {
    // Legacy redeemed on a `[HttpGet] [AllowAnonymous]` action reachable from
    // the emailed URL, which mailbox scanners and link-preview bots fetch —
    // i.e. a scanner could file a prayer request. The emailed link here lands
    // on a page that only renders.
    expect(Object.keys(route).sort()).toEqual(['OPTIONS', 'POST']);
  });

  it('redeems a valid handle and writes exactly one entry', async () => {
    const token = await createPendingAction('prayer-feedback', PENDING, 3600);
    const res = await route.POST(post(await publicToken(), { token }, freshIp()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'verified', feedbackEntryId: 555 });

    const tables = mockCreateTableRecords.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(['Households', 'Contacts', 'Feedback_Entries']);
    const entry = mockCreateTableRecords.mock.calls[2][1][0];
    expect(entry.Entry_Title).toBe('Please pray for my family');
    expect(entry.Approved).toBe(false);
    expect(entry.Contact_ID).toBe(901);
  });

  it('is single-use: the second redemption is verification_used', async () => {
    // Single-use by construction — `kvGetDelete` is an atomic read-and-burn —
    // rather than legacy's content-comparison duplicate guard, which was broken
    // for any entry over 1000 characters.
    const token = await createPendingAction('prayer-feedback', PENDING, 3600);
    expect((await route.POST(post(await publicToken(), { token }, freshIp()))).status).toBe(200);

    mockCreateTableRecords.mockClear();
    const second = await route.POST(post(await publicToken(), { token }, freshIp()));

    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('verification_used');
    expect(mockCreateTableRecords).not.toHaveBeenCalled();
  });

  it('answers verification_invalid for a tampered signature', async () => {
    const token = await createPendingAction('prayer-feedback', PENDING, 3600);
    const tampered = `${token.slice(0, -4)}AAAA`;
    const res = await route.POST(post(await publicToken(), { token: tampered }, freshIp()));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('verification_invalid');
    expect(mockCreateTableRecords).not.toHaveBeenCalled();
  });

  it('answers verification_expired without reading the store', async () => {
    // The reason the hybrid envelope earns its keep: expiry is proved from the
    // signature, so `expired` is distinguishable from `used` at all — and the
    // cheapest possible reply to the most likely bogus request costs no store
    // round-trip.
    const expired = await createActionToken('prayer-feedback', { jti: 'whatever' }, -60);
    const store = getSessionStore();
    const spy = vi.spyOn(store, 'kvGetDelete');

    const res = await route.POST(post(await publicToken(), { token: expired }, freshIp()));

    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe('verification_expired');
    expect(spy).not.toHaveBeenCalled();
    expect(mockCreateTableRecords).not.toHaveBeenCalled();
  });

  it('answers verification_invalid for a token minted for another flow', async () => {
    // `verifyActionToken` can tell "wrong flow" from "forged", but saying so
    // would tell the bearer that the token they hold is valid for something
    // else — a hint about what else they hold.
    const wrongFlow = await createActionToken('publication-verify', { jti: 'abc' }, 3600);
    const res = await route.POST(post(await publicToken(), { token: wrongFlow }, freshIp()));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('verification_invalid');
  });

  it('fails closed on a store error: internal_error and no write', async () => {
    // **The assertion to keep.** A store error reported as a success writes a
    // duplicate entry on every retry, which is precisely what the single-use
    // handle exists to prevent.
    const token = await createPendingAction('prayer-feedback', PENDING, 3600);
    vi.spyOn(getSessionStore(), 'kvGetDelete').mockRejectedValue(new Error('redis down'));

    const res = await route.POST(post(await publicToken(), { token }, freshIp()));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('internal_error');
    expect(mockCreateTableRecords).not.toHaveBeenCalled();
  });

  it('answers validation_failed for a body with no token', async () => {
    const res = await route.POST(post(await publicToken(), {}, freshIp()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('validation_failed');
  });

  it('answers feedback_save_failed when MP rejects the insert', async () => {
    const token = await createPendingAction('prayer-feedback', PENDING, 3600);
    mockCreateTableRecords.mockRejectedValue(new Error('FK violation'));

    const res = await route.POST(post(await publicToken(), { token }, freshIp()));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('feedback_save_failed');
  });

  it('sends the acknowledgement carried in the sealed payload', async () => {
    // The template travels in the payload rather than in this route's body, so
    // the landing page cannot redirect the acknowledgement to a template of its
    // own choosing.
    const token = await createPendingAction(
      'prayer-feedback',
      { ...PENDING, acknowledgementEmailTemplateId: 6000 },
      3600
    );
    await route.POST(post(await publicToken(), { token }, freshIp()));

    expect(mockSendMessageTemplate).toHaveBeenCalledTimes(1);
    const [templateId, recipient, merge] = mockSendMessageTemplate.mock.calls[0];
    expect(templateId).toBe(6000);
    expect(recipient.email).toBe('doug@example.com');
    expect(merge.mpp_feedback_summary).toBe('Please pray for my family');
    // Never the description.
    expect(JSON.stringify(merge)).not.toContain('hard season');
  });

  it('still reports success when the acknowledgement send fails', async () => {
    const token = await createPendingAction(
      'prayer-feedback',
      { ...PENDING, acknowledgementEmailTemplateId: 6000 },
      3600
    );
    mockSendMessageTemplate.mockRejectedValue(new Error('SMTP exploded'));

    const res = await route.POST(post(await publicToken(), { token }, freshIp()));
    expect((await res.json()).status).toBe('verified');
  });

  it('rejects a sealed payload whose shape it no longer recognises', async () => {
    // Deploy skew: a record written by an older build is `invalid` rather than
    // half-trusted and written to MP.
    const token = await createPendingAction('prayer-feedback', { nonsense: true }, 3600);
    const res = await route.POST(post(await publicToken(), { token }, freshIp()));

    expect((await res.json()).error).toBe('verification_invalid');
    expect(mockCreateTableRecords).not.toHaveBeenCalled();
  });

  it('backfills nothing for a contact this redemption just created', async () => {
    const token = await createPendingAction('prayer-feedback', PENDING, 3600);
    await route.POST(post(await publicToken(), { token }, freshIp()));
    expect(mockUpdateTableRecords).not.toHaveBeenCalled();
  });

  describe('rate limiting', () => {
    it('meters real handles at 5/min per IP', async () => {
      const ip = '198.51.100.55';
      const token = await publicToken();
      for (let i = 0; i < 5; i += 1) {
        const handle = await createPendingAction('prayer-feedback', PENDING, 3600);
        expect((await route.POST(post(token, { token: handle }, ip))).status).toBe(200);
      }
      const handle = await createPendingAction('prayer-feedback', PENDING, 3600);
      const res = await route.POST(post(token, { token: handle }, ip));

      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe('rate_limited');
    });

    it('spends no rate-limit slot on an expired or forged handle', async () => {
      // Link-scanning traffic and stale bookmarks must not exhaust the budget
      // of the visitors holding real links.
      const ip = '198.51.100.66';
      const token = await publicToken();
      const expired = await createActionToken('prayer-feedback', { jti: 'x' }, -60);

      for (let i = 0; i < 20; i += 1) {
        const res = await route.POST(post(token, { token: expired }, ip));
        expect(res.status).toBe(410);
      }

      // A real handle from the same IP still works.
      const handle = await createPendingAction('prayer-feedback', PENDING, 3600);
      expect((await route.POST(post(token, { token: handle }, ip))).status).toBe(200);
    });

    it('still meters a body with no token at all', async () => {
      const ip = '198.51.100.77';
      const token = await publicToken();
      for (let i = 0; i < 5; i += 1) {
        expect((await route.POST(post(token, {}, ip))).status).toBe(400);
      }
      const res = await route.POST(post(token, {}, ip));
      expect(res.status).toBe(429);
    });
  });
});
