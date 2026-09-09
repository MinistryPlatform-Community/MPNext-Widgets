import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { consumePendingAction } from '@/lib/embed/pending-action';
import { getSessionStore, __resetSessionStoreForTests } from '@/lib/embed/session-store';
import {
  NoFromAddressError,
  TemplateNotFoundError,
  TemplateSendFailedError,
} from '@/services/messageTemplateService';
import { guardPublicationVerifyData } from '@mpnext/types';

/**
 * `POST /api/embed/subscribe-to-publication/send-verification`.
 *
 * The assertions that carry this file are all *negative*, and none of them are
 * visible from the service or the component:
 *
 *  - a known and an unknown address produce **byte-identical** responses, and
 *    the hop reads no `Contacts` row at all — the anti-enumeration property,
 *    and the deliberate divergence from `plan-your-visit`'s
 *    `{ contactExists: true }`;
 *  - a caller-supplied `contactId` is **ignored**, not merely unused — that is
 *    legacy's account-takeover primitive (D1), and "restore parity" is the
 *    obvious way to bring it back;
 *  - a `return-url` that is cross-origin, plain http, or credential-bearing
 *    sends **no email** — legacy interpolated it unvalidated (D2);
 *  - a store failure sends no email either: a link that can never be redeemed
 *    must not reach an inbox.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com', 'https://other.example.com'],
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
const RETURN_URL = 'https://allowed.example.com/newsletter?page=2';

const ONLINE_ROW = {
  Publication_ID: 4,
  Title: 'Weekly Newsletter',
  Description: 'Church news every Thursday',
  Congregation_ID: 7,
};

/** A valid submission. */
const BODY = {
  publicationId: 4,
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  returnUrl: RETURN_URL,
  verificationEmailTemplateId: 5125,
};

async function publicToken(wid = 'subscribe-to-publication'): Promise<string> {
  return createWidgetToken({ sub: 'public', wid, origin: ORIGIN });
}

function post(token: string, body: unknown, ip = '198.51.100.7'): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/embed/subscribe-to-publication/send-verification',
    {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-forwarded-for': ip,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
  );
}

/** The `nextwidgets_verify` handle out of the URL the email would have carried. */
function mintedHandle(param = 'nextwidgets_verify'): string {
  const merge = mockSendMessageTemplate.mock.calls[0][2] as Record<string, string>;
  return new URL(merge.mpp_verify_email_url).searchParams.get(param) ?? '';
}

/** A unique IP per test, so the per-IP bucket never carries between them. */
let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

describe('POST /api/embed/subscribe-to-publication/send-verification', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    mockGetTableRecords.mockResolvedValue([ONLINE_ROW]);
    mockSendMessageTemplate.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('method surface', () => {
    it('exports POST and OPTIONS only', () => {
      expect(Object.keys(route).sort()).toEqual(['OPTIONS', 'POST']);
      expect('GET' in route).toBe(false);
    });

    it('answers the preflight with CORS headers', async () => {
      const res = await route.OPTIONS(
        new NextRequest(
          'http://localhost:3000/api/embed/subscribe-to-publication/send-verification',
          { method: 'OPTIONS', headers: { Origin: ORIGIN } }
        )
      );
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    });
  });

  describe('the happy path', () => {
    it('answers 202 { ok: true } and sends one email', async () => {
      const res = await route.POST(post(await publicToken(), BODY, freshIp()));

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockSendMessageTemplate).toHaveBeenCalledTimes(1);
    });

    it('merges the four tokens, including the publication title legacy lacked', async () => {
      await route.POST(post(await publicToken(), BODY, freshIp()));

      const [templateId, to, merge] = mockSendMessageTemplate.mock.calls[0];
      expect(templateId).toBe(5125);
      expect(to).toEqual({ email: 'ada@example.com', name: 'Ada Lovelace' });
      expect(merge.mpp_contact_first_name).toBe('Ada');
      expect(merge.mpp_contact_last_name).toBe('Lovelace');
      expect(merge.mpp_publication_title).toBe('Weekly Newsletter');
      expect(merge.mpp_verify_email_url).toContain('nextwidgets_verify=');
    });

    it('seals the origin into the handle and no contact id', async () => {
      await route.POST(post(await publicToken(), BODY, freshIp()));

      const redeemed = await consumePendingAction(
        'publication-verify',
        mintedHandle(),
        (data) => data as Record<string, unknown>
      );
      expect(redeemed.ok).toBe(true);
      if (!redeemed.ok) return;

      expect(redeemed.data).toEqual({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        publicationId: 4,
        origin: ORIGIN,
      });
      expect(redeemed.data).not.toHaveProperty('contactId');
      expect(guardPublicationVerifyData(redeemed.data)).not.toBeNull();
    });

    it('lower-cases the sealed address', async () => {
      await route.POST(
        post(await publicToken(), { ...BODY, email: 'Ada@Example.COM' }, freshIp())
      );
      const redeemed = await consumePendingAction(
        'publication-verify',
        mintedHandle(),
        guardPublicationVerifyData
      );
      expect(redeemed.ok && redeemed.data.email).toBe('ada@example.com');
    });
  });

  describe('no existence oracle', () => {
    it('reads no Contacts row on this hop', async () => {
      // Not "looks it up and hides the answer" — it does not perform the query.
      // Contact resolution happens after the caller has proved mailbox control.
      await route.POST(post(await publicToken(), BODY, freshIp()));

      const tables = mockGetTableRecords.mock.calls.map(
        (call: unknown[]) => (call[0] as { table: string }).table
      );
      expect(tables).not.toContain('Contacts');
      expect(tables).toEqual(['dp_Publications']);
    });

    it('answers byte-identically for a known and an unknown address', async () => {
      // Asserted on the serialised body and the status, because that is all a
      // prober can see.
      const known = await route.POST(
        post(await publicToken(), { ...BODY, email: 'known@example.com' }, freshIp())
      );
      const unknown = await route.POST(
        post(await publicToken(), { ...BODY, email: 'nobody@example.com' }, freshIp())
      );

      expect(known.status).toBe(unknown.status);
      expect(await known.text()).toBe(await unknown.text());
    });

    it('never answers the plan-your-visit contactExists shape', async () => {
      const res = await route.POST(post(await publicToken(), BODY, freshIp()));
      const body = await res.json();
      expect(body).not.toHaveProperty('contactExists');
      expect(body).not.toHaveProperty('success');
    });
  });

  describe('D1 — a caller-supplied contactId changes nothing', () => {
    it('is stripped from the body and never sealed', async () => {
      // Legacy took `ContactId` off an `[AllowAnonymous]` form, sealed it, and
      // on redemption set that contact's `Email_Address` to whatever the form
      // held — a password-reset takeover on an email-identified IdP.
      const res = await route.POST(
        post(
          await publicToken(),
          { ...BODY, contactId: 12345, email: 'attacker@evil.example' },
          freshIp()
        )
      );

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });

      const redeemed = await consumePendingAction(
        'publication-verify',
        mintedHandle(),
        (data) => data as Record<string, unknown>
      );
      expect(redeemed.ok).toBe(true);
      if (!redeemed.ok) return;
      expect(redeemed.data).not.toHaveProperty('contactId');
      expect(Object.keys(redeemed.data).sort()).toEqual([
        'email',
        'firstName',
        'lastName',
        'origin',
        'publicationId',
      ]);
    });

    it('writes and updates nothing on this hop at all', async () => {
      await route.POST(post(await publicToken(), { ...BODY, contactId: 12345 }, freshIp()));
      expect(mockCreateTableRecords).not.toHaveBeenCalled();
      expect(mockUpdateTableRecords).not.toHaveBeenCalled();
    });
  });

  describe('D2 — the return URL cannot point off-origin', () => {
    const refused = [
      ['a different allowlisted origin', 'https://other.example.com/newsletter'],
      ['an origin that is not allowlisted', 'https://evil.example/newsletter'],
      ['plain http on a non-localhost host', 'http://allowed.example.com/newsletter'],
      ['a credential-bearing URL', 'https://allowed.example.com@evil.example/x'],
      ['a javascript: URL', 'javascript:alert(1)'],
      ['a relative path', '/newsletter'],
      ['an empty string', ''],
    ] as const;

    for (const [label, returnUrl] of refused) {
      it(`refuses ${label} and sends no email`, async () => {
        const res = await route.POST(
          post(await publicToken(), { ...BODY, returnUrl }, freshIp())
        );

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_request');
        // The assertion that matters: not merely a 400, but nothing sent.
        expect(mockSendMessageTemplate).not.toHaveBeenCalled();
      });
    }

    it('refuses a return URL carrying a control character', async () => {
      const res = await route.POST(
        post(
          await publicToken(),
          { ...BODY, returnUrl: 'https://allowed.example.com/a\r\nBcc: x@evil.example' },
          freshIp()
        )
      );
      expect(res.status).toBe(400);
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });

    it('keeps a legitimate query parameter and adds exactly one handle', async () => {
      await route.POST(post(await publicToken(), BODY, freshIp()));

      const merge = mockSendMessageTemplate.mock.calls[0][2] as Record<string, string>;
      const url = new URL(merge.mpp_verify_email_url);
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.getAll('nextwidgets_verify')).toHaveLength(1);
    });

    it('overwrites a stale handle the host page already carries', async () => {
      // `buildReturnUrl` is `searchParams.set`, so a host trying to smuggle a
      // second copy gets it replaced rather than duplicated.
      await route.POST(
        post(
          await publicToken(),
          { ...BODY, returnUrl: 'https://allowed.example.com/n?nextwidgets_verify=stale' },
          freshIp()
        )
      );

      const merge = mockSendMessageTemplate.mock.calls[0][2] as Record<string, string>;
      const values = new URL(merge.mpp_verify_email_url).searchParams.getAll(
        'nextwidgets_verify'
      );
      expect(values).toHaveLength(1);
      expect(values[0]).not.toBe('stale');
    });

    it('honours a custom verify-param-name', async () => {
      await route.POST(
        post(await publicToken(), { ...BODY, verifyParamName: 'confirm_me' }, freshIp())
      );
      const merge = mockSendMessageTemplate.mock.calls[0][2] as Record<string, string>;
      const url = new URL(merge.mpp_verify_email_url);
      expect(url.searchParams.get('confirm_me')).toBeTruthy();
      expect(url.searchParams.get('nextwidgets_verify')).toBeNull();
    });
  });

  describe('validation', () => {
    it('rejects a 51-character first name and names the field', async () => {
      const res = await route.POST(
        post(await publicToken(), { ...BODY, firstName: 'a'.repeat(51) }, freshIp())
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('validation_failed');
      expect(Object.keys(body.details)).toContain('firstName');
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });

    it('rejects a malformed address', async () => {
      const res = await route.POST(
        post(await publicToken(), { ...BODY, email: 'not-an-address' }, freshIp())
      );
      expect((await res.json()).error).toBe('validation_failed');
    });

    it('meters and then rejects malformed JSON', async () => {
      // The wrapper hands the handler `{}` for unparseable JSON deliberately,
      // so a garbage sender is still counted and the schema does the talking.
      const res = await route.POST(post(await publicToken(), '{not json', freshIp()));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('validation_failed');
    });

    it('answers template_not_configured when no template id is supplied', async () => {
      const withoutTemplate: Record<string, unknown> = { ...BODY };
      delete withoutTemplate.verificationEmailTemplateId;
      const res = await route.POST(post(await publicToken(), withoutTemplate, freshIp()));

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('template_not_configured');
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });

    it('answers publication_not_found for a publication that is not online', async () => {
      mockGetTableRecords.mockResolvedValue([]);
      const res = await route.POST(post(await publicToken(), BODY, freshIp()));

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('publication_not_found');
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });
  });

  describe('template failures map to two codes', () => {
    it('maps a missing template to template_not_configured', async () => {
      mockSendMessageTemplate.mockRejectedValueOnce(
        new TemplateNotFoundError(5125, 'dp_Communications')
      );
      const res = await route.POST(post(await publicToken(), BODY, freshIp()));

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('template_not_configured');
    });

    it('maps a template with no From contact to template_not_configured', async () => {
      mockSendMessageTemplate.mockRejectedValueOnce(new NoFromAddressError(5125));
      const res = await route.POST(post(await publicToken(), BODY, freshIp()));

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('template_not_configured');
    });

    it('maps a send that threw to email_send_failed, at 500 not 502', async () => {
      // The machine code carries the meaning and the widget branches on it,
      // never on the status. An upstream-failure convention would belong across
      // all thirty embed routes, not be started in three new ones.
      mockSendMessageTemplate.mockRejectedValueOnce(new TemplateSendFailedError(5125));
      const res = await route.POST(post(await publicToken(), BODY, freshIp()));

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('email_send_failed');
    });

    it('never echoes MP error text', async () => {
      mockSendMessageTemplate.mockRejectedValueOnce(
        new Error('SMTP said: relay denied for pastor@church.example')
      );
      const res = await route.POST(post(await publicToken(), BODY, freshIp()));
      expect(JSON.stringify(await res.json())).not.toContain('pastor@church.example');
    });
  });

  describe('the store', () => {
    it('sends no email when the pending action cannot be written', async () => {
      // A delivered link that can never be redeemed is worse than no email, so
      // the handle is minted before the send and a failure is answered.
      vi.spyOn(getSessionStore(), 'kvSet').mockRejectedValue(new Error('redis down'));

      const res = await route.POST(post(await publicToken(), BODY, freshIp()));

      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('internal_error');
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });

    it('fails closed on a rate-limit store outage', async () => {
      // Failing open on an endpoint that emails a submitted address turns a
      // store outage into an open relay.
      vi.spyOn(getSessionStore(), 'incr').mockRejectedValue(new Error('redis down'));

      const res = await route.POST(post(await publicToken(), BODY, freshIp()));

      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe('rate_limited');
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('caps one IP at 5 per minute', async () => {
      const ip = freshIp();
      const token = await publicToken();
      for (let i = 0; i < 5; i += 1) {
        const ok = await route.POST(
          post(token, { ...BODY, email: `person${i}@example.com` }, ip)
        );
        expect(ok.status).toBe(202);
      }

      const sixth = await route.POST(
        post(token, { ...BODY, email: 'person6@example.com' }, ip)
      );
      expect(sixth.status).toBe(429);
      expect((await sixth.json()).error).toBe('rate_limited');
    });

    it('caps one address at 3 per hour, across IPs', async () => {
      // The bucket that matters: a per-minute cap alone still permits a steady
      // all-day bombardment of one mailbox from rotating IPs.
      const token = await publicToken();
      for (let i = 0; i < 3; i += 1) {
        const ok = await route.POST(post(token, BODY, freshIp()));
        expect(ok.status).toBe(202);
      }

      const fourth = await route.POST(post(token, BODY, freshIp()));
      expect(fourth.status).toBe(429);
      expect(mockSendMessageTemplate).toHaveBeenCalledTimes(3);
    });

    it('short-circuits before the publication read and the send', async () => {
      const ip = freshIp();
      const token = await publicToken();
      for (let i = 0; i < 5; i += 1) {
        await route.POST(post(token, { ...BODY, email: `p${i}@example.com` }, ip));
      }
      vi.clearAllMocks();
      mockGetTableRecords.mockResolvedValue([ONLINE_ROW]);

      await route.POST(post(token, { ...BODY, email: 'p9@example.com' }, ip));

      expect(mockGetTableRecords).not.toHaveBeenCalled();
      expect(mockSendMessageTemplate).not.toHaveBeenCalled();
    });

    it('does not meter every address-less request under one bucket', async () => {
      // C69 found this: an unconditional per-address bucket keys every request
      // with no address under a single "no address" hash, capping everyone at
      // 3/hour. Four malformed bodies from four IPs must not exhaust anything.
      const token = await publicToken();
      for (let i = 0; i < 4; i += 1) {
        const res = await route.POST(post(token, { publicationId: 4 }, freshIp()));
        expect(res.status).toBe(400);
      }
    });
  });
});
