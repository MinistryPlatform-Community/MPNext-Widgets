import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import type { StatementPreference } from "@mpnext/types";

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface DonorRecord {
  Donor_ID: number;
  Statement_Method_ID: number;
}

export class StatementPreferencesService {
  private static instance: StatementPreferencesService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<StatementPreferencesService> {
    if (!StatementPreferencesService.instance) {
      StatementPreferencesService.instance = new StatementPreferencesService();
      await StatementPreferencesService.instance.initialize();
    }
    return StatementPreferencesService.instance;
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
      console.error(
        "StatementPreferencesService: No dp_Users record for GUID:",
        guid
      );
      return null;
    }

    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Statement Preference ──

  public async getPreference(
    contactId: number
  ): Promise<StatementPreference | null> {
    const donors = await this.mp!.getTableRecords<DonorRecord>({
      table: "Donors",
      select: "Donor_ID,Statement_Method_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });

    if (!donors[0]) {
      return null;
    }

    return {
      donorId: donors[0].Donor_ID,
      statementMethodId: donors[0].Statement_Method_ID,
      paperless: donors[0].Statement_Method_ID === 2,
    };
  }

  public async setPreference(
    contactId: number,
    donorId: number,
    paperless: boolean
  ): Promise<StatementPreference> {
    const statementMethodId = paperless ? 2 : 1;

    await this.mp!.updateTableRecords("Donors", [
      {
        Donor_ID: donorId,
        Contact_ID: contactId,
        Statement_Method_ID: statementMethodId,
      },
    ]);

    return { donorId, statementMethodId, paperless };
  }
}
