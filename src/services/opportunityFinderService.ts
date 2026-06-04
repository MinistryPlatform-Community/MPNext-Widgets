import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import type {
  OpportunitySearchResult,
  OpportunityConfigurations,
  OpportunityFilterOption,
  OpportunityAttributeType,
} from "@mpnext/types";

/**
 * Backend for the public `next-opportunity-finder` widget.
 *
 * Migrated from the legacy `OpportunityManager.SearchOpportunities` /
 * `OpportunityService.GetOpportunityFinderConfigurations` flow:
 *   1. `api_MPPW_SearchOpportunities` → opportunity cards (+ Maximum_Needed).
 *   2. A single `Responses` read tallies confirmed responses so opportunities
 *      that have met their Maximum_Needed are dropped (legacy did this with an
 *      N+1 GetOpportunityById loop; we batch it into one query).
 * Configuration dropdowns come from direct lookup-table reads.
 */
export interface OpportunitySearchFilters {
  congregationId?: number | null;
  ministryId?: number | null;
  programId?: number | null;
  eventId?: number | null;
  genderId?: number | null;
  minimumAge?: number | null;
  /** 1 = ongoing, 2 = one-time, null = any. */
  frequency?: number | null;
  keyword?: string;
  /** Comma-separated Attribute_ID list. */
  attributeIds?: string;
  isStaffUser?: boolean;
}

interface SearchRow {
  Id: number | string;
  Title: string | null;
  Description: string | null;
  ImageUrl: string | null;
  Location: string | null;
  MeetingDay: string | null;
  MeetingTime: string | null;
  StartDate: string | null;
  Featured: boolean | number | null;
  RequiredGender: string | null;
  MinimumAge: string | null;
  MaximumNeeded: number | string | null;
  Hidden: boolean | number | null;
}

interface ResponseCountRow {
  Opportunity_ID: number | string;
}

interface LookupRow {
  Id: number | string;
  Name: string | null;
}

interface AttributeRow {
  Attribute_ID: number | string;
  Attribute_Name: string | null;
  Attribute_Type_ID: number | string | null;
  Attribute_Type: string | null;
}

const MAX_RESULTS = 100;

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export class OpportunityFinderService {
  private static instance: OpportunityFinderService;
  private mp: MPHelper | null = null;
  private imageBaseUrl = "";

  private constructor() {
    const raw = getEnv("MINISTRY_PLATFORM_BASE_URL").replace(/\/$/, "");
    // The proc concatenates @ImageBaseUrl + file unique name; the env base
    // already includes /ministryplatformapi, so this resolves to /files/.
    this.imageBaseUrl = `${raw}/files/`;
    this.initialize();
  }

  public static async getInstance(): Promise<OpportunityFinderService> {
    if (!OpportunityFinderService.instance) {
      OpportunityFinderService.instance = new OpportunityFinderService();
      await OpportunityFinderService.instance.initialize();
    }
    return OpportunityFinderService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── Filter dropdowns ──

  public async getConfigurations(): Promise<OpportunityConfigurations> {
    const toOptions = (rows: LookupRow[]): OpportunityFilterOption[] =>
      rows
        .filter((r) => r.Name)
        .map((r) => ({ id: Number(r.Id), name: String(r.Name) }));

    const [congregations, ministries, genders, attributeTypes] = await Promise.all([
      this.mp!.getTableRecords<LookupRow>({
        table: "Congregations",
        select: "Congregation_ID AS Id, Congregation_Name AS Name",
        filter: "Available_Online = 1 AND (End_Date IS NULL OR End_Date >= GETDATE())",
        orderBy: "Congregation_Name",
        top: 1000,
      }).catch(() => [] as LookupRow[]),
      this.mp!.getTableRecords<LookupRow>({
        table: "Ministries",
        select: "Ministry_ID AS Id, Ministry_Name AS Name",
        filter: "Available_Online = 1 AND (End_Date IS NULL OR End_Date >= GETDATE())",
        orderBy: "Ministry_Name",
        top: 100,
      }).catch(() => [] as LookupRow[]),
      this.mp!.getTableRecords<LookupRow>({
        table: "Genders",
        select: "Gender_ID AS Id, Gender AS Name",
        orderBy: "Gender",
        top: 100,
      }).catch(() => [] as LookupRow[]),
      this.getAttributeTypes(),
    ]);

    return {
      congregations: toOptions(congregations),
      ministries: toOptions(ministries),
      genders: toOptions(genders),
      attributeTypes,
    };
  }

  /** Attribute types with their selectable attributes (grouped optgroups). */
  private async getAttributeTypes(): Promise<OpportunityAttributeType[]> {
    try {
      const rows = await this.mp!.getTableRecords<AttributeRow>({
        table: "Attributes",
        select:
          "Attributes.Attribute_ID, Attributes.Attribute_Name, Attribute_Type_ID_Table.Attribute_Type_ID AS Attribute_Type_ID, Attribute_Type_ID_Table.Attribute_Type AS Attribute_Type",
        filter: "ISNULL(Attributes.Available_Online, 1) = 1",
        orderBy: "Attribute_Type_ID_Table.Attribute_Type, Attributes.Attribute_Name",
        top: 1000,
      });

      const byType = new Map<number, OpportunityAttributeType>();
      for (const r of rows) {
        const typeId = toNumberOrNull(r.Attribute_Type_ID);
        if (typeId == null || !r.Attribute_Type || !r.Attribute_Name) continue;
        let group = byType.get(typeId);
        if (!group) {
          group = { id: typeId, name: String(r.Attribute_Type), attributes: [] };
          byType.set(typeId, group);
        }
        group.attributes.push({
          id: Number(r.Attribute_ID),
          name: String(r.Attribute_Name),
        });
      }
      return Array.from(byType.values());
    } catch {
      return [];
    }
  }

  // ── Search ──

  public async searchOpportunities(
    filters: OpportunitySearchFilters
  ): Promise<OpportunitySearchResult[]> {
    const params: Record<string, string | number | boolean | null> = {
      "@ImageBaseUrl": this.imageBaseUrl,
      "@CongregationId": filters.congregationId ?? null,
      "@MinistryId": filters.ministryId ?? null,
      "@ProgramId": filters.programId ?? null,
      "@IsStaffUser": filters.isStaffUser ?? false,
      "@EventId": filters.eventId ?? null,
      "@GenderId": filters.genderId ?? null,
      "@MinimumAge": filters.minimumAge ?? null,
      "@Keyword": filters.keyword ?? null,
      "@Frequency": filters.frequency ?? null,
    };
    if (filters.attributeIds && filters.attributeIds.trim()) {
      params["@AttributeIDs"] = filters.attributeIds.trim();
    }

    const result = await this.mp!.executeProcedure(
      "api_MPPW_SearchOpportunities",
      params
    );
    const rows = (result[0] as SearchRow[] | undefined) ?? [];
    if (rows.length === 0) return [];

    const limited = rows.slice(0, MAX_RESULTS);

    // Drop opportunities that have met their Maximum_Needed. Tally confirmed
    // responses (Response_Result_ID = 1) for the candidate ids in one read.
    const counts = await this.getResponseCounts(limited.map((r) => Number(r.Id)));

    const cards: OpportunitySearchResult[] = [];
    for (const row of limited) {
      const id = Number(row.Id);
      const maxNeeded = toNumberOrNull(row.MaximumNeeded);
      if (maxNeeded != null) {
        const remaining = maxNeeded - (counts.get(id) ?? 0);
        if (remaining <= 0) continue;
      }

      const attributes = [row.RequiredGender, row.MinimumAge]
        .map((a) => (a ?? "").trim())
        .filter((a) => a.length > 0);

      cards.push({
        id,
        title: String(row.Title ?? ""),
        description: row.Description ?? null,
        imageUrl: row.ImageUrl ?? null,
        location: row.Location ?? null,
        meetingDay: row.MeetingDay ?? null,
        // MP returns wall-clock datetimes; pass through verbatim (no Z-shift).
        meetingTime: row.MeetingTime ? String(row.MeetingTime) : row.StartDate ?? null,
        featured: Boolean(row.Featured),
        attributes,
      });
    }
    return cards;
  }

  /** Confirmed-response counts (Response_Result_ID = 1) keyed by opportunity id. */
  private async getResponseCounts(ids: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (ids.length === 0) return counts;
    try {
      const rows = await this.mp!.getTableRecords<ResponseCountRow>({
        table: "Responses",
        select: "Opportunity_ID",
        filter: `Opportunity_ID IN (${ids.join(",")}) AND Response_Result_ID = 1`,
        top: 10000,
      });
      for (const r of rows) {
        const oppId = Number(r.Opportunity_ID);
        counts.set(oppId, (counts.get(oppId) ?? 0) + 1);
      }
    } catch {
      // On failure, leave counts empty — opportunities are shown rather than
      // hidden, matching the legacy "show when count unknown" behavior.
    }
    return counts;
  }
}
