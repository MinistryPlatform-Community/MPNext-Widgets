import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `getConfigValue` (C20 class): a failed `dp_Configuration_Settings` read used
 * to be `.catch(() => [])` with no log, indistinguishable from an unset
 * setting. It still falls back (see the method's comment for why), but logs.
 */

const { mockGetTableRecords } = vi.hoisted(() => ({ mockGetTableRecords: vi.fn() }));

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
  },
}));

vi.mock("@/services/configSettingsService", () => ({
  ConfigSettingsService: {
    getInstance: async () => ({ getGoogleMapsApiKey: async () => null }),
  },
}));

import { PlanYourVisitService } from "@/services/planYourVisitService";

type Query = { table: string; filter?: string };

describe("PlanYourVisitService configuration-setting reads", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetTableRecords.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (PlanYourVisitService as any).instance = undefined;
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("logs a failed PhoneMask read and still returns the configuration", async () => {
    mockGetTableRecords.mockImplementation(async (q: Query) => {
      if (q.table === "dp_Configuration_Settings") throw new Error("Invalid column name 'Value'");
      return [];
    });

    const svc = await PlanYourVisitService.getInstance();
    const config = await svc.getConfigurations();

    expect(config.phoneMask).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("PhoneMask");
    expect(logged).toContain("Invalid column name 'Value'");
  });

  it("does not log when the setting is simply unset", async () => {
    mockGetTableRecords.mockResolvedValue([]);
    const svc = await PlanYourVisitService.getInstance();
    const config = await svc.getConfigurations();
    expect(config.phoneMask).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to congregation 0 when GlobalCongregationID cannot be read, and logs it", async () => {
    mockGetTableRecords.mockImplementation(async (q: Query) => {
      if (q.table === "Group_Types") return [{ Id: 9 }];
      if (q.table === "dp_Configuration_Settings") throw new Error("boom");
      return [];
    });

    const svc = await PlanYourVisitService.getInstance();
    await svc.getAgeOrGradeGroups(4);

    const groups = mockGetTableRecords.mock.calls.find(([q]) => q.table === "Groups");
    expect((groups![0] as Query).filter).toMatch(/^Congregation_ID IN \(4,0\) AND /);
    expect(warn.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n")).toContain(
      "GlobalCongregationID"
    );
  });
});
