import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import type {
  AgeOrGradeGroup,
  PlanYourVisitConfig,
  PyvOption,
  PyvCountry,
  PyvRegisterRequest,
} from "@mpnext/types";

/**
 * Backend for the `next-plan-your-visit` widget. Ported from the legacy .NET
 * `PlanYourVisitService` / `PlanYourVisitManager` (which used direct table CRUD
 * — no stored procedures).
 *
 * Two-step flow:
 *   1. `sendVerificationEmail` — confirms the visitor isn't an existing contact,
 *      mints a signed verify token, renders the configured dp_Communications
 *      template and emails the visitor a link back to the host page.
 *   2. `saveVisitDetails` (gated by a verified token) — creates the household +
 *      address + head/spouse/children contacts, participants, milestone
 *      assignments and pending age/grade group memberships, then sends the user
 *      + church notification emails.
 *
 * Email note: MinistryPlatform's REST layer has no "send from template" call, so
 * templates (subject/body) are read from dp_Communications / dp_Communication_
 * Templates and the `[merge_token]` substitution + send is done here, mirroring
 * the legacy EmailManager.
 */

interface ContactRow {
  Contact_ID: number | string;
  First_Name: string | null;
  Last_Name: string | null;
  Email_Address: string | null;
}

interface MessageTemplate {
  subject: string;
  body: string;
  fromContactId: number | null;
}

function toNumberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  const n = toNumberOrNull(value);
  return n === null ? fallback : n;
}

function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str === "" ? null : str;
}

/** Escape a value for safe inclusion inside an MP `LIKE '...'` filter literal. */
function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export class PlanYourVisitService {
  private static instance: PlanYourVisitService;
  private mp: MPHelper | null = null;
  private mpBaseUrl: string;
  private idCache = new Map<string, number | null>();

  private constructor() {
    this.mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL").replace(/\/$/, "");
    this.initialize();
  }

  public static async getInstance(): Promise<PlanYourVisitService> {
    if (!PlanYourVisitService.instance) {
      PlanYourVisitService.instance = new PlanYourVisitService();
      await PlanYourVisitService.instance.initialize();
    }
    return PlanYourVisitService.instance;
  }

  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  // ── Configuration ──

  public async getConfigurations(): Promise<PlanYourVisitConfig> {
    const [congregationRows, genderRows, countryRows, phoneMask] = await Promise.all([
      this.mp!.getTableRecords<{ Id: number | string; Name: string | null }>({
        table: "Congregations",
        select: "Congregation_ID AS Id, Congregation_Name AS Name",
        filter: "Available_Online = 1",
        orderBy: "Congregation_Name",
        top: 100,
      }),
      this.mp!.getTableRecords<{ Id: number | string; Name: string | null }>({
        table: "Genders",
        select: "Gender_ID AS Id, Gender AS Name",
        orderBy: "Gender",
        top: 100,
      }),
      this.mp!.getTableRecords<{ Code: string | null; Name: string | null }>({
        table: "Countries",
        select: "Country_Code AS Code, Country AS Name",
        orderBy: "Country",
        top: 300,
      }),
      this.getConfigValue("PhoneMask"),
    ]);

    const toOptions = (rows: { Id: number | string; Name: string | null }[]): PyvOption[] =>
      rows
        .filter((r) => r.Name && toNumberOrNull(r.Id) != null)
        .map((r) => ({ id: toNumber(r.Id), name: String(r.Name) }));

    const countries: PyvCountry[] = countryRows
      .filter((r) => r.Code && r.Name)
      .map((r) => ({ code: String(r.Code), name: String(r.Name) }));

    return {
      congregations: toOptions(congregationRows),
      genders: toOptions(genderRows),
      countries,
      phoneMask: phoneMask ?? null,
    };
  }

  public async getAgeOrGradeGroups(congregationId: number): Promise<AgeOrGradeGroup[]> {
    const groupTypeId = await this.getIdByValue(
      "Group_Types",
      "Group_Type",
      "Age or Grade Group",
      "Group_Type_ID"
    );
    if (groupTypeId == null) return [];

    const globalCongregationId =
      toNumberOrNull(await this.getConfigValue("GlobalCongregationID")) ?? 0;

    const base =
      `Group_Type_ID = ${groupTypeId} AND Available_Online = 1 ` +
      `AND Start_Date < GETUTCDATE() AND ISNULL(End_Date, GETUTCDATE()) >= GETUTCDATE()`;
    const filter =
      congregationId > 0
        ? `Congregation_ID IN (${congregationId},${globalCongregationId}) AND ${base}`
        : `Congregation_ID = ${globalCongregationId} AND ${base}`;

    const groups = await this.mp!.getTableRecords<{
      Group_ID: number | string;
      Group_Name: string | null;
      Age_in_Months_to_Promote: number | string | null;
      TargetSize: number | string | null;
    }>({
      table: "Groups",
      select:
        "Group_ID, Group_Name, Group_Type_ID, Congregation_ID, Age_in_Months_to_Promote, ISNULL(Target_Size, -1) AS TargetSize",
      filter,
      orderBy: "Group_Name",
      top: 500,
    });

    const result: AgeOrGradeGroup[] = [];
    for (const g of groups) {
      const groupId = toNumber(g.Group_ID);
      const targetSize = toNumber(g.TargetSize, -1);
      const option: AgeOrGradeGroup = {
        id: groupId,
        value: String(g.Group_Name ?? ""),
        ageInMonthsToPromote: toNumberOrNull(g.Age_in_Months_to_Promote),
      };

      if (targetSize === -1) {
        result.push(option);
      } else if (targetSize > 0) {
        const participants = await this.mp!.getTableRecords<{ Group_Participant_ID: number }>({
          table: "Group_Participants",
          select: "Group_Participant_ID",
          filter: `Group_ID = ${groupId} AND (GETDATE() BETWEEN Group_Participants.Start_Date AND ISNULL(Group_Participants.End_Date, GETDATE()))`,
        });
        if (participants.length <= targetSize) result.push(option);
      }
    }
    return result;
  }

  /** The congregation's Plan_A_Visit_Template (a dp_Communication_Templates id), or null. */
  public async getCongregationEmailTemplate(congregationId: number): Promise<number | null> {
    const rows = await this.mp!.getTableRecords<{ Plan_A_Visit_Template: number | string | null }>({
      table: "Congregations",
      select: "Plan_A_Visit_Template",
      filter: `Congregation_ID = ${congregationId}`,
      top: 1,
    });
    return toNumberOrNull(rows[0]?.Plan_A_Visit_Template ?? null);
  }

  // ── Contact existence ──

  /** Find an existing contact by name + email/phone. Returns its id or null. */
  public async findContact(
    firstName: string,
    lastName: string,
    email: string
  ): Promise<number | null> {
    const f = clean(firstName);
    const l = clean(lastName);
    const e = clean(email);
    if (!f || !l || !e) return null;

    const rows = await this.mp!.getTableRecords<{ Contact_ID: number | string }>({
      table: "Contacts",
      select: "Contacts.Contact_ID AS Contact_ID",
      filter:
        `Contacts.Last_Name LIKE '${sqlLiteral(l)}' ` +
        `AND (Contacts.First_Name LIKE '${sqlLiteral(f)}' OR Contacts.Nickname LIKE '${sqlLiteral(f)}') ` +
        `AND Contacts.Email_Address LIKE '${sqlLiteral(e)}'`,
      top: 1,
    });
    return rows[0] ? toNumber(rows[0].Contact_ID) : null;
  }

  // ── Verification email ──

  /**
   * Send the verification email. Returns `{ contactExists: true }` (no email
   * sent) when the visitor already has a contact record, mirroring the legacy
   * "Contact exists" branch that offers sign-in instead.
   */
  public async sendVerificationEmail(args: {
    firstName: string;
    lastName: string;
    email: string;
    verifyUrl: string; // returnUrl + "?mpp-verify-id=" + token
    templateId: number;
  }): Promise<{ contactExists: boolean }> {
    const existing = await this.findContact(args.firstName, args.lastName, args.email);
    if (existing != null) return { contactExists: true };

    await this.sendMessageTemplate(args.templateId, args.email, `${args.firstName} ${args.lastName}`, {
      mpp_verify_email_url: args.verifyUrl,
      mpp_contact_first_name: args.firstName,
      mpp_contact_last_name: args.lastName,
    });

    return { contactExists: false };
  }

  // ── Save visit details ──

  public async saveVisitDetails(model: PyvRegisterRequest): Promise<void> {
    const headFirst = clean(model.headOfHousehold.firstName) ?? "";
    const headLast = clean(model.headOfHousehold.lastName) ?? "";

    const householdId = await this.createHousehold(model, headLast);

    const [activeStatusId, headPositionId, minorPositionId] = await Promise.all([
      this.getIdByValue("Contact_Statuses", "Contact_Status", "Active", "Contact_Status_ID"),
      this.getIdByValue("Household_Positions", "Household_Position", "Head of Household", "Household_Position_ID"),
      this.getIdByValue("Household_Positions", "Household_Position", "Minor Child", "Household_Position_ID"),
    ]);

    // Head of household.
    const headContactId = await this.findOrCreateContact({
      firstName: headFirst,
      lastName: headLast,
      email: model.email,
      mobilePhone: clean(model.headOfHousehold.mobilePhoneNumber),
      genderId: null,
      dateOfBirth: null,
      statusId: activeStatusId,
      positionId: headPositionId,
    });
    await this.associateHousehold(headContactId, householdId);
    const headParticipantId = await this.createParticipant(headContactId);
    await this.assignMilestone(model, headParticipantId);

    // Spouse (optional).
    const spouseFirst = clean(model.spouse?.firstName);
    if (spouseFirst) {
      const spouseContactId = await this.findOrCreateContact({
        firstName: spouseFirst,
        lastName: headLast,
        email: clean(model.spouse?.emailAddress),
        mobilePhone: clean(model.spouse?.mobilePhoneNumber),
        genderId: null,
        dateOfBirth: null,
        statusId: activeStatusId,
        positionId: headPositionId,
      });
      await this.associateHousehold(spouseContactId, householdId);
      const spouseParticipantId = await this.createParticipant(spouseContactId);
      await this.assignMilestone(model, spouseParticipantId);
    }

    // Children (optional).
    for (const child of model.children ?? []) {
      const childFirst = clean(child.firstName);
      const childLast = clean(child.lastName) ?? headLast;
      if (!childFirst) continue;
      const childContactId = await this.createContact({
        firstName: childFirst,
        lastName: childLast,
        email: null,
        mobilePhone: null,
        genderId: child.genderId ?? null,
        dateOfBirth: clean(child.dateOfBirth),
        statusId: activeStatusId,
        positionId: minorPositionId,
      });
      await this.associateHousehold(childContactId, householdId);
      const childParticipantId = await this.createParticipant(childContactId);
      const groupId = toNumberOrNull(child.ageAndGradeGroup ?? null);
      if (groupId != null && groupId > 0) {
        await this.createPendingGroupParticipant(groupId, childParticipantId);
      }
    }

    // Notifications — best-effort (records are already saved).
    await this.sendNotificationEmails(model, headFirst, headLast).catch((err) =>
      console.warn("PlanYourVisitService: notification email failed:", err)
    );
  }

  // ── Household / address ──

  private async createHousehold(model: PyvRegisterRequest, headLastName: string): Promise<number> {
    let addressId: number | null = null;
    const addr = model.address;
    if (addr && clean(addr.addressLine1)) {
      const created = await this.mp!.createTableRecords<{ Address_ID: number }>("Addresses", [
        {
          Address_Line_1: clean(addr.addressLine1),
          Address_Line_2: clean(addr.addressLine2),
          City: clean(addr.city),
          "State/Region": clean(addr.stateRegion),
          Postal_Code: clean(addr.postalCode),
          Country_Code: clean(addr.countryCode),
        } as unknown as { Address_ID: number },
      ]);
      addressId = toNumberOrNull(created[0]?.Address_ID ?? null);
    }

    const householdSourceId = await this.getIdByValue(
      "Household_Sources",
      "Household_Source",
      "Plan a Visit Widget",
      "Household_Source_ID"
    );

    const record: Record<string, unknown> = {
      Congregation_ID: model.congregationId,
      Household_Name: headLastName || "Visitor",
      Bulk_Mail_Opt_Out: false,
    };
    if (householdSourceId != null) record.Household_Source_ID = householdSourceId;
    if (addressId != null) record.Address_ID = addressId;

    const created = await this.mp!.createTableRecords<{ Household_ID: number }>("Households", [
      record as unknown as { Household_ID: number },
    ]);
    const householdId = toNumberOrNull(created[0]?.Household_ID ?? null);
    if (householdId == null) throw new Error("Failed to create household.");
    return householdId;
  }

  // ── Contacts / participants / milestones ──

  private async findOrCreateContact(c: {
    firstName: string;
    lastName: string;
    email: string | null;
    mobilePhone: string | null;
    genderId: number | null;
    dateOfBirth: string | null;
    statusId: number | null;
    positionId: number | null;
  }): Promise<number> {
    if (c.email) {
      const existing = await this.findContact(c.firstName, c.lastName, c.email);
      if (existing != null) return existing;
    }
    return this.createContact(c);
  }

  private async createContact(c: {
    firstName: string;
    lastName: string;
    email: string | null;
    mobilePhone: string | null;
    genderId: number | null;
    dateOfBirth: string | null;
    statusId: number | null;
    positionId: number | null;
  }): Promise<number> {
    const record: Record<string, unknown> = {
      Company: false,
      Status: c.statusId,
      Household_Position_ID: c.positionId,
      Mobile_Phone: c.mobilePhone,
      Email_Address: c.email,
      Gender_ID: c.genderId,
      First_Name: c.firstName,
      Last_Name: c.lastName,
      Nickname: c.firstName,
      Display_Name: `${c.lastName}, ${c.firstName}`,
    };
    if (c.dateOfBirth) record.Date_of_Birth = c.dateOfBirth;

    const created = await this.mp!.createTableRecords<{ Contact_ID: number }>("Contacts", [
      record as unknown as { Contact_ID: number },
    ]);
    const contactId = toNumberOrNull(created[0]?.Contact_ID ?? null);
    if (contactId == null) throw new Error("Failed to create contact.");
    return contactId;
  }

  private async associateHousehold(contactId: number, householdId: number): Promise<void> {
    await this.mp!.updateTableRecords("Contacts", [
      { Contact_ID: contactId, Household_ID: householdId },
    ]);
  }

  private async createParticipant(contactId: number): Promise<number> {
    const participantTypeId = toNumberOrNull(await this.getConfigValue("defaultParticipantType"));
    if (participantTypeId == null) {
      throw new Error("Cannot create participant: defaultParticipantType is not configured.");
    }
    const startDate = await this.now();
    const created = await this.mp!.createTableRecords<{ Participant_ID: number }>("Participants", [
      {
        Contact_ID: contactId,
        Participant_Type_ID: participantTypeId,
        Participant_Start_Date: startDate,
        Notes: "Created by Plan Your Visit Widget",
      } as unknown as { Participant_ID: number },
    ]);
    const participantId = toNumberOrNull(created[0]?.Participant_ID ?? null);
    if (participantId == null) throw new Error("Failed to create participant.");
    return participantId;
  }

  private async assignMilestone(model: PyvRegisterRequest, participantId: number): Promise<void> {
    const milestoneId = toNumberOrNull(model.milestoneToAssignId ?? null);
    const programId = toNumberOrNull(model.milestoneProgramId ?? null);
    if (milestoneId == null || programId == null) return;
    const dateAccomplished = await this.now();
    await this.mp!.createTableRecords("Participant_Milestones", [
      {
        Milestone_ID: milestoneId,
        Participant_ID: participantId,
        Program_ID: programId,
        Date_Accomplished: dateAccomplished,
        Notes: "Created by Plan Your Visit Widget.",
      },
    ]);
  }

  /** Add a child participant to the chosen age/grade Group (pending approval). */
  private async createPendingGroupParticipant(groupId: number, participantId: number): Promise<void> {
    const roleRows = await this.mp!.getTableRecords<{ DefaultRole: number | string | null }>({
      table: "Groups",
      select: "Group_Type_ID_Table.Default_Role AS DefaultRole",
      filter: `Group_ID = ${groupId}`,
      top: 1,
    });
    const roleId = toNumberOrNull(roleRows[0]?.DefaultRole ?? null);
    if (roleId == null) return; // No default role — skip group assignment.

    const startDate = await this.now();
    await this.mp!.createTableRecords("Group_Participants", [
      {
        Group_ID: groupId,
        Participant_ID: participantId,
        Group_Role_ID: roleId,
        Start_Date: startDate,
        Notes: "Created by Plan Your Visit Widget",
      },
    ]);
  }

  // ── Notification emails ──

  private async sendNotificationEmails(
    model: PyvRegisterRequest,
    headFirst: string,
    headLast: string
  ): Promise<void> {
    const congregationName = await this.getCongregationName(model.congregationId);

    // 1. User notification — congregation's Plan_A_Visit_Template (a template).
    const userTemplateId =
      toNumberOrNull(model.userNotificationEmailTemplate ?? null) ??
      (await this.getCongregationEmailTemplate(model.congregationId));
    if (userTemplateId != null) {
      await this.sendCommunicationTemplate(
        userTemplateId,
        clean(model.email) ?? "",
        `${headFirst} ${headLast}`,
        {
          mpp_congregation_name: congregationName,
          mpp_contact_first_name: headFirst,
          mpp_contact_last_name: headLast,
        }
      ).catch((err) => console.warn("PlanYourVisitService: user notification failed:", err));
    }

    // 2. Church notification — the widget's churchNotificationEmailTemplate (message).
    const churchTemplateId = toNumberOrNull(model.churchNotificationEmailTemplate ?? null);
    if (churchTemplateId != null) {
      const congContact = await this.getCongregationContact(model.congregationId);
      if (congContact?.email) {
        await this.sendMessageTemplate(
          churchTemplateId,
          congContact.email,
          congregationName,
          {
            mpp_congregation_name: congregationName,
            mpp_contact_first_name: headFirst,
            mpp_contact_last_name: headLast,
            mpp_when_to_expect_you: clean(model.whenCanWeExpectYou) ?? "",
          }
        ).catch((err) => console.warn("PlanYourVisitService: church notification failed:", err));
      }
    }
  }

  private async getCongregationName(congregationId: number): Promise<string> {
    const rows = await this.mp!.getTableRecords<{ Congregation_Name: string | null }>({
      table: "Congregations",
      select: "Congregation_Name",
      filter: `Congregation_ID = ${congregationId}`,
      top: 1,
    });
    return clean(rows[0]?.Congregation_Name) ?? "";
  }

  /** Plan_A_Visit_User (a user) → its contact, else the congregation's Contact_ID. */
  private async getCongregationContact(
    congregationId: number
  ): Promise<{ contactId: number; email: string | null } | null> {
    const rows = await this.mp!.getTableRecords<{
      PlanContactId: number | string | null;
      ContactId: number | string | null;
    }>({
      table: "Congregations",
      select:
        "Plan_A_Visit_User_Table.Contact_ID AS PlanContactId, Congregations.Contact_ID AS ContactId",
      filter: `Congregations.Congregation_ID = ${congregationId}`,
      top: 1,
    });
    const row = rows[0];
    const contactId = toNumberOrNull(row?.PlanContactId ?? null) ?? toNumberOrNull(row?.ContactId ?? null);
    if (contactId == null) return null;
    const contact = await this.getContactById(contactId);
    return { contactId, email: contact?.Email_Address ?? null };
  }

  private async getContactById(contactId: number): Promise<ContactRow | null> {
    const rows = await this.mp!.getTableRecords<ContactRow>({
      table: "Contacts",
      select: "Contact_ID,First_Name,Last_Name,Email_Address",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    return rows[0] ?? null;
  }

  // ── Email template render + send ──

  /** Read a dp_Communications message template (verification / church notice). */
  private async getMessageTemplate(id: number): Promise<MessageTemplate | null> {
    const rows = await this.mp!.getTableRecords<{
      Subject: string | null;
      Body: string | null;
      From_Contact: number | string | null;
    }>({
      table: "dp_Communications",
      select: "Subject, Body, From_Contact",
      filter: `Communication_ID = ${id}`,
      top: 1,
    });
    const r = rows[0];
    if (!r) return null;
    return {
      subject: r.Subject ?? "",
      body: r.Body ?? "",
      fromContactId: toNumberOrNull(r.From_Contact),
    };
  }

  /** Read a dp_Communication_Templates template (congregation user notice). */
  private async getCommunicationTemplate(id: number): Promise<MessageTemplate | null> {
    const rows = await this.mp!.getTableRecords<{
      Subject_Text: string | null;
      Body_HTML: string | null;
      From_Contact: number | string | null;
    }>({
      table: "dp_Communication_Templates",
      select: "Subject_Text, Body_HTML, From_Contact",
      filter: `Communication_Template_ID = ${id}`,
      top: 1,
    });
    const r = rows[0];
    if (!r) return null;
    return {
      subject: r.Subject_Text ?? "",
      body: r.Body_HTML ?? "",
      fromContactId: toNumberOrNull(r.From_Contact),
    };
  }

  private async sendMessageTemplate(
    templateId: number,
    toEmail: string,
    toName: string,
    merge: Record<string, string>
  ): Promise<void> {
    const template = await this.getMessageTemplate(templateId);
    if (!template) throw new Error(`Email template ${templateId} not found.`);
    await this.renderAndSend(template, toEmail, toName, merge);
  }

  private async sendCommunicationTemplate(
    templateId: number,
    toEmail: string,
    toName: string,
    merge: Record<string, string>
  ): Promise<void> {
    const template = await this.getCommunicationTemplate(templateId);
    if (!template) throw new Error(`Communication template ${templateId} not found.`);
    await this.renderAndSend(template, toEmail, toName, merge);
  }

  private async renderAndSend(
    template: MessageTemplate,
    toEmail: string,
    toName: string,
    merge: Record<string, string>
  ): Promise<void> {
    if (!toEmail) throw new Error("No recipient email address.");

    const from = await this.resolveFromAddress(template.fromContactId);

    let subject = template.subject;
    let body = template.body;
    for (const [key, value] of Object.entries(merge)) {
      subject = replaceToken(subject, key, value);
      body = replaceToken(body, key, value);
    }

    await this.mp!.sendMessage({
      FromAddress: from,
      ToAddresses: [{ DisplayName: toName, Address: toEmail }],
      Subject: subject,
      Body: body,
    });
  }

  private async resolveFromAddress(
    fromContactId: number | null
  ): Promise<{ DisplayName: string; Address: string }> {
    if (fromContactId != null) {
      const contact = await this.getContactById(fromContactId);
      if (contact?.Email_Address) {
        const name = `${contact.First_Name ?? ""} ${contact.Last_Name ?? ""}`.trim();
        return { DisplayName: name || contact.Email_Address, Address: contact.Email_Address };
      }
    }
    throw new Error("Email template has no valid From contact.");
  }

  // ── Helpers ──

  /** Look up the numeric id of a row by a column value (cached). */
  private async getIdByValue(
    table: string,
    columnName: string,
    value: string,
    idColumn: string
  ): Promise<number | null> {
    const cacheKey = `${table}:${columnName}:${value}`;
    if (this.idCache.has(cacheKey)) return this.idCache.get(cacheKey)!;

    let id: number | null = null;
    try {
      const rows = await this.mp!.getTableRecords<Record<string, number | string | null>>({
        table,
        select: `${idColumn} AS Id`,
        filter: `${columnName} = '${sqlLiteral(value)}'`,
        top: 1,
      });
      id = toNumberOrNull(rows[0]?.Id ?? null);
    } catch (err) {
      console.warn(`PlanYourVisitService: getIdByValue ${table}.${columnName}='${value}' failed:`, err);
    }
    this.idCache.set(cacheKey, id);
    return id;
  }

  private async getConfigValue(keyName: string): Promise<string | null> {
    const rows = await this.mp!
      .getTableRecords<{ Value: string | null }>({
        table: "dp_Configuration_Settings",
        select: "Value",
        filter: `Key_Name = '${sqlLiteral(keyName)}'`,
        top: 1,
      })
      .catch(() => [] as { Value: string | null }[]);
    return clean(rows[0]?.Value ?? null);
  }

  private async now(): Promise<string> {
    const tz = DomainTimezoneService.getInstance();
    return tz.toMpSqlDatetime(new Date().toISOString());
  }
}

/** Replace `[key]` tokens (case-insensitive) the way MP merge fields render. */
function replaceToken(text: string, key: string, value: string): string {
  if (!text) return text;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\[${escaped}\\]`, "gi"), value);
}
