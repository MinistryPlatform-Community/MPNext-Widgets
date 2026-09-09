import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { ConfigSettingsService } from "@/services/configSettingsService";
import type { FileDescription } from "@/lib/providers/ministry-platform/types/provider.types";
import type {
  HouseholdAddress,
  HouseholdInfo,
  HouseholdLookups,
  HouseholdMember,
  HouseholdResponse,
  UpdateHouseholdMemberRequest,
  UpdateHouseholdRequest,
} from "@mpnext/types";

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface ResolvedUser {
  /**
   * `dp_Users.User_ID`.
   *
   * Read here already — the query has always selected it — but not surfaced
   * until `next-pre-check` (C78) needed it for MP's `$userId` write parameter,
   * so an `Event_Participants` row a parent creates is audited to the parent
   * rather than to the API service account. **Audit only**: no caller may treat
   * it as an authorisation input.
   */
  userId: number;
  contactId: number;
  householdId: number | null;
  isHeadOfHousehold: boolean;
}

interface HouseholdRecord {
  Household_ID: number;
  Household_Name: string;
  Home_Phone: string | null;
  Home_Phone_Unlisted: boolean | null;
  Home_Address_Unlisted: boolean | null;
  Congregation_ID: number | null;
  Congregation_Name: string | null;
  Address_ID: number | null;
  Address_Line_1: string | null;
  Address_Line_2: string | null;
  City: string | null;
  State: string | null;
  Postal_Code: string | null;
  Country: string | null;
  Country_Code: string | null;
  Alt_Address_ID: number | null;
  Alt_Address_Line_1: string | null;
  Alt_Address_Line_2: string | null;
  Alt_City: string | null;
  Alt_State: string | null;
  Alt_Postal_Code: string | null;
  Alt_Country: string | null;
  Alt_Country_Code: string | null;
  Alt_Address_Start: string | null;
  Alt_Address_End: string | null;
  Alt_Address_Repeats_Annually: boolean | null;
}

interface MemberRecord {
  ContactId: number;
  FirstName: string;
  MiddleName: string | null;
  LastName: string;
  DisplayName: string | null;
  NickName: string | null;
  PrefixId: number | null;
  SuffixId: number | null;
  SuffixName: string | null;
  EmailAddress: string | null;
  MobilePhoneNumber: string | null;
  WorkPhoneNumber: string | null;
  HouseholdId: number | null;
  HouseholdPositionId: number | null;
  HouseholdPositionName: string | null;
  DateOfBirth: string | null;
  GenderId: number | null;
  MaritalStatusId: number | null;
  BulkEmailOptOut: boolean | null;
  EmailUnlisted: boolean | null;
  DoNotText: boolean | null;
  MobilePhoneUnlisted: boolean | null;
  RemoveFromDirectory: boolean | null;
  CongregationId: number | null;
  FileGUID: string | null;
}

interface AddressRecord {
  [key: string]: unknown;
  Address_ID: number;
  Address_Line_1: string;
  Address_Line_2?: string | null;
  City: string;
  "State/Region": string;
  Postal_Code: string;
  Country_Code?: string | null;
}

const HEAD_OF_HOUSEHOLD_POSITION_ID = 1;

const HOUSEHOLD_SELECT = [
  "Household_ID",
  "Household_Name",
  "Home_Phone",
  "Home_Phone_Unlisted",
  "Home_Address_Unlisted",
  "Congregation_ID_Table.Congregation_ID",
  "Congregation_ID_Table.Congregation_Name",
  "Address_ID_Table.Address_ID",
  "Address_ID_Table.Address_Line_1",
  "Address_ID_Table.Address_Line_2",
  "Address_ID_Table.City",
  "Address_ID_Table.[State/Region] as State",
  "Address_ID_Table.Postal_Code",
  "Address_ID_Table.Foreign_Country as Country",
  "Address_ID_Table.Country_Code",
  "Alternate_Mailing_Address_Table.Address_ID as Alt_Address_ID",
  "Alternate_Mailing_Address_Table.Address_Line_1 as Alt_Address_Line_1",
  "Alternate_Mailing_Address_Table.Address_Line_2 as Alt_Address_Line_2",
  "Alternate_Mailing_Address_Table.City as Alt_City",
  "Alternate_Mailing_Address_Table.[State/Region] as Alt_State",
  "Alternate_Mailing_Address_Table.Postal_Code as Alt_Postal_Code",
  "Alternate_Mailing_Address_Table.Foreign_Country as Alt_Country",
  "Alternate_Mailing_Address_Table.Country_Code as Alt_Country_Code",
  "Season_Start as Alt_Address_Start",
  "Season_End as Alt_Address_End",
  "Repeats_Annually as Alt_Address_Repeats_Annually",
].join(",");

// Base Contacts columns are qualified with `Contacts.` because the FK-traversal
// joins below (Suffix_ID_Table, Household_Position_ID_Table, Household_ID_Table)
// surface same-named columns and MP rejects unqualified ones as ambiguous.
const MEMBER_SELECT = [
  "Contacts.Contact_ID as ContactId",
  "Contacts.First_Name as FirstName",
  "Contacts.Middle_Name as MiddleName",
  "Contacts.Last_Name as LastName",
  "Contacts.Display_Name as DisplayName",
  "Contacts.Nickname as NickName",
  "Contacts.Prefix_ID as PrefixId",
  "Contacts.Suffix_ID as SuffixId",
  "Suffix_ID_Table.Suffix as SuffixName",
  "Contacts.Email_Address as EmailAddress",
  "Contacts.Mobile_Phone as MobilePhoneNumber",
  "Contacts.Company_Phone as WorkPhoneNumber",
  "Contacts.Household_ID as HouseholdId",
  "Contacts.Household_Position_ID as HouseholdPositionId",
  "Household_Position_ID_Table.Household_Position as HouseholdPositionName",
  "Contacts.Date_Of_Birth as DateOfBirth",
  "Contacts.Gender_ID as GenderId",
  "Contacts.Marital_Status_ID as MaritalStatusId",
  "Contacts.Bulk_Email_Opt_Out as BulkEmailOptOut",
  "Contacts.Email_Unlisted as EmailUnlisted",
  "Contacts.Do_Not_Text as DoNotText",
  "Contacts.Mobile_Phone_Unlisted as MobilePhoneUnlisted",
  "Contacts.Remove_From_Directory as RemoveFromDirectory",
  "Household_ID_Table.Congregation_ID as CongregationId",
  "dp_fileUniqueId as FileGUID",
].join(",");

export class HouseholdService {
  private static instance: HouseholdService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;
  private lookupsCache: HouseholdLookups | null = null;

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<HouseholdService> {
    if (!HouseholdService.instance) {
      HouseholdService.instance = new HouseholdService();
      await HouseholdService.instance.initialize();
    }
    return HouseholdService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── User Identity ──

  public async resolveUser(guid: string): Promise<ResolvedUser | null> {
    const users = await this.mp!.getTableRecords<DpUserRecord>({
      table: "dp_Users",
      select: "User_ID,User_GUID,Contact_ID",
      filter: `User_GUID = '${guid}'`,
      top: 1,
    });

    if (!users[0]) {
      console.error("HouseholdService: No dp_Users record for GUID:", guid);
      return null;
    }

    const contactId = users[0].Contact_ID;

    const contacts = await this.mp!.getTableRecords<{
      HouseholdId: number | null;
      HouseholdPositionId: number | null;
    }>({
      table: "Contacts",
      select: "Household_ID as HouseholdId, Household_Position_ID as HouseholdPositionId",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });

    const householdId = contacts[0]?.HouseholdId ?? null;
    const householdPositionId = contacts[0]?.HouseholdPositionId ?? null;

    return {
      userId: users[0].User_ID,
      contactId,
      householdId,
      isHeadOfHousehold: householdPositionId === HEAD_OF_HOUSEHOLD_POSITION_ID,
    };
  }

  // ── Household ──

  public async getHousehold(householdId: number): Promise<HouseholdInfo | null> {
    const records = await this.mp!.getTableRecords<HouseholdRecord>({
      table: "Households",
      select: HOUSEHOLD_SELECT,
      filter: `Household_ID = ${householdId}`,
      top: 1,
    });

    const r = records[0];
    if (!r) return null;

    const address: HouseholdAddress | null =
      r.Address_ID != null
        ? {
            addressId: r.Address_ID,
            addressLine1: r.Address_Line_1 ?? "",
            addressLine2: r.Address_Line_2 ?? null,
            city: r.City ?? "",
            stateRegion: r.State ?? "",
            postalCode: r.Postal_Code ?? "",
            country: r.Country ?? null,
            countryCode: r.Country_Code ?? null,
          }
        : null;

    const alternativeAddress: HouseholdAddress | null =
      r.Alt_Address_ID != null
        ? {
            addressId: r.Alt_Address_ID,
            addressLine1: r.Alt_Address_Line_1 ?? "",
            addressLine2: r.Alt_Address_Line_2 ?? null,
            city: r.Alt_City ?? "",
            stateRegion: r.Alt_State ?? "",
            postalCode: r.Alt_Postal_Code ?? "",
            country: r.Alt_Country ?? null,
            countryCode: r.Alt_Country_Code ?? null,
          }
        : null;

    return {
      householdId: r.Household_ID,
      name: r.Household_Name,
      homePhone: r.Home_Phone ?? null,
      congregationId: r.Congregation_ID ?? null,
      congregationName: r.Congregation_Name ?? null,
      address,
      alternativeAddress,
      alternativeAddressStart: r.Alt_Address_Start ?? null,
      alternativeAddressEnd: r.Alt_Address_End ?? null,
      alternativeAddressRepeatAnnually: Boolean(r.Alt_Address_Repeats_Annually),
      homePhoneUnlisted: Boolean(r.Home_Phone_Unlisted),
      homeAddressUnlisted: Boolean(r.Home_Address_Unlisted),
    };
  }

  // ── Members ──

  public async getMembers(householdId: number): Promise<HouseholdMember[]> {
    const records = await this.mp!.getTableRecords<MemberRecord>({
      table: "Contacts",
      select: MEMBER_SELECT,
      filter: `Contacts.Household_ID = ${householdId} AND Contacts.Contact_Status_ID <> 3`,
    });

    return records.map((r) => ({
      contactId: r.ContactId,
      firstName: r.FirstName,
      middleName: r.MiddleName ?? null,
      lastName: r.LastName,
      displayName: r.DisplayName ?? null,
      nickName: r.NickName ?? null,
      prefixId: r.PrefixId ?? null,
      suffixId: r.SuffixId ?? null,
      suffixName: r.SuffixName ?? null,
      emailAddress: r.EmailAddress ?? null,
      mobilePhoneNumber: r.MobilePhoneNumber ?? null,
      workPhoneNumber: r.WorkPhoneNumber ?? null,
      householdId: r.HouseholdId ?? null,
      householdPositionId: r.HouseholdPositionId ?? null,
      householdPositionName: r.HouseholdPositionName ?? null,
      dateOfBirth: r.DateOfBirth ?? null,
      genderId: r.GenderId ?? null,
      maritalStatusId: r.MaritalStatusId ?? null,
      bulkEmailOptOut: Boolean(r.BulkEmailOptOut),
      emailUnlisted: Boolean(r.EmailUnlisted),
      doNotText: Boolean(r.DoNotText),
      mobilePhoneUnlisted: Boolean(r.MobilePhoneUnlisted),
      removeFromDirectory: Boolean(r.RemoveFromDirectory),
      congregationId: r.CongregationId ?? null,
      imageUrl: r.FileGUID ? `${this.mpBaseUrl}/files/${r.FileGUID}` : null,
    }));
  }

  // ── Lookups ──

  public async getLookups(): Promise<HouseholdLookups> {
    if (this.lookupsCache) return this.lookupsCache;

    const [
      prefixRows,
      suffixRows,
      genderRows,
      maritalRows,
      congregationRows,
      positionRows,
      countryRows,
    ] = await Promise.all([
      this.mp!.getTableRecords<{ Prefix_ID: number; Prefix: string }>({
        table: "Prefixes",
        select: "Prefix_ID,Prefix",
        orderBy: "Prefix",
      }),
      this.mp!.getTableRecords<{ Suffix_ID: number; Suffix: string }>({
        table: "Suffixes",
        select: "Suffix_ID,Suffix",
        orderBy: "Suffix",
      }),
      this.mp!.getTableRecords<{ Gender_ID: number; Gender: string }>({
        table: "Genders",
        select: "Gender_ID,Gender",
        orderBy: "Gender",
      }),
      this.mp!.getTableRecords<{ Marital_Status_ID: number; Marital_Status: string }>({
        table: "Marital_Statuses",
        select: "Marital_Status_ID,Marital_Status",
        orderBy: "Marital_Status",
      }),
      this.mp!.getTableRecords<{ Congregation_ID: number; Congregation_Name: string }>({
        table: "Congregations",
        select: "Congregation_ID,Congregation_Name",
        orderBy: "Congregation_Name",
      }),
      this.mp!.getTableRecords<{ Household_Position_ID: number; Household_Position: string }>({
        table: "Household_Positions",
        select: "Household_Position_ID,Household_Position",
        orderBy: "Household_Position",
      }),
      this.mp!.getTableRecords<{ Country_Code: string; Country: string }>({
        table: "Countries",
        select: "Country_Code,Country",
        orderBy: "Country",
      }),
    ]);

    this.lookupsCache = {
      prefixes: prefixRows.map((r) => ({ id: r.Prefix_ID, label: r.Prefix })),
      suffixes: suffixRows.map((r) => ({ id: r.Suffix_ID, label: r.Suffix })),
      genders: genderRows.map((r) => ({ id: r.Gender_ID, label: r.Gender })),
      maritalStatuses: maritalRows.map((r) => ({
        id: r.Marital_Status_ID,
        label: r.Marital_Status,
      })),
      congregations: congregationRows.map((r) => ({
        id: r.Congregation_ID,
        label: r.Congregation_Name,
      })),
      householdPositions: positionRows.map((r) => ({
        id: r.Household_Position_ID,
        label: r.Household_Position,
      })),
      countries: countryRows.map((r) => ({ code: r.Country_Code, name: r.Country })),
    };

    return this.lookupsCache;
  }

  // ── Google Maps Key ──

  public async getGoogleMapsApiKey(): Promise<string | null> {
    const config = await ConfigSettingsService.getInstance();
    return config.getGoogleMapsApiKey();
  }

  // ── Bundle ──

  public async getHouseholdBundle(guid: string): Promise<HouseholdResponse> {
    const user = await this.resolveUser(guid);

    if (!user || user.householdId == null) {
      const [lookups, googleMapsApiKey] = await Promise.all([
        this.getLookups(),
        this.getGoogleMapsApiKey(),
      ]);
      return {
        household: null,
        members: [],
        isHeadOfHousehold: false,
        lookups,
        googleMapsApiKey,
      };
    }

    const [household, members, lookups, googleMapsApiKey] = await Promise.all([
      this.getHousehold(user.householdId),
      this.getMembers(user.householdId),
      this.getLookups(),
      this.getGoogleMapsApiKey(),
    ]);

    return {
      household,
      members,
      isHeadOfHousehold: user.isHeadOfHousehold,
      lookups,
      googleMapsApiKey,
    };
  }

  // ── Address upsert ──

  private async upsertAddress(
    address: HouseholdAddress | null | undefined
  ): Promise<number | null> {
    if (!address) return null;

    const line1 = address.addressLine1?.trim();
    if (!line1) return null;

    const record: AddressRecord = {
      Address_ID: address.addressId ?? 0,
      Address_Line_1: address.addressLine1,
      Address_Line_2: address.addressLine2 ?? null,
      City: address.city,
      "State/Region": address.stateRegion,
      Postal_Code: address.postalCode,
      Country_Code: address.countryCode ?? null,
    };

    if (address.addressId != null) {
      await this.mp!.updateTableRecords<AddressRecord>("Addresses", [record]);
      return address.addressId;
    }

    const { Address_ID: _ignored, ...createRecord } = record;
    void _ignored;
    const created = await this.mp!.createTableRecords<AddressRecord>("Addresses", [
      createRecord as AddressRecord,
    ]);
    return created[0]?.Address_ID ?? null;
  }

  // ── Household update ──

  public async updateHousehold(
    householdId: number,
    req: UpdateHouseholdRequest
  ): Promise<HouseholdInfo | null> {
    const [addressId, altAddressId] = await Promise.all([
      this.upsertAddress(req.address),
      this.upsertAddress(req.alternativeAddress),
    ]);

    await this.mp!.updateTableRecords("Households", [
      {
        Household_ID: householdId,
        Household_Name: req.name,
        Home_Phone: req.homePhone ?? null,
        Congregation_ID: req.congregationId ?? null,
        Address_ID: addressId,
        Alternate_Mailing_Address: altAddressId,
        Season_Start: req.alternativeAddressStart ?? null,
        Season_End: req.alternativeAddressEnd ?? null,
        Repeats_Annually: req.alternativeAddressRepeatAnnually ?? false,
        Home_Phone_Unlisted: req.homePhoneUnlisted ?? false,
        Home_Address_Unlisted: req.homeAddressUnlisted ?? false,
      },
    ]);

    return this.getHousehold(householdId);
  }

  // ── Member save (create/update) ──

  public async saveMember(
    householdId: number,
    req: UpdateHouseholdMemberRequest
  ): Promise<{ contactId: number; members: HouseholdMember[] }> {
    const nickName = req.nickName?.trim() ? req.nickName.trim() : req.firstName;

    let suffixLabel: string | null = null;
    if (req.suffixId != null) {
      const lookups = await this.getLookups();
      suffixLabel = lookups.suffixes.find((s) => s.id === req.suffixId)?.label ?? null;
    }

    let displayName = `${req.lastName}, ${nickName}`;
    if (suffixLabel) {
      displayName += ` ${suffixLabel}`;
    }

    const record: Record<string, unknown> = {
      First_Name: req.firstName,
      Middle_Name: req.middleName ?? null,
      Last_Name: req.lastName,
      Nickname: nickName,
      Prefix_ID: req.prefixId ?? null,
      Suffix_ID: req.suffixId ?? null,
      Display_Name: displayName,
      Email_Address: req.emailAddress ?? null,
      Mobile_Phone: req.mobilePhoneNumber ?? null,
      Company_Phone: req.workPhoneNumber ?? null,
      Household_ID: householdId,
      Household_Position_ID: req.householdPositionId ?? null,
      Date_Of_Birth: req.dateOfBirth ?? null,
      Gender_ID: req.genderId ?? null,
      Marital_Status_ID: req.maritalStatusId ?? null,
      Company: false,
      Bulk_Email_Opt_Out: req.bulkEmailOptOut ?? false,
      Email_Unlisted: req.emailUnlisted ?? false,
      Do_Not_Text: req.doNotText ?? false,
      Mobile_Phone_Unlisted: req.mobilePhoneUnlisted ?? false,
      Remove_From_Directory: req.removeFromDirectory ?? false,
    };

    let contactId: number;
    if (req.contactId != null) {
      record.Contact_ID = req.contactId;
      const updated = await this.mp!.updateTableRecords<{ Contact_ID: number }>("Contacts", [
        record as { Contact_ID: number },
      ]);
      contactId = updated[0]?.Contact_ID ?? req.contactId;
    } else {
      const created = await this.mp!.createTableRecords<{ Contact_ID: number }>("Contacts", [
        record as { Contact_ID: number },
      ]);
      contactId = created[0]?.Contact_ID;
    }

    const members = await this.getMembers(householdId);
    return { contactId, members };
  }

  // ── Member photo ──

  public async verifyMemberInHousehold(
    contactId: number,
    householdId: number
  ): Promise<boolean> {
    const contacts = await this.mp!.getTableRecords<{ Household_ID: number | null }>({
      table: "Contacts",
      select: "Household_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    return contacts[0]?.Household_ID === householdId;
  }

  public async uploadMemberPhoto(
    householdId: number,
    contactId: number,
    file: File
  ): Promise<FileDescription> {
    // SECURITY: confirm the contact belongs to the caller's household before writing.
    const inHousehold = await this.verifyMemberInHousehold(contactId, householdId);
    if (!inHousehold) {
      throw new Error("Contact is not a member of this household.");
    }

    const existing = await this.mp!.getFilesByRecord({
      table: "Contacts",
      recordId: contactId,
      defaultOnly: true,
    });

    if (existing.length > 0) {
      return await this.mp!.updateFile({
        fileId: existing[0].FileId,
        file,
        updateParams: { isDefaultImage: true },
      });
    }

    const results = await this.mp!.uploadFiles({
      table: "Contacts",
      recordId: contactId,
      files: [file],
      uploadParams: { isDefaultImage: true },
    });
    return results[0];
  }
}
