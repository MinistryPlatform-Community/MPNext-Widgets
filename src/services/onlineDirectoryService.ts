import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type { CommunicationInfo } from "@/lib/providers/ministry-platform";
import type { DirectoryConfig, DirectoryMember, DirectoryFilterOption } from "@mpnext/types";

/**
 * Backend for the authenticated `next-online-directory` widget. Migrated from
 * the legacy .NET `OnlineDirectoryManager` / `OnlineDirectoryService`.
 *
 *  - Access is gated by the signed-in user's participant type + member status
 *    `Can_Access_Directory` flags (and a deceased-contact short-circuit).
 *  - Search is a Contacts read with directory-eligibility filters and one of
 *    four keyword modes (keyword / display-name / "last, first" / household id).
 *  - Unlisted phone/email/address fields are nulled server-side rather than
 *    relying on the client to hide them.
 *  - Emailing a member sends an MP communication addressed by contact id, so
 *    the recipient's address is never exposed to the browser.
 */

// Legacy Constants.cs directory values.
const MINIMUM_SEARCH_LENGTH = 3;
const SEARCH_INPUT_TIMEOUT = 1000;
const HOUSEHOLD_PREFIX = "hh ";
const MAX_RESULTS = 100;

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface AccessRow {
  ContactStatus: string | null;
  ParticipantRecord: number | string | null;
  MemberStatusId: number | string | null;
  ParticipantTypeCanAccess: boolean | number | null;
  MemberStatusCanAccess: boolean | number | null;
}

interface ContactRow {
  ContactId: number | string;
  DisplayName: string | null;
  NicknameOrFirstName: string | null;
  LastName: string | null;
  Suffix: string | null;
  MobilePhone: string | null;
  MobilePhoneUnlisted: boolean | number | null;
  DateofBirth: string | null;
  EmailAddress: string | null;
  EmailUnlisted: boolean | number | null;
  HouseholdId: number | string | null;
  CongregationId: number | string | null;
  HouseholdPosition: string | null;
  HouseholdPositionId: number | string | null;
  HomePhone: string | null;
  HomePhoneUnlisted: boolean | number | null;
  HomeAddressUnlisted: boolean | number | null;
  AddressId: number | string | null;
  AddressLine1: string | null;
  City: string | null;
  State: string | null;
  PostalCode: string | null;
  HouseholdName: string | null;
  ContactImageUrl: string | null;
}

interface FromContactRow {
  Contact_ID: number | string;
  First_Name: string | null;
  Last_Name: string | null;
  Email_Address: string | null;
}

export interface DirectorySearchFilters {
  keyword: string;
  congregationId: number | null;
}

type SearchType = "keyword" | "displayName" | "lastNameFirstName" | "householdId";

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export class OnlineDirectoryService {
  private static instance: OnlineDirectoryService;
  private mp: MPHelper | null = null;
  private imageBaseUrl = "";

  private constructor() {
    const raw = getEnv("MINISTRY_PLATFORM_BASE_URL").replace(/\/$/, "");
    this.imageBaseUrl = `${raw}/files/`;
    this.initialize();
  }

  public static async getInstance(): Promise<OnlineDirectoryService> {
    if (!OnlineDirectoryService.instance) {
      OnlineDirectoryService.instance = new OnlineDirectoryService();
      await OnlineDirectoryService.instance.initialize();
    }
    return OnlineDirectoryService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── User identity ──

  public async getUserByGuid(
    guid: string
  ): Promise<{ User_ID: number; Contact_ID: number } | null> {
    const users = await this.mp!.getTableRecords<DpUserRecord>({
      table: "dp_Users",
      select: "User_ID,User_GUID,Contact_ID",
      filter: `User_GUID = '${this.sqlEscape(guid)}'`,
      top: 1,
    });
    if (!users[0]) return null;
    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Access gate ──

  /**
   * Mirrors OnlineDirectoryApiController.UserCanAccessDirectory +
   * OnlineDirectoryManager.CanAccessDirectory: deceased → no; otherwise the
   * participant type must allow access and (if set) the member status must too.
   */
  public async canAccessDirectory(contactId: number): Promise<boolean> {
    const rows = await this.mp!.getTableRecords<AccessRow>({
      table: "Contacts",
      select: [
        "Contact_Status_ID_Table.Contact_Status AS ContactStatus",
        "Contacts.Participant_Record AS ParticipantRecord",
        "Participant_Record_Table.Member_Status_ID AS MemberStatusId",
        "Participant_Record_Table_Participant_Type_ID_Table.Can_Access_Directory AS ParticipantTypeCanAccess",
        "Participant_Record_Table_Member_Status_ID_Table.Can_Access_Directory AS MemberStatusCanAccess",
      ].join(", "),
      filter: `Contacts.Contact_ID = ${contactId}`,
      top: 1,
    });

    const row = rows[0];
    if (!row) return false;

    if ((row.ContactStatus ?? "").trim().toLowerCase() === "deceased") return false;
    if (toNumberOrNull(row.ParticipantRecord) == null) return false;

    const participantTypeCanAccess = Boolean(row.ParticipantTypeCanAccess);
    const memberStatusCanAccess =
      toNumberOrNull(row.MemberStatusId) == null ? true : Boolean(row.MemberStatusCanAccess);

    return participantTypeCanAccess && memberStatusCanAccess;
  }

  // ── Config ──

  public async getConfig(): Promise<DirectoryConfig> {
    let congregations: DirectoryFilterOption[] = [];
    try {
      const rows = await this.mp!.getTableRecords<{ Id: number | string; Name: string | null }>({
        table: "Congregations",
        select: "Congregation_ID AS Id, Congregation_Name AS Name",
        filter: "Available_Online = 1 AND (End_Date IS NULL OR End_Date >= GETDATE())",
        orderBy: "Congregation_Name",
        top: 1000,
      });
      congregations = rows
        .filter((r) => r.Name)
        .map((r) => ({ id: Number(r.Id), name: String(r.Name) }));
    } catch {
      congregations = [];
    }

    return {
      congregations,
      minimumSearchLength: MINIMUM_SEARCH_LENGTH,
      searchInputTimeout: SEARCH_INPUT_TIMEOUT,
      householdPrefix: HOUSEHOLD_PREFIX,
    };
  }

  // ── Search ──

  public async search(filters: DirectorySearchFilters): Promise<DirectoryMember[]> {
    const keyword = (filters.keyword ?? "").trim();
    const searchType = this.determineSearchType(keyword);

    let householdId: number | null = null;
    if (searchType === "householdId") {
      // Keyword is "hh <id>"; the household-position chip sends it this way.
      const parts = keyword.split(/\s+/);
      householdId = toNumberOrNull(parts[1]);
      if (householdId == null) return [];
    }

    const filter = this.buildFilter(keyword, searchType, filters.congregationId, householdId);
    const orderBy = this.buildOrderBy(searchType);

    const rows = await this.mp!.getTableRecords<ContactRow>({
      table: "Contacts",
      select: this.selectFields(),
      filter,
      orderBy,
      top: MAX_RESULTS,
    });

    return rows.map((r) => this.mapMember(r));
  }

  private determineSearchType(keyword: string): SearchType {
    if (!keyword) return "keyword";
    if (keyword.includes(",")) return "lastNameFirstName";
    const parts = keyword.split(/\s+/);
    if (parts.length > 1) {
      if (parts[0] === HOUSEHOLD_PREFIX.trim()) return "householdId";
      return "displayName";
    }
    return "keyword";
  }

  private selectFields(): string {
    return [
      "Contacts.Contact_ID AS ContactId",
      "Contacts.Display_Name AS DisplayName",
      "COALESCE(Contacts.Nickname, Contacts.First_Name) AS NicknameOrFirstName",
      "Contacts.Last_Name AS LastName",
      "Suffix_ID_Table.Suffix AS Suffix",
      "Contacts.Mobile_Phone AS MobilePhone",
      "Contacts.Mobile_Phone_Unlisted AS MobilePhoneUnlisted",
      "Contacts.Date_of_Birth AS DateofBirth",
      "Contacts.Email_Address AS EmailAddress",
      "Contacts.Email_Unlisted AS EmailUnlisted",
      "Household_ID_Table.Household_ID AS HouseholdId",
      "Household_ID_Table_Congregation_ID_Table.Congregation_ID AS CongregationId",
      "Household_Position_ID_Table.Household_Position AS HouseholdPosition",
      "Household_Position_ID_Table.Household_Position_ID AS HouseholdPositionId",
      "Household_ID_Table.Home_Phone AS HomePhone",
      "Household_ID_Table.Home_Phone_Unlisted AS HomePhoneUnlisted",
      "Household_ID_Table.Home_Address_Unlisted AS HomeAddressUnlisted",
      "Household_ID_Table_Address_ID_Table.Address_ID AS AddressId",
      "Household_ID_Table_Address_ID_Table.Address_Line_1 AS AddressLine1",
      "Household_ID_Table_Address_ID_Table.City AS City",
      "Household_ID_Table_Address_ID_Table.[State/Region] AS State",
      "Household_ID_Table_Address_ID_Table.Postal_Code AS PostalCode",
      "Household_ID_Table.Household_Name AS HouseholdName",
      `'${this.imageBaseUrl}' + CONVERT(varchar(40), dp_FileUniqueID) AS ContactImageUrl`,
    ].join(", ");
  }

  private buildFilter(
    keyword: string,
    searchType: SearchType,
    congregationId: number | null,
    householdId: number | null
  ): string {
    // Directory eligibility (Contact_Status != Deceased, not removed, shown).
    let filter =
      "Contact_Status_ID_Table.Contact_Status_ID != 3" +
      " AND Contacts.Remove_From_Directory = 0" +
      " AND Participant_Record_Table_Participant_Type_ID_Table.Show_In_Directory = 1" +
      " AND (Participant_Record_Table_Member_Status_ID_Table.Show_In_Directory = 1 OR Participant_Record_Table.Member_Status_ID IS NULL)";

    const kw = this.sqlEscape(keyword);

    if (kw && searchType === "keyword") {
      filter +=
        " AND (" +
        [
          `Contacts.First_Name LIKE '%${kw}%'`,
          `Contacts.Last_Name LIKE '%${kw}%'`,
          `Contacts.Nickname LIKE '%${kw}%'`,
          `Contacts.Mobile_Phone LIKE '%${kw}%'`,
          `Contacts.Email_Address LIKE '%${kw}%'`,
          `Household_ID_Table.Home_Phone LIKE '%${kw}%'`,
        ].join(" OR ") +
        ")";
    } else if (kw && searchType === "displayName") {
      const parts = keyword.split(/\s+/);
      const first = this.sqlEscape(parts[0]);
      const last = this.sqlEscape(parts.slice(1).join(" "));
      filter += ` AND (Contacts.First_Name LIKE '%${first}%' OR Contacts.Nickname LIKE '%${first}%') AND Contacts.Last_Name LIKE '%${last}%'`;
    } else if (kw && searchType === "lastNameFirstName") {
      const parts = keyword.split(",");
      const last = this.sqlEscape((parts[0] ?? "").trim());
      const first = this.sqlEscape((parts[1] ?? "").trim());
      filter += ` AND Contacts.Last_Name LIKE '${last}%' AND (Contacts.First_Name LIKE '${first}%' OR Contacts.Nickname LIKE '${first}%')`;
    }

    if (congregationId && congregationId > 0) {
      filter += ` AND Household_ID_Table_Congregation_ID_Table.Congregation_ID = ${congregationId}`;
    }
    if (householdId && householdId > 0) {
      filter += ` AND Household_ID_Table.Household_ID = ${householdId}`;
    }

    return filter;
  }

  private buildOrderBy(searchType: SearchType): string {
    if (searchType === "householdId") {
      // Heads of household first, then by first name.
      return "(CASE Household_Position_ID_Table.Household_Position_ID WHEN 1 THEN 1 ELSE 99 END), NicknameOrFirstName";
    }
    return "DisplayName asc, DateofBirth desc, City asc, State asc";
  }

  private mapMember(r: ContactRow): DirectoryMember {
    const mobileUnlisted = Boolean(r.MobilePhoneUnlisted);
    const homeUnlisted = Boolean(r.HomePhoneUnlisted);
    const addressUnlisted = Boolean(r.HomeAddressUnlisted);
    const emailUnlisted = Boolean(r.EmailUnlisted);
    const addressId = toNumberOrNull(r.AddressId);

    const nickOrFirst = (r.NicknameOrFirstName ?? "").trim();
    const last = (r.LastName ?? "").trim();
    const suffix = (r.Suffix ?? "").trim();
    const displayName =
      [nickOrFirst, last, suffix].filter(Boolean).join(" ").trim() ||
      (r.DisplayName ?? "").trim();

    const { short, monthDay } = this.formatBirthday(r.DateofBirth);

    const addressListed = !addressUnlisted && addressId != null && addressId > 0;
    const address = addressListed
      ? [
          r.AddressLine1,
          [r.City ? `${r.City},` : null, r.State, r.PostalCode]
            .filter((p) => p && String(p).trim().length)
            .join(" "),
        ]
          .filter((p) => p && String(p).trim().length)
          .join(", ") || null
      : null;

    return {
      contactId: Number(r.ContactId),
      displayName,
      householdPosition: r.HouseholdPosition ?? null,
      householdId: toNumberOrNull(r.HouseholdId),
      householdName: r.HouseholdName ?? null,
      congregationId: toNumberOrNull(r.CongregationId),
      contactImageUrl: r.ContactImageUrl || null,
      mobilePhone: !mobileUnlisted && r.MobilePhone ? r.MobilePhone : null,
      homePhone: !homeUnlisted && r.HomePhone ? r.HomePhone : null,
      canEmail: !emailUnlisted && !!r.EmailAddress,
      dateOfBirthShort: short,
      dateOfBirthMonthDay: monthDay,
      address,
    };
  }

  /** Wall-clock parse of an MP date → { "Mon D", "MM-DD" } (no year). */
  private formatBirthday(value: string | null): { short: string | null; monthDay: string | null } {
    if (!value) return { short: null, monthDay: null };
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return { short: null, monthDay: null };
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12) return { short: null, monthDay: null };
    return {
      short: `${MONTHS_SHORT[month - 1]} ${day}`,
      monthDay: `${m[2]}-${m[3]}`,
    };
  }

  // ── Email a member ──

  public async sendEmail(args: {
    fromUserId: number;
    fromContactId: number;
    toContactId: number;
    subject: string;
    body: string;
  }): Promise<void> {
    const fromRows = await this.mp!.getTableRecords<FromContactRow>({
      table: "Contacts",
      select: "Contact_ID,First_Name,Last_Name,Email_Address",
      filter: `Contact_ID = ${args.fromContactId}`,
      top: 1,
    });
    const from = fromRows[0];
    if (!from || !from.Email_Address) {
      throw new Error("Your account has no email address on file to send from.");
    }

    const fromDisplayName = `${from.First_Name ?? ""} ${from.Last_Name ?? ""}`.trim();
    const fromAddress = String(from.Email_Address);
    const now = await DomainTimezoneService.getInstance().toMpSqlDatetime(
      new Date().toISOString()
    );

    const comm: CommunicationInfo = {
      AuthorUserId: args.fromUserId,
      FromContactId: args.fromContactId,
      ReplyToContactId: args.fromContactId,
      Contacts: [args.toContactId],
      Subject: args.subject,
      Body: args.body,
      StartDate: now,
      CommunicationType: "Email",
      IsBulkEmail: false,
      SendToContactParents: false,
      FromAddress: { DisplayName: fromDisplayName, Address: fromAddress },
      ReplyToAddress: { DisplayName: fromDisplayName, Address: fromAddress },
    };

    await this.mp!.createCommunication(comm);
  }

  private sqlEscape(value: string): string {
    return (value ?? "").replace(/'/g, "''");
  }
}
