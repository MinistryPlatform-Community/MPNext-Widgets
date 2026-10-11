import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `canActAsContact` is the only thing standing between a posted `ContactId`
 * and a row stamped with someone else's identity (C21, C26). It must refuse a
 * public token, a stranger, and an unresolvable caller.
 */

const resolveUser = vi.fn();
const verifyMemberInHousehold = vi.fn();

vi.mock("@/services/householdService", () => ({
  HouseholdService: {
    getInstance: async () => ({ resolveUser, verifyMemberInHousehold }),
  },
}));
vi.mock("@/lib/providers/ministry-platform", () => ({ MPHelper: class {} }));

import { canActAsContact } from "@/services/_shared/household-contact";

describe("canActAsContact", () => {
  beforeEach(() => {
    resolveUser.mockReset();
    verifyMemberInHousehold.mockReset();
    resolveUser.mockResolvedValue({ userId: 1, contactId: 2, householdId: 7, isHeadOfHousehold: true });
  });

  it("never lets a public token act as anyone", async () => {
    expect(await canActAsContact("public", 2)).toBe(false);
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it("allows the caller's own contact without a household read", async () => {
    expect(await canActAsContact("guid", 2)).toBe(true);
    expect(verifyMemberInHousehold).not.toHaveBeenCalled();
  });

  it("allows a member of the caller's household", async () => {
    verifyMemberInHousehold.mockResolvedValue(true);
    expect(await canActAsContact("guid", 44)).toBe(true);
    expect(verifyMemberInHousehold).toHaveBeenCalledWith(44, 7);
  });

  it("refuses a contact outside the household", async () => {
    verifyMemberInHousehold.mockResolvedValue(false);
    expect(await canActAsContact("guid", 999)).toBe(false);
  });

  it("refuses when the caller has no household or cannot be resolved", async () => {
    resolveUser.mockResolvedValueOnce({ userId: 1, contactId: 2, householdId: null, isHeadOfHousehold: false });
    expect(await canActAsContact("guid", 44)).toBe(false);
    resolveUser.mockResolvedValueOnce(null);
    expect(await canActAsContact("guid", 44)).toBe(false);
  });

  it("refuses a non-positive or non-integer id", async () => {
    expect(await canActAsContact("guid", 0)).toBe(false);
    expect(await canActAsContact("guid", 1.5)).toBe(false);
  });
});
