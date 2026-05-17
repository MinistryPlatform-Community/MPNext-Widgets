import { describe, it, expect } from 'vitest';
import {
  InvoiceListItemSchema,
  InvoiceListResponseSchema,
  InvoiceLineItemSchema,
  InvoiceDetailResponseSchema,
  type InvoiceListItem,
  type InvoiceLineItem,
} from './invoices';

/**
 * Tests for invoice schemas. Note that several fields use
 * `.nullable().optional()` -- both undefined AND null are accepted.
 */

const validInvoice: InvoiceListItem = {
  Invoice_ID: 1001,
  Invoice_Date: '2026-05-17',
  Invoice_Total: 99.95,
  Invoice_Status_ID: 2,
  Invoice_Status: 'Paid',
  Notes: 'Thank you',
  Currency: 'USD',
  Invoice_GUID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  Product_Summary: '1x T-Shirt',
};

const validLineItem: InvoiceLineItem = {
  Invoice_Detail_ID: 5001,
  Product_Name: 'T-Shirt',
  Description: 'Logo tee',
  Item_Quantity: 1,
  Line_Total: 19.99,
  Item_Note: null,
  Recipient_Name: 'John Doe',
};

describe('InvoiceListItemSchema', () => {
  describe('happy path', () => {
    it('accepts a fully populated invoice', () => {
      expect(InvoiceListItemSchema.safeParse(validInvoice).success).toBe(true);
    });

    it('accepts null for nullable-optional fields', () => {
      const result = InvoiceListItemSchema.safeParse({
        ...validInvoice,
        Notes: null,
        Currency: null,
        Product_Summary: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts omitted nullable-optional fields', () => {
      const result = InvoiceListItemSchema.safeParse({
        Invoice_ID: 1,
        Invoice_Date: '2026-01-01',
        Invoice_Total: 10,
        Invoice_Status_ID: 1,
        Invoice_Status: 'Open',
        Invoice_GUID: 'guid',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('required fields', () => {
    const required: Array<keyof InvoiceListItem> = [
      'Invoice_ID',
      'Invoice_Date',
      'Invoice_Total',
      'Invoice_Status_ID',
      'Invoice_Status',
      'Invoice_GUID',
    ];

    for (const field of required) {
      it(`fails when "${field}" is omitted`, () => {
        const partial = { ...validInvoice };
        delete (partial as Record<string, unknown>)[field];
        const result = InvoiceListItemSchema.safeParse(partial);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path[0] === field)).toBe(true);
        }
      });
    }
  });

  describe('type validation', () => {
    it('rejects string for Invoice_ID', () => {
      const result = InvoiceListItemSchema.safeParse({ ...validInvoice, Invoice_ID: '1' });
      expect(result.success).toBe(false);
    });

    it('rejects string for Invoice_Total', () => {
      const result = InvoiceListItemSchema.safeParse({
        ...validInvoice,
        Invoice_Total: '99.95',
      });
      expect(result.success).toBe(false);
    });

    it('rejects number for Invoice_Status', () => {
      const result = InvoiceListItemSchema.safeParse({
        ...validInvoice,
        Invoice_Status: 5,
      });
      expect(result.success).toBe(false);
    });

    it('rejects number for Notes (must be string|null|undefined)', () => {
      const result = InvoiceListItemSchema.safeParse({ ...validInvoice, Notes: 42 });
      expect(result.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts negative Invoice_Total (e.g. refund)', () => {
      const result = InvoiceListItemSchema.safeParse({ ...validInvoice, Invoice_Total: -50 });
      expect(result.success).toBe(true);
    });

    it('accepts zero Invoice_Total', () => {
      const result = InvoiceListItemSchema.safeParse({ ...validInvoice, Invoice_Total: 0 });
      expect(result.success).toBe(true);
    });

    it('accepts empty string Invoice_GUID (no min constraint)', () => {
      const result = InvoiceListItemSchema.safeParse({ ...validInvoice, Invoice_GUID: '' });
      expect(result.success).toBe(true);
    });
  });
});

describe('InvoiceListResponseSchema', () => {
  it('accepts an array of invoices', () => {
    const result = InvoiceListResponseSchema.safeParse({ invoices: [validInvoice] });
    expect(result.success).toBe(true);
  });

  it('accepts an empty array', () => {
    expect(InvoiceListResponseSchema.safeParse({ invoices: [] }).success).toBe(true);
  });

  it('fails when invoices field is missing', () => {
    const result = InvoiceListResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('fails when invoices is not an array', () => {
    const result = InvoiceListResponseSchema.safeParse({ invoices: validInvoice });
    expect(result.success).toBe(false);
  });

  it('fails when an invoice in the array is invalid', () => {
    const result = InvoiceListResponseSchema.safeParse({
      invoices: [{ ...validInvoice, Invoice_Total: 'free' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('InvoiceLineItemSchema', () => {
  it('accepts a valid line item', () => {
    expect(InvoiceLineItemSchema.safeParse(validLineItem).success).toBe(true);
  });

  it('accepts omitted optional fields', () => {
    const result = InvoiceLineItemSchema.safeParse({
      Invoice_Detail_ID: 1,
      Product_Name: 'X',
      Item_Quantity: 1,
      Line_Total: 1,
    });
    expect(result.success).toBe(true);
  });

  it('fails when Product_Name is missing', () => {
    const partial = { ...validLineItem };
    delete (partial as Record<string, unknown>).Product_Name;
    const result = InvoiceLineItemSchema.safeParse(partial);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'Product_Name')).toBe(true);
    }
  });

  it('fails when Item_Quantity is not a number', () => {
    const result = InvoiceLineItemSchema.safeParse({ ...validLineItem, Item_Quantity: '1' });
    expect(result.success).toBe(false);
  });

  it('accepts null for nullable-optional Recipient_Name', () => {
    const result = InvoiceLineItemSchema.safeParse({ ...validLineItem, Recipient_Name: null });
    expect(result.success).toBe(true);
  });
});

describe('InvoiceDetailResponseSchema', () => {
  it('accepts a valid detail response', () => {
    const result = InvoiceDetailResponseSchema.safeParse({
      invoice: validInvoice,
      lineItems: [validLineItem],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty lineItems', () => {
    const result = InvoiceDetailResponseSchema.safeParse({
      invoice: validInvoice,
      lineItems: [],
    });
    expect(result.success).toBe(true);
  });

  it('fails when invoice is missing', () => {
    const result = InvoiceDetailResponseSchema.safeParse({ lineItems: [] });
    expect(result.success).toBe(false);
  });

  it('fails when lineItems is missing', () => {
    const result = InvoiceDetailResponseSchema.safeParse({ invoice: validInvoice });
    expect(result.success).toBe(false);
  });

  it('fails when a line item is invalid', () => {
    const result = InvoiceDetailResponseSchema.safeParse({
      invoice: validInvoice,
      lineItems: [{ ...validLineItem, Line_Total: 'a lot' }],
    });
    expect(result.success).toBe(false);
  });
});
