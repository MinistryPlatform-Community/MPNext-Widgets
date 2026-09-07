import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import type { Group, GroupAddress } from "@mpnext/types";

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface RawGroupRow {
  GroupId: number | string;
  GroupName: string | null;
  Description: string | null;
  StartDate: string | null;
  EndDate: string | null;
  AvailableOnline: boolean | number | null;
  OffsiteMeetingAddressId: number | string | null;
  CongregationId: number | string | null;
  MeetingDayId?: number | string | null;
  MeetingDay: string | null;
  MeetingTime: string | null;
  PrimaryContactId: number | string | null;
  ImageUrl: string | null;
  GroupRoleId: number | string | null;
  IsUserLeader: boolean | number | null;
  MeetsOnline: boolean | number | null;
  VolunteerGroup: boolean | number | null;
}

interface OffsiteAddressRow {
  Address_ID: number | string;
  Address_Line_1: string | null;
  Address_Line_2: string | null;
  City: string | null;
  State: string | null;
  Postal_Code: string | null;
}

interface CongregationAddressRow {
  Congregation_ID: number | string;
  Address_Line_1: string | null;
  Address_Line_2: string | null;
  City: string | null;
  State: string | null;
  Postal_Code: string | null;
}

export class MyGroupsService {
  private static instance: MyGroupsService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<MyGroupsService> {
    if (!MyGroupsService.instance) {
      MyGroupsService.instance = new MyGroupsService();
      await MyGroupsService.instance.initialize();
    }
    return MyGroupsService.instance;
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
      console.error("MyGroupsService: No dp_Users record for GUID:", guid);
      return null;
    }

    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Cloud URL Prefix ──

  public async getCloudUrlPrefix(): Promise<string | null> {
    try {
      const rows = await this.mp!.getTableRecords<{ Value: string | null }>({
        table: "dp_Configuration_Settings",
        select: "Value",
        filter: "Application_Code = 'COMMON' AND Key_Name = 'MPCloudUrlPrefix'",
        top: 1,
      });
      const value = rows[0]?.Value?.trim();
      return value ? value : null;
    } catch (err) {
      console.warn("MyGroupsService: Failed to fetch cloud URL prefix:", err);
      return null;
    }
  }

  // ── My Groups ──

  public async getGroups(userId: number): Promise<Group[]> {
    const result = await this.mp!.executeProcedure("api_MPPW_GetMyGroups", {
      "@UserId": userId,
      "@ImageBaseUrl": `${this.mpBaseUrl}/files/`,
    });

    const rawRows = (result[0] as RawGroupRow[] | undefined) ?? [];

    // Legacy only surfaces groups flagged as available online.
    const rows = rawRows.filter((row) => Boolean(row.AvailableOnline) === true);

    // ── Collect address resolution keys ──
    const offsiteIds = new Set<number>();
    const congregationIds = new Set<number>();

    for (const row of rows) {
      const offsiteId =
        row.OffsiteMeetingAddressId == null
          ? 0
          : Number(row.OffsiteMeetingAddressId);
      const congId =
        row.CongregationId == null ? 0 : Number(row.CongregationId);

      if (offsiteId > 0) {
        offsiteIds.add(offsiteId);
      } else if (congId > 0) {
        congregationIds.add(congId);
      }
    }

    const [offsiteAddresses, congregationAddresses] = await Promise.all([
      this.fetchOffsiteAddresses([...offsiteIds]),
      this.fetchCongregationAddresses([...congregationIds]),
    ]);

    return rows.map((row) => {
      const offsiteId =
        row.OffsiteMeetingAddressId == null
          ? 0
          : Number(row.OffsiteMeetingAddressId);
      const congId =
        row.CongregationId == null ? null : Number(row.CongregationId);

      let location: GroupAddress | null = null;
      if (offsiteId > 0) {
        location = offsiteAddresses.get(offsiteId) ?? null;
      } else if (congId != null && congId > 0) {
        location = congregationAddresses.get(congId) ?? null;
      }

      return {
        groupId: Number(row.GroupId),
        groupName: String(row.GroupName ?? ""),
        description: row.Description == null ? null : String(row.Description),
        // MP returns wall-clock values; pass dates through verbatim and do NOT
        // run them through new Date().toISOString() (which would shift the day).
        startDate: row.StartDate == null ? null : String(row.StartDate),
        endDate: row.EndDate == null ? null : String(row.EndDate),
        availableOnline: Boolean(row.AvailableOnline),
        meetingDay: row.MeetingDay == null ? null : String(row.MeetingDay),
        meetingTime: row.MeetingTime == null ? null : String(row.MeetingTime),
        meetsOnline: Boolean(row.MeetsOnline),
        isUserLeader: Boolean(row.IsUserLeader),
        volunteerGroup: Boolean(row.VolunteerGroup),
        groupRoleId:
          row.GroupRoleId == null ? null : Number(row.GroupRoleId),
        congregationId: congId,
        primaryContactId:
          row.PrimaryContactId == null ? null : Number(row.PrimaryContactId),
        imageUrl:
          row.ImageUrl == null || row.ImageUrl === ""
            ? null
            : String(row.ImageUrl),
        location,
      };
    });
  }

  // ── Address resolution helpers ──

  private async fetchOffsiteAddresses(
    ids: number[]
  ): Promise<Map<number, GroupAddress>> {
    const map = new Map<number, GroupAddress>();
    if (ids.length === 0) {
      return map;
    }

    const rows = await this.mp!.getTableRecords<OffsiteAddressRow>({
      table: "Addresses",
      select:
        "Address_ID,Address_Line_1,Address_Line_2,City,[State/Region] as State,Postal_Code",
      filter: `Address_ID IN (${ids.join(",")})`,
    });

    for (const row of rows) {
      const address = this.asAddress(row);
      if (address) {
        map.set(Number(row.Address_ID), address);
      }
    }

    return map;
  }

  private async fetchCongregationAddresses(
    ids: number[]
  ): Promise<Map<number, GroupAddress>> {
    const map = new Map<number, GroupAddress>();
    if (ids.length === 0) {
      return map;
    }

    // Two-hop traversal Congregations → Locations → Addresses. MP requires the
    // FK columns concatenated with _Table_ between hops (dotted chains 500 on the
    // second hop), and base columns qualified once any clause traverses an FK.
    const rows = await this.mp!.getTableRecords<CongregationAddressRow>({
      table: "Congregations",
      select:
        "Congregations.Congregation_ID,Location_ID_Table_Address_ID_Table.Address_Line_1 as Address_Line_1,Location_ID_Table_Address_ID_Table.Address_Line_2 as Address_Line_2,Location_ID_Table_Address_ID_Table.City as City,Location_ID_Table_Address_ID_Table.[State/Region] as State,Location_ID_Table_Address_ID_Table.Postal_Code as Postal_Code",
      filter: `Congregations.Congregation_ID IN (${ids.join(",")})`,
    });

    for (const row of rows) {
      const address = this.asAddress(row);
      if (address) {
        map.set(Number(row.Congregation_ID), address);
      }
    }

    return map;
  }

  /**
   * Maps a raw address row to a GroupAddress, returning null when every field
   * is null/empty (e.g. a congregation with no associated location/address).
   */
  private asAddress(row: {
    Address_Line_1: string | null;
    Address_Line_2: string | null;
    City: string | null;
    State: string | null;
    Postal_Code: string | null;
  }): GroupAddress | null {
    const addressLine1 = this.normalize(row.Address_Line_1);
    const addressLine2 = this.normalize(row.Address_Line_2);
    const city = this.normalize(row.City);
    const stateRegion = this.normalize(row.State);
    const postalCode = this.normalize(row.Postal_Code);

    if (
      addressLine1 == null &&
      addressLine2 == null &&
      city == null &&
      stateRegion == null &&
      postalCode == null
    ) {
      return null;
    }

    return { addressLine1, addressLine2, city, stateRegion, postalCode };
  }

  private normalize(value: string | null): string | null {
    if (value == null) {
      return null;
    }
    const str = String(value).trim();
    return str === "" ? null : str;
  }
}
