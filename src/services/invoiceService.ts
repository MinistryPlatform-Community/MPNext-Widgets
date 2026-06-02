import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import type {
  InvoiceListItem,
  InvoiceLineItem,
  InvoiceDetailResponse,
  CheckoutInvoice,
  CheckoutLineItem,
} from "@mpnext/types";

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface InvoiceRecord {
  Invoice_ID: number;
  Invoice_Date: string;
  Invoice_Total: number;
  Invoice_Status_ID: number;
  Invoice_Status?: string;
  Notes: string | null;
  Currency: string | null;
  Invoice_GUID: string;
}

interface InvoiceDetailRecord {
  Invoice_Detail_ID: number;
  Product_ID: number;
  Item_Quantity: number;
  Line_Total: number;
  Item_Note: string | null;
  Recipient_Name: string | null;
}

interface ProductRecord {
  Product_ID: number;
  Product_Name: string;
  Description: string | null;
}

// ── api_MPPW_GetInvoice proc result shapes (header = result[0][0], details = result[1]) ──

interface CheckoutInvoiceHeaderRow {
  Contact_ID: number | string | null;
  First_Name: string | null;
  Last_Name: string | null;
  Mobile_Phone: string | null;
  Email_Address: string | null;
  Address_Line_1: string | null;
  Address_Line_2: string | null;
  City: string | null;
  State: string | null;
  Postal_Code: string | null;
  Amount_Paid: number | string | null;
  Invoice_ID: number | string | null;
  Invoice_Date: string | null;
  Invoice_GUID: string | null;
  Invoice_Total: number | string | null;
  Invoice_Status_ID: number | string | null;
  Notes: string | null;
}

interface CheckoutInvoiceDetailRow {
  Invoice_Detail_ID: number | string | null;
  Sub_Item: boolean | number | null;
  Item_Name: string | null;
  Item_Note: string | null;
  Line_Total: number | string | null;
  Item_Quantity: number | string | null;
  Product_ID: number | string | null;
  Recipient_Name: string | null;
  Deposit_Requested: boolean | number | null;
  Event_ID: number | string | null;
  Program_ID: number | string | null;
  Event_Participant_ID: number | string | null;
  Participation_Status_ID: number | string | null;
  Product_Option_Price_ID: number | string | null;
}

// Invoice status ids (mirror the legacy InvoiceStatus enum).
const CHECKOUT_INVOICE_STATUS_CANCELLED = 7;

function toCheckoutNumberOrNull(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toCheckoutNumber(
  value: number | string | null | undefined,
  fallback = 0
): number {
  const n = toCheckoutNumberOrNull(value);
  return n === null ? fallback : n;
}

export class InvoiceService {
  private static instance: InvoiceService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<InvoiceService> {
    if (!InvoiceService.instance) {
      InvoiceService.instance = new InvoiceService();
      await InvoiceService.instance.initialize();
    }
    return InvoiceService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── User Identity ──

  public async getUserByGuid(
    guid: string
  ): Promise<{ User_ID: number; Contact_ID: number } | null> {
    const users = await this.mp!.getTableRecords<DpUserRecord>({
      table: "dp_Users",
      select: "User_ID,User_GUID,Contact_ID",
      filter: `User_GUID = '${guid}'`,
      top: 1,
    });

    if (!users[0]) {
      console.error("InvoiceService: No dp_Users record for GUID:", guid);
      return null;
    }

    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Status Lookup ──

  private statusCache: Map<number, string> | null = null;

  private async getStatusMap(): Promise<Map<number, string>> {
    if (this.statusCache) return this.statusCache;

    const statuses = await this.mp!.getTableRecords<{
      Invoice_Status_ID: number;
      Invoice_Status: string;
    }>({
      table: "Invoice_Statuses",
      select: "Invoice_Status_ID,Invoice_Status",
    });

    this.statusCache = new Map(
      statuses.map((s) => [s.Invoice_Status_ID, s.Invoice_Status])
    );
    return this.statusCache;
  }

  // ── Invoice List ──

  public async getInvoices(
    contactId: number,
    mpAccessToken?: string
  ): Promise<InvoiceListItem[]> {
    const [records, statusMap] = await Promise.all([
      this.mp!.getTableRecords<InvoiceRecord>({
        table: "Invoices",
        select:
          "Invoice_ID,Invoice_Date,Invoice_Total,Invoice_Status_ID,Notes,Currency,Invoice_GUID",
        filter: `Purchaser_Contact_ID = ${contactId}`,
        orderBy: "Invoice_Date DESC",
      }),
      this.getStatusMap(),
    ]);

    // Fetch product summaries for all invoices
    const invoiceIds = records.map((r) => r.Invoice_ID);
    const productSummaryMap = await this.getProductSummaries(invoiceIds, mpAccessToken);

    return records.map((r) => ({
      Invoice_ID: r.Invoice_ID,
      Invoice_Date: r.Invoice_Date,
      Invoice_Total: r.Invoice_Total,
      Invoice_Status_ID: r.Invoice_Status_ID,
      Invoice_Status: statusMap.get(r.Invoice_Status_ID) || "Unknown",
      Notes: r.Notes,
      Currency: r.Currency,
      Invoice_GUID: r.Invoice_GUID,
      Product_Summary: productSummaryMap.get(r.Invoice_ID) || null,
    }));
  }

  /**
   * For each invoice, fetch the first product name from its line items.
   * Returns a map of Invoice_ID → product summary string.
   */
  private async getProductSummaries(
    invoiceIds: number[],
    mpAccessToken?: string
  ): Promise<Map<number, string>> {
    const summaryMap = new Map<number, string>();
    if (invoiceIds.length === 0) return summaryMap;

    try {
      // Batch-fetch all Invoice_Detail records for these invoices
      const filter = invoiceIds.map((id) => `Invoice_ID = ${id}`).join(" OR ");
      const details = await this.mp!.getTableRecords<InvoiceDetailRecord & { Invoice_ID: number }>({
        table: "Invoice_Detail",
        select: "Invoice_Detail_ID,Invoice_ID,Product_ID,Item_Quantity,Line_Total,Item_Note,Recipient_Name",
        filter,
      });

      // Collect unique Product_IDs
      const productIds = [...new Set(details.map((d) => d.Product_ID))];
      const productMap = await this.getProductMap(productIds, mpAccessToken);

      // Group details by Invoice_ID and build summary
      const grouped = new Map<number, typeof details>();
      for (const d of details) {
        if (!grouped.has(d.Invoice_ID)) grouped.set(d.Invoice_ID, []);
        grouped.get(d.Invoice_ID)!.push(d);
      }

      for (const [invoiceId, items] of grouped) {
        // Build line descriptions with product name and recipient
        const lineDescriptions = items.map((item) => {
          const productName = productMap.get(item.Product_ID)?.Product_Name;
          const recipient = item.Recipient_Name?.trim();
          if (recipient && productName) {
            return `${recipient} — ${productName}`;
          }
          return productName || null;
        }).filter(Boolean) as string[];

        if (lineDescriptions.length === 1) {
          summaryMap.set(invoiceId, lineDescriptions[0]);
        } else if (lineDescriptions.length > 1) {
          summaryMap.set(invoiceId, `${lineDescriptions[0]} + ${lineDescriptions.length - 1} more`);
        }
      }
    } catch (err) {
      console.warn("InvoiceService: Failed to fetch product summaries:", err);
    }

    return summaryMap;
  }

  // ── Product Lookup ──

  private productCache: Map<number, { Product_Name: string; Description: string | null }> = new Map();

  /**
   * Fetch product info using the user's own MP access token.
   * Client credentials don't have permission to the Products table,
   * but the user's OIDC token (from MP Widget Login) does.
   */
  private async fetchProductsWithUserToken(
    productIds: number[],
    mpAccessToken: string
  ): Promise<ProductRecord[]> {
    const filter = productIds.map((id) => `Product_ID = ${id}`).join(" OR ");
    const params = new URLSearchParams({
      $select: "Product_ID,Product_Name,Description",
      $filter: filter,
    });

    const url = `${this.mpBaseUrl}/tables/Products?${params}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Products fetch with user token failed: ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as ProductRecord[];
  }

  private async getProductMap(
    productIds: number[],
    mpAccessToken?: string
  ): Promise<Map<number, { Product_Name: string; Description: string | null }>> {
    const uncached = productIds.filter((id) => !this.productCache.has(id));
    if (uncached.length === 0) return this.productCache;

    // Strategy 1: Use the user's MP access token (preferred — has table permissions)
    if (mpAccessToken) {
      try {
        const products = await this.fetchProductsWithUserToken(uncached, mpAccessToken);
        for (const p of products) {
          this.productCache.set(p.Product_ID, {
            Product_Name: p.Product_Name,
            Description: p.Description,
          });
        }
        return this.productCache;
      } catch (err) {
        console.warn("InvoiceService: User-token Products query failed, trying client credentials:", err);
      }
    }

    // Strategy 2: Fall back to client credentials (may not have Products table access)
    try {
      const filter = uncached.map((id) => `Product_ID = ${id}`).join(" OR ");
      const products = await this.mp!.getTableRecords<ProductRecord>({
        table: "Products",
        select: "Product_ID,Product_Name,Description",
        filter,
      });

      for (const p of products) {
        this.productCache.set(p.Product_ID, {
          Product_Name: p.Product_Name,
          Description: p.Description,
        });
      }
    } catch (err) {
      console.warn("InvoiceService: Products table query failed, using fallback names:", err);
    }

    return this.productCache;
  }

  // ── Invoice Detail ──

  public async getInvoiceDetail(
    invoiceId: number,
    contactId: number,
    mpAccessToken?: string
  ): Promise<InvoiceDetailResponse | null> {
    // First verify the invoice belongs to this contact (security)
    const [invoices, statusMap] = await Promise.all([
      this.mp!.getTableRecords<InvoiceRecord>({
        table: "Invoices",
        select:
          "Invoice_ID,Invoice_Date,Invoice_Total,Invoice_Status_ID,Notes,Currency,Invoice_GUID",
        filter: `Invoice_ID = ${invoiceId} AND Purchaser_Contact_ID = ${contactId}`,
        top: 1,
      }),
      this.getStatusMap(),
    ]);

    if (!invoices[0]) {
      return null;
    }

    const invoice: InvoiceListItem = {
      Invoice_ID: invoices[0].Invoice_ID,
      Invoice_Date: invoices[0].Invoice_Date,
      Invoice_Total: invoices[0].Invoice_Total,
      Invoice_Status_ID: invoices[0].Invoice_Status_ID,
      Invoice_Status:
        statusMap.get(invoices[0].Invoice_Status_ID) || "Unknown",
      Notes: invoices[0].Notes,
      Currency: invoices[0].Currency,
      Invoice_GUID: invoices[0].Invoice_GUID,
    };

    // Fetch line items (plain query, no _TABLE join)
    const details = await this.mp!.getTableRecords<InvoiceDetailRecord>({
      table: "Invoice_Detail",
      select:
        "Invoice_Detail_ID,Item_Quantity,Line_Total,Item_Note,Recipient_Name,Product_ID",
      filter: `Invoice_ID = ${invoiceId}`,
    });

    // Resolve product names (user token → client credentials → fallback)
    const productIds = [...new Set(details.map((d) => d.Product_ID))];
    const productMap = await this.getProductMap(productIds, mpAccessToken);

    const lineItems: InvoiceLineItem[] = details.map((d) => {
      const product = productMap.get(d.Product_ID);
      return {
        Invoice_Detail_ID: d.Invoice_Detail_ID,
        Product_Name: product?.Product_Name || `Product #${d.Product_ID}`,
        Description: product?.Description || null,
        Item_Quantity: d.Item_Quantity,
        Line_Total: d.Line_Total,
        Item_Note: d.Item_Note,
        Recipient_Name: d.Recipient_Name,
      };
    });

    return { invoice, lineItems };
  }

  // ── Checkout Invoice (by GUID, via api_MPPW_GetInvoice) ──

  /**
   * Load a single invoice for the checkout/payment flow, keyed by GUID. Wraps
   * the legacy `api_MPPW_GetInvoice` proc (header in result[0][0], detail rows
   * in result[1]) and maps it onto the shared CheckoutInvoice contract.
   *
   * Pass `mpContactId` (> 0) for an authenticated payor so the proc can scope
   * to the logged-in contact; omit it for the public/guest checkout path.
   */
  public async getCheckoutInvoiceByGuid(
    invoiceGuid: string,
    mpContactId?: number
  ): Promise<CheckoutInvoice | null> {
    const params: Record<string, string | number | null> = {
      "@InvoiceGuid": invoiceGuid,
    };
    if (mpContactId != null && mpContactId > 0) {
      params["@MpLoggedInContactId"] = mpContactId;
    }

    const [result, statusMap] = await Promise.all([
      this.mp!.executeProcedure("api_MPPW_GetInvoice", params),
      this.getStatusMap(),
    ]);

    const header = ((result[0] as CheckoutInvoiceHeaderRow[] | undefined) ?? [])[0];
    if (!header) return null;

    const details = (result[1] as CheckoutInvoiceDetailRow[] | undefined) ?? [];

    const invoiceTotal = toCheckoutNumber(header.Invoice_Total);
    const amountPaid = toCheckoutNumber(header.Amount_Paid);
    const balanceDue = Math.max(0, Number((invoiceTotal - amountPaid).toFixed(2)));
    const statusId = toCheckoutNumber(header.Invoice_Status_ID);
    const canPay = statusId !== CHECKOUT_INVOICE_STATUS_CANCELLED && balanceDue > 0;

    // Best-effort deposit: sum of detail Line_Total flagged Deposit_Requested.
    const depositRows = details.filter((d) => Boolean(d.Deposit_Requested));
    const depositDue =
      depositRows.length > 0
        ? Number(
            depositRows
              .reduce((sum, d) => sum + toCheckoutNumber(d.Line_Total), 0)
              .toFixed(2)
          )
        : null;

    const lineItems: CheckoutLineItem[] = details.map((d) => ({
      invoiceDetailId: toCheckoutNumber(d.Invoice_Detail_ID),
      itemName: d.Item_Name ?? null,
      itemNote: d.Item_Note ?? null,
      recipientName: d.Recipient_Name ?? null,
      quantity: toCheckoutNumber(d.Item_Quantity),
      lineTotal: toCheckoutNumber(d.Line_Total),
      isSubItem: Boolean(d.Sub_Item),
      eventParticipantId: toCheckoutNumberOrNull(d.Event_Participant_ID),
    }));

    return {
      invoiceId: toCheckoutNumber(header.Invoice_ID),
      invoiceGuid: header.Invoice_GUID ?? invoiceGuid,
      invoiceDate: String(header.Invoice_Date ?? ""),
      invoiceTotal,
      amountPaid,
      balanceDue,
      depositDue,
      statusId,
      status: statusMap.get(statusId) || "Unknown",
      canPay,
      payorContactId: toCheckoutNumberOrNull(header.Contact_ID),
      payor: {
        firstName: header.First_Name ?? null,
        lastName: header.Last_Name ?? null,
        email: header.Email_Address ?? null,
        mobilePhone: header.Mobile_Phone ?? null,
        addressLine1: header.Address_Line_1 ?? null,
        addressLine2: header.Address_Line_2 ?? null,
        city: header.City ?? null,
        state: header.State ?? null,
        postalCode: header.Postal_Code ?? null,
      },
      lineItems,
    };
  }
}
