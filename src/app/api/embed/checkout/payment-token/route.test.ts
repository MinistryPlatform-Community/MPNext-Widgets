import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { CheckoutService } from '@/services/checkoutService';

/**
 * `GET /api/embed/checkout/payment-token` — the server half of C43's overpay
 * guard, the single-use `jti`, and the C80 signed-in scoping.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const mockGetUserByGuid = vi.fn();
const mockGetCheckoutInvoiceByGuid = vi.fn();

vi.mock('@/services/invoiceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/invoiceService')>();
  return {
    ...actual,
    InvoiceService: {
      getInstance: async () => ({
        getUserByGuid: mockGetUserByGuid,
        getCheckoutInvoiceByGuid: mockGetCheckoutInvoiceByGuid,
      }),
    },
  };
});

const ORIGIN = 'https://allowed.example.com';

const INVOICE = {
  invoiceId: 6,
  invoiceGuid: 'inv-guid',
  balanceDue: 40,
  canPay: true,
  payorContactId: 98,
  payor: {
    firstName: 'Pat', lastName: 'Payer', email: null, mobilePhone: null,
    addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null,
  },
};

async function get(query: string, sub = 'public'): Promise<Response> {
  const token = await createWidgetToken({ sub, wid: 'checkout', origin: ORIGIN });
  return route.GET(
    new NextRequest(`http://localhost:3000/api/embed/checkout/payment-token?${query}`, {
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
    })
  );
}

describe('GET /api/embed/checkout/payment-token', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    vi.stubEnv('EMBED_PUBLIC_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetCheckoutInvoiceByGuid.mockResolvedValue(INVOICE);
    mockGetUserByGuid.mockResolvedValue({ User_ID: 1, Contact_ID: 98 });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses an amount above the balance due with 422 (C43)', async () => {
    const res = await get('guid=inv-guid&amount=999999');
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('invalid_request');
  });

  it('accepts exactly the balance, despite float noise', async () => {
    mockGetCheckoutInvoiceByGuid.mockResolvedValue({ ...INVOICE, balanceDue: 0.3 });
    const res = await get(`guid=inv-guid&amount=${0.1 + 0.2}`);
    expect(res.status).toBe(200);
  });

  it('issues a token with an open jti, and points notify at this host', async () => {
    const res = await get('guid=inv-guid&amount=10');
    const { token } = await res.json();
    const checkout = CheckoutService.getInstance();
    const request = checkout.decodeRequestToken(token);
    expect(request.jti).toBeTruthy();
    expect(await checkout.isRequestOpen(request)).toBe(true);
    expect(request.paymentNotifyUrl).toBe('http://localhost:3000/api/embed/payment/notify');
  });

  it('scopes a signed-in payer to their own invoice (C80)', async () => {
    await get('guid=inv-guid', 'user-guid');
    expect(mockGetCheckoutInvoiceByGuid).toHaveBeenCalledWith('inv-guid', 98);
  });
});
