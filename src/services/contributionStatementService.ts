import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import type { ContributionStatementGroup } from "@mpnext/types";

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface StatementRow {
  Statement_ID: string | number;
  Statement_Year: string | number;
  File_Name: string;
  Unique_Name: string;
  Extension: string;
  Accounting_Company_Name: string;
}

export class ContributionStatementService {
  private static instance: ContributionStatementService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<ContributionStatementService> {
    if (!ContributionStatementService.instance) {
      ContributionStatementService.instance = new ContributionStatementService();
      await ContributionStatementService.instance.initialize();
    }
    return ContributionStatementService.instance;
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
        "ContributionStatementService: No dp_Users record for GUID:",
        guid
      );
      return null;
    }

    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Contribution Statements ──

  public async getStatements(
    contactId: number
  ): Promise<ContributionStatementGroup[]> {
    const result = await this.mp!.executeProcedure(
      "api_MPPW_GetMyContributionStatements",
      {
        "@ContactId": contactId,
        // Congregation filtering removed; the proc still expects the param.
        "@CongregationId": null,
      }
    );

    const rows = (result[0] as StatementRow[] | undefined) ?? [];

    // Group rows by Accounting_Company_Name
    const groupMap = new Map<string, ContributionStatementGroup>();

    for (const row of rows) {
      const companyName = row.Accounting_Company_Name;
      const downloadUrl = `${this.mpBaseUrl}/files/${encodeURIComponent(
        String(row.Unique_Name)
      )}`;

      const statement = {
        Statement_ID: Number(row.Statement_ID),
        Statement_Year: Number(row.Statement_Year),
        File_Name: row.File_Name,
        Unique_Name: row.Unique_Name,
        Extension: row.Extension,
        Download_Url: downloadUrl,
      };

      let group = groupMap.get(companyName);
      if (!group) {
        group = {
          Accounting_Company_Name: companyName,
          statements: [],
        };
        groupMap.set(companyName, group);
      }
      group.statements.push(statement);
    }

    // Within each group, sort statements by Statement_Year DESCENDING
    const groups = [...groupMap.values()];
    for (const group of groups) {
      group.statements.sort((a, b) => b.Statement_Year - a.Statement_Year);
    }

    return groups;
  }
}
