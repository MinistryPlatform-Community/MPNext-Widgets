import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createWidgetToken } from '@/lib/embed/jwt';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import type { PaymentRequestToken } from '@mpnext/types';

/**
 * C43 — the request token is single-use, and the three-reload replay from the
 * finding yields exactly one `Payments` row (this doubles as C40's acceptance).
 *
 * The replay is driven through the real routes and the real `PaymentService`;
 * only MP is mocked, as a tiny stateful `Payments` table.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const mp = vi.hoisted(() => ({
  payments: [] as Array<Record<string, unknown>>,
  getTableRecords: vi.fn(),
  executeProcedure: vi.fn(),
  createTableRecords: vi.fn(),
  updateTableRecords: vi.fn(),
}));

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mp.getTableRecords;
    executeProcedure = mp.executeProcedure;
    createTableRecords = mp.createTableRecords;
    updateTableRecords = mp.updateTableRecords;
  },
}));

vi.mock('@/services/domainTimezoneService', () => ({
  DomainTimezoneService: {
    getInstance: () => ({ toMpSqlDatetime: async () => '2026-10-11 09:00:00' }),
  },
}));

import * as payResponse from './route';
import * as payUnpack from '../unpack/route';
import * as paymentResponse from '../../checkout/payment-response/route';
import { CheckoutService } from '@/services/checkoutService';
import { PaymentService } from '@/services/paymentService';
import { InvoiceService } from '@/services/invoiceService';

const ORIGIN = 'https://allowed.example.com';
const GUID = 'b0b0b0b0-0000-4000-8000-000000000001';

function request(over: Partial<PaymentRequestToken> = {}): Omit<PaymentRequestToken, 'jti'> {
  return {
    invoiceId: GUID,
    amount: 40,
    payorContactId: 98,
    returnUrl: 'https://allowed.example.com/checkout',
    paymentNotifyUrl: 'http://localhost:3000/api/embed/payment/notify',
    firstName: 'Pat',
    lastName: 'Payer',
    email: 'pat@example.org',
    mobilePhone: null,
    addressStreet: null,
    addressStreet2: null,
    addressCity: null,
    addressState: null,
    addressZip: null,
    addressCountry: null,
    fundId: null,
    ...over,
  };
}

async function widgetToken(wid: string): Promise<string> {
  return createWidgetToken({ sub: 'public', wid, origin: ORIGIN });
}

async function submit(token: string, cardNumber = '4111 1111 1111 1111') {
  const req = new NextRequest('http://localhost:3000/api/embed/pay/response', {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await widgetToken('pay')}`,
    },
    body: JSON.stringify({ token, cardNumber }),
  });
  return payResponse.POST(req);
}

async function unpack(token: string) {
  const req = new NextRequest(
    `http://localhost:3000/api/embed/pay/unpack?token=${encodeURIComponent(token)}`,
    { headers: { Origin: ORIGIN, Authorization: `Bearer ${await widgetToken('pay')}` } }
  );
  return payUnpack.GET(req);
}

async function record(responseToken: string) {
  const req = new NextRequest('http://localhost:3000/api/embed/checkout/payment-response', {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await widgetToken('checkout')}`,
    },
    body: JSON.stringify({ token: responseToken }),
  });
  return paymentResponse.POST(req);
}

describe('single-use payment request token (C43)', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    mp.payments = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (PaymentService as any).instance = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (InvoiceService as any).instance = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mp.getTableRecords.mockImplementation((args: { table: string; filter?: string }) => {
      if (args.table === 'Payments') {
        const code = /Transaction_Code = '(.*)'/.exec(args.filter ?? '')?.[1];
        return Promise.resolve(mp.payments.filter((p) => p.Transaction_Code === code));
      }
      if (args.table === 'Invoice_Statuses') {
        return Promise.resolve([{ Invoice_Status_ID: 1, Invoice_Status: 'None Paid' }]);
      }
      return Promise.resolve([]);
    });
    mp.executeProcedure.mockImplementation((name: string) => {
      if (name === 'api_MPPW_GetInvoice') {
        const paid = mp.payments.reduce((s, p) => s + Number(p.Payment_Total), 0);
        return Promise.resolve([
          [{ Contact_ID: 98, Invoice_ID: 6, Invoice_GUID: GUID, Invoice_Total: 40, Amount_Paid: paid, Invoice_Status_ID: 1 }],
          [],
        ]);
      }
      return Promise.resolve([[{ Invoice_Detail_ID: 11, Line_Total: 40, Payment_Amount: 0 }]]);
    });
    mp.createTableRecords.mockImplementation((table: string, rows: Array<Record<string, unknown>>) => {
      if (table === 'Payments') {
        mp.payments.push(...rows);
        return Promise.resolve([{ Payment_ID: 900 + mp.payments.length }]);
      }
      return Promise.resolve([{}]);
    });
    mp.updateTableRecords.mockResolvedValue([{}]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the three-reload replay writes exactly one Payments row', async () => {
    const requestToken = await CheckoutService.getInstance().issueRequestToken(request());

    // Back, Forward, submit — three times, with one request token.
    const submits = [];
    for (let i = 0; i < 3; i++) submits.push(await submit(requestToken));
    expect(submits.map((r) => r.status)).toEqual([200, 409, 409]);
    expect((await submits[1].json()).error).toBe('verification_used');

    // And the one response token, posted back three times (reloads of the
    // checkout page that still carries ?token=).
    const { token: responseToken } = await submits[0].json();
    const outcomes = [];
    for (let i = 0; i < 3; i++) outcomes.push(await (await record(responseToken)).json());
    expect(outcomes.map((o) => o.status)).toEqual(['received', 'received', 'received']);

    expect(mp.payments).toHaveLength(1);
    expect(mp.createTableRecords.mock.calls.filter(([t]) => t === 'Payments')).toHaveLength(1);
  });

  it('a decline does not spend the token, so another card can be tried', async () => {
    const requestToken = await CheckoutService.getInstance().issueRequestToken(request());
    expect((await submit(requestToken, '4242424242424242')).status).toBe(200);
    expect((await submit(requestToken)).status).toBe(200);
    expect((await submit(requestToken)).status).toBe(409);
  });

  it('a spent token cannot be unpacked again', async () => {
    const requestToken = await CheckoutService.getInstance().issueRequestToken(request());
    expect((await unpack(requestToken)).status).toBe(200);
    await submit(requestToken);
    const res = await unpack(requestToken);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('verification_used');
  });

  it('a token without a jti (issued before this change) is refused', async () => {
    // Signed correctly, but never recorded in the ledger.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = CheckoutService.getInstance().buildResponseToken(request() as any);
    expect((await unpack(legacy)).status).toBe(409);
  });

  it('concurrent posts of one response token write once', async () => {
    const requestToken = await CheckoutService.getInstance().issueRequestToken(request());
    const { token: responseToken } = await (await submit(requestToken)).json();
    // Hold the Payments insert open so the two requests genuinely overlap.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const insert = mp.createTableRecords.getMockImplementation()!;
    mp.createTableRecords.mockImplementation(async (table: string, rows: Array<Record<string, unknown>>) => {
      if (table === 'Payments') await gate;
      return insert(table, rows);
    });

    const first = record(responseToken);
    const second = record(responseToken);
    setTimeout(() => release(), 20);
    const statuses = (await Promise.all([first, second].map(async (r) => (await r).json()))).map(
      (o) => o.status
    );
    expect(statuses.sort()).toEqual(['pending', 'received']);
    expect(mp.payments).toHaveLength(1);
  });

  it('refuses to record an amount above the balance due', async () => {
    const requestToken = await CheckoutService.getInstance().issueRequestToken(
      request({ amount: 999999 })
    );
    const { token: responseToken } = await (await submit(requestToken)).json();
    const outcome = await (await record(responseToken)).json();
    expect(outcome.status).toBe('error');
    expect(mp.payments).toHaveLength(0);
  });
});
