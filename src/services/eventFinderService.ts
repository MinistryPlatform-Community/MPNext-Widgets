import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type { EventSearchResult, EventConfigurations } from "@mpnext/types";

/**
 * Backend for the public `next-event-finder` widget.
 *
 * Migrated from the legacy `EventsService.SearchEvents` / `GetEventConfigurations`
 * flow. Search is the same two-step procedure call the legacy .NET layer used:
 *   1. `api_MPPW_SearchEvents` → event IDs (+ per-series `Seq`).
 *   2. `api_MPPW_GetEvents`    → full card data for those IDs.
 * Configuration dropdowns come from direct `Congregations`/`Ministries` reads.
 */
export interface EventSearchFilters {
  congregationId?: number | null;
  ministryId?: number | null;
  programId?: number | null;
  eventTypeId?: number | null;
  monthId?: number | null;
  /** 0/none, 1 = open registration, 2 = open volunteer opportunities. */
  signupType?: number;
  isFeatured?: boolean;
  keyword?: string;
  /** Cap recurring-series instances; matches legacy MaxNumberPerSeries. */
  reduceSeriesTo?: number;
  isStaffUser?: boolean;
}

interface SearchRow {
  Id: number | string;
  Seq: number | string;
}

interface EventCardRow {
  Id: number | string;
  Title: string | null;
  Description: string | null;
  ImageUrl: string | null;
  Location: string | null;
  StartDate: string | null;
  EndDate: string | null;
  Featured: boolean | number | null;
}

interface LookupRow {
  Id: number | string;
  Name: string | null;
}

const MAX_RESULTS = 100;

export class EventFinderService {
  private static instance: EventFinderService;
  private mp: MPHelper | null = null;
  private imageBaseUrl = "";

  private constructor() {
    const raw = getEnv("MINISTRY_PLATFORM_BASE_URL").replace(/\/$/, "");
    // The proc concatenates @ImageBaseUrl + file GUID; the env base already
    // includes /ministryplatformapi, so this resolves to the MP file endpoint.
    this.imageBaseUrl = `${raw}/files/`;
    this.initialize();
  }

  public static async getInstance(): Promise<EventFinderService> {
    if (!EventFinderService.instance) {
      EventFinderService.instance = new EventFinderService();
      await EventFinderService.instance.initialize();
    }
    return EventFinderService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── Filter dropdowns ──

  public async getConfigurations(): Promise<EventConfigurations> {
    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());
    const activeFilter = (col: string) =>
      `Available_Online = 1 AND (${col} IS NULL OR ${col} >= '${now}')`;

    const [congregations, ministries] = await Promise.all([
      this.mp!.getTableRecords<LookupRow>({
        table: "Congregations",
        select: "Congregation_ID AS Id, Congregation_Name AS Name",
        filter: activeFilter("End_Date"),
        orderBy: "Congregation_Name",
        top: 1000,
      }),
      this.mp!.getTableRecords<LookupRow>({
        table: "Ministries",
        select: "Ministry_ID AS Id, Ministry_Name AS Name",
        filter: activeFilter("End_Date"),
        orderBy: "Ministry_Name",
        top: 100,
      }),
    ]);

    const toOptions = (rows: LookupRow[]) =>
      rows
        .filter((r) => r.Name)
        .map((r) => ({ id: Number(r.Id), name: String(r.Name) }));

    return {
      congregations: toOptions(congregations),
      ministries: toOptions(ministries),
    };
  }

  // ── Search ──

  public async searchEvents(filters: EventSearchFilters): Promise<EventSearchResult[]> {
    const searchResult = await this.mp!.executeProcedure("api_MPPW_SearchEvents", {
      "@CongregationId": filters.congregationId ?? null,
      "@MinistryId": filters.ministryId ?? null,
      "@ProgramId": filters.programId ?? null,
      "@SignupType": filters.signupType ?? 0,
      "@IsFeatured": filters.isFeatured ?? false,
      "@IsStaffUser": filters.isStaffUser ?? false,
      "@Keyword": filters.keyword ?? "",
      "@MonthId": filters.monthId ?? null,
      "@EventTypeId": filters.eventTypeId ?? null,
    });

    const rows = (searchResult[0] as SearchRow[] | undefined) ?? [];
    if (rows.length === 0) return [];

    const max = filters.reduceSeriesTo ?? 0;
    const filtered = max > 0 ? rows.filter((r) => Number(r.Seq) <= max) : rows;
    const ids = filtered.map((r) => Number(r.Id)).slice(0, MAX_RESULTS);
    if (ids.length === 0) return [];

    // api_MPPW_GetEvents declares @EventIds as an array of Integers. Sending it
    // on the query string collapses it to a string ("201,359,…") which MP
    // rejects with 500. Use the POST-body variant so the array stays typed.
    const eventsResult = await this.mp!.executeProcedureWithBody("api_MPPW_GetEvents", {
      "@ImageBaseUrl": this.imageBaseUrl,
      "@EventIds": ids,
    });

    const cardRows = (eventsResult[0] as EventCardRow[] | undefined) ?? [];

    const cards: EventSearchResult[] = cardRows.map((row) => ({
      id: Number(row.Id),
      title: String(row.Title ?? ""),
      description: row.Description ?? null,
      imageUrl: row.ImageUrl ?? null,
      location: row.Location ?? null,
      // MP returns wall-clock datetimes; pass through verbatim (no Z-shift).
      startDate: String(row.StartDate ?? ""),
      endDate: String(row.EndDate ?? ""),
      featured: Boolean(row.Featured),
    }));

    // Preserve the relevance/series ordering returned by api_MPPW_SearchEvents.
    const order = new Map(ids.map((id, i) => [id, i]));
    cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return cards;
  }
}
