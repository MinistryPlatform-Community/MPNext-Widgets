import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv, getEnvOptional } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import { CustomFormService } from "@/services/customFormService";
import type { OpportunityDetail, OpportunityContact } from "@mpnext/types";

/**
 * Backend for the `next-opportunity-details` widget. Migrated from the legacy
 * .NET `OpportunityManager.GetOpportunityById` / `OpportunityService.Respond`.
 *
 * Detail is read straight from the Opportunities table with FK traversal (the
 * legacy code path, which has no dedicated stored procedure). Responding
 * resolves/creates a contact + participant and writes a Responses row, mirroring
 * `InquiryFormTranslator` + `OpportunityManager.CreateOpportunityResponse`.
 *
 * Simplifications relative to legacy (noted inline):
 *  - Location is the program congregation name from the FK read; the legacy
 *    event-based location override is not reproduced.
 *  - A submitted custom-form response is saved against the contact only (no
 *    Opportunity_Response link column is exposed by CustomFormService).
 */

interface OpportunityRow {
  Id: number | string | null;
  ImageUrl: string | null;
  NoImageText: string | null;
  Title: string | null;
  Description: string | null;
  AddressId: number | string | null;
  Location: string | null;
  ContactDisplayName: string | null;
  ContactFirstName: string | null;
  ContactNickName: string | null;
  ContactLastName: string | null;
  ContactEmail: string | null;
  ContactPhone: string | null;
  ContactImageUrl: string | null;
  MeetingDay: string | null;
  StartDate: string | null;
  RequiredGender: string | null;
  MinimumAge: number | string | null;
  MaximumNeeded: number | string | null;
  VisibilityLevel: number | string | null;
  EventId: number | string | null;
  CustomFormGuid: string | null;
  CustomFormId: number | string | null;
  ForceLogin: boolean | number | null;
}

interface AddressRow {
  Address_ID: number | string;
  Address_Line_1: string | null;
  Address_Line_2: string | null;
  City: string | null;
  "State/Region": string | null;
  Postal_Code: string | null;
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export interface RespondArgs {
  opportunityId: number;
  contactId: number | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
  userId: number | null;
}

export class OpportunityDetailsService {
  private static instance: OpportunityDetailsService;
  private mp: MPHelper | null = null;
  private imageBaseUrl = "";
  private defaultParticipantTypeId: number;

  private constructor() {
    const raw = getEnv("MINISTRY_PLATFORM_BASE_URL").replace(/\/$/, "");
    this.imageBaseUrl = `${raw}/files/`;
    const ptype = getEnvOptional("MPPW_DEFAULT_PARTICIPANT_TYPE_ID");
    this.defaultParticipantTypeId = ptype ? parseInt(ptype, 10) : 1;
    this.initialize();
  }

  public static async getInstance(): Promise<OpportunityDetailsService> {
    if (!OpportunityDetailsService.instance) {
      OpportunityDetailsService.instance = new OpportunityDetailsService();
      await OpportunityDetailsService.instance.initialize();
    }
    return OpportunityDetailsService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── Single opportunity detail ──

  private detailSelect(): string {
    // Ported from OpportunityManager.GetDetailSelectFields. Base table is
    // qualified (Opportunities.) and FK columns use MP _Table traversal to
    // avoid ambiguous-column errors.
    return [
      "Opportunities.Opportunity_ID AS Id",
      `'${this.imageBaseUrl}' + CONVERT(varchar(40), dp_FileUniqueID) AS ImageUrl`,
      "Group_Role_ID_Table.Role_Title AS NoImageText",
      "Opportunity_Title AS Title",
      "Opportunities.Description AS Description",
      "Program_ID_Table_Congregation_ID_Table_Location_ID_Table.Address_ID AS AddressId",
      "Program_ID_Table_Congregation_ID_Table.Congregation_Name AS Location",
      "Contact_Person_Table.Display_Name AS ContactDisplayName",
      "Contact_Person_Table.First_Name AS ContactFirstName",
      "Contact_Person_Table.Nickname AS ContactNickName",
      "Contact_Person_Table.Last_Name AS ContactLastName",
      "Contact_Person_Table.Email_Address AS ContactEmail",
      "Contact_Person_Table.Company_Phone AS ContactPhone",
      `CASE WHEN Contact_Person_Table.dp_FileUniqueID IS NULL THEN '' ELSE '${this.imageBaseUrl}' + CONVERT(varchar(40), Contact_Person_Table.dp_FileUniqueID) END AS ContactImageUrl`,
      "ISNULL(DATENAME(dw, Opportunity_Date), 'Ongoing') AS MeetingDay",
      "Opportunity_Date AS StartDate",
      "Required_Gender_Table.Gender AS RequiredGender",
      "Minimum_Age AS MinimumAge",
      "Maximum_Needed AS MaximumNeeded",
      "Opportunities.Visibility_Level_ID AS VisibilityLevel",
      "Add_to_Event_Table.Event_ID AS EventId",
      "Custom_Form_Table.Form_GUID AS CustomFormGuid",
      "Custom_Form_Table.Form_ID AS CustomFormId",
      "Custom_Form_Table.Force_Login AS ForceLogin",
    ].join(", ");
  }

  public async getOpportunityById(opportunityId: number): Promise<OpportunityDetail> {
    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());

    const rows = await this.mp!.getTableRecords<OpportunityRow>({
      table: "Opportunities",
      select: this.detailSelect(),
      // Visibility 1 = hidden; date gate matches the legacy detail read.
      filter: `Opportunities.Opportunity_ID = ${opportunityId} AND Opportunities.Visibility_Level_ID <> 1 AND (Opportunities.Opportunity_Date IS NULL OR Opportunities.Opportunity_Date > '${now}')`,
      top: 1,
    });

    const row = rows[0];
    if (!row) {
      throw new Error("Opportunity not found");
    }

    const maximumNeeded = toNumberOrNull(row.MaximumNeeded);
    const numberOfResponses = await this.getResponseCount(opportunityId);
    const remainingNeeded =
      maximumNeeded == null ? null : Math.max(0, maximumNeeded - numberOfResponses);

    const addressId = toNumberOrNull(row.AddressId);
    const address = addressId != null ? await this.getAddressLine(addressId) : null;

    const minimumAgeNum = toNumberOrNull(row.MinimumAge);
    const minimumAge = minimumAgeNum != null ? `Age ${minimumAgeNum}+` : null;

    return {
      id: Number(row.Id),
      title: String(row.Title ?? ""),
      description: row.Description ?? null,
      imageUrl: row.ImageUrl || null,
      location: row.Location ?? null,
      address,
      // MP returns wall-clock datetimes; pass through verbatim (no Z-shift).
      startDate: row.StartDate ? String(row.StartDate) : "",
      meetingDay: row.MeetingDay ?? null,
      requiredGender: row.RequiredGender ?? null,
      minimumAge,
      remainingNeeded,
      maximumNeeded,
      numberOfResponses,
      visibilityLevel: toNumberOrNull(row.VisibilityLevel) ?? 0,
      eventId: toNumberOrNull(row.EventId),
      customFormId: toNumberOrNull(row.CustomFormId),
      customFormGuid: row.CustomFormGuid ?? null,
      forceLogin: Boolean(row.ForceLogin),
      contacts: this.buildContacts(row),
    };
  }

  private buildContacts(row: OpportunityRow): OpportunityContact[] {
    let displayName = "";
    if (row.ContactLastName && row.ContactNickName) {
      displayName = `${row.ContactNickName} ${row.ContactLastName}`;
    } else if (row.ContactLastName && row.ContactFirstName) {
      displayName = `${row.ContactFirstName} ${row.ContactLastName}`;
    } else if (row.ContactDisplayName) {
      displayName = row.ContactDisplayName;
    }
    if (!displayName) return [];
    return [
      {
        displayName,
        imageUrl: row.ContactImageUrl || null,
        emailAddress: row.ContactEmail ?? null,
      },
    ];
  }

  private async getResponseCount(opportunityId: number): Promise<number> {
    try {
      const rows = await this.mp!.getTableRecords<{ Response_ID: number }>({
        table: "Responses",
        select: "Response_ID",
        filter: `Opportunity_ID = ${opportunityId} AND Response_Result_ID = 1`,
        top: 10000,
      });
      return rows.length;
    } catch {
      return 0;
    }
  }

  private async getAddressLine(addressId: number): Promise<string | null> {
    try {
      const rows = await this.mp!.getTableRecords<AddressRow>({
        table: "Addresses",
        // [State/Region] must be bracketed — the slash is MP's FK-traversal
        // operator, so an unbracketed State/Region is read as State→Region.
        select:
          "Address_ID,Address_Line_1,Address_Line_2,City,[State/Region],Postal_Code",
        filter: `Address_ID = ${addressId}`,
        top: 1,
      });
      const a = rows[0];
      if (!a) return null;
      const cityStateZip = [a.City ? `${a.City},` : null, a["State/Region"], a.Postal_Code]
        .filter((p) => p != null && String(p).trim().length > 0)
        .join(" ")
        .trim();
      const parts = [a.Address_Line_1, a.Address_Line_2, cityStateZip || null].filter(
        (p): p is string => p != null && String(p).trim().length > 0
      );
      return parts.length > 0 ? parts.join(", ") : null;
    } catch {
      return null;
    }
  }

  // ── Has-responded check ──

  public async hasResponded(opportunityId: number, contactId: number): Promise<boolean> {
    const rows = await this.mp!.getTableRecords<{ Response_ID: number }>({
      table: "Responses",
      select: "Response_ID",
      filter: `Opportunity_ID = ${opportunityId} AND Participant_ID_Table.Contact_ID = ${contactId} AND Closed = 0`,
      top: 1,
    });
    return rows.length > 0;
  }

  // ── Respond (volunteer inquiry) ──

  public async respond(args: RespondArgs): Promise<number> {
    const opportunity = await this.getOpportunityById(args.opportunityId);

    // Gate on Maximum_Needed (legacy OpportunityService.Respond).
    if (
      opportunity.maximumNeeded != null &&
      opportunity.numberOfResponses >= opportunity.maximumNeeded
    ) {
      throw new Error("The maximum number of responses for this opportunity has been met.");
    }

    const contactId = await this.resolveContactId(args);
    const participantId = await this.resolveParticipantId(contactId, args.userId);

    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());

    const record: Record<string, unknown> = {
      Response_Date: now,
      First_Name: args.firstName || null,
      Last_Name: args.lastName || null,
      Phone: args.phone || null,
      Email: args.email || null,
      Comments: args.message || null,
      Opportunity_ID: args.opportunityId,
      Participant_ID: participantId,
      Closed: false,
    };
    if (opportunity.eventId != null) {
      record.Event_ID = opportunity.eventId;
    }

    const created = (await this.mp!.createTableRecords(
      "Responses",
      [record],
      args.userId ? { $userId: args.userId } : undefined
    )) as Array<{ Response_ID?: number }>;
    const responseId = created[0]?.Response_ID;
    if (!responseId) {
      throw new Error("Unable to save your response.");
    }
    return responseId;
  }

  /** Save a submitted custom-form response (best-effort; never blocks respond). */
  public async saveCustomForm(
    formId: number,
    payload: Record<string, string>,
    contactId: number | null,
    ipAddress: string | null
  ): Promise<void> {
    try {
      const forms = await CustomFormService.getInstance();
      const answers = forms.extractAnswers(payload);
      if (answers.length === 0) return;
      await forms.saveFormResponse({
        formId,
        contactId,
        ipAddress,
        answers,
        contact: {
          firstName: payload.FirstName,
          lastName: payload.LastName,
          email: payload.EmailAddress,
          phone: payload.MobilePhoneNumber,
        },
      });
    } catch (err) {
      console.warn("OpportunityDetailsService: custom-form save failed:", err);
    }
  }

  // ── Contact / participant resolution (mirrors registrationService) ──

  private async resolveContactId(args: RespondArgs): Promise<number> {
    if (args.contactId && args.contactId > 0) return args.contactId;

    const first = this.sqlEscape(args.firstName);
    const last = this.sqlEscape(args.lastName);
    const email = this.sqlEscape(args.email);
    const phone = this.sqlEscape(args.phone);

    // Best-effort fuzzy match (legacy ContactManager.FindContact).
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

    // No match — create a minimal Contact and let MP apply its defaults.
    const display = `${args.lastName}, ${args.firstName}`.replace(/^, |, $/g, "").trim() ||
      "Web Inquiry";
    const created = (await this.mp!.createTableRecords("Contacts", [
      {
        Display_Name: display,
        First_Name: args.firstName || null,
        Last_Name: args.lastName || null,
        Email_Address: args.email || null,
        Mobile_Phone: args.phone || null,
        Contact_Status_ID: 1,
        Company: false,
      },
    ])) as Array<{ Contact_ID?: number }>;
    if (!created[0]?.Contact_ID) {
      throw new Error("Unable to resolve or create a contact for this response.");
    }
    return created[0].Contact_ID;
  }

  private async resolveParticipantId(
    contactId: number,
    userId: number | null
  ): Promise<number> {
    const existing = await this.mp!.getTableRecords<{ Participant_ID: number }>({
      table: "Participants",
      select: "Participant_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    if (existing[0]?.Participant_ID) return existing[0].Participant_ID;

    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());
    const created = (await this.mp!.createTableRecords(
      "Participants",
      [
        {
          Contact_ID: contactId,
          Participant_Type_ID: this.defaultParticipantTypeId,
          Participant_Start_Date: now,
          Notes: "Created by Web Widget",
        },
      ],
      userId ? { $userId: userId } : undefined
    )) as Array<{ Participant_ID?: number }>;
    if (!created[0]?.Participant_ID) {
      throw new Error("Unable to create participant for this response.");
    }
    return created[0].Participant_ID;
  }

  private sqlEscape(value: string): string {
    return (value ?? "").replace(/'/g, "''").trim();
  }
}
