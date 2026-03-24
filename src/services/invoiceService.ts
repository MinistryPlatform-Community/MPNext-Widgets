import { MPHelper } from "@/lib/providers/ministry-platform";
import type {
  InvoiceListItem,
  InvoiceLineItem,
  InvoiceDetailResponse,
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

export class InvoiceService {
  private static instance: InvoiceService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;

  private constructor() {
    this.mpBaseUrl = process.env.MINISTRY_PLATFORM_BASE_URL!;
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
}
