import { MPHelper } from "@/lib/providers/ministry-platform";
import type { CommunicationInfo } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type { Pledge } from "@mpnext/types";

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface RawPledgeRow {
  Pledge_ID: number | string;
  Pledge_Campaign_ID: number | string;
  Campaign_Name: string | null;
  Description: string | null;
  First_Name: string | null;
  Last_Name: string | null;
  Pledge_Status_ID: number | string | null;
  Pledge_Status: string | null;
  Installments_Planned: number | string;
  First_Installment_Date: string | Date;
  ImageUrl: string | null;
  Total_Pledge: number | string;
  SubTotalAmount: number | string;
}

interface CommunicationTemplateRow {
  Communication_ID: number;
  Subject: string | null;
  Body: string | null;
  From_Contact: number | null;
  Reply_to_Contact: number | null;
  Author_User_ID: number | null;
}

interface ContactMergeRow {
  Contact_ID: number;
  First_Name: string | null;
  Last_Name: string | null;
  Nickname: string | null;
  Display_Name: string | null;
  Email_Address: string | null;
}

export class MyPledgesService {
  private static instance: MyPledgesService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<MyPledgesService> {
    if (!MyPledgesService.instance) {
      MyPledgesService.instance = new MyPledgesService();
      await MyPledgesService.instance.initialize();
    }
    return MyPledgesService.instance;
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
      console.error("MyPledgesService: No dp_Users record for GUID:", guid);
      return null;
    }

    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── My Pledges ──

  public async getPledges(userId: number): Promise<Pledge[]> {
    const result = await this.mp!.executeProcedure("api_MPPW_GetMyPledges", {
      "@UserId": userId,
      "@ImageBaseUrl": `${this.mpBaseUrl}/files/`,
      // Congregation filtering removed; the proc still expects the param.
      "@CongregationId": null,
    });

    const rows = (result[0] as RawPledgeRow[] | undefined) ?? [];

    return rows.map((row) => ({
      pledgeId: Number(row.Pledge_ID),
      pledgeCampaignId: Number(row.Pledge_Campaign_ID),
      campaignName: String(row.Campaign_Name ?? ""),
      pledgeDescription: String(row.Description ?? ""),
      contactFirstName: row.First_Name == null ? null : String(row.First_Name),
      contactLastName: row.Last_Name == null ? null : String(row.Last_Name),
      pledgeStatusId:
        row.Pledge_Status_ID == null ? 1 : Number(row.Pledge_Status_ID),
      pledgeStatus: String(row.Pledge_Status ?? ""),
      installmentsPlanned: Number(row.Installments_Planned),
      // MP returns wall-clock values; pass the date through verbatim and do
      // NOT run it through new Date().toISOString() (which would shift the day).
      firstInstallmentDate: String(row.First_Installment_Date),
      imageUrl:
        row.ImageUrl == null || row.ImageUrl === ""
          ? null
          : String(row.ImageUrl),
      totalPledge: Number(row.Total_Pledge),
      pledgeTotalToDate: Number(row.SubTotalAmount),
    }));
  }

  /**
   * Confirms the pledge belongs to the given contact before allowing a mutation.
   * Base columns are qualified because the filter joins through the Donor_ID_Table
   * FK — MP 500s on ambiguous columns otherwise.
   */
  public async verifyPledgeOwnedByContact(
    pledgeId: number,
    contactId: number
  ): Promise<boolean> {
    const rows = await this.mp!.getTableRecords<{ Pledge_ID: number }>({
      table: "Pledges",
      select: "Pledges.Pledge_ID",
      filter: `Pledges.Pledge_ID = ${pledgeId} AND Donor_ID_Table.Contact_ID = ${contactId}`,
      top: 1,
    });
    return rows.length > 0;
  }

  // ── Mutation ──

  public async cancelPledge(pledgeId: number): Promise<void> {
    // 3 = Discontinued
    await this.mp!.updateTableRecords("Pledges", [
      { Pledge_ID: pledgeId, Pledge_Status_ID: 3 },
    ]);
  }

  /**
   * Best-effort cancellation confirmation email (replicates legacy
   * EmailManager.CreateEmail). The pledge is already cancelled by the time this
   * runs, so any failure is logged and swallowed — this must NOT throw.
   */
  public async sendCancellationEmail(
    templateId: number,
    toContactId: number
  ): Promise<void> {
    try {
      // 1. Read the template communication.
      const templates = await this.mp!.getTableRecords<CommunicationTemplateRow>({
        table: "dp_Communications",
        select:
          "Communication_ID,Subject,Body,From_Contact,Reply_to_Contact,Author_User_ID",
        filter: `Communication_ID = ${templateId}`,
        top: 1,
      });
      const template = templates[0];
      if (!template) {
        return;
      }

      // 2. Fetch the to-contact merge fields.
      const toContacts = await this.mp!.getTableRecords<ContactMergeRow>({
        table: "Contacts",
        select:
          "Contact_ID,First_Name,Last_Name,Nickname,Display_Name,Email_Address",
        filter: `Contact_ID = ${toContactId}`,
        top: 1,
      });
      const toContact = toContacts[0];

      // 3. Fetch the from-contact merge fields. Legacy aborts when the from
      //    contact is missing or has no email address.
      if (template.From_Contact == null) {
        return;
      }
      const fromContacts = await this.mp!.getTableRecords<ContactMergeRow>({
        table: "Contacts",
        select:
          "Contact_ID,First_Name,Last_Name,Nickname,Display_Name,Email_Address",
        filter: `Contact_ID = ${template.From_Contact}`,
        top: 1,
      });
      const fromContact = fromContacts[0];
      if (!fromContact || !fromContact.Email_Address) {
        return;
      }

      // 4. Token-replace into Subject and Body.
      let subject = String(template.Subject ?? "");
      let body = String(template.Body ?? "");

      const replaceAll = (
        haystack: string,
        token: string,
        value: string
      ): string => haystack.split(token).join(value);

      if (toContact) {
        for (const [key, value] of Object.entries(toContact)) {
          if (value == null) {
            continue;
          }
          const token = `[${key}]`;
          const str = String(value);
          subject = replaceAll(subject, token, str);
          body = replaceAll(body, token, str);
        }
      }

      for (const [key, value] of Object.entries(fromContact)) {
        if (value == null) {
          continue;
        }
        const token = `[From_User_${key}]`;
        const str = String(value);
        subject = replaceAll(subject, token, str);
        body = replaceAll(body, token, str);
      }

      // 5. Build and send the communication.
      const fromDisplayName = `${fromContact.First_Name ?? ""} ${
        fromContact.Last_Name ?? ""
      }`.trim();
      const fromAddress = String(fromContact.Email_Address);

      const comm: CommunicationInfo = {
        AuthorUserId: Number(template.Author_User_ID),
        FromContactId: Number(template.From_Contact),
        ReplyToContactId: Number(template.Reply_to_Contact),
        Contacts: [toContactId],
        Subject: subject,
        Body: body,
        StartDate: await DomainTimezoneService.getInstance().toMpSqlDatetime(
          new Date()
        ),
        CommunicationType: "Email",
        IsBulkEmail: false,
        SendToContactParents: false,
        FromAddress: { DisplayName: fromDisplayName, Address: fromAddress },
        ReplyToAddress: { DisplayName: fromDisplayName, Address: fromAddress },
      };

      await this.mp!.createCommunication(comm);
    } catch (error) {
      console.error("MyPledgesService: failed to send cancellation email:", error);
      return;
    }
  }
}
