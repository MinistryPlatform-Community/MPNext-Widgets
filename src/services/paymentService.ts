import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import { InvoiceService } from "@/services/invoiceService";
import { sqlLiteral } from "@/services/_shared/mp-lookup";
import type { PaymentOutcome, PaymentResponseToken } from "@mpnext/types";

/**
 * Payment write orchestration for the checkout flow, migrated from the legacy
 * .NET PaymentTranslator / CheckoutService payment processing. Consumes a
 * signed PaymentResponseToken (produced by the gateway / next-pay sandbox) and
 * records the payment against an invoice:
 *
 *   1. Resolve the invoice by GUID (token.invoiceId carries the Invoice_GUID).
 *   2. Idempotency guard on Transaction_Code (re-posted webhook is a no-op).
 *   3. Insert a Payments row, then allocate Payment_Detail rows across the
 *      invoice's unpaid detail lines (greedy fill, summing to token.amount).
 *   4. Bump Invoice_Status_ID to PaidInFull / SomePaid.
 *
 * The answer is one `status` discriminant (C41): `received` | `pending` |
 * `declined` | `error`. Failures are returned rather than thrown so the
 * webhook endpoint stays 200 (a vendor retrying on 5xx would double-post), but
 * every one is logged at `error` level — the silent catch is what hid C40.
 */

// Invoice status ids (mirror the legacy InvoiceStatus enum).
const INVOICE_STATUS_SOME_PAID = 2;
const INVOICE_STATUS_PAID_IN_FULL = 3;

// Payment_Type_ID values (mirror the legacy PaymentType enum).
const PAYMENT_TYPE_CREDIT_DEBIT = 4;
const PAYMENT_TYPE_ACH = 5;

interface ExistingPaymentRow {
  Payment_ID: number;
}

/** A row of `api_MPPW_GetUnpaidInvoiceDetails` result set 0. */
interface UnpaidDetailRow {
  Invoice_Detail_ID: number | string | null;
  Line_Total: number | string | null;
  /** Already allocated to this line by earlier payments. */
  Payment_Amount?: number | string | null;
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toNumber(
  value: number | string | null | undefined,
  fallback = 0
): number {
  const n = toNumberOrNull(value);
  return n === null ? fallback : n;
}

/**
 * The wire `PaymentOutcome` plus a diagnostic `detail` for the server log.
 * Routes return `{ invoiceId, status }` only — `detail` never reaches a payer.
 */
export interface PaymentResult extends PaymentOutcome {
  detail?: string;
}

export class PaymentService {
  private static instance: PaymentService;
  private mp: MPHelper | null = null;

  private constructor() {
    getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<PaymentService> {
    if (!PaymentService.instance) {
      PaymentService.instance = new PaymentService();
      await PaymentService.instance.initialize();
    }
    return PaymentService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Record a payment from a signed gateway response token.
  // ───────────────────────────────────────────────────────────────────────

  public async createPaymentFromResponse(
    token: PaymentResponseToken,
    mpContactId?: number
  ): Promise<PaymentResult> {
    try {
      // Resolve the invoice through `api_MPPW_GetInvoice` — the one definition
      // of "amount paid" in this codebase. The `Invoices` *table* has no
      // `Amount_Paid` column (C40): selecting it 500'd every payment write.
      const invoiceService = await InvoiceService.getInstance();
      const invoice = await invoiceService.getCheckoutInvoiceByGuid(
        token.invoiceId ?? ""
      );
      if (!invoice) {
        console.error(
          "PaymentService: no invoice for response token",
          token.transactionCode
        );
        return { invoiceId: null, status: "error", detail: "Invoice not found" };
      }

      const invoiceId = invoice.invoiceId;

      // Idempotency: a payment with this transaction code already exists.
      if (token.transactionCode) {
        const existing = await this.mp!.getTableRecords<ExistingPaymentRow>({
          table: "Payments",
          select: "Payment_ID",
          filter: `Transaction_Code = '${sqlLiteral(token.transactionCode)}'`,
          top: 1,
        });
        if (existing[0]) {
          return { invoiceId, status: "received" };
        }
      }

      // A declined/failed transaction records nothing.
      if (!token.transactionSuccess) {
        return { invoiceId, status: "declined", detail: "Transaction declined" };
      }

      const amount = Number(token.amount) || 0;
      const paymentTypeId =
        token.type === "CREDIT_DEBIT"
          ? PAYMENT_TYPE_CREDIT_DEBIT
          : PAYMENT_TYPE_ACH;
      const contactId = invoice.payorContactId ?? (mpContactId ?? null);

      // Payments header.
      const tz = DomainTimezoneService.getInstance();
      const now = await tz.toMpSqlDatetime(new Date().toISOString());

      const paymentRecord: Record<string, unknown> = {
        Payment_Total: amount,
        Contact_ID: contactId,
        Invoice_Number: invoiceId,
        Payment_Type_ID: paymentTypeId,
        Payment_Date: now,
        Invoice_ID: invoiceId,
        Transaction_Code: token.transactionCode,
        Notes: "Recorded by Web Widget checkout",
        Currency: "USD",
        Item_Number: token.itemNumber ?? null,
        Processed: false,
      };
      const createdPayments = (await this.mp!.createTableRecords("Payments", [
        paymentRecord,
      ])) as Array<{ Payment_ID?: number }>;
      const paymentId = createdPayments[0]?.Payment_ID;
      if (!paymentId) {
        console.error(
          "PaymentService: MP returned no Payment_ID for",
          token.transactionCode
        );
        return { invoiceId, status: "error", detail: "Failed to create payment" };
      }

      // Allocate the payment across the invoice's unpaid detail lines.
      await this.allocatePaymentDetails(paymentId, invoiceId, amount);

      // Update the invoice status from the proc's paid total plus this payment.
      const newAmountPaid = Number((invoice.amountPaid + amount).toFixed(2));
      const newStatusId =
        newAmountPaid >= invoice.invoiceTotal
          ? INVOICE_STATUS_PAID_IN_FULL
          : INVOICE_STATUS_SOME_PAID;
      try {
        await this.mp!.updateTableRecords("Invoices", [
          { Invoice_ID: invoiceId, Invoice_Status_ID: newStatusId },
        ]);
      } catch (err) {
        // The payment is recorded; a stale status is a staff-visible nuisance,
        // not a lost payment. Still `error`: it needs a human.
        console.error("PaymentService: invoice status update failed:", err);
      }

      return { invoiceId, status: "received" };
    } catch (error) {
      // Keep the 200 for webhooks (a vendor retrying on 5xx would double-post),
      // but never quietly: this catch is what hid C40 for the widget's life.
      console.error("PaymentService: createPaymentFromResponse failed:", error);
      return { invoiceId: null, status: "error", detail: "Payment processing failed" };
    }
  }

  /**
   * Create Payment_Detail rows summing to `amount`, greedily filling each unpaid
   * invoice detail line up to its remaining balance. If the unpaid-details proc
   * is unavailable or returns nothing, fall back to a single Payment_Detail
   * against the first invoice detail line (best-effort).
   */
  private async allocatePaymentDetails(
    paymentId: number,
    invoiceId: number,
    amount: number
  ): Promise<void> {
    let unpaid: UnpaidDetailRow[] = [];
    try {
      const result = await this.mp!.executeProcedure(
        "api_MPPW_GetUnpaidInvoiceDetails",
        { "@InvoiceId": invoiceId }
      );
      unpaid = (result[0] as UnpaidDetailRow[] | undefined) ?? [];
    } catch (err) {
      console.warn(
        "PaymentService: api_MPPW_GetUnpaidInvoiceDetails unavailable, using fallback allocation:",
        err
      );
    }

    const records: Record<string, unknown>[] = [];

    if (unpaid.length > 0) {
      let remaining = Number(amount.toFixed(2));
      for (const row of unpaid) {
        if (remaining <= 0) break;
        const detailId = toNumberOrNull(row.Invoice_Detail_ID);
        if (detailId == null) continue;
        // The proc returns each line's total *and* what is already paid on it
        // (verified live 2026-10-11); only the difference is open.
        const lineRemaining = Math.max(
          0,
          toNumber(row.Line_Total) - toNumber(row.Payment_Amount)
        );
        const applied = Number(Math.min(remaining, lineRemaining).toFixed(2));
        if (applied <= 0) continue;
        records.push({
          Payment_ID: paymentId,
          Invoice_Detail_ID: detailId,
          Payment_Amount: applied,
        });
        remaining = Number((remaining - applied).toFixed(2));
      }
      // Any rounding/leftover amount lands on the last allocated line.
      if (remaining > 0 && records.length > 0) {
        const last = records[records.length - 1];
        last.Payment_Amount =
          Number((last.Payment_Amount as number).toFixed(2)) + remaining;
        last.Payment_Amount = Number((last.Payment_Amount as number).toFixed(2));
      }
    }

    // Fallback: allocate the full amount to the first invoice detail line.
    if (records.length === 0) {
      const details = await this.mp!.getTableRecords<{ Invoice_Detail_ID: number }>(
        {
          table: "Invoice_Detail",
          select: "Invoice_Detail_ID",
          filter: `Invoice_ID = ${invoiceId}`,
          top: 1,
        }
      );
      const firstDetailId = details[0]?.Invoice_Detail_ID;
      if (firstDetailId) {
        console.warn(
          "PaymentService: falling back to single Payment_Detail on detail",
          firstDetailId
        );
        records.push({
          Payment_ID: paymentId,
          Invoice_Detail_ID: firstDetailId,
          Payment_Amount: Number(amount.toFixed(2)),
        });
      }
    }

    if (records.length > 0) {
      await this.mp!.createTableRecords("Payment_Detail", records);
    }
  }
}
