import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import type { DonationRecord } from "@mpnext/types";

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface RawRow {
  Donation_Date: string | Date;
  Amount: number | string;
  Program_ID: number | string;
  Program_Name: string | null;
  Statement_Title: string | null;
  IsTaxDeductible: boolean | number;
  IsSpouseDonation: boolean | number;
  IsSoftCredit: boolean | number;
  IsPending: boolean | number;
  IsOmitAmount: boolean | number;
}

export class MyGivingService {
  private static instance: MyGivingService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<MyGivingService> {
    if (!MyGivingService.instance) {
      MyGivingService.instance = new MyGivingService();
      await MyGivingService.instance.initialize();
    }
    return MyGivingService.instance;
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
      console.error("MyGivingService: No dp_Users record for GUID:", guid);
      return null;
    }

    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── My Giving History ──

  public async getDonations(
    contactId: number,
    year: number,
    month?: number
  ): Promise<DonationRecord[]> {
    const params: Record<string, number | null> = {
      "@ContactId": contactId,
      "@Year": year,
      // Congregation filtering removed; the proc still expects the param.
      "@CongregationId": null,
    };

    if (month != null && month > 0) {
      params["@Month"] = month;
    }

    const result = await this.mp!.executeProcedure(
      "api_MPPW_GetMyGivingHistory",
      params
    );

    const rows = (result[0] as RawRow[] | undefined) ?? [];

    return rows.map((row) => ({
      // MP returns wall-clock values; pass the date through verbatim and do
      // NOT run it through new Date().toISOString() (which would shift the day).
      donationDate: String(row.Donation_Date),
      amount: Number(row.Amount),
      programId: Number(row.Program_ID),
      programName: String(row.Program_Name ?? ""),
      statementTitle: String(row.Statement_Title ?? ""),
      isTaxDeductible: Boolean(row.IsTaxDeductible),
      isSpouseDonation: Boolean(row.IsSpouseDonation),
      isSoftCredit: Boolean(row.IsSoftCredit),
      isPending: Boolean(row.IsPending),
      isOmitAmount: Boolean(row.IsOmitAmount),
    }));
  }
}
