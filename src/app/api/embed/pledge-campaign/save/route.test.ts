import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import * as route from './route';
import { createWidgetToken } from '@/lib/embed/jwt';
import { __resetSessionStoreForTests } from '@/lib/embed/session-store';
import { MAX_PLEDGE_AMOUNT } from '@mpnext/types';

/**
 * `POST /api/embed/pledge-campaign/save` — the amount gate (C32).
 *
 * The comparison run wrote a `$0.00` and a `$15,999,999,999,984.00` pledge into
 * MP and told the donor "thank you" both times. The browser was the only gate,
 * so these tests go around it: a scripted POST must be refused by the schema
 * **before** the service — and therefore MP — is touched.
 */

vi.mock('@/lib/embed/config', () => ({
  allowedOrigins: ['https://allowed.example.com'],
}));

const mockSavePledge = vi.fn();

vi.mock('@/services/pledgeCampaignService', () => ({
  PledgeCampaignService: {
    getInstance: async () => ({
      savePledge: mockSavePledge,
      getUserByGuid: vi.fn(async () => null),
    }),
  },
}));

const ORIGIN = 'https://allowed.example.com';

async function token(): Promise<string> {
  return createWidgetToken({ sub: 'public', wid: 'pledge-campaign', origin: ORIGIN });
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    pledgeCampaignId: 6,
    contactId: 0,
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    installmentAmount: 10,
    frequency: 12,
    firstInstallmentDate: '2026-09-08',
    lastInstallmentDate: '2026-12-08',
    installmentsPlanned: 4,
    installmentsPerYear: 4,
    totalPledge: 40,
    ...overrides,
  };
}

async function post(payload: unknown): Promise<Response> {
  const req = new NextRequest('http://localhost:3000/api/embed/pledge-campaign/save', {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
      'x-forwarded-for': '198.51.100.12',
    },
    body: JSON.stringify(payload),
  });
  return route.POST(req);
}

describe('POST /api/embed/pledge-campaign/save amount limits (C32)', () => {
  beforeEach(() => {
    __resetSessionStoreForTests();
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSavePledge.mockResolvedValue({ success: true, pledgeId: 48 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves a sane pledge ($10 monthly Sep→Dec = $40 over 4)', async () => {
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(mockSavePledge).toHaveBeenCalledTimes(1);
    expect(mockSavePledge.mock.calls[0][0]).toMatchObject({ totalPledge: 40, installmentsPlanned: 4 });
  });

  it.each([
    ['a $0 installment', { installmentAmount: 0, totalPledge: 0 }],
    ['a $0 total', { totalPledge: 0 }],
    ['a negative installment', { installmentAmount: -50, totalPledge: -800 }],
    ['a sixteen-trillion total', { installmentAmount: 999999999999, totalPledge: 15999999999984 }],
    ['a $1e13 total', { totalPledge: 1e13 }],
    ['one cent over the ceiling', { totalPledge: MAX_PLEDGE_AMOUNT + 0.01 }],
  ])('refuses %s without touching MP', async (_label, overrides) => {
    const res = await post(body(overrides));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      pledgeId: null,
      error: 'invalid_request',
    });
    expect(mockSavePledge).not.toHaveBeenCalled();
  });

  it('accepts the ceiling itself', async () => {
    const res = await post(body({ installmentAmount: MAX_PLEDGE_AMOUNT, totalPledge: MAX_PLEDGE_AMOUNT }));
    expect(res.status).toBe(200);
  });
});
