import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `OpportunityDetailsService.respond()` — C21.
 *
 * Responding *as* a household member used to write a `Responses` row whose
 * `First_Name` / `Last_Name` / `Email` / `Phone` were all NULL: the widget hides
 * those inputs once a member is picked, and the service wrote the empty strings
 * verbatim. The row is what MP's response views and the notification template
 * merge from, so a coordinator saw a blank name. These tests pin the back-fill
 * from the chosen contact's own record.
 */

const mockGetTableRecords = vi.fn();
const mockCreateTableRecords = vi.fn();

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    createTableRecords = mockCreateTableRecords;
  },
}));

vi.mock("@/services/domainTimezoneService", () => ({
  DomainTimezoneService: {
    getInstance: () => ({ toMpSqlDatetime: async () => "2026-10-11 09:00:00" }),
  },
}));

const sendMessageTemplate = vi.fn();
vi.mock("@/services/messageTemplateService", () => ({
  MessageTemplateService: { getInstance: async () => ({ sendMessageTemplate }) },
}));

import { OpportunityDetailsService } from "@/services/opportunityDetailsService";

const OPPORTUNITY = {
  Id: 5,
  Title: "Greeter",
  MaximumNeeded: null,
  AddressId: null,
  EventId: null,
};
const MEMBER = {
  Contact_ID: 44,
  First_Name: "Sarah",
  Nickname: null,
  Last_Name: "Kehayias",
  Email_Address: "sarah@example.com",
  Mobile_Phone: "321-555-0101",
};

function routeReads() {
  mockGetTableRecords.mockImplementation(async (q: { table: string }) => {
    switch (q.table) {
      case "Opportunities":
        return [OPPORTUNITY];
      case "Responses":
        return [];
      case "Participants":
        return [{ Participant_ID: 10 }];
      case "Contacts":
        return [MEMBER];
      default:
        throw new Error(`unexpected table ${q.table}`);
    }
  });
  mockCreateTableRecords.mockImplementation(async (table: string) =>
    table === "Responses" ? [{ Response_ID: 77 }] : []
  );
}

function writtenResponse(): Record<string, unknown> {
  const call = mockCreateTableRecords.mock.calls.find(([table]) => table === "Responses");
  return (call![1] as Record<string, unknown>[])[0];
}

const BLANK = { firstName: "", lastName: "", email: "", phone: "", message: "Happy to help" };

describe("OpportunityDetailsService.getOpportunityById address (C65)", () => {
  const ADDRESS = {
    Address_ID: 31,
    Address_Line_1: "12 Shelter Lane",
    Address_Line_2: "Unit 4",
    City: "Melbourne",
    "State/Region": "FL",
    Postal_Code: "32901",
  };

  beforeEach(() => {
    mockGetTableRecords.mockReset();
    mockGetTableRecords.mockImplementation(async (q: { table: string }) => {
      if (q.table === "Opportunities") return [{ ...OPPORTUNITY, AddressId: 31 }];
      if (q.table === "Addresses") return [ADDRESS];
      return [];
    });
  });

  it("withholds the street and postal code by default", async () => {
    const svc = await OpportunityDetailsService.getInstance();
    const op = await svc.getOpportunityById(5);
    expect(op.address).toBe("Melbourne, FL");
    expect(JSON.stringify(op)).not.toMatch(/Shelter Lane|32901|Unit 4/);
  });

  it("returns the full address only when asked", async () => {
    const svc = await OpportunityDetailsService.getInstance();
    const op = await svc.getOpportunityById(5, { showFullAddress: true });
    expect(op.address).toBe("12 Shelter Lane, Unit 4, Melbourne, FL 32901");
  });
});

describe("OpportunityDetailsService.respond (C21)", () => {
  beforeEach(() => {
    mockGetTableRecords.mockReset();
    mockCreateTableRecords.mockReset();
    routeReads();
  });

  it("back-fills name, email and phone from the chosen household member", async () => {
    const svc = await OpportunityDetailsService.getInstance();
    const id = await svc.respond({ opportunityId: 5, contactId: 44, userId: 9, ...BLANK });

    expect(id).toBe(77);
    expect(writtenResponse()).toMatchObject({
      First_Name: "Sarah",
      Last_Name: "Kehayias",
      Email: "sarah@example.com",
      Phone: "321-555-0101",
      Participant_ID: 10,
      Comments: "Happy to help",
    });
  });

  it("prefers the contact's record over typed values for a picked member", async () => {
    const svc = await OpportunityDetailsService.getInstance();
    await svc.respond({
      opportunityId: 5,
      contactId: 44,
      userId: 9,
      ...BLANK,
      email: "attacker@example.com",
    });
    expect(writtenResponse().Email).toBe("sarah@example.com");
  });

  it("falls back to a typed value where the record has none", async () => {
    mockGetTableRecords.mockImplementation(async (q: { table: string }) => {
      if (q.table === "Contacts") return [{ ...MEMBER, Mobile_Phone: null }];
      if (q.table === "Opportunities") return [OPPORTUNITY];
      if (q.table === "Participants") return [{ Participant_ID: 10 }];
      return [];
    });
    const svc = await OpportunityDetailsService.getInstance();
    await svc.respond({ opportunityId: 5, contactId: 44, userId: 9, ...BLANK, phone: "321-555-0199" });
    expect(writtenResponse().Phone).toBe("321-555-0199");
  });

  it("sends response-email-template to the stored (record) address", async () => {
    sendMessageTemplate.mockReset().mockResolvedValue(undefined);
    const svc = await OpportunityDetailsService.getInstance();
    await svc.respond({ opportunityId: 5, contactId: 44, userId: 9, ...BLANK, responseTemplateId: 131 });
    expect(sendMessageTemplate).toHaveBeenCalledWith(
      131,
      { email: "sarah@example.com", name: "Sarah Kehayias" },
      expect.objectContaining({ Opportunity_Title: "Greeter", mpp_contact_first_name: "Sarah" })
    );
  });

  it("keeps the response when the template send fails, and sends nothing without an id", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendMessageTemplate.mockReset().mockRejectedValue(new Error("Template 131 not found"));
    const svc = await OpportunityDetailsService.getInstance();
    await expect(
      svc.respond({ opportunityId: 5, contactId: 44, userId: 9, ...BLANK, responseTemplateId: 131 })
    ).resolves.toBe(77);

    sendMessageTemplate.mockReset();
    await svc.respond({ opportunityId: 5, contactId: 44, userId: 9, ...BLANK });
    expect(sendMessageTemplate).not.toHaveBeenCalled();
  });

  it("writes the typed values for an anonymous (blank-form) response", async () => {
    mockGetTableRecords.mockImplementation(async (q: { table: string }) => {
      if (q.table === "Opportunities") return [OPPORTUNITY];
      if (q.table === "Contacts") return [{ Contact_ID: 60 }]; // fuzzy match
      if (q.table === "Participants") return [{ Participant_ID: 11 }];
      return [];
    });
    const svc = await OpportunityDetailsService.getInstance();
    await svc.respond({
      opportunityId: 5,
      contactId: null,
      userId: null,
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      phone: "",
      message: "",
    });
    expect(writtenResponse()).toMatchObject({
      First_Name: "Ada",
      Last_Name: "Lovelace",
      Email: "ada@example.com",
      Phone: null,
      Participant_ID: 11,
    });
  });
});
