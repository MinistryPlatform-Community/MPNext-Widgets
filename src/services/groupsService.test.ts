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

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = mockCreateTableRecords;
    updateTableRecords = mockUpdateTableRecords;
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
    return [];
  });
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
