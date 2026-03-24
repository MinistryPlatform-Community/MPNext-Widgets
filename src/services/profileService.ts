import { MPHelper } from "@/lib/providers/ministry-platform";
import type { FileDescription } from "@/lib/providers/ministry-platform/types/provider.types";
import type { ProfileData, LookupOption, ProfileLookups, ProfileUpdateRequest, ProfileUpdateResponse } from "@mpnext/types";

export class ProfileService {
  private static instance: ProfileService;
  private mp: MPHelper | null = null;
  private lookupsCache: ProfileLookups | null = null;

  private constructor() {
    this.initialize();
  }

  public static async getInstance(): Promise<ProfileService> {
    if (!ProfileService.instance) {
      ProfileService.instance = new ProfileService();
      await ProfileService.instance.initialize();
    }
    return ProfileService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  public async getProfileByUserGuid(userGuid: string): Promise<ProfileData | null> {
    // Resolve User_GUID → Contact_ID via dp_Users table
    const users = await this.mp!.getTableRecords<{ User_ID: number; Contact_ID: number }>({
      table: "dp_Users",
      filter: `User_GUID = '${userGuid}'`,
      select: "User_ID,Contact_ID",
      top: 1,
    });

    if (users.length === 0) return null;

    const contactId = users[0].Contact_ID;

    const records = await this.mp!.getTableRecords<ProfileData>({
      table: "Contacts",
      filter: `Contact_ID = ${contactId}`,
      select: "Contact_ID,Contact_GUID,Prefix_ID,First_Name,Middle_Name,Last_Name,Nickname,Suffix_ID,Gender_ID,Date_of_Birth,Marital_Status_ID,Mobile_Phone,Company_Phone,Email_Address,Do_Not_Text,Bulk_Email_Opt_Out",
      top: 1,
    });

    if (records.length === 0) return null;

    return {
      ...records[0],
      Prefix: null,
      Suffix: null,
      Gender: null,
      Marital_Status: null,
    } as ProfileData;
  }

  public async getLookups(): Promise<ProfileLookups> {
    if (this.lookupsCache) return this.lookupsCache;

    const [prefixRows, suffixRows, genderRows, maritalRows] = await Promise.all([
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
    ]);

    const toLookup = <T>(rows: T[], idKey: keyof T, labelKey: keyof T): LookupOption[] =>
      rows.map((r) => ({ id: r[idKey] as number, label: r[labelKey] as string }));

    this.lookupsCache = {
      prefixes: toLookup(prefixRows, "Prefix_ID", "Prefix"),
      suffixes: toLookup(suffixRows, "Suffix_ID", "Suffix"),
      genders: toLookup(genderRows, "Gender_ID", "Gender"),
      maritalStatuses: toLookup(maritalRows, "Marital_Status_ID", "Marital_Status"),
    };

    return this.lookupsCache;
  }

  public async getProfilePhoto(contactId: number): Promise<{ uniqueFileId: string } | null> {
    try {
      const files = await this.mp!.getFilesByRecord({
        table: "Contacts",
        recordId: contactId,
        defaultOnly: true,
      });
      if (files.length === 0) return null;
      return { uniqueFileId: files[0].UniqueFileId };
    } catch {
      return null;
    }
  }

  public async uploadProfilePhoto(contactId: number, file: File): Promise<FileDescription> {
    // Check if there's already a default image
    const existing = await this.mp!.getFilesByRecord({
      table: "Contacts",
      recordId: contactId,
      defaultOnly: true,
    });

    if (existing.length > 0) {
      // Update the existing default image
      return await this.mp!.updateFile({
        fileId: existing[0].FileId,
        file,
        updateParams: { isDefaultImage: true },
      });
    }

    // Upload new default image
    const results = await this.mp!.uploadFiles({
      table: "Contacts",
      recordId: contactId,
      files: [file],
      uploadParams: { isDefaultImage: true },
    });
    return results[0];
  }

  public async getProfilePhotoContent(uniqueFileId: string, thumbnail?: boolean): Promise<Blob> {
    return await this.mp!.getFileContentByUniqueId({ uniqueFileId, thumbnail });
  }

  public async updateProfile(
    contactId: number,
    data: ProfileUpdateRequest
  ): Promise<ProfileUpdateResponse> {
    try {
      await this.mp!.updateTableRecords("Contacts", [
        { Contact_ID: contactId, ...data },
      ]);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update profile",
      };
    }
  }
}
