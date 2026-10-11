import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MISSION_TRIP_PROCS,
  MissionTripService,
  MissionTripsUnavailableError,
  NotAParticipantError,
  NotTripLeaderError,
} from "@/services/missionTripService";

/**
 * `missionTripService` — the MP read boundary for C76.
 *
 * Most of what is asserted here is a *legacy defect that must not come back*.
 * Each of those is named `D1`…`D4` in the source, and each has a test below
 * written against the legacy predicate rather than against ours, so a future
 * "restore parity with the stored procedure" fails loudly:
 *
 *  - **D1** — the roster had no `Trip_Leader` check anywhere on the server.
 *  - **D2** — the roster ignored the unlisted flags its sibling honours.
 *  - **D3** — `@ShowFullTrips = 0` kept exactly the *full* trips.
 *  - **D4** — the donor list had no campaign scope and no date window.
 *
 * The two that are easiest to get wrong are the pair in the middle of the
 * authorisation model: `team()` must 403 a participant whose own pledge is not
 * the leader pledge, **and** must succeed for a head of household whose child
 * holds it. A naive caller-only check passes the first and fails the second.
 */

const mockGetTableRecords = vi.fn();
const mockExecuteProcedure = vi.fn();
const mockGetProcedures = vi.fn();

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
    executeProcedure = mockExecuteProcedure;
    getProcedures = mockGetProcedures;
    createTableRecords = vi.fn();
    updateTableRecords = vi.fn();
  },
}));

// ── The world these tests run in ──

interface WorldContact {
  Contact_ID: number;
  Household_ID: number | null;
  Household_Position_ID: number | null;
  User_Account: number | null;
  Email_Unlisted: boolean;
  Mobile_Phone_Unlisted: boolean;
}

/**
 * One household (500) with a head (100) and a child (101), plus two unrelated
 * teammates (200, 201) who carry one suppressed contact field each.
 */
const CONTACTS: Record<number, WorldContact> = {
  100: {
    Contact_ID: 100,
    Household_ID: 500,
    Household_Position_ID: 1, // head of household
    User_Account: 77,
    Email_Unlisted: false,
    Mobile_Phone_Unlisted: false,
  },
  101: {
    Contact_ID: 101,
    Household_ID: 500,
    Household_Position_ID: 2, // the teenager who actually holds the pledge
    User_Account: 78,
    Email_Unlisted: false,
    Mobile_Phone_Unlisted: false,
  },
  200: {
    Contact_ID: 200,
    Household_ID: 600,
    Household_Position_ID: 1,
    User_Account: 88,
    Email_Unlisted: true, // D2
    Mobile_Phone_Unlisted: false,
  },
  201: {
    Contact_ID: 201,
    Household_ID: 601,
    Household_Position_ID: 1,
    User_Account: 89,
    Email_Unlisted: false,
    Mobile_Phone_Unlisted: true, // D2
  },
  300: {
    Contact_ID: 300,
    Household_ID: null, // no household row at all
    Household_Position_ID: null,
    User_Account: 90,
    Email_Unlisted: false,
    Mobile_Phone_Unlisted: false,
  },
};

/** `Pledge_ID → Contact_ID`. */
const PLEDGE_HOLDERS: Record<number, number> = {
  900: 100, // the parent's own pledge on campaign 10
  901: 101, // the child's pledge on campaign 10 — this is the leader pledge
  902: 200, // a teammate
  903: 201, // another teammate
  910: 100, // the parent on a second campaign, 20
  999: 100, // a stale pledge on campaign 30, outside mine()'s window
};

function myTripRow(
  pledgeId: number,
  campaignId: number,
  tripLeader: 0 | 1,
  overrides: Record<string, unknown> = {}
) {
  return {
    isMyMission: PLEDGE_HOLDERS[pledgeId] === 100 ? 1 : 0,
    First_Name: "Pat",
    Last_Name: "Parent",
    Pledge_Status_ID: 1,
    Pledge_Status: "Active",
    Pledge_ID: pledgeId,
    Trip_Leader: tripLeader,
    Total_Pledge: 1500,
    Pledge_Campaign_ID: campaignId,
    Campaign_Name: `Campaign ${campaignId}`,
    Description: "Go and serve.",
    Campaign_Goal: 3000,
    Start_Date: "2026-01-05T00:00:00",
    End_Date: "2026-06-30T00:00:00",
    Event_Start_Date: "2026-07-01T08:00:00",
    Event_End_Date: "2026-07-10T20:00:00",
    SubTotalAmount: 450,
    ImageUrl: null,
    ...overrides,
  };
}

function teamRow(
  pledgeId: number,
  campaignId: number,
  tripLeader: 0 | 1,
  overrides: Record<string, unknown> = {}
) {
  return {
    Campaign_Name: `Campaign ${campaignId}`,
    Pledge_Campaign_ID: campaignId,
    // The procedure selects these two raw — D2 is fixed on our side.
    Email_Address: `p${pledgeId}@example.org`,
    Mobile_Phone: `555-01${pledgeId}`,
    First_Name: "Sam",
    Last_Name: "Teammate",
    Pledge_Status_ID: 1,
    Pledge_Status: "Active",
    Campaign_Goal: 3000,
    SubTotalAmount: 250,
    ImageUrl: null,
    Pledge_ID: pledgeId,
    Trip_Leader: tripLeader,
    Total_Pledge: 1500,
    ...overrides,
  };
}

function donorRow(
  pledgeId: number,
  campaignId: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    Pledge_ID: pledgeId,
    Contact_ID: 4242,
    Pledge_Donor_Display_Name: "Dana Donor",
    Donor_Display_Name: "Donor, Dana",
    Pledge_Campaign_ID: campaignId,
    Campaign_Name: `Campaign ${campaignId}`,
    Amount: 125.5,
    Currency: "USD",
    Notes: "",
    Donation_Date: "2026-03-04T00:00:00",
    Anonymous: false,
    Address_Line_1: "1 Main St",
    Address_Line_2: "",
    City: "Springfield",
    StateRegion: "IL",
    Postal_Code: "62701",
    Foreign_Country: "--",
    ImageUrl: null,
    Phone: "555-0100",
    Email: "dana@example.org",
    ...overrides,
  };
}

function searchRow(
  campaignId: number,
  maximumRegistrants: number | null,
  currentRegistrants: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    Pledge_Campaign_ID: campaignId,
    ImageUrl: "https://mp.example.com/files/abc",
    Campaign_Name: `Trip ${campaignId}`,
    Congregation_Name: "Main Campus",
    Event_ID: campaignId + 1000,
    Program_Name: "Missions",
    Ministry_Name: "Outreach",
    // Deliberately *wrong* on some rows in the tests below: `isFull` is
    // recomputed from the counts, never trusted from the procedure.
    IsFull: 0,
    Registration_Start: "2026-01-01T00:00:00",
    Registration_End: "2026-05-01T00:00:00",
    Event_Start_Date: "2026-07-01T08:00:00",
    Event_End_Date: "2026-07-10T20:00:00",
    Maximum_Registrants: maximumRegistrants,
    Current_Registrants: currentRegistrants,
    Description: "Serve in Guatemala.",
    ...overrides,
  };
}

/** Rows the `mine` procedure returns for our head-of-household caller. */
let mineRows: ReturnType<typeof myTripRow>[] = [];
let teamRows: ReturnType<typeof teamRow>[] = [];
let donorRows: ReturnType<typeof donorRow>[] = [];
let searchRows: ReturnType<typeof searchRow>[] = [];

/** Every procedure installed on the imaginary domain under test. */
let installedProcs: string[] = [];

function pledgeIdsIn(filter: string): number[] {
  const inner = /IN \(([^)]*)\)/.exec(filter)?.[1] ?? "";
  return inner
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/** A service with a cold procedure probe. */
async function freshService(): Promise<MissionTripService> {
  (MissionTripService as unknown as { instance?: MissionTripService }).instance =
    undefined;
  return MissionTripService.getInstance();
}

describe("MissionTripService", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    installedProcs = Object.values(MISSION_TRIP_PROCS);
    mineRows = [
      myTripRow(900, 10, 0),
      myTripRow(901, 10, 1),
      myTripRow(910, 20, 0),
    ];
    teamRows = [
      teamRow(900, 10, 0),
      teamRow(901, 10, 1),
      teamRow(902, 10, 0),
      teamRow(903, 10, 0),
    ];
    donorRows = [donorRow(900, 10), donorRow(901, 10)];
    searchRows = [];

    mockGetProcedures.mockImplementation(async () =>
      installedProcs.map((Name) => ({ Name, Parameters: [] }))
    );

    mockExecuteProcedure.mockImplementation(async (proc: string) => {
      switch (proc) {
        case MISSION_TRIP_PROCS.search:
          return [searchRows];
        case MISSION_TRIP_PROCS.mine:
          return [mineRows];
        case MISSION_TRIP_PROCS.team:
          return [teamRows];
        case MISSION_TRIP_PROCS.donors:
          return [donorRows];
        default:
          return [[]];
      }
    });

    mockGetTableRecords.mockImplementation(
      async ({ table, filter }: { table: string; filter?: string }) => {
        const where = filter ?? "";
        if (table === "dp_Users") {
          return [{ User_ID: 77, User_GUID: "guid-77", Contact_ID: 100 }];
        }
        if (table === "Contacts" && where.startsWith("Contact_ID =")) {
          const id = Number(where.split("=")[1]);
          const c = CONTACTS[id];
          return c ? [c] : [];
        }
        if (table === "Contacts" && where.startsWith("Household_ID =")) {
          const hh = Number(where.split("=")[1]);
          return Object.values(CONTACTS)
            .filter((c) => c.Household_ID === hh)
            .map((c) => ({ Contact_ID: c.Contact_ID }));
        }
        if (table === "Pledges") {
          return pledgeIdsIn(where)
            .filter((id) => PLEDGE_HOLDERS[id] !== undefined)
            .map((id) => {
              const holder = CONTACTS[PLEDGE_HOLDERS[id] as number];
              return {
                Pledge_ID: id,
                Contact_ID: holder?.Contact_ID ?? null,
                Email_Unlisted: holder?.Email_Unlisted ?? false,
                Mobile_Phone_Unlisted: holder?.Mobile_Phone_Unlisted ?? false,
              };
            });
        }
        return [];
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── D3: the inverted full-trip filter ──

  describe("search", () => {
    it("always sends @ShowFullTrips = 1, even when the caller asked to hide them", async () => {
      // D3's regression test. Legacy's `@ShowFullTrips = 0` branch appends
      // `Current_Registrants >= Maximum_Registrants`, which is the definition of
      // *full* — so delegating the filter to SQL returns exactly the trips the
      // caller asked to hide. If anyone "restores parity" by passing the flag
      // through, this fails.
      searchRows = [searchRow(1, 10, 10)];
      const svc = await freshService();
      await svc.search({ campaignTypeId: 2, showFullTrips: false });

      expect(mockExecuteProcedure).toHaveBeenCalledWith(
        MISSION_TRIP_PROCS.search,
        expect.objectContaining({ "@ShowFullTrips": 1 })
      );
    });

    it("hides full trips and keeps trips with space when showFullTrips is false", async () => {
      searchRows = [
        searchRow(1, 10, 10), // full
        searchRow(2, 10, 3), // has space
        searchRow(3, 10, 11), // over-subscribed, still full
      ];
      const svc = await freshService();
      const trips = await svc.search({ campaignTypeId: 2, showFullTrips: false });

      expect(trips.map((t) => t.pledgeCampaignId)).toEqual([2]);
    });

    it("keeps full trips, badged, when showFullTrips is on (the default)", async () => {
      searchRows = [searchRow(1, 10, 10), searchRow(2, 10, 3)];
      const svc = await freshService();
      const trips = await svc.search({ campaignTypeId: 2 });

      expect(trips.map((t) => [t.pledgeCampaignId, t.isFull])).toEqual([
        [1, true],
        [2, false],
      ]);
    });

    it("never treats an uncapped campaign as full — null or 0 registrants max", async () => {
      // Legacy lumped uncapped campaigns in with the full ones in the same
      // clause, which is how the inversion hid in plain sight.
      searchRows = [
        searchRow(1, null, 250),
        searchRow(2, 0, 250),
      ];
      const svc = await freshService();

      const shown = await svc.search({ campaignTypeId: 2, showFullTrips: false });
      expect(shown.map((t) => t.pledgeCampaignId)).toEqual([1, 2]);
      expect(shown.every((t) => t.isFull === false)).toBe(true);
    });

    it("recomputes isFull rather than trusting the procedure's IsFull column", async () => {
      // The filter and the badge must be the same predicate.
      searchRows = [searchRow(1, 5, 5, { IsFull: 0 })];
      const svc = await freshService();
      const [trip] = await svc.search({ campaignTypeId: 2 });

      expect(trip?.isFull).toBe(true);
    });

    it("passes the wall-clock dates through verbatim", async () => {
      searchRows = [searchRow(1, null, 0)];
      const svc = await freshService();
      const [trip] = await svc.search({ campaignTypeId: 2 });

      expect(trip?.eventStartDate).toBe("2026-07-01T08:00:00");
      expect(trip?.registrationEnd).toBe("2026-05-01T00:00:00");
    });

    it("coerces the filter ids to numbers and caps the keyword at the column length", async () => {
      searchRows = [];
      const svc = await freshService();
      await svc.search({
        campaignTypeId: 2,
        congregationId: 3,
        ministryId: 4,
        programId: 5,
        keyword: "x".repeat(120),
      });

      const params = mockExecuteProcedure.mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(params["@CongregationId"]).toBe(3);
      expect(params["@MinistryId"]).toBe(4);
      expect(params["@ProgramId"]).toBe(5);
      expect(String(params["@Keyword"]).length).toBe(50);
    });
  });

  // ── The visible-contacts rule ──

  describe("visibleContactIds", () => {
    it("gives a head of household every member of their household", async () => {
      const svc = await freshService();
      const ids = await (
        svc as unknown as {
          visibleContactIds(id: number): Promise<number[]>;
        }
      ).visibleContactIds(100);

      expect([...ids].sort((a, b) => a - b)).toEqual([100, 101]);
    });

    it("gives a non-head only themselves, even inside a household", async () => {
      const svc = await freshService();
      const ids = await (
        svc as unknown as {
          visibleContactIds(id: number): Promise<number[]>;
        }
      ).visibleContactIds(101);

      expect(ids).toEqual([101]);
    });

    it("gives a contact with no household row only themselves", async () => {
      // The SQL does the same: `@HouseholdId` is null, so the household clause
      // matches nothing and only the caller survives.
      const svc = await freshService();
      const ids = await (
        svc as unknown as {
          visibleContactIds(id: number): Promise<number[]>;
        }
      ).visibleContactIds(300);

      expect(ids).toEqual([300]);
    });
  });

  // ── mine() ──

  describe("mine", () => {
    it("returns the household's trips and flags which are the caller's own", async () => {
      const svc = await freshService();
      const trips = await svc.mine(100, 2);

      expect(trips.map((t) => [t.pledgeId, t.isMine])).toEqual([
        [900, true],
        [901, false], // the child's
        [910, true],
      ]);
    });

    it("drops a pledge whose holder is outside the visible set", async () => {
      // Defence in depth over the procedure's own household clause: an older
      // or locally-patched copy that over-returns must not widen our scope.
      mineRows = [myTripRow(900, 10, 0), myTripRow(902, 10, 0)];
      const svc = await freshService();
      const trips = await svc.mine(100, 2);

      expect(trips.map((t) => t.pledgeId)).toEqual([900]);
    });

    it("passes the caller's dp_Users id, not their contact id, as @UserId", async () => {
      const svc = await freshService();
      await svc.mine(100, 2);

      expect(mockExecuteProcedure).toHaveBeenCalledWith(
        MISSION_TRIP_PROCS.mine,
        expect.objectContaining({ "@UserId": 77, "@PledgeCampaignTypeId": 2 })
      );
    });

    it("maps the money and the wall-clock dates verbatim", async () => {
      const svc = await freshService();
      const [trip] = await svc.mine(100, 2);

      expect(trip?.campaignGoal).toBe(3000);
      expect(trip?.totalPledge).toBe(1500);
      expect(trip?.raised).toBe(450);
      expect(trip?.startDate).toBe("2026-01-05T00:00:00");
      expect(trip?.eventEndDate).toBe("2026-07-10T20:00:00");
    });
  });

  // ── D1: the trip-leader gate ──

  describe("team", () => {
    it("throws NotTripLeaderError when every visible pledge has Trip_Leader = 0", async () => {
      // D1's regression test. The procedure returns the whole roster with no
      // `Trip_Leader` predicate at all, so this gate exists only here.
      mineRows = [myTripRow(900, 10, 0)];
      const svc = await freshService();

      await expect(svc.team(100, 10, 2)).rejects.toBeInstanceOf(NotTripLeaderError);
    });

    it("does not call the roster procedure at all when the gate fails", async () => {
      mineRows = [myTripRow(900, 10, 0)];
      const svc = await freshService();

      await expect(svc.team(100, 10, 2)).rejects.toBeInstanceOf(NotTripLeaderError);
      expect(mockExecuteProcedure).not.toHaveBeenCalledWith(
        MISSION_TRIP_PROCS.team,
        expect.anything()
      );
    });

    it("succeeds for a head of household whose CHILD holds the leader pledge", async () => {
      // The decision 1 × decision 3 interaction, and the case a naive
      // "the caller's own pledge is the leader pledge" check gets wrong. Pledge
      // 900 is the parent's and is not the leader; 901 is the child's and is.
      const svc = await freshService();
      const roster = await svc.team(100, 10, 2);

      expect(roster.map((m) => m.pledgeId)).toEqual([900, 901, 902, 903]);
    });

    it("403s the child, who is not head of household, on the same campaign", async () => {
      // Symmetry check: leadership is borrowed downward from the household, not
      // upward from it. Contact 101 sees only their own pledges.
      mineRows = [myTripRow(901, 10, 0)];
      const svc = await freshService();

      await expect(svc.team(101, 10, 2)).rejects.toBeInstanceOf(NotTripLeaderError);
    });

    it("nulls a teammate's email when Email_Unlisted is set, and phone when Mobile_Phone_Unlisted is", async () => {
      // D2's regression test. `api_MPPW_GetMyMissionTripTeamProgress` selects
      // `C.Email_Address` and `C.Mobile_Phone` raw, unlike its sibling, so the
      // same contact whose mobile is suppressed in the donor list is exposed in
      // the roster. A trip leader is not staff.
      const svc = await freshService();
      const roster = await svc.team(100, 10, 2);

      const unlistedEmail = roster.find((m) => m.pledgeId === 902);
      expect(unlistedEmail?.email).toBeNull();
      expect(unlistedEmail?.phone).toBe("555-01902");

      const unlistedPhone = roster.find((m) => m.pledgeId === 903);
      expect(unlistedPhone?.phone).toBeNull();
      expect(unlistedPhone?.email).toBe("p903@example.org");

      const listed = roster.find((m) => m.pledgeId === 900);
      expect(listed?.email).toBe("p900@example.org");
      expect(listed?.phone).toBe("555-01900");
    });

    it("suppresses both fields when the teammate's contact cannot be resolved", async () => {
      // Fail closed: an unknown privacy setting is "suppressed", never "publish".
      teamRows = [teamRow(901, 10, 1), teamRow(777, 10, 0)];
      const svc = await freshService();
      const roster = await svc.team(100, 10, 2);

      const unknown = roster.find((m) => m.pledgeId === 777);
      expect(unknown?.email).toBeNull();
      expect(unknown?.phone).toBeNull();
    });

    it("returns only the requested campaign's roster", async () => {
      teamRows = [teamRow(901, 10, 1), teamRow(910, 20, 0)];
      const svc = await freshService();
      const roster = await svc.team(100, 10, 2);

      expect(roster.map((m) => m.pledgeCampaignId)).toEqual([10]);
    });
  });

  // ── D4: donors ──

  describe("donors", () => {
    it("throws NotAParticipantError for a campaign the caller holds no visible pledge on", async () => {
      // 403 rather than an empty array, so the campaign id space is not
      // enumerable through an empty donor list.
      const svc = await freshService();

      await expect(svc.donors(100, 999, 2)).rejects.toBeInstanceOf(
        NotAParticipantError
      );
    });

    it("does not call the donors procedure when the participation check fails", async () => {
      const svc = await freshService();

      await expect(svc.donors(100, 999, 2)).rejects.toBeInstanceOf(
        NotAParticipantError
      );
      expect(mockExecuteProcedure).not.toHaveBeenCalledWith(
        MISSION_TRIP_PROCS.donors,
        expect.anything()
      );
    });

    it("scopes to one campaign and to mine()'s window — D4", async () => {
      // The procedure takes only the campaign *type* and applies no
      // pledge-status or end-date filter at all, so a trip from four years ago
      // still hands back its donor list. Intersecting with the pledges `mine()`
      // returned supplies both the scope and the window.
      donorRows = [
        donorRow(900, 10),
        donorRow(910, 20), // a different campaign
        donorRow(999, 30), // a stale trip mine() no longer returns
      ];
      const svc = await freshService();
      const donors = await svc.donors(100, 10, 2);

      expect(donors.map((d) => d.pledgeId)).toEqual([900]);
    });

    it("collapses an anonymous donor to the label and emits no contact data", async () => {
      donorRows = [donorRow(900, 10, { Anonymous: 1 })];
      const svc = await freshService();
      const [donor] = await svc.donors(100, 10, 2);

      expect(donor?.anonymous).toBe(true);
      expect(donor?.donorName).toBe("Anonymous Donor");
      expect(donor?.address).toBeNull();
      expect(donor?.phone).toBeNull();
      expect(donor?.email).toBeNull();
      expect(donor?.imageUrl).toBeNull();
      // The amount is still the point of the list.
      expect(donor?.amount).toBe(125.5);
    });

    it("treats a missing Anonymous column as anonymous — fail closed", async () => {
      donorRows = [donorRow(900, 10, { Anonymous: null })];
      const svc = await freshService();
      const [donor] = await svc.donors(100, 10, 2);

      expect(donor?.anonymous).toBe(true);
      expect(donor?.email).toBeNull();
    });

    it("suppresses the address as a whole object, not as per-field sentinels", async () => {
      // Legacy emitted `"--"` for a suppressed Address_Line_1 and `""` for the
      // rest. A half-rendered address block is worse than none.
      donorRows = [
        donorRow(900, 10, {
          Address_Line_1: "--",
          Address_Line_2: "",
          City: "",
          StateRegion: "",
          Postal_Code: "",
          Foreign_Country: "--",
        }),
      ];
      const svc = await freshService();
      const [donor] = await svc.donors(100, 10, 2);

      expect(donor?.address).toBeNull();
    });

    it("nulls phone and email on their own sentinels while keeping the address", async () => {
      donorRows = [donorRow(900, 10, { Phone: "--", Email: "--" })];
      const svc = await freshService();
      const [donor] = await svc.donors(100, 10, 2);

      expect(donor?.phone).toBeNull();
      expect(donor?.email).toBeNull();
      expect(donor?.address).toEqual({
        line1: "1 Main St",
        line2: null,
        city: "Springfield",
        stateRegion: "IL",
        postalCode: "62701",
        foreignCountry: null,
      });
    });

    it("keeps every donation row rather than de-duplicating by donor and pledge", async () => {
      // Legacy skipped a row whose `(Contact_ID, Pledge_ID)` it had already
      // seen, silently dropping a donor's second gift to the same participant.
      donorRows = [
        donorRow(900, 10, { Amount: 50 }),
        donorRow(900, 10, { Amount: 75 }),
      ];
      const svc = await freshService();
      const donors = await svc.donors(100, 10, 2);

      expect(donors.map((d) => d.amount)).toEqual([50, 75]);
    });

    it("passes the donation date through verbatim and keeps an unbatched note", async () => {
      donorRows = [
        donorRow(900, 10, { Notes: "[This donation is still being processed.]" }),
      ];
      const svc = await freshService();
      const [donor] = await svc.donors(100, 10, 2);

      expect(donor?.donationDate).toBe("2026-03-04T00:00:00");
      expect(donor?.notes).toBe("[This donation is still being processed.]");
    });
  });

  // ── The procedure probe ──

  describe("procedure availability", () => {
    it("matches the full exact procedure name", async () => {
      // `/procs?$search=` is an exact-name match on a live domain, not a
      // substring search: a friendlier partial term returns `[]` everywhere and
      // makes the widget permanently self-report as unavailable.
      expect(MISSION_TRIP_PROCS.search).toBe("api_MPPW_SearchMissionTrips");
      expect(MISSION_TRIP_PROCS.mine).toBe("api_MPPW_GetMyMissionTrips");
      expect(MISSION_TRIP_PROCS.donors).toBe("api_MPPW_GetMyMissionTripDonors");
      expect(MISSION_TRIP_PROCS.team).toBe(
        "api_MPPW_GetMyMissionTripTeamProgress"
      );

      installedProcs = ["api_MPPW_SearchMissionTripsExtra"];
      const svc = await freshService();
      expect(await svc.isAvailable(MISSION_TRIP_PROCS.search)).toBe(false);
    });

    it("probes once per service instance, however many panels ask", async () => {
      const svc = await freshService();
      await svc.mine(100, 2);
      await svc.team(100, 10, 2);
      await svc.donors(100, 10, 2);

      expect(mockGetProcedures).toHaveBeenCalledTimes(1);
    });

    it("shares one in-flight probe between panels that mount together", async () => {
      const svc = await freshService();
      await Promise.all([
        svc.isAvailable(MISSION_TRIP_PROCS.mine),
        svc.isAvailable(MISSION_TRIP_PROCS.team),
        svc.isAvailable(MISSION_TRIP_PROCS.donors),
      ]);

      expect(mockGetProcedures).toHaveBeenCalledTimes(1);
    });

    it("degrades panel by panel on a partially updated domain", async () => {
      // The four procedures are registered by two different MP scripts:
      // `001-Changes.sql` carries GetMyMissionTrips and GetMyMissionTripDonors,
      // while the newer `099-StoredProcMetaData.sql` carries SearchMissionTrips
      // and GetMyMissionTripTeamProgress. A domain on an older revision has the
      // first pair only — and must keep the two panels that work.
      installedProcs = [MISSION_TRIP_PROCS.mine, MISSION_TRIP_PROCS.donors];
      const svc = await freshService();

      await expect(svc.mine(100, 2)).resolves.toHaveLength(3);
      await expect(svc.donors(100, 10, 2)).resolves.toHaveLength(2);

      await expect(
        svc.search({ campaignTypeId: 2 })
      ).rejects.toBeInstanceOf(MissionTripsUnavailableError);
      await expect(svc.team(100, 10, 2)).rejects.toBeInstanceOf(
        MissionTripsUnavailableError
      );
    });

    it("names the missing procedure on the error it throws", async () => {
      installedProcs = [];
      const svc = await freshService();

      await expect(svc.search({ campaignTypeId: 2 })).rejects.toMatchObject({
        procedure: MISSION_TRIP_PROCS.search,
      });
    });

    it("writes nothing and makes no further MP call when the procedure is missing", async () => {
      installedProcs = [];
      const svc = await freshService();

      await expect(
        svc.search({ campaignTypeId: 2 })
      ).rejects.toBeInstanceOf(MissionTripsUnavailableError);
      expect(mockExecuteProcedure).not.toHaveBeenCalled();
    });

    it("fails open on a transport error, and does not cache that answer", async () => {
      // A `/procs` blip should degrade to "try the call and see", not pin a
      // hard `mission_trips_unavailable` on a domain where the widget works.
      mockGetProcedures.mockRejectedValueOnce(new Error("network"));
      const svc = await freshService();

      expect(await svc.isAvailable(MISSION_TRIP_PROCS.team)).toBe(true);

      installedProcs = [];
      expect(await svc.isAvailable(MISSION_TRIP_PROCS.team)).toBe(false);
    });
  });
});
