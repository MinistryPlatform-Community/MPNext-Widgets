import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import * as hasInquiredRoute from "./route";
import * as hasSignedUpRoute from "../has-signed-up/route";
import { createWidgetToken } from "@/lib/embed/jwt";

/**
 * `GET /api/embed/group-details/has-inquired` and `/has-signed-up` (C12).
 *
 * Both answered a boolean for any `contactId` in the query string, which
 * disclosed one bit per (group, contact) pair to anyone holding a widget
 * token. They now answer only for the caller or a member of the caller's
 * household, and refuse everything else before MP is read.
 */

vi.mock("@/lib/embed/config", () => ({
  allowedOrigins: ["https://allowed.example.com"],
}));

const hasInquired = vi.fn(async () => true);
const hasSignedUp = vi.fn(async () => true);
vi.mock("@/services/groupsService", () => ({
  GroupsService: { getInstance: async () => ({ hasInquired, hasSignedUp }) },
}));

const canActAsContact = vi.fn();
vi.mock("@/services/_shared/household-contact", () => ({
  canActAsContact: (...a: unknown[]) => canActAsContact(...a),
}));

const ORIGIN = "https://allowed.example.com";
const GUID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";

const ROUTES = [
  { name: "has-inquired", mod: hasInquiredRoute, field: "hasInquired", svc: hasInquired },
  { name: "has-signed-up", mod: hasSignedUpRoute, field: "hasSignedUp", svc: hasSignedUp },
] as const;

async function get(
  mod: { GET: (req: NextRequest) => Promise<Response> },
  name: string,
  query: string,
  sub = GUID
): Promise<Response> {
  const token = await createWidgetToken({ sub, wid: "group-details", origin: ORIGIN });
  return mod.GET(
    new NextRequest(`http://localhost:3000/api/embed/group-details/${name}?${query}`, {
      headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` },
    })
  );
}

describe.each(ROUTES)("GET /api/embed/group-details/$name (C12)", ({ name, mod, field, svc }) => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("answers for the caller or a household member", async () => {
    canActAsContact.mockResolvedValue(true);
    const res = await get(mod, name, "groupId=7&contactId=5");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ [field]: true });
    expect(canActAsContact).toHaveBeenCalledWith(GUID, 5);
    expect(svc).toHaveBeenCalledWith(7, 5);
  });

  it("refuses a contact outside the caller's household, without reading MP", async () => {
    canActAsContact.mockResolvedValue(false);
    const res = await get(mod, name, "groupId=7&contactId=999");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_household_member");
    expect(svc).not.toHaveBeenCalled();
  });

  it("refuses a public token naming any contact", async () => {
    // The real helper refuses "public" outright; the route must defer to it.
    canActAsContact.mockImplementation(async (sub: string) => sub !== "public");
    const res = await get(mod, name, "groupId=7&contactId=5", "public");
    expect(res.status).toBe(403);
    expect(canActAsContact).toHaveBeenCalledWith("public", 5);
    expect(svc).not.toHaveBeenCalled();
  });

  it("answers false for a malformed query without any lookup", async () => {
    const res = await get(mod, name, "groupId=abc&contactId=5");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ [field]: false });
    expect(canActAsContact).not.toHaveBeenCalled();
    expect(svc).not.toHaveBeenCalled();
  });

  it("answers a machine code, not the exception text, on a fault", async () => {
    canActAsContact.mockRejectedValue(new Error("MP exploded: Contact_ID 5 detail"));
    const res = await get(mod, name, "groupId=7&contactId=5");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("exploded");
  });
});
