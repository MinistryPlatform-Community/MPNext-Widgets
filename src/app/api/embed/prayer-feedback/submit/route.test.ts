import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { PrayerFeedbackService } from '@/services/prayerFeedbackService';

/**
 * `POST /api/embed/prayer-feedback/submit`.
 *
 * The assertions that matter here are the *negative* ones, and none of them are
 * visible from the service or the component:
 *
 *  - an anonymous submission performs **no MP write at all** — the property the
 *    whole match-or-create design rests on;
 *  - the response is byte-identical for a known and an unknown address, so the
 *    endpoint is not an email-existence oracle (the deliberate divergence from
 *    `plan-your-visit`'s `contactExists: true`);
 *  - an unauthenticated caller's `onBehalfOfContactId` is **ignored**, which is
 *    the legacy email-cannon hole (`[AllowAnonymous]` + `formData.ContactId`);
 *  - a signed-in caller cannot file outside their household;
 *  - a cross-origin `returnUrl` sends nothing.
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
const RETURN_URL = 'https://allowed.example.com/prayer?page=2';

const STOCK_TYPES = [
  { Feedback_Type_ID: 1, Feedback_Type: 'Prayer Request', Description: null },
  { Feedback_Type_ID: 2, Feedback_Type: 'Praise Report', Description: null },
  { Feedback_Type_ID: 5, Feedback_Type: 'User Removal Request', Description: null },
];

/** A valid anonymous body. */
const ANON = {
  feedbackTypeId: 1,
  summary: 'Please pray for my family',
  description: 'We are going through a hard season.',
  firstName: 'Doug',
  lastName: 'Smith',
  email: 'doug@example.com',
  returnUrl: RETURN_URL,
  verificationEmailTemplateId: 5125,
};

async function publicToken(wid = 'prayer-feedback'): Promise<string> {
  return createWidgetToken({ sub: 'public', wid, origin: ORIGIN });
}

async function memberToken(guid = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890'): Promise<string> {
  return createWidgetToken({ sub: guid, wid: 'prayer-feedback', origin: ORIGIN });
}

function post(token: string, body: unknown, ip = '198.51.100.7'): NextRequest {
  return new NextRequest('http://localhost:3000/api/embed/prayer-feedback/submit', {
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

/** Contacts rows keyed by the contact id in the filter. */
type ContactRows = Record<number, Record<string, unknown>>;

function stubMp(options: { contacts?: ContactRows; findContact?: number | null } = {}) {
  const contacts = options.contacts ?? {};
  mockGetTableRecords.mockImplementation(
    async (args: { table: string; filter?: string }) => {
      if (args.table === 'Feedback_Types') return STOCK_TYPES;
      if (args.table === 'dp_Users') return [{ Contact_ID: 100 }];
      if (args.table === 'Contacts') {
        const byId = /Contact_ID = (\d+)/.exec(args.filter ?? '');
        if (byId) {
          const row = contacts[Number(byId[1])];
          return row ? [row] : [];
        }
        // The `findContact` predicate.
        return options.findContact ? [{ Contact_ID: options.findContact }] : [];
      }
      if (args.table === 'Household_Sources') return [{ Id: 19 }];
      if (args.table === 'Contact_Statuses') return [{ Id: 1 }];
      if (args.table === 'Household_Positions') return [{ Id: 1 }];
      return [];
    }
  );
}

let ipCounter = 0;
/** A fresh IP per request, so one test's traffic never exhausts another's bucket. */
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

describe('POST /api/embed/prayer-feedback/submit', () => {
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

  describe('method surface', () => {
    it('exports POST and OPTIONS only', () => {
      // A state-changing GET on the intake endpoint would be fetchable from a
      // crafted <img>; the wrapper refuses anything but POST regardless, and
      // exporting no GET is the structural half of that.
      expect(Object.keys(route).sort()).toEqual(['OPTIONS', 'POST']);
    });

    it('answers the preflight with CORS headers', async () => {
      const res = await route.OPTIONS(
        new NextRequest('http://localhost:3000/api/embed/prayer-feedback/submit', {
          method: 'OPTIONS',
          headers: { Origin: ORIGIN },
        })
      );
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    });
  });

  describe('authentication', () => {
    it('rejects a request with no token', async () => {
      const req = new NextRequest('http://localhost:3000/api/embed/prayer-feedback/submit', {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify(ANON),
      });
      const res = await route.POST(req);
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('auth_required');
    });

    it('accepts a widget token whose subject is "public"', async () => {
      const res = await route.POST(post(await publicToken(), ANON, freshIp()));
      expect(res.status).toBe(200);
    });
  });

  describe('validation', () => {
    it('rejects a malformed body as validation_failed', async () => {
      const res = await route.POST(post(await publicToken(), { summary: '' }, freshIp()));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('validation_failed');
    });

    it('rejects a summary over the 50-character column', async () => {
      const res = await route.POST(
        post(await publicToken(), { ...ANON, summary: 'S'.repeat(51) }, freshIp())
      );
      expect((await res.json()).error).toBe('validation_failed');
    });

    it('accepts the full 2000-character description', async () => {
      // Legacy cut at 1000 while its own textarea allowed 2000, so a
      // congregant's last thousand characters vanished silently.
      const res = await route.POST(
        post(await publicToken(), { ...ANON, description: 'D'.repeat(2000) }, freshIp())
      );
      expect(res.status).toBe(200);
    });

    it('rejects a type outside the form allowlist', async () => {
      const res = await route.POST(
        post(await publicToken(), { ...ANON, allowedTypeIds: [2, 3] }, freshIp())
      );
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('feedback_type_not_allowed');
    });

    it('rejects a type MP has never heard of', async () => {
      const res = await route.POST(
        post(await publicToken(), { ...ANON, feedbackTypeId: 77 }, freshIp())
      );
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('feedback_type_not_found');
    });
  });

  describe('the anonymous path', () => {
    it('performs no MP write whatsoever', async () => {
      // **The single most important assertion in this file.** Match-or-create is
      // only a safe answer to `Contact_ID NOT NULL` because unverified traffic
      // cannot reach a write; if this ever fails, an unauthenticated POST is
      // minting Households and Contacts in a church's CRM.
      const res = await route.POST(post(await publicToken(), ANON, freshIp()));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'verification_sent' });
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });

    it('emails the verification link with legacy’s three merge tokens', async () => {
      await route.POST(post(await publicToken(), ANON, freshIp()));

      expect(mockSendMessageTemplate).toHaveBeenCalledTimes(1);
      const [templateId, recipient, merge] = mockSendMessageTemplate.mock.calls[0];
      expect(templateId).toBe(5125);
      expect(recipient).toEqual({ email: 'doug@example.com', name: 'Doug Smith' });
      expect(Object.keys(merge).sort()).toEqual([
        'mpp_contact_first_name',
        'mpp_contact_last_name',
        'mpp_verify_email_url',
      ]);
    });

    it('builds the link on the return URL, keeping its existing query', async () => {
      await route.POST(post(await publicToken(), ANON, freshIp()));

      const url = new URL(mockSendMessageTemplate.mock.calls[0][2].mpp_verify_email_url);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe('/prayer');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('mpp-verify-id')).toBeTruthy();
    });

    it('honours verify-param-name so a legacy template keeps working', async () => {
      await route.POST(
        post(await publicToken(), { ...ANON, verifyParamName: 'confirm' }, freshIp())
      );
      const url = new URL(mockSendMessageTemplate.mock.calls[0][2].mpp_verify_email_url);
      expect(url.searchParams.get('confirm')).toBeTruthy();
      expect(url.searchParams.has('mpp-verify-id')).toBe(false);
    });

    it('answers identically whether or not the address matches a contact', async () => {
      // The no-enumeration property. `plan-your-visit` answers
      // `contactExists: true` here; prayer intake must not report a fact about
      // an address to whoever asks.
      stubMp({ findContact: null });
      const unknown = await route.POST(post(await publicToken(), ANON, freshIp()));
      const unknownBody = await unknown.text();

      vi.clearAllMocks();
      mockSendMessageTemplate.mockResolvedValue(undefined);
      stubMp({ findContact: 314 });
      const known = await route.POST(post(await publicToken(), ANON, freshIp()));
      const knownBody = await known.text();

      expect(known.status).toBe(unknown.status);
      expect(knownBody).toBe(unknownBody);
      // And still no write in the matched case either.
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
    });

    it('ignores onBehalfOfContactId from an unauthenticated caller', async () => {
      // The legacy email-cannon regression guard: post someone else's contact
      // id and legacy harvested their name and address and mailed them a link
      // that would file a prayer request against them.
      await route.POST(
        post(await publicToken(), { ...ANON, onBehalfOfContactId: 41234 }, freshIp())
      );

      // No write, and the mail went to the address the caller typed — never to
      // an address looked up from the posted id.
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockSendMessageTemplate.mock.calls[0][1]).toEqual({
        email: 'doug@example.com',
        name: 'Doug Smith',
      });
    });

    it('refuses a returnUrl on another origin and sends nothing', async () => {
      const res = await route.POST(
        post(
          await publicToken(),
          { ...ANON, returnUrl: 'https://evil.example.com/prayer' },
          freshIp()
        )
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_return_url');
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });

    it('refuses a returnUrl with embedded credentials', async () => {
      const res = await route.POST(
        post(
          await publicToken(),
          { ...ANON, returnUrl: 'https://allowed.example.com@evil.example.com/x' },
          freshIp()
        )
      );
      expect((await res.json()).error).toBe('invalid_return_url');
    });

    it('answers template_not_configured when no verification template is set', async () => {
      const body = { ...ANON } as Record<string, unknown>;
      delete body.verificationEmailTemplateId;
      const res = await route.POST(post(await publicToken(), body, freshIp()));

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('template_not_configured');
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });

    it('distinguishes a misconfigured template from a failed send', async () => {
      const { TemplateNotFoundError } = await import('@/services/messageTemplateService');
      mockSendMessageTemplate.mockRejectedValueOnce(
        new TemplateNotFoundError(5125, 'dp_Communications')
      );
      const misconfigured = await route.POST(post(await publicToken(), ANON, freshIp()));
      expect(misconfigured.status).toBe(422);
      expect((await misconfigured.json()).error).toBe('template_not_configured');

      mockSendMessageTemplate.mockRejectedValueOnce(new Error('SMTP exploded'));
      const failed = await route.POST(post(await publicToken(), ANON, freshIp()));
      expect(failed.status).toBe(500);
      expect((await failed.json()).error).toBe('email_send_failed');
    });

    it('never leaks the English message as the rendered contract', async () => {
      // The widget renders `errorText(payload)` off `error`; `message` is a
      // debug aid. Both must be present, and `error` must be a machine code.
      const res = await route.POST(
        post(await publicToken(), { ...ANON, feedbackTypeId: 77 }, freshIp())
      );
      const payload = await res.json();
      expect(payload.error).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof payload.message).toBe('string');
    });
  });

  describe('the signed-in path', () => {
    const SELF = {
      100: {
        Contact_ID: 100,
        First_Name: 'Doug',
        Last_Name: 'Smith',
        Display_Name: 'Smith, Doug',
        Email_Address: 'doug@example.com',
        Household_ID: 10,
      },
    };

    it('writes the entry immediately and sends no verification email', async () => {
      stubMp({ contacts: SELF });
      const res = await route.POST(
        post(await memberToken(), { feedbackTypeId: 1, summary: 'Pray for me' }, freshIp())
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'submitted', feedbackEntryId: 555 });
      expect(mockCreateTableRecords.mock.calls.map((c) => c[0])).toEqual(['Feedback_Entries']);
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });

    it('files against the caller’s own contact', async () => {
      stubMp({ contacts: SELF });
      await route.POST(
        post(await memberToken(), { feedbackTypeId: 1, summary: 'Pray for me' }, freshIp())
      );
      const entry = mockCreateTableRecords.mock.calls[0][1][0];
      expect(entry.Contact_ID).toBe(100);
    });

    it('sends the acknowledgement when one is configured', async () => {
      // Dropping the *verification* round-trip must not drop the church's only
      // touchpoint with the submitter — that would be a regression dressed as a
      // simplification.
      stubMp({ contacts: SELF });
      await route.POST(
        post(
          await memberToken(),
          {
            feedbackTypeId: 1,
            summary: 'Pray for me',
            description: 'Something I would rather not see quoted back at me.',
            acknowledgementEmailTemplateId: 6000,
          },
          freshIp()
        )
      );

      expect(mockSendMessageTemplate).toHaveBeenCalledTimes(1);
      const [templateId, recipient, merge] = mockSendMessageTemplate.mock.calls[0];
      expect(templateId).toBe(6000);
      expect(recipient.email).toBe('doug@example.com');
      expect(merge.mpp_feedback_type).toBe('Prayer Request');
      expect(merge.mpp_feedback_summary).toBe('Pray for me');
      // The description is deliberately not merged: a prayer request echoed
      // into an unencrypted mailbox is a disclosure nobody asked for.
      expect(JSON.stringify(merge)).not.toContain('quoted back');
    });

    it('still reports success when the acknowledgement fails to send', async () => {
      stubMp({ contacts: SELF });
      mockSendMessageTemplate.mockRejectedValue(new Error('SMTP exploded'));
      const res = await route.POST(
        post(
          await memberToken(),
          { feedbackTypeId: 1, summary: 'Pray for me', acknowledgementEmailTemplateId: 6000 },
          freshIp()
        )
      );

      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe('submitted');
    });

    it('files for a household member and acknowledges to *their* address', async () => {
      stubMp({
        contacts: {
          ...SELF,
          200: {
            Contact_ID: 200,
            First_Name: 'Marie',
            Last_Name: 'Smith',
            Display_Name: 'Smith, Marie',
            Email_Address: 'marie@example.com',
            Household_ID: 10,
          },
        },
      });
      await route.POST(
        post(
          await memberToken(),
          {
            feedbackTypeId: 1,
            summary: 'Pray for Marie',
            onBehalfOfContactId: 200,
            acknowledgementEmailTemplateId: 6000,
          },
          freshIp()
        )
      );

      expect(mockCreateTableRecords.mock.calls[0][1][0].Contact_ID).toBe(200);
      expect(mockSendMessageTemplate.mock.calls[0][1].email).toBe('marie@example.com');
    });

    it('refuses a target outside the caller’s household, with no write', async () => {
      stubMp({
        contacts: {
          ...SELF,
          300: { Contact_ID: 300, Display_Name: 'Other, Person', Household_ID: 99 },
        },
      });
      const res = await route.POST(
        post(
          await memberToken(),
          { feedbackTypeId: 1, summary: 'Pray', onBehalfOfContactId: 300 },
          freshIp()
        )
      );

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('not_household_member');
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
    });

    it('answers contact_not_found for a user with no linked contact', async () => {
      mockGetTableRecords.mockImplementation(async (args: { table: string }) => {
        if (args.table === 'Feedback_Types') return STOCK_TYPES;
        return [];
      });
      const res = await route.POST(
        post(await memberToken(), { feedbackTypeId: 1, summary: 'Pray' }, freshIp())
      );

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('contact_not_found');
    });

    it('answers feedback_save_failed when MP rejects the insert', async () => {
      stubMp({ contacts: SELF });
      mockCreateTableRecords.mockRejectedValue(new Error('FK violation'));
      const res = await route.POST(
        post(await memberToken(), { feedbackTypeId: 1, summary: 'Pray' }, freshIp())
      );

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('feedback_save_failed');
    });

    it('backfills an empty contact email but never overwrites a populated one', async () => {
      stubMp({
        contacts: {
          100: { Contact_ID: 100, First_Name: 'Doug', Last_Name: 'Smith', Household_ID: 10 },
        },
      });
      await route.POST(
        post(
          await memberToken(),
          {
            feedbackTypeId: 1,
            summary: 'Pray',
            onBehalfOfContactId: 100,
            email: 'newly-collected@example.com',
          },
          freshIp()
        )
      );
      expect(mockUpdateTableRecords).toHaveBeenCalledWith('Contacts', [
        { Contact_ID: 100, Email_Address: 'newly-collected@example.com' },
      ]);

      vi.clearAllMocks();
      mockCreateTableRecords.mockResolvedValue([{ Feedback_Entry_ID: 556 }]);
      stubMp({ contacts: SELF });
      await route.POST(
        post(
          await memberToken(),
          {
            feedbackTypeId: 1,
            summary: 'Pray',
            onBehalfOfContactId: 100,
            email: 'typo@example.com',
          },
          freshIp()
        )
      );
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });

    it('takes the verification round-trip for the blank-form option', async () => {
      // A signed-in member filing for someone outside their household has a
      // verified identity of their *own*, which says nothing about the third
      // party whose details they just typed. So it verifies, exactly as legacy
      // did for everyone — and creates no "signed-in users may mint contacts"
      // privilege.
      stubMp({ contacts: SELF });
      const res = await route.POST(post(await memberToken(), ANON, freshIp()));

      expect(await res.json()).toEqual({ status: 'verification_sent' });
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockSendMessageTemplate.mock.calls[0][0]).toBe(5125);
    });
  });

  describe('rate limiting', () => {
    it('answers rate_limited after 5 requests from one IP, with no send', async () => {
      const ip = '198.51.100.99';
      const token = await publicToken();
      // A distinct address per request, so it is unambiguously the IP bucket
      // that fills and not the 3/hour per-address one.
      for (let i = 0; i < 5; i += 1) {
        const body = { ...ANON, email: `visitor${i}@example.com` };
        expect((await route.POST(post(token, body, ip))).status).toBe(200);
      }

      vi.clearAllMocks();
      mockSendMessageTemplate.mockResolvedValue(undefined);
      const res = await route.POST(post(token, { ...ANON, email: 'last@example.com' }, ip));

      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe('rate_limited');
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
    });

    it('meters the submitted address across rotating IPs', async () => {
      // The bucket that matters: an IP limit alone is defeated by a botnet, and
      // this is what stops one mailbox being bombed with prayer-form links.
      const token = await publicToken();
      for (let i = 0; i < 3; i += 1) {
        const res = await route.POST(post(token, ANON, `192.0.2.${i}`));
        expect(res.status).toBe(200);
      }
      const res = await route.POST(post(token, ANON, '192.0.2.200'));
      expect(res.status).toBe(429);
    });

    it('does not meter signed-in submissions into one shared address bucket', async () => {
      // A signed-in submission carries no address, and metering those together
      // under a "no address" key would cap a whole congregation at 3/hour.
      stubMp({
        contacts: {
          100: {
            Contact_ID: 100,
            First_Name: 'Doug',
            Last_Name: 'Smith',
            Display_Name: 'Smith, Doug',
            Email_Address: 'doug@example.com',
            Household_ID: 10,
          },
        },
      });
      const body = { feedbackTypeId: 1, summary: 'Pray for me' };
      for (let i = 0; i < 4; i += 1) {
        const res = await route.POST(post(await memberToken(), body, `192.0.2.${100 + i}`));
        expect(res.status).toBe(200);
      }
    });
  });
});
