import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PledgeCampaignService } from "@/services/pledgeCampaignService";

/**
 * `pledgeCampaignService.getCampaign` — the mapping, and specifically the four
 * fields C76 phase 1 added.
 *
 * `next-pledge-campaign` is the mission-trip **details page**: the decision
 * recorded on 2026-09-11 is that `api_MPPW_GetPledgeCampaign` ignores its own
 * `@IsMissionTrip` parameter, so `mpp-mission-trip` and `mpp-pledge-campaign`
 * received byte-identical data and no third element is built. The whole cost of
 * that decision is here — capacity and the registration window, which the
 * procedure has always returned and the service used to drop.
 *
 * Two of these assertions guard a deliberate choice:
 *
 *  - **`maximumRegistrants` keeps `null` distinct from `0`.** Both mean
 *    *uncapped*, but collapsing them through `num()` would make "no cap set"
 *    indistinguishable from "a cap of zero" and lose the ability to say so.
 *  - **the window dates are the procedure's strings, untouched.** MP returns
 *    wall-clock values; re-serialising through `Date` is the day-shift bug the
 *    existing `startDate` / `endDate` handling already avoids.
 */

const mockGetTableRecords = vi.fn();
const mockExecuteProcedure = vi.fn();

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    executeProcedure = mockExecuteProcedure;
    getProcedures = vi.fn();
    createTableRecords = vi.fn();
    updateTableRecords = vi.fn();
    createCommunication = vi.fn();
  },
}));

vi.mock("@/services/domainTimezoneService", () => ({
  DomainTimezoneService: {
    getInstance: () => ({
      getMpTimezone: async () => "America/New_York",
      toMpSqlDatetime: async (v: unknown) => String(v),
    }),
  },
}));

/** One row exactly as `api_MPPW_GetPledgeCampaign` returns it. */
function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    Campaign_Name: "Guatemala 2026",
    Description: "Ten days in Antigua.",
    Campaign_Goal: 30000,
    Fundraising_Goal: 25000,
    Campaigns_Start_Date: "2026-01-05T00:00:00",
    Campaigns_End_Date: "2026-06-30T00:00:00",
    Registration_Start: "2026-01-05T09:00:00",
    Registration_End: "2026-04-01T17:00:00",
    Pledge_Beyond_End_Date: false,
    Allow_Online_Pledge: true,
    Event_ID: 4321,
    Maximum_Registrants: 24,
    Online_Thank_You_Message: "Thank you!",
    PledgeCount: 18,
    PledgeTotal: 21000,
    DistributionTotal: 9000,
    ImageUrl: "https://mp.example.com/files/abc",
    CustomFormId: 12,
    CustomFormGuid: "form-guid",
    ForceLogin: true,
    ...overrides,
  };
}

async function service(): Promise<PledgeCampaignService> {
  (
    PledgeCampaignService as unknown as { instance?: PledgeCampaignService }
  ).instance = undefined;
  return PledgeCampaignService.getInstance();
}

describe("PledgeCampaignService.getCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockExecuteProcedure.mockResolvedValue([[campaignRow()]]);
    mockGetTableRecords.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the procedure finds no campaign", async () => {
    mockExecuteProcedure.mockResolvedValue([[]]);
    const svc = await service();

    expect(await svc.getCampaign(1)).toBeNull();
  });

  it("maps the capacity and registration-window fields the procedure already returned", async () => {
    const svc = await service();
    const campaign = await svc.getCampaign(7);

    expect(campaign).toMatchObject({
      maximumRegistrants: 24,
      currentRegistrants: 18,
      registrationStart: "2026-01-05T09:00:00",
      registrationEnd: "2026-04-01T17:00:00",
    });
  });

  it("maps currentRegistrants from the same PledgeCount as numberOfPledges", async () => {
    // Duplicated on purpose rather than renamed: the progress copy and the seat
    // count are different questions that happen to share an answer, and
    // `numberOfPledges` is already on the wire.
    const svc = await service();
    const campaign = await svc.getCampaign(7);

    expect(campaign?.currentRegistrants).toBe(campaign?.numberOfPledges);
  });

  it("keeps a null Maximum_Registrants as null rather than collapsing it to 0", async () => {
    mockExecuteProcedure.mockResolvedValue([
      [campaignRow({ Maximum_Registrants: null })],
    ]);
    const svc = await service();

    expect((await svc.getCampaign(7))?.maximumRegistrants).toBeNull();
  });

  it("keeps an explicit 0 cap as 0, distinct from 'no cap set'", async () => {
    mockExecuteProcedure.mockResolvedValue([
      [campaignRow({ Maximum_Registrants: 0 })],
    ]);
    const svc = await service();

    expect((await svc.getCampaign(7))?.maximumRegistrants).toBe(0);
  });

  it("nulls an absent registration window instead of inventing dates", async () => {
    mockExecuteProcedure.mockResolvedValue([
      [campaignRow({ Registration_Start: null, Registration_End: null })],
    ]);
    const svc = await service();
    const campaign = await svc.getCampaign(7);

    expect(campaign?.registrationStart).toBeNull();
    expect(campaign?.registrationEnd).toBeNull();
  });

  it("passes the window through as the procedure's wall-clock strings", async () => {
    // Never `new Date(x).toISOString()`: MP returns wall-clock values already
    // converted into the congregation's zone, and re-serialising shifts the day.
    const svc = await service();
    const campaign = await svc.getCampaign(7);

    expect(campaign?.registrationStart).toBe("2026-01-05T09:00:00");
    expect(campaign?.startDate).toBe("2026-01-05T00:00:00");
    expect(campaign?.endDate).toBe("2026-06-30T00:00:00");
  });

  it("still maps everything it mapped before the four fields were added", async () => {
    // The phase 1 change is additive; this is the guard that says so.
    const svc = await service();
    const campaign = await svc.getCampaign(7);

    expect(campaign).toMatchObject({
      pledgeCampaignId: 7,
      title: "Guatemala 2026",
      campaignGoal: 30000,
      fundraisingGoal: 25000,
      pledged: 21000,
      received: 9000,
      numberOfPledges: 18,
      allowOnlinePledge: true,
      pledgeBeyondEndDate: false,
      forceLogin: true,
      eventId: 4321,
      customFormId: 12,
      customFormGuid: "form-guid",
    });
  });

  it("supplies the capacity facts a full campaign is recognised from", async () => {
    // The apply form's new blocked state is `maximumRegistrants > 0 &&
    // currentRegistrants >= maximumRegistrants`. Today the widget gates only on
    // `allowOnlinePledge` and `pledgeBeyondEndDate`, so a full trip accepts
    // applications indefinitely — a real defect for capital campaigns too.
    mockExecuteProcedure.mockResolvedValue([
      [campaignRow({ Maximum_Registrants: 24, PledgeCount: 24 })],
    ]);
    const svc = await service();
    const campaign = await svc.getCampaign(7);

    expect(campaign?.maximumRegistrants).toBe(24);
    expect(campaign?.currentRegistrants).toBe(24);
  });
});
