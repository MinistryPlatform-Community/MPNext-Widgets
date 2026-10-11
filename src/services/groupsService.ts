import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import { cap, clean } from "@/services/_shared/mp-lookup";
import {
  MessageTemplateService,
  type TemplateMergeData,
  type TemplateRecipient,
} from "@/services/messageTemplateService";
import type {
  GroupCard,
  GroupConfigurations,
  GroupContact,
  GroupContactOption,
  GroupCurrentContact,
  GroupDetail,
  GroupFilterOption,
  GroupInquiryRequest,
  SuggestGroupRequest,
} from "@mpnext/types";

/**
 * Backend for the `next-group-finder` and `next-group-details` widgets.
 *
 * Ported from the legacy .NET `GroupService` / `GroupManager`, which wrapped the
 * `api_MPPW_SearchGroups` stored procedure (used for both the search grid and a
 * single-group detail when `@GroupId` is supplied) plus direct table reads for
 * lookups, inquiries, sign-ups and suggest-a-group inserts.
 */

export interface GroupSearchFilters {
  congregationId?: number | null;
  ministryId?: number | null;
  parentGroupId?: number | null;
  groupFocusId?: number | null;
  lifeStageId?: number | null;
  groupTypeId?: number | null;
  cityPostalCode?: string | null;
  keyword?: string | null;
  /** Meeting_Day_ID values (1=Sun … 7=Sat). */
  meetingDays?: number[];
  /** "morning" | "lunchtime" | "afternoon" | "evening". */
  meetingTimes?: string[];
  meetsOnline?: boolean | null;
  showFullGroups?: boolean;
  showFutureGroups?: boolean;
  countGroupInquiries?: boolean;
}

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

/** First result set of api_MPPW_SearchGroups (the group card rows). */
interface GroupRow {
  Id: number | string;
  ImageUrl: string | null;
  Title: string | null;
  NoImageText: string | null;
  Description: string | null;
  Offsite: string | null;
  Latitude: number | string | null;
  Longitude: number | string | null;
  Address: string | null;
  Location: string | null;
  MeetingTime: string | null;
  MeetingDay: string | null;
  StartDate: string | null;
  IsFull: number | string | null;
  TotalParticipantsCount: number | string | null;
  TargetSize: number | string | null;
  LifeStage: string | null;
  GroupFocus: string | null;
  MeetingFrequency: string | null;
  Hidden: number | string | null;
  UserHasInquired: number | string | null;
  UserHasSignedUp: number | string | null;
  MeetsOnline: boolean | number | null;
}

/** Second result set of api_MPPW_SearchGroups (group leaders / primary contact). */
interface GroupContactRow {
  ContactId: number | string;
  ImageUrl: string | null;
  DisplayName: string | null;
  FirstName: string | null;
  NickName: string | null;
  LastName: string | null;
  ParticipantId: number | string | null;
  DonorId: number | string | null;
  UserId: number | string | null;
  UserName: string | null;
  IsDefaultContact: number | string | null;
  EmailAddress: string | null;
}

interface LookupRow {
  Id: number | string | null;
  Name: string | null;
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

function capOrNull(value: string | null, max: number): string | null {
  return value == null ? null : cap(value, max);
}

/** A contact's identity columns, as read from MP. */
export interface ContactIdentity {
  contactId: number;
  firstName: string | null;
  nickname: string | null;
  lastName: string | null;
  displayName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
  householdId: number | null;
}

/** Who an inquiry or sign-up was written for — the recipient of its confirmation. */
export interface InquirerDetails {
  contactId: number | null;
  firstName: string | null;
  nickname: string | null;
  lastName: string | null;
  emailAddress: string | null;
  mobilePhoneNumber: string | null;
}

/**
 * The three `*-email-template` attributes of `next-group-details` (C11). Each
 * is a `dp_Communications` **message template** id — the same kind of id every
 * other legacy widget's `*emailtemplate` attribute carries.
 */
export interface GroupEmailTemplates {
  /** Confirmation to the inquirer. */
  inquiry?: number | null;
  /** Confirmation to the person signed up. */
  signup?: number | null;
  /** Notification to the group's leaders on a sign-up. */
  leaderSignup?: number | null;
}

/**
 * The request named a contact the caller may not act for: an anonymous caller
 * naming any contact, or a signed-in one naming a contact outside their own
 * household. Routes answer `not_household_member` (403).
 */
export class NotHouseholdMemberError extends Error {
  constructor(public readonly contactId: number) {
    super(`Contact ${contactId} is not in the caller's household.`);
    this.name = "NotHouseholdMemberError";
  }
}

export class GroupsService {
  private static instance: GroupsService;
  private mp: MPHelper | null = null;
  private imageBaseUrl = "";

  private constructor() {
    const raw = getEnv("MINISTRY_PLATFORM_BASE_URL").replace(/\/$/, "");
    // The proc concatenates @ImageBaseUrl + file GUID; this resolves to the MP
    // file endpoint (matches the legacy ConnectionInfo.APIUrl + "files/").
    this.imageBaseUrl = `${raw}/files/`;
    this.initialize();
  }

  public static async getInstance(): Promise<GroupsService> {
    if (!GroupsService.instance) {
      GroupsService.instance = new GroupsService();
      await GroupsService.instance.initialize();
    }
    return GroupsService.instance;
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
      filter: `User_GUID = '${guid}'`,
      top: 1,
    });
    if (!users[0]) {
      console.error("GroupsService: No dp_Users record for GUID:", guid);
      return null;
    }
    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Search ──

  public async searchGroups(
    filters: GroupSearchFilters,
    userId: number | null
  ): Promise<GroupCard[]> {
    const times = filters.meetingTimes ?? [];
    const params: Record<string, string | number | boolean | null> = {
      "@ImageBaseUrl": this.imageBaseUrl,
      "@UserId": userId ?? null,
      "@CongregationId": filters.congregationId ?? null,
      "@MinistryId":
        filters.ministryId && filters.ministryId > 0 ? filters.ministryId : null,
      "@ParentGroupId": filters.parentGroupId ?? null,
      "@GroupFocusId": filters.groupFocusId ?? null,
      "@LifeStageId": filters.lifeStageId ?? null,
      "@CityPostalCode": clean(filters.cityPostalCode),
      "@Keyword": clean(filters.keyword),
      "@ShowFullGroups": filters.showFullGroups ?? false,
      "@CountGroupInquiries": filters.countGroupInquiries ?? false,
      "@ShowFutureGroups": filters.showFutureGroups ?? false,
      "@MeetsOnline": filters.meetsOnline ?? null,
      "@GroupTypeId": filters.groupTypeId ?? null,
    };

    if (filters.meetingDays && filters.meetingDays.length > 0) {
      params["@DaysOfWeek"] = filters.meetingDays.join("|");
    }
    if (times.includes("morning")) params["@Morning"] = true;
    if (times.includes("lunchtime")) params["@Lunchtime"] = true;
    if (times.includes("afternoon")) params["@Afternoon"] = true;
    if (times.includes("evening")) params["@Evening"] = true;

    const result = await this.mp!.executeProcedure("api_MPPW_SearchGroups", params);
    const rows = (result[0] as GroupRow[] | undefined) ?? [];
    return rows.map((r) => this.mapCard(r));
  }

  // ── Single group detail ──

  public async getGroupDetails(
    groupId: number,
    showFullAddress: boolean,
    countGroupInquiries: boolean,
    userId: number | null
  ): Promise<GroupDetail | null> {
    const result = await this.mp!.executeProcedure("api_MPPW_SearchGroups", {
      "@ImageBaseUrl": this.imageBaseUrl,
      "@GroupId": groupId,
      "@UserId": userId ?? null,
      "@CountGroupInquiries": countGroupInquiries,
      // Hard-coded the way the legacy detail call did: detail view always shows
      // the group regardless of full/future state.
      "@ShowFullGroups": true,
      "@ShowFutureGroups": true,
      "@ShowFullAddress": showFullAddress,
    });

    const rows = (result[0] as GroupRow[] | undefined) ?? [];
    const row = rows[0];
    if (!row) return null;

    const contactRows = (result[1] as GroupContactRow[] | undefined) ?? [];
    const contacts = this.mapContacts(contactRows);

    return {
      ...this.mapCard(row),
      latitude: toNumberOrNull(row.Latitude),
      longitude: toNumberOrNull(row.Longitude),
      address: clean(row.Address),
      lifeStage: clean(row.LifeStage),
      groupFocus: clean(row.GroupFocus),
      meetingFrequency: clean(row.MeetingFrequency),
      userHasInquired: toNumber(row.UserHasInquired) === 1,
      userHasSignedUp: toNumber(row.UserHasSignedUp) === 1,
      contacts,
    };
  }

  private mapCard(r: GroupRow): GroupCard {
    return {
      id: toNumber(r.Id),
      title: String(r.Title ?? ""),
      description: clean(r.Description),
      imageUrl: this.normalizeImage(r.ImageUrl),
      noImageText: clean(r.NoImageText),
      location: clean(r.Location),
      meetingDay: clean(r.MeetingDay),
      // MP returns wall-clock values; pass dates/times through verbatim.
      meetingTime: clean(r.MeetingTime),
      startDate: r.StartDate == null ? null : String(r.StartDate),
      isFull: toNumber(r.IsFull) === 1,
      meetsOnline: Boolean(r.MeetsOnline),
      totalParticipantsCount: toNumber(r.TotalParticipantsCount),
      targetSize: toNumberOrNull(r.TargetSize),
    };
  }

  private mapContacts(rows: GroupContactRow[]): GroupContact[] {
    // The proc UNIONs current leaders + the primary contact; de-dupe by contact.
    const seen = new Set<number>();
    const contacts: GroupContact[] = [];
    for (const r of rows) {
      const contactId = toNumber(r.ContactId);
      if (!contactId || seen.has(contactId)) continue;
      seen.add(contactId);
      contacts.push({
        contactId,
        displayName: clean(r.DisplayName),
        firstName: clean(r.FirstName),
        nickName: clean(r.NickName),
        lastName: clean(r.LastName),
        imageUrl: this.normalizeImage(r.ImageUrl),
        emailAddress: clean(r.EmailAddress),
      });
    }
    return contacts;
  }

  /** The proc emits `@ImageBaseUrl + GUID`; a row with no file yields the bare base. */
  private normalizeImage(value: string | null): string | null {
    const str = clean(value);
    if (!str) return null;
    if (str === this.imageBaseUrl) return null;
    // A trailing "files/" with no GUID means there was no default image.
    if (str.endsWith("/files/")) return null;
    return str;
  }

  // ── Configurations (finder dropdowns + suggest-a-group) ──

  public async getConfigurations(): Promise<GroupConfigurations> {
    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());

    const [congregations, groupFocuses, lifeStages, parentGroups] =
      await Promise.all([
        this.mp!.getTableRecords<LookupRow>({
          table: "Congregations",
          select: "Congregation_ID AS Id, Congregation_Name AS Name",
          filter: `Available_Online = 1 AND (End_Date IS NULL OR End_Date >= '${now}')`,
          orderBy: "Congregation_Name",
          top: 1000,
        }),
        this.mp!.getTableRecords<LookupRow>({
          table: "Group_Focuses",
          select: "Group_Focus_ID AS Id, Group_Focus AS Name",
          orderBy: "Group_Focus",
          top: 1000,
        }),
        this.mp!.getTableRecords<LookupRow>({
          table: "Life_Stages",
          select: "Life_Stage_ID AS Id, Life_Stage AS Name",
          orderBy: "Life_Stage",
          top: 1000,
        }),
        this.getParentGroups(now),
      ]);

    return {
      congregations: this.toOptions(congregations),
      groupFocuses: this.toOptions(groupFocuses),
      lifeStages: this.toOptions(lifeStages),
      parentGroups,
    };
  }

  /** Distinct parent ("neighborhood") groups currently active and online. */
  private async getParentGroups(now: string): Promise<GroupFilterOption[]> {
    const rows = await this.mp!.getTableRecords<LookupRow>({
      table: "Groups",
      select:
        "Parent_Group_Table.Group_ID AS Id, Parent_Group_Table.Group_Name AS Name",
      filter: [
        "Groups.Parent_Group IS NOT NULL",
        "Groups.Available_Online = 1",
        "Parent_Group_Table.Available_Online = 1",
        `ISNULL(Groups.End_Date, '${now}') >= '${now}'`,
        `ISNULL(Parent_Group_Table.End_Date, '${now}') >= '${now}'`,
      ].join(" AND "),
      orderBy: "Parent_Group_Table.Group_Name",
      top: 5000,
    });

    // The query returns one row per child group, so collapse to distinct parents.
    const seen = new Set<number>();
    const options: GroupFilterOption[] = [];
    for (const r of rows) {
      const id = toNumberOrNull(r.Id);
      if (id == null || seen.has(id) || !r.Name) continue;
      seen.add(id);
      options.push({ id, name: String(r.Name) });
    }
    return options;
  }

  private toOptions(rows: LookupRow[]): GroupFilterOption[] {
    return rows
      .filter((r) => r.Name && toNumberOrNull(r.Id) != null)
      .map((r) => ({ id: toNumber(r.Id), name: String(r.Name) }));
  }

  // ── Has-inquired / has-signed-up ──

  public async hasInquired(groupId: number, contactId: number): Promise<boolean> {
    const rows = await this.mp!.getTableRecords<{ Group_Inquiry_ID: number }>({
      table: "Group_Inquiries",
      select: "Group_Inquiry_ID",
      filter: `Group_ID = ${groupId} AND Contact_ID = ${contactId} AND ISNULL(Group_Inquiries.Placed, 0) = 0`,
      top: 1,
    });
    return rows.length > 0;
  }

  public async hasSignedUp(groupId: number, contactId: number): Promise<boolean> {
    const tz = DomainTimezoneService.getInstance();
    const now = await tz.toMpSqlDatetime(new Date().toISOString());
    const rows = await this.mp!.getTableRecords<{ Group_Participant_ID: number }>({
      table: "Group_Participants",
      select: "Group_Participant_ID",
      filter: `Group_ID = ${groupId} AND Participant_ID_Table.Contact_ID = ${contactId} AND ISNULL(Group_Participants.End_Date, '${now}') >= '${now}'`,
      top: 1,
    });
    return rows.length > 0;
  }

  // ── Current contact + household members (Inquire/Sign-up "as" picker) ──

  public async getCurrentContact(contactId: number): Promise<GroupCurrentContact | null> {
    const contacts = await this.mp!.getTableRecords<{
      Contact_ID: number | string;
      First_Name: string | null;
      Last_Name: string | null;
      Email_Address: string | null;
      Mobile_Phone: string | null;
      Household_ID: number | string | null;
    }>({
      table: "Contacts",
      select:
        "Contact_ID,First_Name,Last_Name,Email_Address,Mobile_Phone,Household_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });

    const c = contacts[0];
    if (!c) return null;

    const householdId = toNumberOrNull(c.Household_ID);
    const members = householdId != null ? await this.getHouseholdMembers(householdId) : [];

    return {
      contactId: toNumber(c.Contact_ID),
      firstName: clean(c.First_Name),
      lastName: clean(c.Last_Name),
      emailAddress: clean(c.Email_Address),
      mobilePhoneNumber: clean(c.Mobile_Phone),
      householdId,
      members,
    };
  }

  private async getHouseholdMembers(householdId: number): Promise<GroupContactOption[]> {
    const rows = await this.mp!.getTableRecords<{
      ContactId: number | string;
      DisplayName: string | null;
    }>({
      table: "Contacts",
      select: "Contacts.Contact_ID AS ContactId, Contacts.Display_Name AS DisplayName",
      filter: `Contacts.Household_ID = ${householdId} AND Contacts.Contact_Status_ID <> 3`,
      orderBy: "Contacts.Date_Of_Birth",
    });
    return rows
      .map((r) => ({
        contactId: toNumber(r.ContactId),
        displayName: clean(r.DisplayName) ?? "",
      }))
      .filter((m) => m.contactId > 0 && m.displayName);
  }

  // ── Acting-as contact resolution (C12) ──

  /** Read one contact's identity columns. */
  private async getContactIdentity(contactId: number): Promise<ContactIdentity | null> {
    const rows = await this.mp!.getTableRecords<{
      Contact_ID: number | string;
      First_Name: string | null;
      Nickname: string | null;
      Last_Name: string | null;
      Display_Name: string | null;
      Email_Address: string | null;
      Mobile_Phone: string | null;
      Household_ID: number | string | null;
    }>({
      table: "Contacts",
      select:
        "Contact_ID,First_Name,Nickname,Last_Name,Display_Name,Email_Address,Mobile_Phone,Household_ID",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    const c = rows[0];
    if (!c) return null;
    return {
      contactId: toNumber(c.Contact_ID),
      firstName: clean(c.First_Name),
      nickname: clean(c.Nickname),
      lastName: clean(c.Last_Name),
      displayName: clean(c.Display_Name),
      emailAddress: clean(c.Email_Address),
      mobilePhoneNumber: clean(c.Mobile_Phone),
      householdId: toNumberOrNull(c.Household_ID),
    };
  }

  /**
   * Resolve the contact a signed-in user picked from the "as" picker, and
   * prove they may act for it: it must be the user's own contact, or share the
   * user's (non-null) household. Everything about the chosen person — name,
   * email, phone — then comes from MP, **never from the request**: the client
   * only ever knew the member's display name, and accepting a client-supplied
   * email for a contact picked from a list would let a caller attach an
   * address of their choosing to someone else's record (C12).
   *
   * Throws {@link NotHouseholdMemberError} for an anonymous caller naming a
   * contact at all, or a signed-in caller naming one outside their household.
   */
  public async resolveActingContact(
    selectedContactId: number,
    actorContactId: number | null
  ): Promise<ContactIdentity> {
    if (actorContactId == null) throw new NotHouseholdMemberError(selectedContactId);
    const selected = await this.getContactIdentity(selectedContactId);
    if (!selected) throw new NotHouseholdMemberError(selectedContactId);
    if (selected.contactId === actorContactId) return selected;

    const actor = await this.getContactIdentity(actorContactId);
    const sameHousehold =
      actor?.householdId != null && actor.householdId === selected.householdId;
    if (!sameHousehold) throw new NotHouseholdMemberError(selectedContactId);
    return selected;
  }

  // ── Inquiry ──

  /**
   * Write a `Group_Inquiries` row and return who it was written for.
   *
   * With a `contactId`, the four denormalised columns are **back-filled from
   * MP** (C12) — the picker hides those inputs, so the client sends nulls, and
   * legacy stored the contact's real details there. Without one (an anonymous
   * visitor, or "Someone else…"), the typed fields are the only source.
   */
  public async createInquiry(
    form: GroupInquiryRequest,
    actor: { userId: number | null; contactId: number | null }
  ): Promise<InquirerDetails> {
    const tz = DomainTimezoneService.getInstance();
    const inquiryDate = await tz.toMpSqlDatetime(new Date().toISOString());
    const selectedId = form.contactId && form.contactId > 0 ? form.contactId : null;
    const message = clean(form.message);

    let who: InquirerDetails;
    if (selectedId != null) {
      const c = await this.resolveActingContact(selectedId, actor.contactId);
      who = {
        contactId: c.contactId,
        firstName: c.firstName,
        nickname: c.nickname,
        lastName: c.lastName,
        emailAddress: c.emailAddress,
        mobilePhoneNumber: c.mobilePhoneNumber,
      };
    } else {
      who = {
        contactId: null,
        firstName: clean(form.firstName),
        nickname: null,
        lastName: clean(form.lastName),
        emailAddress: clean(form.emailAddress),
        mobilePhoneNumber: clean(form.mobilePhoneNumber),
      };
    }

    const record: Record<string, unknown> = {
      Inquiry_Date: inquiryDate,
      First_Name: capOrNull(who.firstName, 50),
      Last_Name: capOrNull(who.lastName, 50),
      Phone: who.mobilePhoneNumber,
      Email: capOrNull(who.emailAddress, 254),
      Comments: message && message.length > 500 ? message.slice(0, 500) : message,
      Group_ID: form.targetId,
      Contact_ID: who.contactId,
    };

    await this.mp!.createTableRecords("Group_Inquiries", [record], {
      ...(actor.userId != null ? { $userId: actor.userId } : {}),
    });
    return who;
  }

  // ── Sign-up ──

  public async signUp(
    form: GroupInquiryRequest,
    actor: { userId: number | null; contactId: number | null }
  ): Promise<InquirerDetails> {
    const userId = actor.userId;
    const selectedId = form.contactId && form.contactId > 0 ? form.contactId : null;
    if (selectedId == null) {
      throw new Error("A contact is required to sign up for a group.");
    }
    // The same household rule as an inquiry: a caller may sign up themselves
    // or a member of their own household, never an arbitrary Contact_ID.
    const person = await this.resolveActingContact(selectedId, actor.contactId);
    const contactId = person.contactId;

    const participantId = await this.resolveParticipantId(contactId, userId);
    const defaultRoleId = await this.getDefaultGroupRole(form.targetId);
    const tz = DomainTimezoneService.getInstance();
    const startDate = await tz.toMpSqlDatetime(new Date().toISOString());

    const notes = `${clean(form.message) ?? ""}.  Created by Group Finder.`;

    const record: Record<string, unknown> = {
      Group_ID: form.targetId,
      Participant_ID: participantId,
      Group_Role_ID: defaultRoleId,
      Start_Date: startDate,
      Notes: notes,
    };

    await this.mp!.createTableRecords("Group_Participants", [record], {
      ...(userId != null ? { $userId: userId } : {}),
    });
    return {
      contactId,
      firstName: person.firstName,
      nickname: person.nickname,
      lastName: person.lastName,
      emailAddress: person.emailAddress,
      mobilePhoneNumber: person.mobilePhoneNumber,
    };
  }

  // ── Notification emails (C11) ──

  /**
   * Send the inquiry confirmation. Best-effort by design: the
   * `Group_Inquiries` row is already written, so a template fault must not
   * turn a recorded inquiry into a reported failure. Returns `false` when a
   * configured template could not be sent, so the route can answer
   * `200 { success: true, warning: "email_not_sent" }` — legacy's own promise
   * ("Saving the record is allowed, however no email notifications will be
   * sent"), made visible instead of silent.
   */
  public async sendInquiryEmails(
    groupId: number,
    who: InquirerDetails,
    message: string | null | undefined,
    templates: GroupEmailTemplates
  ): Promise<boolean> {
    if (!templates.inquiry) return true;
    const group = await this.getGroupForEmail(groupId);
    return this.trySend(
      templates.inquiry,
      [this.recipientFor(who)],
      this.mergeData(group.title, who, message),
      group.fromContactId
    );
  }

  /**
   * Send the sign-up confirmation to the person signed up and the
   * notification to the group's leaders. Same best-effort contract as
   * {@link sendInquiryEmails}; `false` when any configured send failed.
   */
  public async sendSignupEmails(
    groupId: number,
    who: InquirerDetails,
    message: string | null | undefined,
    templates: GroupEmailTemplates
  ): Promise<boolean> {
    if (!templates.signup && !templates.leaderSignup) return true;
    const group = await this.getGroupForEmail(groupId);
    const merge = this.mergeData(group.title, who, message);

    let ok = true;
    if (templates.signup) {
      ok =
        (await this.trySend(templates.signup, [this.recipientFor(who)], merge, group.fromContactId)) &&
        ok;
    }
    if (templates.leaderSignup) {
      // Leaders come from MP (the detail proc's second result set), never from
      // the request — a client-supplied recipient list would make this an open
      // relay for church-branded mail.
      ok =
        (await this.trySend(templates.leaderSignup, group.leaders, merge, group.fromContactId)) &&
        ok;
    }
    return ok;
  }

  /** The group's title, its leaders' addresses, and a fallback sender. */
  private async getGroupForEmail(groupId: number): Promise<{
    title: string;
    leaders: TemplateRecipient[];
    fromContactId: number | undefined;
  }> {
    // Never throws: the record is already written by the time this runs, so a
    // failed read degrades to "no group name, no leaders" and the send that
    // needed them reports itself as not sent.
    const detail = await this.getGroupDetails(groupId, false, false, null).catch((err) => {
      console.warn(`GroupsService: could not read group ${groupId} for email:`, err);
      return null;
    });
    const contacts = detail?.contacts ?? [];
    return {
      title: detail?.title ?? "",
      leaders: contacts
        .filter((c) => c.emailAddress)
        .map((c) => ({
          email: c.emailAddress as string,
          name: [c.nickName || c.firstName, c.lastName].filter(Boolean).join(" "),
        })),
      // Used only when the template row carries no From contact: the group's
      // own leader is the least surprising sender for a group email.
      fromContactId: contacts[0]?.contactId,
    };
  }

  private recipientFor(who: InquirerDetails): TemplateRecipient {
    return {
      email: who.emailAddress ?? "",
      name: [who.nickname || who.firstName, who.lastName].filter(Boolean).join(" "),
    };
  }

  /**
   * Merge tokens. Two vocabularies, because two kinds of template exist in the
   * wild: MP's own platform notifications use `[Web_First_Name]` /
   * `[GP_Display_Name]` and friends (the stock "New Group Inquiry" and "Small
   * Group Sign-up" templates), while church-authored ones use the column names.
   * Supplying both costs nothing — an absent token is simply not substituted.
   * Values are HTML-escaped by `MessageTemplateService`.
   */
  private mergeData(
    groupName: string,
    who: InquirerDetails,
    message: string | null | undefined
  ): TemplateMergeData {
    const first = who.firstName ?? "";
    const nick = who.nickname || first;
    const last = who.lastName ?? "";
    const email = who.emailAddress ?? "";
    const phone = who.mobilePhoneNumber ?? "";
    const comments = clean(message) ?? "";
    const display = [last, nick].filter(Boolean).join(", ");
    return {
      Group_Name: groupName,
      First_Name: first,
      Nickname: nick,
      Last_Name: last,
      Display_Name: display,
      Email_Address: email,
      Mobile_Phone: phone,
      Comments: comments,
      Message: comments,
      Web_First_Name: first,
      Web_Last_Name: last,
      Web_Email: email,
      Web_Phone: phone,
      GP_Display_Name: display,
      GP_Email_Address: email,
      GP_Mobile_Phone: phone,
    };
  }

  /**
   * Send one template, swallowing (and logging) any failure. Refuses an id
   * that is not a **message template** (`dp_Communications.Template = 1`): the
   * id arrives from a page attribute, and without the check any past
   * communication — a staff email, say — could be replayed to an inquirer's
   * typed address.
   */
  private async trySend(
    templateId: number,
    to: TemplateRecipient[],
    merge: TemplateMergeData,
    fromContactId: number | undefined
  ): Promise<boolean> {
    if (!to.some((r) => r.email)) {
      console.warn(`GroupsService: email template ${templateId} has no recipient address; no email sent.`);
      return false;
    }
    try {
      const rows = await this.mp!.getTableRecords<{ Communication_ID: number }>({
        table: "dp_Communications",
        select: "Communication_ID",
        filter: `Communication_ID = ${templateId} AND Template = 1`,
        top: 1,
      });
      if (!rows[0]) {
        console.warn(
          `GroupsService: email template ${templateId} is not a dp_Communications message template; no email sent.`
        );
        return false;
      }
      const templates = await MessageTemplateService.getInstance();
      await templates.sendMessageTemplate(templateId, to, merge, { fromContactId });
      return true;
    } catch (err) {
      console.warn(`GroupsService: email template ${templateId} could not be sent:`, err);
      return false;
    }
  }

  /** Resolve the contact's Participant_Record, creating one when missing. */
  private async resolveParticipantId(
    contactId: number,
    userId: number | null
  ): Promise<number> {
    const contacts = await this.mp!.getTableRecords<{
      Participant_Record: number | string | null;
    }>({
      table: "Contacts",
      select: "Participant_Record",
      filter: `Contact_ID = ${contactId}`,
      top: 1,
    });
    const existing = toNumberOrNull(contacts[0]?.Participant_Record ?? null);
    if (existing != null && existing > 0) return existing;

    // Create a default Participant record (mirrors the legacy CreateParticipant).
    const participantTypeId = await this.getConfigValueNumber("defaultParticipantType");
    if (participantTypeId == null) {
      throw new Error("Unable to create participant record: defaultParticipantType not configured.");
    }
    const tz = DomainTimezoneService.getInstance();
    const startDate = await tz.toMpSqlDatetime(new Date().toISOString());

    const participantRecord: Record<string, unknown> = {
      Contact_ID: contactId,
      Participant_Type_ID: participantTypeId,
      Participant_Start_Date: startDate,
      Notes: "Created by Group Finder",
    };
    const created = await this.mp!.createTableRecords("Participants", [participantRecord], {
      ...(userId != null ? { $userId: userId } : {}),
    });
    const newRow = created[0] as { Participant_ID?: number | string } | undefined;
    const newId = toNumberOrNull(newRow?.Participant_ID ?? null);
    if (newId == null) {
      throw new Error("Failed to create participant record.");
    }
    return newId;
  }

  /** Group_Types.Default_Role for the group's type (the default group role id). */
  private async getDefaultGroupRole(groupId: number): Promise<number> {
    const rows = await this.mp!.getTableRecords<{ DefaultRole: number | string | null }>({
      table: "Groups",
      select: "Group_Type_ID_Table.Default_Role AS DefaultRole",
      filter: `Group_ID = ${groupId}`,
      top: 1,
    });
    const roleId = toNumberOrNull(rows[0]?.DefaultRole ?? null);
    if (roleId == null) {
      throw new Error("This group's type has no default role configured.");
    }
    return roleId;
  }

  // ── Suggest a group ──

  public async suggestGroup(
    form: SuggestGroupRequest,
    primaryContactId: number,
    userId: number | null
  ): Promise<void> {
    const [ministryId, groupTypeId] = await Promise.all([
      this.getConfigValueNumber("SuggestGroup_MinistryId"),
      this.getConfigValueNumber("SuggestGroup_GroupTypeId"),
    ]);
    if (ministryId == null) {
      throw new Error("Suggest-a-group is not configured (missing SuggestGroup_MinistryId).");
    }
    if (groupTypeId == null) {
      throw new Error("Suggest-a-group is not configured (missing SuggestGroup_GroupTypeId).");
    }

    const tz = DomainTimezoneService.getInstance();
    const startDate = await tz.toMpSqlDatetime(new Date().toISOString());

    const record: Record<string, unknown> = {
      Group_Name: form.groupName,
      Description: form.description,
      Congregation_ID: form.newGroupCongregationId,
      Group_Is_Full: false,
      Available_Online: false,
      Meets_Online: false,
      Ministry_ID: ministryId,
      Group_Type_ID: groupTypeId,
      Primary_Contact: primaryContactId,
      Start_Date: startDate,
      // Required Groups columns (no DB default) — mirror the legacy insert.
      "Secure_Check-in": false,
      Suppress_Nametag: false,
      Suppress_Care_Note: false,
      On_Classroom_Manager: false,
      Promote_Weekly: false,
      Promote_Participants_Only: false,
      Send_Attendance_Notification: false,
      Send_Service_Notification: false,
      Enable_Discussion: false,
      Create_Next_Meeting: false,
    };

    if (form.newGroupLifeStageId != null) record.Life_Stage_ID = form.newGroupLifeStageId;
    if (form.newGroupGroupFocusId != null) record.Group_Focus_ID = form.newGroupGroupFocusId;
    if (form.newGroupMeetingDayId != null) record.Meeting_Day_ID = form.newGroupMeetingDayId;
    const meetingTime = clean(form.newGroupMeetingTime);
    if (meetingTime) {
      // Meeting_Time is a wall-clock time-of-day; store as a datetime on the MP epoch date.
      record.Meeting_Time = await tz.toMpSqlDatetime(`1900-01-01T${meetingTime}:00`);
    }

    await this.mp!.createTableRecords("Groups", [record], {
      ...(userId != null ? { $userId: userId } : {}),
    });
  }

  // ── Config helper ──

  private async getConfigValueNumber(keyName: string): Promise<number | null> {
    try {
      const rows = await this.mp!.getTableRecords<{ Value: string | null }>({
        table: "dp_Configuration_Settings",
        select: "Value",
        filter: `Key_Name = '${keyName}'`,
        top: 1,
      });
      return toNumberOrNull(rows[0]?.Value ?? null);
    } catch (err) {
      console.warn(`GroupsService: failed to read config '${keyName}':`, err);
      return null;
    }
  }
}
