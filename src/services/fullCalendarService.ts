import { MPHelper } from "@/lib/providers/ministry-platform";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type { CalendarEvent } from "@mpnext/types";

// ── MP Record Types ──

interface EventRecord {
  Event_ID: number;
  Event_Title: string;
  Event_Start_Date: string;
  Event_End_Date: string;
  Event_Type_ID: number | null;
  Congregation_ID: number | null;
  Location_ID: number | null;
  Description: string | null;
  Featured_On_Calendar: boolean;
  Registration_Active: boolean;
  External_Registration_URL: string | null;
  Online_Registration_Product: number | null;
  Program_ID: number | null;
  Primary_Contact: number | null;
  Participants_Expected: number | null;
}

interface EventTypeRecord {
  Event_Type_ID: number;
  Event_Type: string;
}

interface CongregationRecord {
  Congregation_ID: number;
  Congregation_Name: string;
}

interface LocationRecord {
  Location_ID: number;
  Location_Name: string;
}

interface ProgramRecord {
  Program_ID: number;
  Program_Name: string;
  Ministry_ID: number | null;
}

interface MinistryRecord {
  Ministry_ID: number;
  Ministry_Name: string;
  Available_Online: boolean;
}

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface UserGroupRecord {
  User_ID: number;
  User_Group_ID: number;
}

interface ContactRecord {
  Contact_ID: number;
  Display_Name: string;
  Email_Address: string | null;
  Mobile_Phone: string | null;
}

interface EventParticipantCount {
  Event_ID: number;
  Count: number;
}

interface ProductRecord {
  Product_ID: number;
  Product_Name: string;
}

interface ProgramInfo {
  programName: string;
  ministryId: number | null;
  ministryName: string | null;
}

interface FilterData {
  campuses: { id: number; name: string }[];
  ministries: { id: number; name: string }[];
}

export class FullCalendarService {
  private static instance: FullCalendarService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string = "";

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<FullCalendarService> {
    if (!FullCalendarService.instance) {
      FullCalendarService.instance = new FullCalendarService();
      await FullCalendarService.instance.initialize();
    }
    return FullCalendarService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
    // Strip /ministryplatformapi so MP links use the correct /mp/{pageId}/{recordId} format
    const raw = process.env.MINISTRY_PLATFORM_BASE_URL || "";
    this.mpBaseUrl = raw.replace(/\/ministryplatformapi\/?$/, "");
  }

  // ── Core Query ──

  public async getEvents(
    start: string,
    end: string,
    congregationId?: number,
    userGuid?: string
  ): Promise<{ events: CalendarEvent[]; isAdmin: boolean; filters: FilterData }> {
    // MP $filter literals are interpreted in the domain's wall-clock time zone.
    // Routing through DomainTimezoneService converts any incoming instant (Z or
    // offset-tagged) to MP-TZ wall-clock so date-boundary queries don't shift.
    const tz = DomainTimezoneService.getInstance();
    const startDate = await tz.toMpSqlDatetime(start);
    const endDate = await tz.toMpSqlDatetime(end);

    let filter = `Event_Start_Date >= '${startDate}' AND Event_End_Date <= '${endDate}' AND Cancelled = 0 AND Visibility_Level_ID = 4`;
    if (congregationId) {
      filter += ` AND Congregation_ID = ${congregationId}`;
    }

    const events = await this.mp!.getTableRecords<EventRecord>({
      table: "Events",
      select:
        "Event_ID,Event_Title,Event_Start_Date,Event_End_Date,Event_Type_ID,Congregation_ID,Location_ID,Description,Featured_On_Calendar,Registration_Active,External_Registration_URL,Online_Registration_Product,Program_ID,Primary_Contact,Participants_Expected",
      filter,
      orderBy: "Event_Start_Date ASC",
    });

    if (events.length === 0) {
      const isAdmin = userGuid ? await this.checkCalendarAdmin(userGuid) : false;
      return {
        events: [],
        isAdmin,
        filters: { campuses: [], ministries: [] },
      };
    }

    // Collect unique foreign key IDs for parallel lookups
    const eventTypeIds = [
      ...new Set(events.map((e) => e.Event_Type_ID).filter((id): id is number => id !== null)),
    ];
    const congregationIds = [
      ...new Set(events.map((e) => e.Congregation_ID).filter((id): id is number => id !== null)),
    ];
    const locationIds = [
      ...new Set(events.map((e) => e.Location_ID).filter((id): id is number => id !== null)),
    ];
    const programIds = [
      ...new Set(events.map((e) => e.Program_ID).filter((id): id is number => id !== null)),
    ];
    const eventIds = events.map((e) => e.Event_ID);

    // Parallel lookups — admin check, images, programs all run concurrently
    const [eventTypeMap, congregationMap, locationMap, programMap, imageMap, isAdmin] =
      await Promise.all([
        this.getEventTypeMap(eventTypeIds),
        this.getCongregationMap(congregationIds),
        this.getLocationMap(locationIds),
        this.getProgramMap(programIds),
        this.resolveEventImages(eventIds),
        userGuid ? this.checkCalendarAdmin(userGuid) : Promise.resolve(false),
      ]);

    // Merge all data
    const mergedEvents: CalendarEvent[] = events.map((e) => {
      const programInfo = e.Program_ID != null ? programMap.get(e.Program_ID) : undefined;
      return {
        Event_ID: e.Event_ID,
        Event_Title: e.Event_Title,
        Event_Start_Date: e.Event_Start_Date,
        Event_End_Date: e.Event_End_Date,
        Event_Type_ID: e.Event_Type_ID,
        Event_Type: e.Event_Type_ID != null ? (eventTypeMap.get(e.Event_Type_ID) ?? null) : null,
        Congregation_ID: e.Congregation_ID,
        Congregation_Name:
          e.Congregation_ID != null ? (congregationMap.get(e.Congregation_ID) ?? null) : null,
        Location_Name: e.Location_ID != null ? (locationMap.get(e.Location_ID) ?? null) : null,
        Description: e.Description,
        Featured_On_Calendar: e.Featured_On_Calendar,
        Registration_URL: this.buildRegistrationUrl(e),
        Image_URL: imageMap.get(e.Event_ID) ?? null,
        Program_ID: e.Program_ID,
        Program_Name: programInfo?.programName ?? null,
        Ministry_Name: programInfo?.ministryName ?? null,
        Primary_Contact_Name: null,
        Primary_Contact_Email: null,
        Primary_Contact_Phone: null,
        Participants_Expected: e.Participants_Expected,
        Participant_Count: null,
        Registration_Product_Name: null,
        MP_Detail_URL: `${this.mpBaseUrl}/mp/308/${e.Event_ID}`,
      };
    });

    // Extract filters from the enriched events
    const filters = this.extractFilters(mergedEvents, programMap);

    return { events: mergedEvents, isAdmin, filters };
  }

  // ── Single Event Detail ──

  public async getEventDetail(
    eventId: number,
    userGuid?: string
  ): Promise<{ event: CalendarEvent; isAdmin: boolean }> {
    const [eventRecords, isAdmin] = await Promise.all([
      this.mp!.getTableRecords<EventRecord>({
        table: "Events",
        select:
          "Event_ID,Event_Title,Event_Start_Date,Event_End_Date,Event_Type_ID,Congregation_ID,Location_ID,Description,Featured_On_Calendar,Registration_Active,External_Registration_URL,Online_Registration_Product,Program_ID,Primary_Contact,Participants_Expected",
        filter: `Event_ID = ${eventId} AND Visibility_Level_ID = 4`,
        top: 1,
      }),
      userGuid ? this.checkCalendarAdmin(userGuid) : Promise.resolve(false),
    ]);

    if (eventRecords.length === 0) {
      throw new Error("Event not found");
    }

    const e = eventRecords[0];

    // Parallel lookups for enrichment
    const lookupIds = {
      eventType: e.Event_Type_ID ? [e.Event_Type_ID] : [],
      congregation: e.Congregation_ID ? [e.Congregation_ID] : [],
      location: e.Location_ID ? [e.Location_ID] : [],
      program: e.Program_ID ? [e.Program_ID] : [],
    };

    const parallelFetches: Promise<any>[] = [
      this.getEventTypeMap(lookupIds.eventType),
      this.getCongregationMap(lookupIds.congregation),
      this.getLocationMap(lookupIds.location),
      this.getProgramMap(lookupIds.program),
      this.resolveEventImages([e.Event_ID]),
    ];

    // Admin-only enrichment: contact info, participant count, product name
    if (isAdmin) {
      parallelFetches.push(
        e.Primary_Contact ? this.getContactInfo(e.Primary_Contact) : Promise.resolve(null),
        this.getParticipantCount(e.Event_ID),
        e.Online_Registration_Product
          ? this.getProductName(e.Online_Registration_Product)
          : Promise.resolve(null)
      );
    }

    const results = await Promise.all(parallelFetches);
    const [eventTypeMap, congregationMap, locationMap, programMap, imageMap] = results;
    const contactInfo = isAdmin ? results[5] : null;
    const participantCount = isAdmin ? results[6] : null;
    const productName = isAdmin ? results[7] : null;

    const programInfo = e.Program_ID != null ? programMap.get(e.Program_ID) : undefined;

    const event: CalendarEvent = {
      Event_ID: e.Event_ID,
      Event_Title: e.Event_Title,
      Event_Start_Date: e.Event_Start_Date,
      Event_End_Date: e.Event_End_Date,
      Event_Type_ID: e.Event_Type_ID,
      Event_Type: e.Event_Type_ID != null ? (eventTypeMap.get(e.Event_Type_ID) ?? null) : null,
      Congregation_ID: e.Congregation_ID,
      Congregation_Name:
        e.Congregation_ID != null ? (congregationMap.get(e.Congregation_ID) ?? null) : null,
      Location_Name: e.Location_ID != null ? (locationMap.get(e.Location_ID) ?? null) : null,
      Description: e.Description,
      Featured_On_Calendar: e.Featured_On_Calendar,
      Registration_URL: this.buildRegistrationUrl(e),
      Image_URL: imageMap.get(e.Event_ID) ?? null,
      Program_ID: e.Program_ID,
      Program_Name: programInfo?.programName ?? null,
      Ministry_Name: programInfo?.ministryName ?? null,
      Primary_Contact_Name: contactInfo?.Display_Name ?? null,
      Primary_Contact_Email: contactInfo?.Email_Address ?? null,
      Primary_Contact_Phone: contactInfo?.Mobile_Phone ?? null,
      Participants_Expected: e.Participants_Expected,
      Participant_Count: participantCount,
      Registration_Product_Name: productName,
      MP_Detail_URL: `${this.mpBaseUrl}/mp/308/${e.Event_ID}`,
    };

    return { event, isAdmin };
  }

  // ── Admin Check ──

  public async checkCalendarAdmin(userGuid: string): Promise<boolean> {
    try {
      const users = await this.mp!.getTableRecords<DpUserRecord>({
        table: "dp_Users",
        select: "User_ID,User_GUID,Contact_ID",
        filter: `User_GUID = '${userGuid}'`,
        top: 1,
      });

      if (!users[0]?.User_ID) return false;

      // No tenant-specific default: fail closed when unconfigured so a fresh
      // tenant never inherits another tenant's admin group IDs.
      const groupIdsEnv = process.env.CALENDAR_ADMIN_GROUP_IDS || "";
      const adminGroupIds = groupIdsEnv
        .split(",")
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id));

      if (adminGroupIds.length === 0) {
        console.warn(
          "FullCalendarService: CALENDAR_ADMIN_GROUP_IDS is not set; no users will be treated as calendar admins.",
        );
        return false;
      }

      const idList = adminGroupIds.join(",");
      const records = await this.mp!.getTableRecords<UserGroupRecord>({
        table: "dp_User_User_Groups",
        select: "User_ID,User_Group_ID",
        filter: `User_ID = ${users[0].User_ID} AND User_Group_ID IN (${idList})`,
        top: 1,
      });

      return records.length > 0;
    } catch (err) {
      console.warn("FullCalendarService: Admin check failed:", err);
      return false;
    }
  }

  // ── Program/Ministry Lookup ──

  private async getProgramMap(ids: number[]): Promise<Map<number, ProgramInfo>> {
    const map = new Map<number, ProgramInfo>();
    if (ids.length === 0) return map;

    try {
      const filter = ids.map((id) => `Program_ID = ${id}`).join(" OR ");
      const programs = await this.mp!.getTableRecords<ProgramRecord>({
        table: "Programs",
        select: "Program_ID,Program_Name,Ministry_ID",
        filter,
      });

      // Collect ministry IDs for secondary lookup
      const ministryIds = [
        ...new Set(
          programs.map((p) => p.Ministry_ID).filter((id): id is number => id !== null)
        ),
      ];

      let ministryMap = new Map<number, MinistryRecord>();
      if (ministryIds.length > 0) {
        const mFilter = ministryIds.map((id) => `Ministry_ID = ${id}`).join(" OR ");
        const ministries = await this.mp!.getTableRecords<MinistryRecord>({
          table: "Ministries",
          select: "Ministry_ID,Ministry_Name,Available_Online",
          filter: mFilter,
        });
        for (const m of ministries) {
          ministryMap.set(m.Ministry_ID, m);
        }
      }

      for (const p of programs) {
        const ministry = p.Ministry_ID != null ? ministryMap.get(p.Ministry_ID) : undefined;
        map.set(p.Program_ID, {
          programName: p.Program_Name,
          ministryId: ministry?.Ministry_ID ?? null,
          ministryName: ministry?.Ministry_Name ?? null,
        });
      }
    } catch (err) {
      console.warn("FullCalendarService: Failed to fetch programs:", err);
    }

    return map;
  }

  // ── Image Resolution ──

  private async resolveEventImages(eventIds: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (eventIds.length === 0) return map;

    // Process in batches of 20
    const batchSize = 20;
    for (let i = 0; i < eventIds.length; i += batchSize) {
      const batch = eventIds.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(async (eventId) => {
          try {
            const files = await this.mp!.getFilesByRecord({
              table: "Events",
              recordId: eventId,
              defaultOnly: true,
            });
            if (files.length > 0 && files[0].IsImage) {
              return { eventId, url: `${this.mpBaseUrl}/files/${files[0].UniqueFileId}` };
            }
            return null;
          } catch {
            return null;
          }
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          map.set(result.value.eventId, result.value.url);
        }
      }
    }

    return map;
  }

  // ── Filter Extraction ──

  private extractFilters(
    events: CalendarEvent[],
    programMap: Map<number, ProgramInfo>
  ): FilterData {
    // Campuses: distinct from events
    const campusMap = new Map<number, string>();
    for (const e of events) {
      if (e.Congregation_ID != null && e.Congregation_Name) {
        campusMap.set(e.Congregation_ID, e.Congregation_Name);
      }
    }

    // Ministries: only include where Available_Online = true
    // We need to check the program map for the Available_Online flag
    // Since we stored ministry info in ProgramInfo, we need to query ministries separately
    // For now, collect unique ministry names from events and filter via program map
    const ministrySet = new Map<string, number>();
    for (const [, info] of programMap) {
      if (info.ministryName && info.ministryId != null) {
        ministrySet.set(info.ministryName, info.ministryId);
      }
    }

    return {
      campuses: Array.from(campusMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      ministries: Array.from(ministrySet.entries())
        .map(([name, id]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  // ── Admin-Only Enrichment Helpers ──

  private async getContactInfo(contactId: number): Promise<ContactRecord | null> {
    try {
      const records = await this.mp!.getTableRecords<ContactRecord>({
        table: "Contacts",
        select: "Contact_ID,Display_Name,Email_Address,Mobile_Phone",
        filter: `Contact_ID = ${contactId}`,
        top: 1,
      });
      return records[0] ?? null;
    } catch (err) {
      console.warn("FullCalendarService: Failed to fetch contact:", err);
      return null;
    }
  }

  private async getParticipantCount(eventId: number): Promise<number | null> {
    try {
      const records = await this.mp!.getTableRecords<{ Event_ID: number; Participant_ID: number }>(
        {
          table: "Event_Participants",
          select: "Event_ID,Participant_ID",
          filter: `Event_ID = ${eventId} AND Participation_Status_ID IN (2,3,4)`,
        }
      );
      return records.length;
    } catch (err) {
      console.warn("FullCalendarService: Failed to fetch participant count:", err);
      return null;
    }
  }

  private async getProductName(productId: number): Promise<string | null> {
    try {
      const records = await this.mp!.getTableRecords<ProductRecord>({
        table: "Products",
        select: "Product_ID,Product_Name",
        filter: `Product_ID = ${productId}`,
        top: 1,
      });
      return records[0]?.Product_Name ?? null;
    } catch (err) {
      console.warn("FullCalendarService: Failed to fetch product:", err);
      return null;
    }
  }

  // ── Registration URL ──

  private buildRegistrationUrl(event: EventRecord): string | null {
    if (!event.Registration_Active) return null;

    if (event.External_Registration_URL) return event.External_Registration_URL;

    if (event.Online_Registration_Product) {
      return `${this.mpBaseUrl}/portal/event_detail.aspx?id=${event.Event_ID}`;
    }

    return null;
  }

  // ── Lookup Helpers ──

  private async getEventTypeMap(ids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (ids.length === 0) return map;

    try {
      const filter = ids.map((id) => `Event_Type_ID = ${id}`).join(" OR ");
      const records = await this.mp!.getTableRecords<EventTypeRecord>({
        table: "Event_Types",
        select: "Event_Type_ID,Event_Type",
        filter,
      });
      for (const r of records) {
        map.set(r.Event_Type_ID, r.Event_Type);
      }
    } catch (err) {
      console.warn("FullCalendarService: Failed to fetch event types:", err);
    }

    return map;
  }

  private async getCongregationMap(ids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (ids.length === 0) return map;

    try {
      const filter = ids.map((id) => `Congregation_ID = ${id}`).join(" OR ");
      const records = await this.mp!.getTableRecords<CongregationRecord>({
        table: "Congregations",
        select: "Congregation_ID,Congregation_Name",
        filter,
      });
      for (const r of records) {
        map.set(r.Congregation_ID, r.Congregation_Name);
      }
    } catch (err) {
      console.warn("FullCalendarService: Failed to fetch congregations:", err);
    }

    return map;
  }

  private async getLocationMap(ids: number[]): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    if (ids.length === 0) return map;

    try {
      const filter = ids.map((id) => `Location_ID = ${id}`).join(" OR ");
      const records = await this.mp!.getTableRecords<LocationRecord>({
        table: "Locations",
        select: "Location_ID,Location_Name",
        filter,
      });
      for (const r of records) {
        map.set(r.Location_ID, r.Location_Name);
      }
    } catch (err) {
      console.warn("FullCalendarService: Failed to fetch locations:", err);
    }

    return map;
  }
}
