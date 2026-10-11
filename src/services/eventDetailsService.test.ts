import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventDetailsService } from '@/services/eventDetailsService';

// Hoisted: `productsService` builds a `DomainTimezoneService` (and so an
// `MPHelper`) at import time, before plain module-level consts exist.
const { mockGetTableRecords, mockExecuteProcedure } = vi.hoisted(() => ({
  mockGetTableRecords: vi.fn(),
  mockExecuteProcedure: vi.fn(),
}));

vi.mock('@/lib/providers/ministry-platform', () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    executeProcedure = mockExecuteProcedure;
  },
}));

/**
 * C80 / C01: `api_MPPW_GetInvoice` accepts `@InvoiceGuid` only. The defect was
 * invisible anonymously, so every case here that matters is the signed-in one.
 */
describe('EventDetailsService.getEventParticipantsByInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventDetailsService as any).instance = undefined;
  });

  const header = {
    Contact_ID: 98,
    Invoice_Status_ID: 1,
    Amount_Paid: 0,
    Invoice_Total: 0,
    Notes: null,
  };

  it('calls the proc with @InvoiceGuid only for a signed-in owner', async () => {
    mockExecuteProcedure.mockResolvedValueOnce([[header], []]);
    const service = await EventDetailsService.getInstance();
    const result = await service.getEventParticipantsByInvoice('inv-guid', 98);

    expect(mockExecuteProcedure).toHaveBeenCalledWith('api_MPPW_GetInvoice', {
      '@InvoiceGuid': 'inv-guid',
    });
    expect(result).toEqual({
      isInvoiceExpired: false,
      isSomePaymentExists: false,
      expiredMessageKey: null,
      participants: [],
    });
  });

  it("returns null for another contact's invoice", async () => {
    mockExecuteProcedure.mockResolvedValueOnce([[{ ...header, Contact_ID: 5 }], []]);
    const service = await EventDetailsService.getInstance();
    expect(await service.getEventParticipantsByInvoice('inv-guid', 98)).toBeNull();
  });

  it('reads anonymously without an ownership check', async () => {
    mockExecuteProcedure.mockResolvedValueOnce([[{ ...header, Contact_ID: 5 }], []]);
    const service = await EventDetailsService.getInstance();
    const result = await service.getEventParticipantsByInvoice('inv-guid');
    expect(result?.isInvoiceExpired).toBe(false);
  });
});
