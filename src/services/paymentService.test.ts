import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaymentResponseToken } from '@mpnext/types';

const mp = vi.hoisted(() => ({
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

const templates = vi.hoisted(() => {
  class TemplateNotFoundError extends Error {}
  return {
    TemplateNotFoundError,
    sendCommunicationTemplate: vi.fn(),
    sendMessageTemplate: vi.fn(),
  };
});

vi.mock('@/services/messageTemplateService', () => ({
  TemplateNotFoundError: templates.TemplateNotFoundError,
  MessageTemplateService: {
    getInstance: async () => ({
      sendCommunicationTemplate: templates.sendCommunicationTemplate,
      sendMessageTemplate: templates.sendMessageTemplate,
    }),
  },
}));

import { PaymentService } from '@/services/paymentService';
import { InvoiceService } from '@/services/invoiceService';

const GUID = 'b0b0b0b0-0000-4000-8000-000000000001';

function token(over: Partial<PaymentResponseToken> = {}): PaymentResponseToken {
  return {
    invoiceId: GUID,
    amount: 25,
    transactionSuccess: true,
    transactionCode: 'txn-1',
    type: 'CREDIT_DEBIT',
    ...over,
  };
}

/** `api_MPPW_GetInvoice` for a $100 invoice with $40 already paid. */
function getInvoiceResult() {
  return [
    [
      {
        Contact_ID: 98,
        Invoice_ID: 6,
        Invoice_GUID: GUID,
        Invoice_Total: 100,
        Amount_Paid: 40,
        Invoice_Status_ID: 2,
        Invoice_Date: '2026-09-01T00:00:00',
        First_Name: 'Pat',
        Last_Name: 'Payer',
        Email_Address: 'pat@example.org',
      },
    ],
    [],
  ];
}

/**
 * Route a mocked `getTableRecords` call by table. Payments (idempotency) is
 * empty, the status lookup answers one row, and anything else is empty.
 */
function tables(args: { table: string }) {
  if (args.table === 'Invoice_Statuses') {
    return Promise.resolve([{ Invoice_Status_ID: 2, Invoice_Status: 'Some Paid' }]);
  }
  return Promise.resolve([]);
}

describe('PaymentService.createPaymentFromResponse (C40)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (PaymentService as any).instance = undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (InvoiceService as any).instance = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mp.getTableRecords.mockImplementation(tables);
    mp.executeProcedure.mockImplementation((name: string) => {
      if (name === 'api_MPPW_GetInvoice') return Promise.resolve(getInvoiceResult());
      if (name === 'api_MPPW_GetUnpaidInvoiceDetails') {
        return Promise.resolve([
          [
            { Invoice_Detail_ID: 11, Line_Total: 50, Payment_Amount: 40 },
            { Invoice_Detail_ID: 12, Line_Total: 50, Payment_Amount: 0 },
          ],
        ]);
      }
      return Promise.reject(new Error(`unexpected proc ${name}`));
    });
    mp.createTableRecords.mockImplementation((table: string) =>
      Promise.resolve(table === 'Payments' ? [{ Payment_ID: 900 }] : [{}])
    );
    mp.updateTableRecords.mockResolvedValue([{}]);
  });

  it('never selects the phantom Invoices.Amount_Paid column', async () => {
    const svc = await PaymentService.getInstance();
    await svc.createPaymentFromResponse(token());

    const invoiceReads = mp.getTableRecords.mock.calls.filter(
      ([args]) => (args as { table: string }).table === 'Invoices'
    );
    for (const [args] of invoiceReads) {
      expect((args as { select?: string }).select ?? '').not.toContain('Amount_Paid');
    }
  });

  it('writes the Payments row and allocates only the open part of each line', async () => {
    const svc = await PaymentService.getInstance();
    const result = await svc.createPaymentFromResponse(token());

    expect(result.invoiceId).toBe(6);
    expect(mp.createTableRecords).toHaveBeenCalledWith('Payments', [
      expect.objectContaining({
        Payment_Total: 25,
        Contact_ID: 98,
        Invoice_ID: 6,
        Transaction_Code: 'txn-1',
        Payment_Type_ID: 4,
      }),
    ]);
    // Line 11 has $10 open (50 - 40), line 12 has $50: $25 → 10 + 15.
    expect(mp.createTableRecords).toHaveBeenCalledWith('Payment_Detail', [
      { Payment_ID: 900, Invoice_Detail_ID: 11, Payment_Amount: 10 },
      { Payment_ID: 900, Invoice_Detail_ID: 12, Payment_Amount: 15 },
    ]);
  });

  it('moves the invoice status from the proc paid total', async () => {
    const svc = await PaymentService.getInstance();
    // 40 already paid + 25 = 65 of 100 → Some Paid (2).
    await svc.createPaymentFromResponse(token());
    expect(mp.updateTableRecords).toHaveBeenCalledWith('Invoices', [
      { Invoice_ID: 6, Invoice_Status_ID: 2 },
    ]);

    vi.clearAllMocks();
    mp.getTableRecords.mockImplementation(tables);
    // 40 + 60 = 100 → Paid In Full (3).
    await svc.createPaymentFromResponse(token({ amount: 60, transactionCode: 'txn-2' }));
    expect(mp.updateTableRecords).toHaveBeenCalledWith('Invoices', [
      { Invoice_ID: 6, Invoice_Status_ID: 3 },
    ]);
  });

  it('escapes the transaction code in the idempotency filter', async () => {
    const svc = await PaymentService.getInstance();
    await svc.createPaymentFromResponse(token({ transactionCode: "a'b" }));
    const paymentsRead = mp.getTableRecords.mock.calls.find(
      ([args]) => (args as { table: string }).table === 'Payments'
    );
    expect((paymentsRead?.[0] as { filter: string }).filter).toBe("Transaction_Code = 'a''b'");
  });

  it('logs an MP fault at error level and answers status "error" (C41)', async () => {
    mp.executeProcedure.mockRejectedValue(new Error('GET /procs failed: 500'));
    const svc = await PaymentService.getInstance();
    const result = await svc.createPaymentFromResponse(token());
    expect(result).toMatchObject({ invoiceId: null, status: 'error' });
    expect(console.error).toHaveBeenCalled();
    expect(mp.createTableRecords).not.toHaveBeenCalled();
  });

  it('a recorded payment is status "received" (C41)', async () => {
    const svc = await PaymentService.getInstance();
    expect(await svc.createPaymentFromResponse(token())).toEqual({
      invoiceId: 6,
      status: 'received',
    });
  });

  it('a declined transaction is status "declined" and records nothing (C41)', async () => {
    const svc = await PaymentService.getInstance();
    const result = await svc.createPaymentFromResponse(token({ transactionSuccess: false }));
    expect(result).toMatchObject({ invoiceId: 6, status: 'declined' });
    expect(mp.createTableRecords).not.toHaveBeenCalled();
  });

  it('a re-posted transaction code is "received" without a second row', async () => {
    mp.getTableRecords.mockImplementation((args: { table: string }) =>
      args.table === 'Payments' ? Promise.resolve([{ Payment_ID: 900 }]) : tables(args)
    );
    const svc = await PaymentService.getInstance();
    expect((await svc.createPaymentFromResponse(token())).status).toBe('received');
    expect(mp.createTableRecords).not.toHaveBeenCalled();
  });

  describe('receipt (C66)', () => {
    beforeEach(() => {
      templates.sendCommunicationTemplate.mockReset().mockResolvedValue(undefined);
      templates.sendMessageTemplate.mockReset().mockResolvedValue(undefined);
    });

    it('sends the configured template to the payor after the Payments row', async () => {
      const svc = await PaymentService.getInstance();
      await svc.createPaymentFromResponse(token({ receiptTemplateId: 2695 }));

      expect(templates.sendCommunicationTemplate).toHaveBeenCalledWith(
        2695,
        { email: 'pat@example.org', name: 'Pat Payer' },
        expect.objectContaining({
          mpp_contact_first_name: 'Pat',
          mpp_payment_amount: '$25.00',
          mpp_transaction_code: 'txn-1',
          mpp_invoice_id: '6',
          mpp_balance_due: '$35.00',
        })
      );
      const sendOrder = templates.sendCommunicationTemplate.mock.invocationCallOrder[0];
      const insertOrder = mp.createTableRecords.mock.invocationCallOrder[0];
      expect(sendOrder).toBeGreaterThan(insertOrder);
    });

    it('falls back to a dp_Communications message template on not-found', async () => {
      templates.sendCommunicationTemplate.mockRejectedValue(new templates.TemplateNotFoundError('nf'));
      const svc = await PaymentService.getInstance();
      await svc.createPaymentFromResponse(token({ receiptTemplateId: 2695 }));
      expect(templates.sendMessageTemplate).toHaveBeenCalledWith(2695, expect.anything(), expect.anything());
    });

    it('a template fault never fails the payment', async () => {
      templates.sendCommunicationTemplate.mockRejectedValue(new Error('smtp down'));
      const svc = await PaymentService.getInstance();
      const result = await svc.createPaymentFromResponse(token({ receiptTemplateId: 2695 }));
      expect(result.status).toBe('received');
      expect(templates.sendMessageTemplate).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });

    it('sends nothing without a template id, or on a replay', async () => {
      const svc = await PaymentService.getInstance();
      await svc.createPaymentFromResponse(token());
      expect(templates.sendCommunicationTemplate).not.toHaveBeenCalled();

      mp.getTableRecords.mockImplementation((args: { table: string }) =>
        args.table === 'Payments' ? Promise.resolve([{ Payment_ID: 900 }]) : tables(args)
      );
      await svc.createPaymentFromResponse(token({ receiptTemplateId: 2695 }));
      expect(templates.sendCommunicationTemplate).not.toHaveBeenCalled();
    });
  });
});
