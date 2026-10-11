import { describe, it, expect, vi, beforeEach } from "vitest";
import { GroupsService, NotHouseholdMemberError } from "@/services/groupsService";

/**
 * `GroupsService` — the inquiry / sign-up write paths (C11, C12, C14).
 *
 * The load-bearing assertion in this file is C12's: a `Group_Inquiries` row
 * written for a household member carries that member's name, email and phone
 * **as MP has them**, not as the request claims. The client only ever knew the
 * member's display name, so anything else it sends for a picked contact is at
 * best null and at worst an attacker's address.
 */

const mockGetTableRecords = vi.fn();
const mockCreateTableRecords = vi.fn();
const mockUpdateTableRecords = vi.fn();
const mockExecuteProcedure = vi.fn();
const mockSendMessageTemplate = vi.fn();

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = mockCreateTableRecords;
    updateTableRecords = mockUpdateTableRecords;
    executeProcedure = mockExecuteProcedure;
  },
}));

vi.mock("@/services/messageTemplateService", () => ({
  MessageTemplateService: {
    getInstance: async () => ({ sendMessageTemplate: mockSendMessageTemplate }),
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => "https://mp.example.com/ministryplatformapi",
}));

const NOW_SQL = "2026-10-11 09:00:00";
vi.mock("@/services/domainTimezoneService", () => ({
  DomainTimezoneService: {
    getInstance: () => ({
      toMpSqlDatetime: async () => NOW_SQL,
    }),
  },
}));

interface ContactFixture {
  Contact_ID: number;
  First_Name: string | null;
  Nickname: string | null;
  Last_Name: string | null;
  Display_Name: string | null;
  Email_Address: string | null;
  Mobile_Phone: string | null;
  Household_ID: number | null;
  Participant_Record?: number | null;
}

const CHRIS: ContactFixture = {
  Contact_ID: 98,
  First_Name: "Christopher",
  Nickname: "Chris",
  Last_Name: "Kehayias",
  Display_Name: "Kehayias, Chris",
  Email_Address: "chris@example.com",
  Mobile_Phone: "321-794-1376",
  Household_ID: 40,
  Participant_Record: 10,
};
const SARAH: ContactFixture = {
  Contact_ID: 99,
  First_Name: "Sarah",
  Nickname: null,
  Last_Name: "Kehayias",
  Display_Name: "Kehayias, Sarah",
  Email_Address: "sarah@example.com",
  Mobile_Phone: "321-555-0100",
  Household_ID: 40,
  Participant_Record: 11,
};
const STRANGER: ContactFixture = {
  Contact_ID: 500,
  First_Name: "Ada",
  Nickname: null,
  Last_Name: "Lovelace",
  Display_Name: "Lovelace, Ada",
  Email_Address: "ada@example.com",
  Mobile_Phone: null,
  Household_ID: 77,
  Participant_Record: 50,
};
const CONTACTS = [CHRIS, SARAH, STRANGER];

/** Route `getTableRecords` by table + filter, the way MP would answer. */
function installMp(extra: (opts: { table: string; filter?: string }) => unknown[] | undefined = () => undefined) {
  mockGetTableRecords.mockImplementation(async (opts: { table: string; filter?: string }) => {
    const custom = extra(opts);
    if (custom) return custom;
    if (opts.table === "Contacts") {
      const m = /Contact_ID = (\d+)/.exec(opts.filter ?? "");
      if (m) return CONTACTS.filter((c) => c.Contact_ID === Number(m[1]));
      return [];
    }
    if (opts.table === "Groups") return [{ DefaultRole: 16 }];
    if (opts.table === "dp_Communications") {
      // Only 665 and 664 are message templates; 12 is an ordinary sent email.
      const m = /Communication_ID = (\d+)/.exec(opts.filter ?? "");
      return m && ["664", "665"].includes(m[1]) ? [{ Communication_ID: Number(m[1]) }] : [];
    }
    return [];
  });
  mockExecuteProcedure.mockResolvedValue([
    [{ Id: 49, Title: "Kehayias Home Group" }],
    [
      { ContactId: 98, FirstName: "Christopher", NickName: "Chris", LastName: "Kehayias", EmailAddress: "chris@example.com" },
      { ContactId: 120, FirstName: "Candice", NickName: null, LastName: "Hoy", EmailAddress: "candice@example.com" },
      { ContactId: 121, FirstName: "No", NickName: null, LastName: "Email", EmailAddress: null },
    ],
  ]);
  mockSendMessageTemplate.mockResolvedValue(undefined);
  mockCreateTableRecords.mockImplementation(async (_table: string, records: unknown[]) => records);
}

function createdRecords(table: string): Record<string, unknown>[] {
  return mockCreateTableRecords.mock.calls
    .filter(([t]) => t === table)
    .flatMap(([, records]) => records as Record<string, unknown>[]);
}

async function service(): Promise<GroupsService> {
  (GroupsService as unknown as { instance?: GroupsService }).instance = undefined;
  return GroupsService.getInstance();
}

describe("GroupsService.createInquiry (C12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMp();
  });

  it("back-fills name, email and phone from MP for the signed-in contact", async () => {
    const svc = await service();
    await svc.createInquiry(
      { targetId: 49, contactId: 98, message: "Hello" },
      { userId: 7, contactId: 98 },
    );
    const [row] = createdRecords("Group_Inquiries");
    expect(row).toMatchObject({
      Group_ID: 49,
      Contact_ID: 98,
      First_Name: "Christopher",
      Last_Name: "Kehayias",
      Email: "chris@example.com",
      Phone: "321-794-1376",
      Comments: "Hello",
      Inquiry_Date: NOW_SQL,
    });
  });

  it("back-fills a household member's details, which the client never had", async () => {
    const svc = await service();
    await svc.createInquiry({ targetId: 49, contactId: 99 }, { userId: 7, contactId: 98 });
    expect(createdRecords("Group_Inquiries")[0]).toMatchObject({
      Contact_ID: 99,
      First_Name: "Sarah",
      Email: "sarah@example.com",
      Phone: "321-555-0100",
    });
  });

  it("ignores client-supplied identity fields for a picked contact", async () => {
    const svc = await service();
    await svc.createInquiry(
      {
        targetId: 49,
        contactId: 99,
        firstName: "Mallory",
        emailAddress: "attacker@example.com",
        mobilePhoneNumber: "000",
      },
      { userId: 7, contactId: 98 },
    );
    const [row] = createdRecords("Group_Inquiries");
    expect(row.Email).toBe("sarah@example.com");
    expect(row.First_Name).toBe("Sarah");
    expect(row.Phone).toBe("321-555-0100");
  });

  it("refuses a contact outside the caller's household, writing nothing", async () => {
    const svc = await service();
    await expect(
      svc.createInquiry({ targetId: 49, contactId: 500 }, { userId: 7, contactId: 98 }),
    ).rejects.toBeInstanceOf(NotHouseholdMemberError);
    expect(mockCreateTableRecords).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller naming any contact", async () => {
    const svc = await service();
    await expect(
      svc.createInquiry({ targetId: 49, contactId: 98 }, { userId: null, contactId: null }),
    ).rejects.toBeInstanceOf(NotHouseholdMemberError);
    expect(mockCreateTableRecords).not.toHaveBeenCalled();
  });

  it("stores the typed fields for a blank-form inquiry, with no contact", async () => {
    const svc = await service();
    const who = await svc.createInquiry(
      {
        targetId: 49,
        contactId: null,
        firstName: " Grace ",
        lastName: "Hopper",
        emailAddress: "grace@example.com",
        mobilePhoneNumber: "555-0101",
      },
      { userId: null, contactId: null },
    );
    expect(createdRecords("Group_Inquiries")[0]).toMatchObject({
      Contact_ID: null,
      First_Name: "Grace",
      Last_Name: "Hopper",
      Email: "grace@example.com",
      Phone: "555-0101",
    });
    expect(who.emailAddress).toBe("grace@example.com");
  });
});

describe("GroupsService.signUp household rule (C12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMp();
  });

  it("signs up a household member", async () => {
    const svc = await service();
    await svc.signUp({ targetId: 49, contactId: 99 }, { userId: 7, contactId: 98 });
    expect(createdRecords("Group_Participants")[0]).toMatchObject({
      Group_ID: 49,
      Participant_ID: 11,
      Group_Role_ID: 16,
    });
  });

  it("refuses to sign up a contact outside the household", async () => {
    const svc = await service();
    await expect(
      svc.signUp({ targetId: 49, contactId: 500 }, { userId: 7, contactId: 98 }),
    ).rejects.toBeInstanceOf(NotHouseholdMemberError);
    expect(createdRecords("Group_Participants")).toEqual([]);
  });
});

describe("GroupsService notification emails (C11)", () => {
  const sarah = {
    contactId: 99,
    firstName: "Sarah",
    nickname: null,
    lastName: "Kehayias",
    emailAddress: "sarah@example.com",
    mobilePhoneNumber: "321-555-0100",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    installMp();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("sends nothing and reports success when no template is configured", async () => {
    const svc = await service();
    expect(await svc.sendInquiryEmails(49, sarah, "Hi", {})).toBe(true);
    expect(await svc.sendSignupEmails(49, sarah, "Hi", {})).toBe(true);
    expect(mockSendMessageTemplate).not.toHaveBeenCalled();
  });

  it("sends the inquiry confirmation to the inquirer with both merge vocabularies", async () => {
    const svc = await service();
    expect(await svc.sendInquiryEmails(49, sarah, "Hello <b>", { inquiry: 665 })).toBe(true);
    expect(mockSendMessageTemplate).toHaveBeenCalledTimes(1);
    const [id, to, merge] = mockSendMessageTemplate.mock.calls[0];
    expect(id).toBe(665);
    expect(to).toEqual([{ email: "sarah@example.com", name: "Sarah Kehayias" }]);
    expect(merge).toMatchObject({
      Group_Name: "Kehayias Home Group",
      First_Name: "Sarah",
      Web_First_Name: "Sarah",
      Web_Email: "sarah@example.com",
      Web_Phone: "321-555-0100",
      Comments: "Hello <b>",
    });
  });

  it("notifies the group's leaders from MP, skipping a leader with no email", async () => {
    const svc = await service();
    expect(await svc.sendSignupEmails(49, sarah, null, { signup: 664, leaderSignup: 664 })).toBe(true);
    expect(mockSendMessageTemplate).toHaveBeenCalledTimes(2);
    const leaderCall = mockSendMessageTemplate.mock.calls[1];
    expect(leaderCall[1]).toEqual([
      { email: "chris@example.com", name: "Chris Kehayias" },
      { email: "candice@example.com", name: "Candice Hoy" },
    ]);
    expect(leaderCall[2]).toMatchObject({ GP_Display_Name: "Kehayias, Sarah" });
    // The template's own From contact wins; the first leader is the fallback.
    expect(leaderCall[3]).toEqual({ fromContactId: 98 });
  });

  it("refuses an id that is not a message template, without sending", async () => {
    const svc = await service();
    expect(await svc.sendInquiryEmails(49, sarah, null, { inquiry: 12 })).toBe(false);
    expect(mockSendMessageTemplate).not.toHaveBeenCalled();
  });

  it("swallows a send failure and reports it", async () => {
    mockSendMessageTemplate.mockRejectedValueOnce(new Error("SMTP down"));
    const svc = await service();
    await expect(svc.sendInquiryEmails(49, sarah, null, { inquiry: 665 })).resolves.toBe(false);
  });

  it("does not throw when the group read fails after the write", async () => {
    mockExecuteProcedure.mockRejectedValueOnce(new Error("proc failed"));
    const svc = await service();
    await expect(
      svc.sendSignupEmails(49, sarah, null, { leaderSignup: 664 }),
    ).resolves.toBe(false);
  });
});
