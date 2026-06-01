import { MPHelper } from "@/lib/providers/ministry-platform";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type {
  Product,
  ProductOptionGroup,
  ProductOptionPrice,
  PromoCodeResponse,
} from "@mpnext/types";

/**
 * Backend for product / option-group / promo-code reads behind the
 * `next-event-details` registration flow. Mirrors the legacy .NET
 * `ProductsService` which wraps the `api_MPPW_GetProduct` stored procedure.
 *
 * The proc returns three result sets:
 *   results[0][0] → product header
 *   results[1]    → option groups
 *   results[2]    → option prices (joined to groups by Product_Option_Group_ID)
 */

interface ProductHeaderRow {
  Product_ID: number | string | null;
  Product_Name: string | null;
  Description: string | null;
  BasePrice: number | string | null;
  Deposit_Price: number | string | null;
  Price_Currency: number | string | null;
}

interface OptionGroupRow {
  Product_Option_Group_ID: number | string;
  Option_Group_Name: string | null;
  Description: string | null;
  Mutually_Exclusive: boolean | number | null;
  Required: boolean | number | null;
  Note_Label: string | null;
}

interface OptionPriceRow {
  Product_Option_Price_ID: number | string;
  Product_Option_Group_ID: number | string;
  Option_Title: string | null;
  Option_Price: number | string | null;
  Days_Out_To_Hide: number | string | null;
  Qty_Allowed: number | string | null;
  Add_to_Group: number | string | null;
  Min_Qty: number | string | null;
  Max_Qty: number | string | null;
  Qty_On_Hand: number | string | null;
  Promo_Code: string | null;
}

interface EventDateRow {
  Event_Start_Date: string | null;
  Event_End_Date: string | null;
}

function toNumberOrNull(value: number | string | null): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toNumber(value: number | string | null, fallback = 0): number {
  const n = toNumberOrNull(value);
  return n === null ? fallback : n;
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export class ProductsService {
  private static instance: ProductsService;
  private mp: MPHelper | null = null;

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<ProductsService> {
    if (!ProductsService.instance) {
      ProductsService.instance = new ProductsService();
      await ProductsService.instance.initialize();
    }
    return ProductsService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── Product + option groups ──

  public async getProduct(
    productId: number,
    eventId = 0,
    eventParticipantId: number | null = null,
    formId: number | null = null,
    excludeInvoiceId: number | null = null
  ): Promise<Product | null> {
    const result = await this.mp!.executeProcedure("api_MPPW_GetProduct", {
      "@ProductID": productId,
      "@EventID": eventId > 0 ? eventId : null,
      "@EventParticipantId": eventParticipantId ?? null,
      "@FormId": formId ?? null,
      "@ExcludeInvoiceId": excludeInvoiceId ?? null,
    });

    const headerRows = (result[0] as ProductHeaderRow[] | undefined) ?? [];
    const header = headerRows[0];
    if (!header) return null;

    const groupRows = (result[1] as OptionGroupRow[] | undefined) ?? [];
    const priceRows = (result[2] as OptionPriceRow[] | undefined) ?? [];

    // Resolve the days-out hide window against the event's start date once.
    const isHiddenFor = await this.buildIsHiddenResolver(eventId);

    // Promo-coded rows are not surfaced as selectable options; they only flag
    // the product as promo-enabled.
    let hasPromoCode = false;
    let feesWillBeCollected = false;

    const pricesByGroup = new Map<number, ProductOptionPrice[]>();
    for (const row of priceRows) {
      if (isNonEmpty(row.Promo_Code)) {
        hasPromoCode = true;
        continue;
      }

      const optionPrice = toNumber(row.Option_Price);
      if (optionPrice > 0) {
        feesWillBeCollected = true;
      }

      const groupId = Number(row.Product_Option_Group_ID);
      const mapped: ProductOptionPrice = {
        optionPriceId: Number(row.Product_Option_Price_ID),
        optionTitle: row.Option_Title ?? null,
        optionPrice,
        daysOutToHide: toNumberOrNull(row.Days_Out_To_Hide),
        qtyAllowed: toNumber(row.Qty_Allowed),
        addToGroupId: toNumberOrNull(row.Add_to_Group),
        minQty: toNumber(row.Min_Qty),
        maxQty: toNumber(row.Max_Qty),
        qtyOnHand: toNumber(row.Qty_On_Hand),
        isHidden: isHiddenFor(toNumberOrNull(row.Days_Out_To_Hide)),
      };

      const list = pricesByGroup.get(groupId);
      if (list) {
        list.push(mapped);
      } else {
        pricesByGroup.set(groupId, [mapped]);
      }
    }

    const optionGroups: ProductOptionGroup[] = [];
    for (const g of groupRows) {
      const groupId = Number(g.Product_Option_Group_ID);
      const optionPrices = pricesByGroup.get(groupId) ?? [];
      // Drop groups that ended up with no non-promo prices.
      if (optionPrices.length === 0) continue;

      optionGroups.push({
        optionGroupId: groupId,
        optionGroupName: g.Option_Group_Name ?? null,
        description: g.Description ?? null,
        mutuallyExclusive: Boolean(g.Mutually_Exclusive),
        required: Boolean(g.Required),
        noteLabel: g.Note_Label ?? null,
        optionPrices,
      });
    }

    return {
      productId: Number(header.Product_ID ?? productId),
      productName: header.Product_Name ?? null,
      description: header.Description ?? null,
      basePrice: toNumber(header.BasePrice),
      depositPrice: toNumberOrNull(header.Deposit_Price),
      priceCurrency: toNumberOrNull(header.Price_Currency),
      hasPromoCode,
      feesWillBeCollected,
      optionGroups,
    };
  }

  /**
   * Build a predicate that decides whether a given Days_Out_To_Hide value means
   * the option is currently hidden. A price is hidden when Days_Out_To_Hide > 0
   * and the current domain date falls within that many days before the event's
   * start date. Day-only math is used against the MP domain's wall-clock date.
   *
   * When no event context is available (eventId <= 0) nothing is hidden.
   */
  private async buildIsHiddenResolver(
    eventId: number
  ): Promise<(daysOutToHide: number | null) => boolean> {
    if (eventId <= 0) {
      return () => false;
    }

    try {
      const rows = await this.mp!.getTableRecords<EventDateRow>({
        table: "Events",
        select: "Event_Start_Date,Event_End_Date",
        filter: `Event_ID = ${eventId}`,
        top: 1,
      });
      const startRaw = rows[0]?.Event_Start_Date;
      if (!startRaw) return () => false;

      const tz = DomainTimezoneService.getInstance();
      const iana = await tz.getMpTimezone();

      // Current domain date (midnight) and event start date (midnight), both as
      // UTC-epoch day counts so the diff is a whole-day count free of DST drift.
      const nowParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: iana,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const lookup: Record<string, string> = {};
      for (const p of nowParts) lookup[p.type] = p.value;
      const todayUtc = Date.UTC(
        Number(lookup.year),
        Number(lookup.month) - 1,
        Number(lookup.day)
      );

      const startMatch = startRaw
        .trim()
        .match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!startMatch) return () => false;
      const startUtc = Date.UTC(
        Number(startMatch[1]),
        Number(startMatch[2]) - 1,
        Number(startMatch[3])
      );

      const daysUntilStart = Math.floor(
        (startUtc - todayUtc) / 86400000
      );

      return (daysOutToHide: number | null) => {
        if (daysOutToHide === null || daysOutToHide <= 0) return false;
        return daysUntilStart >= 0 && daysUntilStart <= daysOutToHide;
      };
    } catch (err) {
      console.warn("ProductsService: days-out hide resolution failed:", err);
      return () => false;
    }
  }

  // ── Promo codes ──

  public async validPromoCode(
    productId: number,
    promoCode: string,
    editExistingPromoCode = false,
    formId: number | null = null,
    excludeInvoiceId: number | null = null
  ): Promise<PromoCodeResponse> {
    const result = await this.mp!.executeProcedure("api_MPPW_GetProduct", {
      "@ProductID": productId,
      "@EventID": null,
      "@EventParticipantId": null,
      "@FormId": formId ?? null,
      "@ExcludeInvoiceId": excludeInvoiceId ?? null,
    });

    const notFound: PromoCodeResponse = {
      isValidPromoCode: false,
      optionPriceId: null,
      promoCodePrice: 0,
      optionTitle: null,
      mutuallyExclusiveOptionGroupId: null,
      daysOutToHide: null,
    };

    const target = promoCode.trim().toLowerCase();
    if (!target) return notFound;

    const groupRows = (result[1] as OptionGroupRow[] | undefined) ?? [];
    const priceRows = (result[2] as OptionPriceRow[] | undefined) ?? [];

    const match = priceRows.find(
      (r) => isNonEmpty(r.Promo_Code) && r.Promo_Code.trim().toLowerCase() === target
    );
    if (!match) return notFound;

    // A used-up promo code is invalid unless we're editing an existing one.
    if (!editExistingPromoCode && toNumber(match.Qty_On_Hand) <= 0) {
      return notFound;
    }

    const groupId = Number(match.Product_Option_Group_ID);
    const group = groupRows.find(
      (g) => Number(g.Product_Option_Group_ID) === groupId
    );
    const mutuallyExclusive = group ? Boolean(group.Mutually_Exclusive) : false;

    return {
      isValidPromoCode: true,
      promoCodePrice: toNumber(match.Option_Price),
      optionPriceId: Number(match.Product_Option_Price_ID),
      optionTitle: match.Option_Title ?? null,
      mutuallyExclusiveOptionGroupId: mutuallyExclusive ? groupId : null,
      daysOutToHide: toNumberOrNull(match.Days_Out_To_Hide),
    };
  }
}
