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

/**
 * C20 class: the household-address prefill is best-effort, but a failed read
 * used to be swallowed with no trace, so a broken column read as "no address".
 */
describe('EventDetailsService.getBasicContact household address prefill', () => {
  const CONTACT = {
    Contact_ID: 44,
    First_Name: 'Sarah',
    Last_Name: 'Kehayias',
    Email_Address: 'sarah@example.com',
    Mobile_Phone: '321-555-0101',
    Household_ID: 77,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (EventDetailsService as any).instance = undefined;
    mockExecuteProcedure.mockResolvedValue([[{ ContactId: 44, HouseholdId: 77, IsStaff: 0 }]]);
  });

  it('logs a failed address read without PII and still returns the contact', async () => {
    mockGetTableRecords.mockImplementation(async (q: { table: string }) => {
      if (q.table === 'Contacts') return [CONTACT];
      throw new Error("Invalid column name 'Address_ID'");
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const service = await EventDetailsService.getInstance();
      const result = await service.getBasicContact(1);

      expect(result?.contactId).toBe(44);
      expect(result?.addressLine1).toBeNull();
      expect(error).toHaveBeenCalledTimes(1);
      const logged = error.mock.calls[0].map(String).join(' ');
      expect(logged).toContain('household address read failed');
      expect(logged).toContain("Invalid column name 'Address_ID'");
      expect(logged).not.toMatch(/77|Sarah|Kehayias|sarah@example\.com/);
    } finally {
      error.mockRestore();
    }
  });

  it('does not log when the household simply has no address', async () => {
    mockGetTableRecords.mockImplementation(async (q: { table: string }) =>
      q.table === 'Contacts' ? [CONTACT] : [{ Address_ID: null }]
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const service = await EventDetailsService.getInstance();
      const result = await service.getBasicContact(1);
      expect(result?.addressLine1).toBeNull();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
