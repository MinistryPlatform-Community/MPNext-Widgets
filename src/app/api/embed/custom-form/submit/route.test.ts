import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import * as route from "./route";
import { createWidgetToken } from "@/lib/embed/jwt";

/**
 * `POST /api/embed/custom-form/submit` — C26 "Who is this form for?".
 *
 * The client posts a bare `ContactId`. It is honoured only for the caller or a
 * member of the caller's household, and then the stored name/email/phone come
 * from that contact's MP record, never the client.
 */

vi.mock("@/lib/embed/config", () => ({
  allowedOrigins: ["https://allowed.example.com"],
}));

const saveFormResponse = vi.fn(async () => 900);
vi.mock("@/services/customFormService", () => ({
  CustomFormService: {
    getInstance: async () => ({
      extractAnswers: () => [{ fieldId: 303, response: "yes" }],
      saveFormResponse,
    }),
  },
}));

vi.mock("@/services/eventDetailsService", () => ({
  EventDetailsService: {
    getInstance: async () => ({ getUserByGuid: async () => ({ User_ID: 1, Contact_ID: 2 }) }),
  },
}));

const canActAsContact = vi.fn();
const getContactBasics = vi.fn();
vi.mock("@/services/_shared/household-contact", () => ({
  canActAsContact: (...a: unknown[]) => canActAsContact(...a),
  getContactBasics: (...a: unknown[]) => getContactBasics(...a),
}));

const ORIGIN = "https://allowed.example.com";
const GUID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";

async function post(body: Record<string, string>, sub = GUID): Promise<Response> {
  const token = await createWidgetToken({ sub, wid: "custom-form", origin: ORIGIN });
  return route.POST(
    new NextRequest("http://localhost:3000/api/embed/custom-form/submit", {
      method: "POST",
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const savedArgs = () => (saveFormResponse.mock.calls[0] as unknown as [Record<string, unknown>])[0];

const BASE = {
  mp_customformformid: "12",
  mp_customform_303: "yes",
  FirstName: "Typed",
  LastName: "Name",
  EmailAddress: "typed@example.com",
};

describe("POST /api/embed/custom-form/submit (C26)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getContactBasics.mockResolvedValue({
      contactId: 5,
      firstName: "Sarah",
      lastName: "Kehayias",
      email: "sarah@example.com",
      phone: null,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("files against a household member, with their record's details", async () => {
    canActAsContact.mockResolvedValue(true);
    const res = await post({ ...BASE, ContactId: "5", MobilePhoneNumber: "321-555-0199" });
    expect(res.status).toBe(200);
    expect(canActAsContact).toHaveBeenCalledWith(GUID, 5);
    expect(savedArgs()).toMatchObject({
      contactId: 5,
      contact: {
        firstName: "Sarah",
        lastName: "Kehayias",
        email: "sarah@example.com",
        // The record has no phone, so the typed one is kept.
        phone: "321-555-0199",
      },
    });
  });

  it("refuses a contact outside the caller's household and saves nothing", async () => {
    canActAsContact.mockResolvedValue(false);
    const res = await post({ ...BASE, ContactId: "999" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_household_member");
    expect(saveFormResponse).not.toHaveBeenCalled();
  });

  it("files 'Someone else' against nobody, with the typed details", async () => {
    const res = await post({ ...BASE, ContactId: "" });
    expect(res.status).toBe(200);
    expect(canActAsContact).not.toHaveBeenCalled();
    expect(savedArgs()).toMatchObject({
      contactId: null,
      contact: { firstName: "Typed", email: "typed@example.com" },
    });
  });

  it("keeps the pre-picker behaviour when no ContactId is sent: the signed-in caller", async () => {
    await post(BASE);
    expect(savedArgs()).toMatchObject({ contactId: 2, contact: { firstName: "Typed" } });
  });

  it("files an anonymous submit against nobody", async () => {
    await post(BASE, "public");
    expect(savedArgs()).toMatchObject({ contactId: null });
  });
});
