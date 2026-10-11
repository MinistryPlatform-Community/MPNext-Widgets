import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvoiceService, resolveInvoiceOwner } from '@/services/invoiceService';

const mockGetTableRecords = vi.fn();
const mockExecuteProcedure = vi.fn();

vi.mock('@/lib/providers/ministry-platform', () => {
  return {
    MPHelper: class {
      getTableRecords = mockGetTableRecords;
      executeProcedure = mockExecuteProcedure;
    },
  };
});

/** An `api_MPPW_GetInvoice` result: header in [0][0], detail rows in [1]. */
function procResult(header: Record<string, unknown>, details: Record<string, unknown>[] = []) {
  return [
    [
      {
        Contact_ID: 98,
        First_Name: 'Pat',
        Last_Name: 'Payer',
        Mobile_Phone: null,
        Email_Address: 'pat@example.org',
        Address_Line_1: null,
        Address_Line_2: null,
        City: null,
        State: null,
        Postal_Code: null,
        Amount_Paid: 0,
        Invoice_ID: 6,
        Invoice_Date: '2026-09-01T00:00:00',
        Invoice_GUID: 'inv-guid',
        Invoice_Total: 40,
        Invoice_Status_ID: 1,
        Notes: null,
        ...header,
      },
    ],
    details,
  ];
}

describe('getCheckoutInvoiceByGuid (C80 / C42)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (InvoiceService as any).instance = undefined;
    mockGetTableRecords.mockResolvedValue([{ Invoice_Status_ID: 1, Invoice_Status: 'Pending' }]);
  });

  it('calls the proc with @InvoiceGuid only, signed in', async () => {
    mockExecuteProcedure.mockResolvedValueOnce(procResult({}));
    const service = await InvoiceService.getInstance();
    const invoice = await service.getCheckoutInvoiceByGuid('inv-guid', 98);

    expect(mockExecuteProcedure).toHaveBeenCalledWith('api_MPPW_GetInvoice', {
      '@InvoiceGuid': 'inv-guid',
    });
    expect(invoice?.invoiceId).toBe(6);
    expect(invoice?.balanceDue).toBe(40);
  });

  it("returns null for another contact's invoice when signed in", async () => {
    mockExecuteProcedure.mockResolvedValueOnce(procResult({ Contact_ID: 1234 }));
    const service = await InvoiceService.getInstance();
    expect(await service.getCheckoutInvoiceByGuid('inv-guid', 98)).toBeNull();
  });

  it('does not scope the anonymous read', async () => {
    mockExecuteProcedure.mockResolvedValueOnce(procResult({ Contact_ID: 1234 }));
    const service = await InvoiceService.getInstance();
    const invoice = await service.getCheckoutInvoiceByGuid('inv-guid');
    expect(invoice?.payorContactId).toBe(1234);
  });

  it('carries Event_ID onto the lines and the invoice (C49)', async () => {
    mockExecuteProcedure.mockResolvedValueOnce(
      procResult({}, [
        { Invoice_Detail_ID: 1, Item_Name: 'Fee', Line_Total: 40, Item_Quantity: 1, Event_ID: null },
        { Invoice_Detail_ID: 2, Item_Name: 'Camp', Line_Total: 0, Item_Quantity: 1, Event_ID: 16 },
      ])
    );
    const service = await InvoiceService.getInstance();
    const invoice = await service.getCheckoutInvoiceByGuid('inv-guid');
    expect(invoice?.lineItems.map((li) => li.eventId)).toEqual([null, 16]);
    expect(invoice?.eventId).toBe(16);
  });

  it('returns null when the proc has no header row', async () => {
    mockExecuteProcedure.mockResolvedValueOnce([[], []]);
    const service = await InvoiceService.getInstance();
    expect(await service.getCheckoutInvoiceByGuid('nope', 98)).toBeNull();
  });
});

describe('getInvoices filters (C60)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (InvoiceService as any).instance = undefined;
    mockGetTableRecords.mockResolvedValue([]);
  });

  async function filterFor(filters: Parameters<InvoiceService['getInvoices']>[2]) {
    const service = await InvoiceService.getInstance();
    await service.getInvoices(100, undefined, filters);
    const call = mockGetTableRecords.mock.calls.filter(([a]) => a.table === 'Invoices').at(-1);
    return (call?.[0] as { filter: string }).filter;
  }

  it('narrows by congregation, month and legacy status vocabulary in MP', async () => {
    expect(await filterFor({ congregationId: 4, monthId: 10, invoiceStatus: 1 })).toBe(
      'Purchaser_Contact_ID = 100 AND Congregation_ID = 4 AND MONTH(Invoice_Date) = 10 AND Invoice_Status_ID IN (1,2)'
    );
    expect(await filterFor({ invoiceStatus: 2 })).toBe(
      'Purchaser_Contact_ID = 100 AND Invoice_Status_ID = 3'
    );
  });

  it('ignores out-of-range values and "all"', async () => {
    expect(await filterFor({ congregationId: 0, monthId: 13, invoiceStatus: 0 })).toBe(
      'Purchaser_Contact_ID = 100'
    );
  });
});

describe('resolveInvoiceOwner', () => {
  it('is undefined for a public token', async () => {
    const svc = { getUserByGuid: vi.fn() };
    expect(await resolveInvoiceOwner(svc, 'public')).toBeUndefined();
    expect(svc.getUserByGuid).not.toHaveBeenCalled();
  });

  it("is the signed-in user's contact", async () => {
    const svc = { getUserByGuid: vi.fn().mockResolvedValue({ Contact_ID: 98 }) };
    expect(await resolveInvoiceOwner(svc, 'user-guid')).toBe(98);
  });

  it('fails closed (0) when the user has no dp_Users row', async () => {
    const svc = { getUserByGuid: vi.fn().mockResolvedValue(null) };
    expect(await resolveInvoiceOwner(svc, 'user-guid')).toBe(0);
  });
});

describe('InvoiceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (InvoiceService as any).instance = undefined;
  });

  describe('getInstance', () => {
    it('should return a singleton instance', async () => {
      const instance1 = await InvoiceService.getInstance();
      const instance2 = await InvoiceService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('getUserByGuid', () => {
    const guid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    it('should return User_ID and Contact_ID when a user is found', async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { User_ID: 1, User_GUID: guid, Contact_ID: 100 },
      ]);

      const service = await InvoiceService.getInstance();
      const result = await service.getUserByGuid(guid);

      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: 'dp_Users',
        select: 'User_ID,User_GUID,Contact_ID',
        filter: `User_GUID = '${guid}'`,
        top: 1,
      });
      expect(result).toEqual({ User_ID: 1, Contact_ID: 100 });
    });

    it('should return null when no user is found', async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);

      const service = await InvoiceService.getInstance();
      const result = await service.getUserByGuid(guid);

      expect(result).toBeNull();
    });

    it('should propagate MPHelper errors', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('boom'));

      const service = await InvoiceService.getInstance();
      await expect(service.getUserByGuid(guid)).rejects.toThrow('boom');
    });
  });

  describe('getInvoices', () => {
    it('should fetch invoices, status map, and product summaries and merge them', async () => {
      mockGetTableRecords
        // 1) Invoices query
        .mockResolvedValueOnce([
          {
            Invoice_ID: 10,
            Invoice_Date: '2026-01-01',
            Invoice_Total: 50,
            Invoice_Status_ID: 2,
            Notes: null,
            Currency: 'USD',
            Invoice_GUID: 'inv-guid-10',
          },
          {
            Invoice_ID: 11,
            Invoice_Date: '2026-01-02',
            Invoice_Total: 75,
            Invoice_Status_ID: 99, // unknown status
            Notes: 'thanks',
            Currency: 'USD',
            Invoice_GUID: 'inv-guid-11',
          },
        ])
        // 2) Invoice_Statuses lookup
        .mockResolvedValueOnce([
          { Invoice_Status_ID: 1, Invoice_Status: 'Pending' },
          { Invoice_Status_ID: 2, Invoice_Status: 'Paid' },
        ])
        // 3) Invoice_Detail batch
        .mockResolvedValueOnce([
          { Invoice_Detail_ID: 100, Invoice_ID: 10, Product_ID: 500, Item_Quantity: 1, Line_Total: 50, Item_Note: null, Recipient_Name: 'Alice' },
          { Invoice_Detail_ID: 101, Invoice_ID: 11, Product_ID: 500, Item_Quantity: 1, Line_Total: 25, Item_Note: null, Recipient_Name: null },
          { Invoice_Detail_ID: 102, Invoice_ID: 11, Product_ID: 501, Item_Quantity: 2, Line_Total: 50, Item_Note: null, Recipient_Name: null },
        ])
        // 4) Products lookup (client credentials path)
        .mockResolvedValueOnce([
          { Product_ID: 500, Product_Name: 'Camp Registration', Description: null },
          { Product_ID: 501, Product_Name: 'T-Shirt', Description: null },
        ]);

      const service = await InvoiceService.getInstance();
      const result = await service.getInvoices(100);

      expect(mockGetTableRecords).toHaveBeenNthCalledWith(1, {
        table: 'Invoices',
        select: 'Invoice_ID,Invoice_Date,Invoice_Total,Invoice_Status_ID,Notes,Currency,Invoice_GUID',
        filter: 'Purchaser_Contact_ID = 100',
        orderBy: 'Invoice_Date DESC',
      });
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(2, {
        table: 'Invoice_Statuses',
        select: 'Invoice_Status_ID,Invoice_Status',
      });

      expect(result).toHaveLength(2);
      const inv10 = result.find((r) => r.Invoice_ID === 10)!;
      const inv11 = result.find((r) => r.Invoice_ID === 11)!;
      expect(inv10.Invoice_Status).toBe('Paid');
      expect(inv10.Product_Summary).toBe('Alice — Camp Registration');
      expect(inv11.Invoice_Status).toBe('Unknown');
      // inv11 has two line items, so summary is "<first> + 1 more"
      expect(inv11.Product_Summary).toMatch(/ \+ 1 more$/);
    });

    it('should return [] when the contact has no invoices', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([]) // invoices
        .mockResolvedValueOnce([{ Invoice_Status_ID: 1, Invoice_Status: 'Pending' }]); // statuses

      const service = await InvoiceService.getInstance();
      const result = await service.getInvoices(100);

      expect(result).toEqual([]);
    });

    it('should still return invoices when product summary lookup fails', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([
          {
            Invoice_ID: 10,
            Invoice_Date: '2026-01-01',
            Invoice_Total: 50,
            Invoice_Status_ID: 2,
            Notes: null,
            Currency: 'USD',
            Invoice_GUID: 'g',
          },
        ])
        .mockResolvedValueOnce([{ Invoice_Status_ID: 2, Invoice_Status: 'Paid' }])
        // Invoice_Detail rejects → caught and warned
        .mockRejectedValueOnce(new Error('detail fetch failed'));

      const service = await InvoiceService.getInstance();
      const result = await service.getInvoices(100);

      expect(result).toHaveLength(1);
      expect(result[0].Product_Summary).toBeNull();
    });

    it('should propagate errors from the primary invoice query', async () => {
      mockGetTableRecords.mockRejectedValueOnce(new Error('inv error'));

      const service = await InvoiceService.getInstance();
      await expect(service.getInvoices(100)).rejects.toThrow('inv error');
    });
  });

  describe('getInvoiceDetail', () => {
    it('should fetch invoice, line items, and product names', async () => {
      mockGetTableRecords
        // 1) Invoices (security check)
        .mockResolvedValueOnce([
          {
            Invoice_ID: 10,
            Invoice_Date: '2026-01-01',
            Invoice_Total: 50,
            Invoice_Status_ID: 2,
            Notes: 'note',
            Currency: 'USD',
            Invoice_GUID: 'g',
          },
        ])
        // 2) Invoice_Statuses
        .mockResolvedValueOnce([{ Invoice_Status_ID: 2, Invoice_Status: 'Paid' }])
        // 3) Invoice_Detail
        .mockResolvedValueOnce([
          { Invoice_Detail_ID: 100, Item_Quantity: 1, Line_Total: 50, Item_Note: null, Recipient_Name: null, Product_ID: 500 },
        ])
        // 4) Products
        .mockResolvedValueOnce([
          { Product_ID: 500, Product_Name: 'Camp Registration', Description: 'desc' },
        ]);

      const service = await InvoiceService.getInstance();
      const result = await service.getInvoiceDetail(10, 100);

      expect(mockGetTableRecords).toHaveBeenNthCalledWith(1, {
        table: 'Invoices',
        select: 'Invoice_ID,Invoice_Date,Invoice_Total,Invoice_Status_ID,Notes,Currency,Invoice_GUID',
        filter: 'Invoice_ID = 10 AND Purchaser_Contact_ID = 100',
        top: 1,
      });
      expect(mockGetTableRecords).toHaveBeenNthCalledWith(3, {
        table: 'Invoice_Detail',
        select: 'Invoice_Detail_ID,Item_Quantity,Line_Total,Item_Note,Recipient_Name,Product_ID',
        filter: 'Invoice_ID = 10',
      });
      expect(result?.invoice.Invoice_ID).toBe(10);
      expect(result?.invoice.Invoice_Status).toBe('Paid');
      expect(result?.lineItems).toEqual([
        {
          Invoice_Detail_ID: 100,
          Product_Name: 'Camp Registration',
          Description: 'desc',
          Item_Quantity: 1,
          Line_Total: 50,
          Item_Note: null,
          Recipient_Name: null,
        },
      ]);
    });

    it('should return null when the invoice does not belong to the contact', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([]) // no matching invoice
        .mockResolvedValueOnce([]); // status map

      const service = await InvoiceService.getInstance();
      const result = await service.getInvoiceDetail(10, 100);

      expect(result).toBeNull();
    });

    it('should fall back to "Product #ID" naming when product lookup fails', async () => {
      mockGetTableRecords
        .mockResolvedValueOnce([
          {
            Invoice_ID: 10,
            Invoice_Date: '2026-01-01',
            Invoice_Total: 50,
            Invoice_Status_ID: 2,
            Notes: null,
            Currency: 'USD',
            Invoice_GUID: 'g',
          },
        ])
        .mockResolvedValueOnce([{ Invoice_Status_ID: 2, Invoice_Status: 'Paid' }])
        .mockResolvedValueOnce([
          { Invoice_Detail_ID: 100, Item_Quantity: 1, Line_Total: 50, Item_Note: null, Recipient_Name: null, Product_ID: 500 },
        ])
        // Products lookup fails → fallback
        .mockRejectedValueOnce(new Error('no perms'));

      const service = await InvoiceService.getInstance();
      const result = await service.getInvoiceDetail(10, 100);

      expect(result?.lineItems[0].Product_Name).toBe('Product #500');
      expect(result?.lineItems[0].Description).toBeNull();
    });
  });
});

describe('getInvoices product summaries are batched (mp-url-length)', () => {
  // 230 invoices and 150 distinct products: both lists are past the ~75 ids at
  // which one unbatched `X_ID = n OR ...` filter overflowed IIS's 2048-char
  // query limit and blanked every Product_Summary.
  const INVOICES = Array.from({ length: 230 }, (_, i) => 7_000_000 + i);
  const PRODUCTS = Array.from({ length: 150 }, (_, i) => 8_000_000 + i);

  function idsIn(filter: string): number[] {
    const list = /IN \(([^)]*)\)/.exec(filter)?.[1] ?? '';
    return list.split(',').filter(Boolean).map(Number);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (InvoiceService as any).instance = undefined;
    mockGetTableRecords.mockImplementation(async (q: { table: string; filter?: string }) => {
      switch (q.table) {
        case 'Invoices':
          return INVOICES.map((Invoice_ID) => ({ Invoice_ID, Invoice_Status_ID: 1 }));
        case 'Invoice_Statuses':
          return [{ Invoice_Status_ID: 1, Invoice_Status: 'Pending' }];
        case 'Invoice_Detail':
          return idsIn(q.filter!).map((Invoice_ID) => ({
            Invoice_Detail_ID: Invoice_ID,
            Invoice_ID,
            Product_ID: PRODUCTS[(Invoice_ID - INVOICES[0]) % PRODUCTS.length],
            Recipient_Name: null,
          }));
        case 'Products':
          return idsIn(q.filter!).map((Product_ID) => ({
            Product_ID,
            Product_Name: `P${Product_ID}`,
            Description: null,
          }));
        default:
          return [];
      }
    });
  });

  function filtersFor(table: string): string[] {
    return mockGetTableRecords.mock.calls
      .filter(([a]) => a.table === table)
      .map(([a]) => (a as { filter: string }).filter);
  }

  it('reads Invoice_Detail and Products in IN batches of at most 100 and merges every row', async () => {
    const service = await InvoiceService.getInstance();
    const result = await service.getInvoices(100);

    const detailFilters = filtersFor('Invoice_Detail');
    expect(detailFilters).toHaveLength(3);
    for (const f of detailFilters) {
      expect(f).toMatch(/^Invoice_ID IN \(/);
      expect(f).not.toMatch(/ OR /);
      expect(idsIn(f).length).toBeLessThanOrEqual(100);
    }
    expect(new Set(detailFilters.flatMap(idsIn))).toEqual(new Set(INVOICES));

    const productFilters = filtersFor('Products');
    expect(productFilters).toHaveLength(2);
    expect(new Set(productFilters.flatMap(idsIn))).toEqual(new Set(PRODUCTS));

    expect(result).toHaveLength(INVOICES.length);
    expect(result.every((r) => typeof r.Product_Summary === 'string')).toBe(true);
  });

  it('batches the user-token Products read the same way', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const filter = new URL(url).searchParams.get('$filter') ?? '';
      return {
        ok: true,
        json: async () =>
          idsIn(filter).map((Product_ID) => ({ Product_ID, Product_Name: `U${Product_ID}`, Description: null })),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const service = await InvoiceService.getInstance();
      const result = await service.getInvoices(100, 'user-token');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [url] of fetchMock.mock.calls) {
        expect(new URL(url).search.length).toBeLessThan(2048);
      }
      expect(filtersFor('Products')).toHaveLength(0);
      expect(result.every((r) => r.Product_Summary?.startsWith('U'))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
