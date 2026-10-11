import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `OpportunityFinderService.getConfigurations()` — C20.
 *
 * The Attributes filter queried a column `Attributes` does not have, MP
 * answered 500, and a bare `catch { return []; }` made the control vanish with
 * nothing logged. These pin the type-level visibility filter and the logging.
 */

const mockGetTableRecords = vi.fn();

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
  },
}));

import { OpportunityFinderService } from "@/services/opportunityFinderService";

const ATTRIBUTE_ROWS = [
  { Attribute_ID: 6, Attribute_Name: "Carpenter", Attribute_Type_ID: 2, Attribute_Type: "Occupation" },
  { Attribute_ID: 8, Attribute_Name: "Doctor", Attribute_Type_ID: 2, Attribute_Type: "Occupation" },
  { Attribute_ID: 11, Attribute_Name: "Teaching", Attribute_Type_ID: 3, Attribute_Type: "Spiritual Gifts" },
];

describe("OpportunityFinderService.getConfigurations (C20)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetTableRecords.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it("filters attributes on the type-level Available_Online flag, never Attributes.Available_Online", async () => {
    mockGetTableRecords.mockImplementation(async (q: { table: string }) =>
      q.table === "Attributes" ? ATTRIBUTE_ROWS : []
    );
    const svc = await OpportunityFinderService.getInstance();
    const config = await svc.getConfigurations();

    const query = mockGetTableRecords.mock.calls
      .map(([q]) => q as { table: string; filter?: string })
      .find((q) => q.table === "Attributes")!;
    expect(query.filter).toBe("Attribute_Type_ID_Table.Available_Online = 1");
    expect(query.filter).not.toMatch(/Attributes\.Available_Online/);

    expect(config.attributeTypes).toEqual([
      {
        id: 2,
        name: "Occupation",
        attributes: [
          { id: 6, name: "Carpenter" },
          { id: 8, name: "Doctor" },
        ],
      },
      { id: 3, name: "Spiritual Gifts", attributes: [{ id: 11, name: "Teaching" }] },
    ]);
  });

  it("logs, rather than swallows, a failed attribute read", async () => {
    mockGetTableRecords.mockImplementation(async (q: { table: string }) => {
      if (q.table === "Attributes") throw new Error("Invalid column name 'Available_Online'.");
      return [];
    });
    const svc = await OpportunityFinderService.getInstance();
    const config = await svc.getConfigurations();

    expect(config.attributeTypes).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("getAttributeTypes failed"),
      "Invalid column name 'Available_Online'."
    );
  });
});
