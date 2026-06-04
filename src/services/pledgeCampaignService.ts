import { MPHelper } from "@/lib/providers/ministry-platform";
import type { CommunicationInfo } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type {
  PledgeBasicContact,
  PledgeCampaign,
  PledgeFrequency,
  SavePledgeRequest,
} from "@mpnext/types";

/**
 * Server-side data + write orchestration for the next-pledge-campaign widget.
 *
 * Ported from the legacy mpp-pledge-campaign widget's PledgeCampaignApi
 * (PledgeCampaignManager / PledgeCampaignService). Reads campaign details and
 * aggregate totals via the `api_MPPW_GetPledgeCampaign` stored procedure (same
 * convention as MyPledgesService), exposes the fixed frequency lookup, checks
 * whether a contact has already pledged, and creates a Pledge (resolving or
 * creating the Donor/Contact for anonymous "blank form" submissions).
 */

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface RawCampaignRow {
  Campaign_Name?: string | null;
  Description?: string | null;
  Campaign_Goal?: number | string | null;
  Fundraising_Goal?: number | string | null;
  Campaigns_Start_Date?: string | null;
  Campaigns_End_Date?: string | null;
  Pledge_Beyond_End_Date?: boolean | number | null;
  Allow_Online_Pledge?: boolean | number | null;
  Event_ID?: number | string | null;
  Online_Thank_You_Message?: string | null;
  PledgeCount?: number | string | null;
  PledgeTotal?: number | string | null;
  DistributionTotal?: number | string | null;
  ImageUrl?: string | null;
  CustomFormId?: number | string | null;
  CustomFormGuid?: string | null;
  ForceLogin?: boolean | number | null;
}

interface ContactRow {
  Contact_ID: number;
  First_Name: string | null;
  Last_Name: string | null;
  Nickname: string | null;
  Email_Address: string | null;
  Mobile_Phone: string | null;
  Household_ID: number | null;
}

interface CommunicationTemplateRow {
  Communication_ID: number;
  Subject: string | null;
  Body: string | null;
  From_Contact: number | null;
  Reply_to_Contact: number | null;
  Author_User_ID: number | null;
}

// Pledge_Statuses.Pledge_Status_ID = 4 ("Pending"), matching the legacy insert.
const PLEDGE_STATUS_PENDING = 4;

/**
 * Fixed frequency lookup. The legacy PledgeCampaignManager.GetFrequencyData
 * returns these hard-coded values (ids are MP Frequency_IDs) rather than a
 * table read; the client's installment math keys off these exact ids.
 */
const PLEDGE_FREQUENCIES: PledgeFrequency[] = [
  { id: 52, name: "Weekly" },
  { id: 26, name: "Every Other Week" },
  { id: 24, name: "Twice Per Month" },
  { id: 12, name: "Monthly" },
  { id: 2, name: "Annually" },
  { id: 1, name: "One Time" },
];

export class PledgeCampaignService {
  private static instance: PledgeCampaignService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
    this.initialize();
  }

  public static async getInstance(): Promise<PledgeCampaignService> {
    if (!PledgeCampaignService.instance) {
      PledgeCampaignService.instance = new PledgeCampaignService();
      await PledgeCampaignService.instance.initialize();
    }
    return PledgeCampaignService.instance;
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
    if (!users[0]) {
      console.error("PledgeCampaignService: No dp_Users record for GUID:", guid);
      return null;
    }
    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Campaign ──

  public async getCampaign(campaignId: number): Promise<PledgeCampaign | null> {
    const result = await this.mp!.executeProcedure("api_MPPW_GetPledgeCampaign", {
      "@PledgeCampaignId": campaignId,
      "@IsMissionTrip": false,
      "@ImageBaseUrl": `${this.mpBaseUrl}/files/`,
    });

    const row = ((result[0] as RawCampaignRow[] | undefined) ?? [])[0];
    if (!row) return null;

    const num = (v: number | string | null | undefined): number =>
      v == null || v === "" ? 0 : Number(v);
    const bool = (v: boolean | number | null | undefined): boolean =>
      v === true || v === 1;

    return {
      pledgeCampaignId: campaignId,
      title: String(row.Campaign_Name ?? ""),
      description: row.Description == null ? null : String(row.Description),
      imageUrl:
        row.ImageUrl == null || row.ImageUrl === "" ? null : String(row.ImageUrl),
      campaignGoal: num(row.Campaign_Goal),
      fundraisingGoal:
        row.Fundraising_Goal == null ? null : num(row.Fundraising_Goal),
      pledged: num(row.PledgeTotal),
      received: num(row.DistributionTotal),
      numberOfPledges: num(row.PledgeCount),
      // MP returns wall-clock datetimes; pass through verbatim (no UTC shift).
      startDate: String(row.Campaigns_Start_Date ?? ""),
      endDate:
        row.Campaigns_End_Date == null ? null : String(row.Campaigns_End_Date),
      allowOnlinePledge: bool(row.Allow_Online_Pledge),
      pledgeBeyondEndDate: bool(row.Pledge_Beyond_End_Date),
      onlineThankYouMessage:
        row.Online_Thank_You_Message == null
          ? null
          : String(row.Online_Thank_You_Message),
      forceLogin: bool(row.ForceLogin),
      eventId: row.Event_ID == null ? null : num(row.Event_ID),
      customFormId: row.CustomFormId == null ? null : num(row.CustomFormId),
      customFormGuid:
        row.CustomFormGuid == null ? null : String(row.CustomFormGuid),
    };
  }

  // ── Frequencies ──

  public getFrequencies(): PledgeFrequency[] {
    return PLEDGE_FREQUENCIES;
  }

  // ── Has pledged ──

  /**
   * True when a pledge already exists for the campaign + contact. Base columns
   * are qualified because the filter joins through Donor_ID_Table — MP 500s on
   * ambiguous columns otherwise (same pattern as MyPledgesService).
   */
  public async hasPledged(
    campaignId: number,
    contactId: number
  ): Promise<boolean> {
    const rows = await this.mp!.getTableRecords<{ Pledge_ID: number }>({
      table: "Pledges",
      select: "Pledges.Pledge_ID",
      filter: `Pledges.Pledge_Campaign_ID = ${campaignId} AND Donor_ID_Table.Contact_ID = ${contactId}`,
      top: 1,
    });
    return rows.length > 0;
  }

  // ── Basic contact (prefill) ──

  public async getBasicContact(
    contactId: number
  ): Promise<PledgeBasicContact | null> {
    const rows = await this.mp!.getTableRecords<ContactRow>({
      table: "Contacts",
      select:
        "Contact_ID,First_Name,Last_Name,Nickname,Email_Address,Mobile_Phone,Household_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    const c = rows[0];
    if (!c) return null;
    return {
      contactId: c.Contact_ID,
      firstName: c.Nickname ?? c.First_Name ?? null,
      lastName: c.Last_Name ?? null,
      emailAddress: c.Email_Address ?? null,
      mobilePhoneNumber: c.Mobile_Phone ?? null,
      householdId: c.Household_ID ?? null,
    };
  }

  // ── Save pledge ──

  public async savePledge(
    req: SavePledgeRequest,
    userId: number | null
  ): Promise<{ success: boolean; pledgeId: number | null; message?: string }> {
    const contactId = await this.resolveContactId(req);
    const donorId = await this.resolveDonorId(contactId, userId);

    const notes = this.buildNotes(req);

    const tz = DomainTimezoneService.getInstance();
    const firstInstallment = await tz.toMpSqlDatetime(req.firstInstallmentDate);

    // _Installment_Amount is a read-only computed column in MP; it is derived
    // from Total_Pledge / Installments_Planned, so it is intentionally omitted.
    const pledgeRecord: Record<string, unknown> = {
      Donor_ID: donorId,
      Pledge_Campaign_ID: req.pledgeCampaignId,
      Pledge_Status_ID: PLEDGE_STATUS_PENDING,
      Total_Pledge: req.totalPledge,
      Installments_Planned: req.installmentsPlanned,
      Installments_Per_Year: req.installmentsPerYear,
      First_Installment_Date: firstInstallment,
      Notes: notes,
    };

    const created = (await this.mp!.createTableRecords(
      "Pledges",
      [pledgeRecord],
      userId ? { $userId: userId } : undefined
    )) as Array<{ Pledge_ID?: number }>;

    const pledgeId = created[0]?.Pledge_ID ?? null;
    if (!pledgeId) {
      return { success: false, pledgeId: null, message: "Unable to save your pledge." };
    }

    // Confirmation email is best-effort — the pledge is already saved, so a
    // failure here must not surface as an error to the user.
    if (req.pledgeEmailTemplateId && req.pledgeEmailTemplateId > 0) {
      await this.sendConfirmationEmail(req.pledgeEmailTemplateId, contactId);
    }

    return { success: true, pledgeId };
  }

  /**
   * Resolve the donor's contact id. Authenticated/household submissions pass a
   * real contact id; "blank form" submissions (contactId === 0) fall back to a
   * best-effort match on name + email/phone, then create a minimal Contact.
   * Mirrors the legacy ContactManager.FindContact flow used by registration.
   */
  private async resolveContactId(req: SavePledgeRequest): Promise<number> {
    if (req.contactId && req.contactId > 0) return req.contactId;

    const first = this.sqlEscape((req.firstName ?? "").trim());
    const last = this.sqlEscape((req.lastName ?? "").trim());
    const email = this.sqlEscape((req.email ?? "").trim());
    const phone = this.sqlEscape((req.mobilePhoneNumber ?? "").trim());

    if (last && (email || phone)) {
      const conds: string[] = [`Last_Name = '${last}'`];
      if (first) conds.push(`(First_Name = '${first}' OR Nickname = '${first}')`);
      const contactConds: string[] = [];
      if (email) contactConds.push(`Email_Address = '${email}'`);
      if (phone) contactConds.push(`Mobile_Phone = '${phone}'`);
      if (contactConds.length) conds.push(`(${contactConds.join(" OR ")})`);

      const matches = await this.mp!.getTableRecords<{ Contact_ID: number }>({
        table: "Contacts",
        select: "Contact_ID",
        filter: conds.join(" AND "),
        top: 1,
      });
      if (matches[0]) return matches[0].Contact_ID;
    }

    // No match: create a minimal Contact and let MP apply its tenant defaults.
    const display =
      `${last}, ${first}`.replace(/^, |, $/g, "").trim() || "Web Pledge";
    const contactRecord: Record<string, unknown> = {
      Display_Name: display,
      First_Name: (req.firstName ?? "").trim(),
      Last_Name: (req.lastName ?? "").trim(),
      Email_Address: (req.email ?? "").trim(),
      Mobile_Phone: (req.mobilePhoneNumber ?? "").trim(),
      Contact_Status_ID: 1,
      Company: false,
    };
    const created = (await this.mp!.createTableRecords("Contacts", [
      contactRecord,
    ])) as Array<{ Contact_ID?: number }>;
    if (!created[0]?.Contact_ID) {
      throw new Error("Unable to resolve or create a contact for the pledge.");
    }
    return created[0].Contact_ID;
  }

  /**
   * Find the contact's Donor record, creating a default one if absent (legacy
   * PledgeCampaignManager.CreateDefaultDonorRecord). Statement defaults are
   * left to MP's column defaults so this stays tenant-independent.
   */
  private async resolveDonorId(
    contactId: number,
    userId: number | null
  ): Promise<number> {
    const existing = await this.mp!.getTableRecords<{ Donor_ID: number }>({
      table: "Donors",
      select: "Donor_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    if (existing[0]?.Donor_ID) return existing[0].Donor_ID;

    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());
    const donorRecord: Record<string, unknown> = {
      Contact_ID: contactId,
      Setup_Date: now,
    };
    const created = (await this.mp!.createTableRecords(
      "Donors",
      [donorRecord],
      userId ? { $userId: userId } : undefined
    )) as Array<{ Donor_ID?: number }>;
    if (!created[0]?.Donor_ID) {
      throw new Error("Unable to resolve or create a donor for the pledge.");
    }
    return created[0].Donor_ID;
  }

  /** Legacy AddNotesToFormData: stash the entered contact details in Notes. */
  private buildNotes(req: SavePledgeRequest): string {
    return [
      `First Name: ${req.firstName ?? ""}`,
      `LastName: ${req.lastName ?? ""}`,
      `Email: ${req.email ?? ""}`,
      `Phone: ${req.mobilePhoneNumber ?? ""}`,
    ].join("\n");
  }

  /**
   * Best-effort confirmation email (replicates legacy EmailManager.CreateEmail).
   * Reads a dp_Communications template, token-replaces the to/from contact
   * merge fields, and sends. Any failure is logged and swallowed.
   */
  private async sendConfirmationEmail(
    templateId: number,
    toContactId: number
  ): Promise<void> {
    try {
      const templates = await this.mp!.getTableRecords<CommunicationTemplateRow>({
        table: "dp_Communications",
        select:
          "Communication_ID,Subject,Body,From_Contact,Reply_to_Contact,Author_User_ID",
        filter: `Communication_ID = ${templateId}`,
        top: 1,
      });
      const template = templates[0];
      if (!template || template.From_Contact == null) return;

      const toContacts = await this.mp!.getTableRecords<ContactRow>({
        table: "Contacts",
        select:
          "Contact_ID,First_Name,Last_Name,Nickname,Email_Address,Mobile_Phone,Household_ID",
        filter: `Contact_ID = ${toContactId}`,
        top: 1,
      });
      const toContact = toContacts[0];

      const fromContacts = await this.mp!.getTableRecords<ContactRow>({
        table: "Contacts",
        select:
          "Contact_ID,First_Name,Last_Name,Nickname,Email_Address,Mobile_Phone,Household_ID",
        filter: `Contact_ID = ${template.From_Contact}`,
        top: 1,
      });
      const fromContact = fromContacts[0];
      if (!fromContact || !fromContact.Email_Address) return;

      const replaceAll = (haystack: string, token: string, value: string): string =>
        haystack.split(token).join(value);

      let subject = String(template.Subject ?? "");
      let body = String(template.Body ?? "");

      if (toContact) {
        for (const [key, value] of Object.entries(toContact)) {
          if (value == null) continue;
          const token = `[${key}]`;
          subject = replaceAll(subject, token, String(value));
          body = replaceAll(body, token, String(value));
        }
      }

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
      console.error(
        "PledgeCampaignService: failed to send confirmation email:",
        error
      );
    }
  }

  // ── utils ──

  private sqlEscape(value: string): string {
    return (value ?? "").replace(/'/g, "''");
  }
}
