import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';

/**
 * `GET /api/embed/checkout/invoice` — C80 / C42.
 *
 * The defect was invisible anonymously: only a signed-in payer's read 500'd.
 * So the cases that matter are signed in — own invoice opens, another contact's
 * GUID is a 404, and an MP fault never reaches the payer as MP text.
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

function get(token: string, guid = 'inv-guid'): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/embed/checkout/invoice?guid=${guid}`,
    { headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` } }
  );
}

async function signedIn(): Promise<string> {
  return createWidgetToken({ sub: 'user-guid', wid: 'checkout', origin: ORIGIN });
}

describe('GET /api/embed/checkout/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockGetUserByGuid.mockResolvedValue({ User_ID: 1, Contact_ID: 98 });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a signed-in payer’s own invoice, scoped to their contact', async () => {
    mockGetCheckoutInvoiceByGuid.mockResolvedValue({ invoiceId: 6 });
    const res = await route.GET(get(await signedIn()));
    expect(res.status).toBe(200);
    expect(mockGetCheckoutInvoiceByGuid).toHaveBeenCalledWith('inv-guid', 98);
  });

  it("answers 404 for another contact's invoice", async () => {
    mockGetCheckoutInvoiceByGuid.mockResolvedValue(null);
    const res = await route.GET(get(await signedIn()));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'invoice_not_found' });
  });

  it('does not scope a public token', async () => {
    mockGetCheckoutInvoiceByGuid.mockResolvedValue({ invoiceId: 6 });
    const token = await createWidgetToken({ sub: 'public', wid: 'checkout', origin: ORIGIN });
    await route.GET(get(token));
    expect(mockGetUserByGuid).not.toHaveBeenCalled();
    expect(mockGetCheckoutInvoiceByGuid).toHaveBeenCalledWith('inv-guid', undefined);
  });

  it('never echoes MP text: an MP fault is mp_unavailable', async () => {
    mockGetCheckoutInvoiceByGuid.mockRejectedValue(
      new Error('GET /procs/api_MPPW_GetInvoice failed: 500 Internal Server Error')
    );
    const res = await route.GET(get(await signedIn()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('mp_unavailable');
    expect(JSON.stringify(body)).not.toMatch(/api_MPPW|500/);
  });

  it('answers auth_required for a missing token', async () => {
    const req = new NextRequest('http://localhost:3000/api/embed/checkout/invoice?guid=x', {
      headers: { Origin: ORIGIN },
    });
    const res = await route.GET(req);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('auth_required');
  });
});
