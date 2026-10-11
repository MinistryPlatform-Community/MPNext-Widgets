import { MPHelper } from "@/lib/providers/ministry-platform";
import { getEnv } from "@/lib/env";
import { cap, clean } from "@/services/_shared/mp-lookup";
import type {
  MissionDonor,
  MissionDonorAddress,
  MissionTeamMember,
  MissionTripCard,
  MissionTripSearchParams,
  MyMissionTrip,
} from "@mpnext/types";

/**
 * Mission trips (C76) — the MP read boundary for `next-mission-trip-finder`
 * and `next-my-mission-trips`.
 *
 * Four legacy stored procedures sit behind this file. Three of them are read
 * here; the fourth (`api_MPPW_GetPledgeCampaign`) belongs to
 * `pledgeCampaignService`, which doubles as the trip-details page.
 *
 * **This service performs reads only.** Nothing here creates, updates or
 * deletes — in particular nothing writes `Pledges.Trip_Leader`, which is
 * read-only across the entire legacy stack too (staff tick the box in the
 * Platform).
 *
 * Four legacy defects are deliberately *not* ported, each marked `D1`…`D4` at
 * the point where the divergence happens (comparison finding C76).
 *
 * Every MP datetime here is a **wall-clock string passed through verbatim**.
 * The procedures already convert into the congregation's zone with
 * `dp_Convert_DateTime`; re-serialising through `Date` would shift the day.
 */

// ── Stored procedures ──

/**
 * The four procedure names, spelled **exactly** as MP registers them.
 *
 * Exact spelling is load-bearing twice over: once to call the procedure, and
 * once to probe for it. `/procs?$search=` is an exact-name match on a live
 * domain, not a substring search — `getProcedures("MissionTrip")` returns `[]`
 * even where all four are installed — so a friendlier term here would make the
 * widgets permanently self-report as unavailable. Same trap `next-pre-check`
 * documented in README, "Before it will work".
 */
export const MISSION_TRIP_PROCS = {
  search: "api_MPPW_SearchMissionTrips",
  mine: "api_MPPW_GetMyMissionTrips",
  donors: "api_MPPW_GetMyMissionTripDonors",
  team: "api_MPPW_GetMyMissionTripTeamProgress",
} as const;

export type MissionTripProc =
  (typeof MISSION_TRIP_PROCS)[keyof typeof MISSION_TRIP_PROCS];

/**
 * A procedure this call path needs is not installed on the domain.
 *
 * Thrown **per procedure**, not per domain, because the four are registered by
 * two different MP scripts from two different eras: `001-Changes.sql` carries
 * `GetMyMissionTrips` and `GetMyMissionTripDonors` (alongside most of the set
 * this SDK already depends on), while `099-StoredProcMetaData.sql` carries the
 * newer `SearchMissionTrips` and `GetMyMissionTripTeamProgress`. A domain on an
 * older revision of MP's widget scripts genuinely has "my trips" and "donors"
 * working while the finder and the roster are missing, so a partial install
 * must degrade panel by panel rather than darkening the whole domain.
 */
export class MissionTripsUnavailableError extends Error {
  constructor(public readonly procedure: string) {
    super(`${procedure} is not installed on this MP domain.`);
    this.name = "MissionTripsUnavailableError";
  }
}

/** The caller holds no *visible* pledge on the requested campaign. */
export class NotAParticipantError extends Error {
  constructor(public readonly pledgeCampaignId: number) {
    super(`No visible pledge on campaign ${pledgeCampaignId}.`);
    this.name = "NotAParticipantError";
  }
}

/** No *visible* pledge on the requested campaign has `Trip_Leader = 1`. */
export class NotTripLeaderError extends Error {
  constructor(public readonly pledgeCampaignId: number) {
    super(`No visible trip-leader pledge on campaign ${pledgeCampaignId}.`);
    this.name = "NotTripLeaderError";
  }
}

// ── Constants ──

/** `Household_Positions.Household_Position_ID` for "Head of Household". */
const HEAD_OF_HOUSEHOLD = 1;

/**
 * What a collapsed donor is called on the wire.
 *
 * The widget branches on `anonymous` and renders its own localised label, so
 * this is a fallback for anything that renders `donorName` raw — matching the
 * procedure's own `'Anonymous Donor'`.
 */
const ANONYMOUS_DONOR = "Anonymous Donor";

/**
 * `Keyword` is `nvarchar(50)` in `api_MPPW_SearchMissionTrips`. Truncating here
 * rather than letting SQL Server do it silently keeps the sent value and the
 * matched value the same thing.
 */
const KEYWORD_MAX = 50;

/** Ceiling on `@MaxResults`, so a query string cannot ask for the whole table. */
const MAX_RESULTS_CEILING = 500;
const MAX_RESULTS_DEFAULT = 100;

/** How many ids to put in one `Pledge_ID IN (…)` filter. */
const ID_BATCH = 100;

// ── Raw procedure row shapes ──

interface DpUserRecord {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
}

interface SearchRow {
  Pledge_Campaign_ID: number | string;
  ImageUrl: string | null;
  Campaign_Name: string | null;
  Congregation_Name: string | null;
  Event_ID: number | string | null;
  Program_Name: string | null;
  Ministry_Name: string | null;
  IsFull: number | boolean | null;
  Registration_Start: string | null;
  Registration_End: string | null;
  Event_Start_Date: string | null;
  Event_End_Date: string | null;
  Maximum_Registrants: number | string | null;
  Current_Registrants: number | string | null;
  Description: string | null;
}

interface MyTripRow {
  isMyMission: number | boolean | null;
  First_Name: string | null;
  Last_Name: string | null;
  Pledge_Status_ID: number | string | null;
  Pledge_Status: string | null;
  Pledge_ID: number | string;
  Trip_Leader: number | boolean | null;
  Total_Pledge: number | string | null;
  Pledge_Campaign_ID: number | string;
  Campaign_Name: string | null;
  Description: string | null;
  Campaign_Goal: number | string | null;
  Start_Date: string | null;
  End_Date: string | null;
  Event_Start_Date: string | null;
  Event_End_Date: string | null;
  SubTotalAmount: number | string | null;
  ImageUrl: string | null;
}

interface DonorRow {
  Pledge_ID: number | string;
  Contact_ID: number | string | null;
  Pledge_Donor_Display_Name: string | null;
  Donor_Display_Name: string | null;
  Pledge_Campaign_ID: number | string;
  Campaign_Name: string | null;
  Amount: number | string | null;
  Currency: string | null;
  Notes: string | null;
  Donation_Date: string | null;
  Anonymous: number | boolean | null;
  Address_Line_1: string | null;
  Address_Line_2: string | null;
  City: string | null;
  StateRegion: string | null;
  Postal_Code: string | null;
  Foreign_Country: string | null;
  ImageUrl: string | null;
  Phone: string | null;
  Email: string | null;
}

interface TeamRow {
  Campaign_Name: string | null;
  Pledge_Campaign_ID: number | string;
  Email_Address: string | null;
  Mobile_Phone: string | null;
  First_Name: string | null;
  Last_Name: string | null;
  Pledge_Status_ID: number | string | null;
  Pledge_Status: string | null;
  Campaign_Goal: number | string | null;
  SubTotalAmount: number | string | null;
  ImageUrl: string | null;
  Pledge_ID: number | string;
  Trip_Leader: number | boolean | null;
  Total_Pledge: number | string | null;
}

/** One pledge's holder, plus the holder's two contact-privacy flags. */
interface PledgeHolder {
  pledgeId: number;
  contactId: number | null;
  emailUnlisted: boolean;
  mobilePhoneUnlisted: boolean;
}

interface PledgeHolderRow {
  Pledge_ID: number | string;
  Contact_ID: number | string | null;
  Email_Unlisted: boolean | number | null;
  Mobile_Phone_Unlisted: boolean | number | null;
}

interface CallerRow {
  Contact_ID: number;
  Household_ID: number | null;
  Household_Position_ID: number | null;
  User_Account: number | null;
}

/**
 * Everything the three signed-in methods need to know about who is asking.
 *
 * Resolved once per call and **passed down**, never memoised on the singleton:
 * this service is a process-wide instance shared by every request, so caching
 * anything contact-scoped on it would hand one congregant another's scope. The
 * only cached state on this class is the domain-wide procedure probe.
 */
interface CallerScope {
  contactId: number;
  /** `dp_Users.User_ID` — what all three procedures take as `@UserId`. */
  userId: number | null;
  householdId: number | null;
  isHeadOfHousehold: boolean;
  /** Legacy's visible-contacts set. See {@link MissionTripService.visibleContactIds}. */
  visible: number[];
}

export class MissionTripService {
  private static instance: MissionTripService;
  private mp: MPHelper | null = null;
  private imageBaseUrl: string;

  /**
   * The names of every procedure this API client can execute, fetched once.
   *
   * The **promise** is memoised rather than the resolved value, so three panels
   * mounting at the same moment share one in-flight `/procs` round trip instead
   * of racing three. One unfiltered fetch answers all four membership tests;
   * asking `/procs?$search=` per name would be four calls for the same answer.
   */
  private procNames: Promise<Set<string>> | null = null;

  private constructor() {
    this.imageBaseUrl = `${getEnv("MINISTRY_PLATFORM_BASE_URL")}/files/`;
    this.mp = new MPHelper();
  }

  public static async getInstance(): Promise<MissionTripService> {
    if (!MissionTripService.instance) {
      MissionTripService.instance = new MissionTripService();
    }
    return MissionTripService.instance;
  }

  // ── Availability ──

  /**
   * Is one specific procedure installed and granted to the API client?
   *
   * Per-procedure on purpose — see {@link MissionTripsUnavailableError} for why
   * "the domain has mission trips" is not a single boolean.
   *
   * Fails **open** on a transport error, and does not cache that answer: a
   * `/procs` blip should degrade to "try the call and see", not pin a hard
   * `mission_trips_unavailable` on a domain where the widget works. A genuinely
   * missing procedure still surfaces, because an empty list is a *successful*
   * response rather than an error.
   */
  public async isAvailable(proc: MissionTripProc): Promise<boolean> {
    try {
      const names = await this.loadProcNames();
      return names.has(proc);
    } catch (error) {
      console.warn(
        "MissionTripService: /procs probe failed; assuming the proc is present:",
        error instanceof Error ? error.message : error
      );
      return true;
    }
  }

  private loadProcNames(): Promise<Set<string>> {
    if (!this.procNames) {
      this.procNames = this.mp!.getProcedures()
        .then((procs) => new Set(procs.map((p) => p.Name)))
        .catch((error) => {
          // Drop the rejected promise so the next caller re-probes rather than
          // inheriting a one-off network failure for the process's lifetime.
          this.procNames = null;
          throw error;
        });
    }
    return this.procNames;
  }

  private async requireProc(proc: MissionTripProc): Promise<void> {
    if (!(await this.isAvailable(proc))) {
      throw new MissionTripsUnavailableError(proc);
    }
  }

  // ── User identity ──

  public async getUserByGuid(
    guid: string
  ): Promise<{ User_ID: number; Contact_ID: number } | null> {
    const users = await this.mp!.getTableRecords<DpUserRecord>({
      table: "dp_Users",
      select: "User_ID,User_GUID,Contact_ID",
      filter: `User_GUID = '${String(guid).replace(/'/g, "''")}'`,
      top: 1,
    });
    if (!users[0]) {
      console.error("MissionTripService: no dp_Users record for GUID:", guid);
      return null;
    }
    return { User_ID: users[0].User_ID, Contact_ID: users[0].Contact_ID };
  }

  // ── Finder ──

  /**
   * `api_MPPW_SearchMissionTrips`, with **D3** corrected in TypeScript.
   *
   * `@ShowFullTrips = 1` is passed *unconditionally*. Legacy's
   * `@ShowFullTrips = 0` branch appends
   *
   * ```sql
   * AND (Maximum_Registrants IS NULL OR Maximum_Registrants = 0
   *      OR Current_Registrants >= Maximum_Registrants)
   * ```
   *
   * and `>=` is the definition of *full* — so asking to hide full trips returns
   * the uncapped ones plus exactly the full ones, and hides every trip that has
   * space. The filter is applied here instead of by shipping corrected SQL, so
   * no church has to re-run a database script to get the documented behaviour.
   *
   * `isFull` is likewise recomputed rather than read from the procedure's own
   * `IsFull` column: the predicate that decides what is hidden and the flag that
   * decides what is badged must be the same predicate, and an uncapped campaign
   * (`Maximum_Registrants` null **or** 0) is never full.
   *
   * `congregationId` filters on the **Program's** congregation
   * (`Programs.Congregation_ID`), not `Pledge_Campaigns.Congregation_ID`, which
   * also exists. That reads like a bug and is not: a campaign's own congregation
   * is frequently null while its program's is set, so this is legacy behaviour
   * kept deliberately (D5).
   */
  public async search(params: MissionTripSearchParams): Promise<MissionTripCard[]> {
    await this.requireProc(MISSION_TRIP_PROCS.search);

    const keyword = clean(params.keyword ?? null);
    const requested = Number(params.maxResults ?? MAX_RESULTS_DEFAULT);
    const maxResults =
      Number.isFinite(requested) && requested > 0
        ? Math.min(Math.trunc(requested), MAX_RESULTS_CEILING)
        : MAX_RESULTS_DEFAULT;

    const result = await this.mp!.executeProcedure(MISSION_TRIP_PROCS.search, {
      "@ImageBaseUrl": this.imageBaseUrl,
      "@PledgeCampaignTypeId": Number(params.campaignTypeId),
      "@CongregationId": this.idOrNull(params.congregationId),
      "@MinistryId": this.idOrNull(params.ministryId),
      "@ProgramId": this.idOrNull(params.programId),
      "@Keyword": keyword === null ? null : cap(keyword, KEYWORD_MAX),
      // Always 1 — see the D3 note above. The capacity filter is ours.
      "@ShowFullTrips": 1,
      "@MaxResults": maxResults,
    });

    const rows = (result[0] as SearchRow[] | undefined) ?? [];
    const cards = rows.map((row) => this.mapCard(row));

    // Default is "show them", matching the widget attribute's documented default.
    if (params.showFullTrips === false) {
      return cards.filter((card) => !card.isFull);
    }
    return cards;
  }

  private mapCard(row: SearchRow): MissionTripCard {
    const maximumRegistrants = this.numOrNull(row.Maximum_Registrants);
    const currentRegistrants = this.num(row.Current_Registrants);

    return {
      pledgeCampaignId: Number(row.Pledge_Campaign_ID),
      campaignName: String(row.Campaign_Name ?? ""),
      description: this.str(row.Description),
      imageUrl: this.str(row.ImageUrl),
      congregationName: this.str(row.Congregation_Name),
      programName: this.str(row.Program_Name),
      ministryName: this.str(row.Ministry_Name),
      eventId: this.numOrNull(row.Event_ID),
      // Wall-clock strings, verbatim.
      eventStartDate: this.str(row.Event_Start_Date),
      eventEndDate: this.str(row.Event_End_Date),
      registrationStart: this.str(row.Registration_Start),
      registrationEnd: this.str(row.Registration_End),
      maximumRegistrants,
      currentRegistrants,
      isFull:
        maximumRegistrants !== null &&
        maximumRegistrants > 0 &&
        currentRegistrants >= maximumRegistrants,
    };
  }

  // ── The visible-contacts rule ──

  /**
   * Legacy's household rule, computed once and used by all three signed-in
   * methods: **a head of household sees every member of their household;
   * everyone else sees only themselves.**
   *
   * All three procedures declare it identically in SQL —
   * `C.Household_ID = @HouseholdId AND (@IsHeadOfHousehold = 1 OR C.User_Account = @UserId)`
   * — and computing it here as well is not redundancy for its own sake. The
   * roster endpoint discloses third-party contact details on the strength of
   * this set, so the gate that authorises it is derived from a set this repo
   * owns rather than one a domain's copy of a procedure happens to implement.
   *
   * A contact with no household row sees only themselves, which is what the SQL
   * does too: `@HouseholdId` is null, so `C.Household_ID = @HouseholdId` matches
   * nothing and only the caller survives.
   */
  private async visibleContactIds(contactId: number): Promise<number[]> {
    return (await this.resolveScope(contactId)).visible;
  }

  private async resolveScope(contactId: number): Promise<CallerScope> {
    const id = Number(contactId);
    const rows = await this.mp!.getTableRecords<CallerRow>({
      table: "Contacts",
      select: "Contact_ID,Household_ID,Household_Position_ID,User_Account",
      filter: `Contact_ID = ${id}`,
      top: 1,
    });

    const caller = rows[0];
    if (!caller) {
      return {
        contactId: id,
        userId: null,
        householdId: null,
        isHeadOfHousehold: false,
        visible: [id],
      };
    }

    const householdId = this.numOrNull(caller.Household_ID);
    const isHeadOfHousehold =
      this.numOrNull(caller.Household_Position_ID) === HEAD_OF_HOUSEHOLD;

    if (!isHeadOfHousehold || householdId === null) {
      return {
        contactId: id,
        userId: this.numOrNull(caller.User_Account),
        householdId,
        isHeadOfHousehold,
        visible: [id],
      };
    }

    const members = await this.mp!.getTableRecords<{ Contact_ID: number }>({
      table: "Contacts",
      select: "Contact_ID",
      filter: `Household_ID = ${householdId}`,
    });

    const visible = new Set<number>([id]);
    for (const member of members) {
      visible.add(Number(member.Contact_ID));
    }

    return {
      contactId: id,
      userId: this.numOrNull(caller.User_Account),
      householdId,
      isHeadOfHousehold,
      visible: [...visible],
    };
  }

  // ── My trips ──

  /**
   * `api_MPPW_GetMyMissionTrips` — the caller's and their household's trips.
   *
   * This is also **the single source of "what can this caller see"**: a campaign
   * is visible iff a row comes back for it here, and both {@link donors} and
   * {@link team} take their authorisation from that. One consequence is worth
   * stating plainly because it is intended rather than incidental — the
   * procedure's status-and-date window
   * (`Pledge_Status_ID IN (1,2)` within 180 days of `End_Date`, or `IN (3,4)`
   * within one) therefore bounds the donors list and the roster too, even though
   * the donors procedure applies no window of its own (D4).
   *
   * `Show_On_My_Pledges` is deliberately **not** applied: the procedure has that
   * line commented out on purpose, so a trip hidden from the pledges page still
   * appears here. That is one of the three reasons this is not an extension of
   * `myPledgesService`.
   */
  public async mine(
    contactId: number,
    campaignTypeId: number
  ): Promise<MyMissionTrip[]> {
    await this.requireProc(MISSION_TRIP_PROCS.mine);
    const scope = await this.resolveScope(contactId);
    return this.mineWithScope(scope, campaignTypeId);
  }

  private async mineWithScope(
    scope: CallerScope,
    campaignTypeId: number
  ): Promise<MyMissionTrip[]> {
    // The procedure keys off dp_Users.User_ID. A contact with no user account
    // cannot be the signed-in caller, and the procedure would return nothing.
    if (scope.userId === null) return [];

    const result = await this.mp!.executeProcedure(MISSION_TRIP_PROCS.mine, {
      "@UserId": scope.userId,
      "@PledgeCampaignTypeId": Number(campaignTypeId),
      "@ImageBaseUrl": this.imageBaseUrl,
    });

    const rows = (result[0] as MyTripRow[] | undefined) ?? [];
    if (rows.length === 0) return [];

    const holders = await this.pledgeHolders(rows.map((r) => Number(r.Pledge_ID)));
    const visible = new Set(scope.visible);

    const trips: MyMissionTrip[] = [];
    for (const row of rows) {
      const pledgeId = Number(row.Pledge_ID);
      const holder = holders.get(pledgeId);
      // Defence in depth over the procedure's own household clause: a pledge
      // whose holder is not in the set this repo computed is dropped rather
      // than trusted. An unresolvable holder is dropped for the same reason —
      // fail closed, because everything downstream is authorised from this list.
      if (!holder || holder.contactId === null || !visible.has(holder.contactId)) {
        continue;
      }

      trips.push({
        pledgeId,
        pledgeCampaignId: Number(row.Pledge_Campaign_ID),
        campaignName: String(row.Campaign_Name ?? ""),
        description: this.str(row.Description),
        imageUrl: this.str(row.ImageUrl),
        campaignGoal: this.num(row.Campaign_Goal),
        totalPledge: this.num(row.Total_Pledge),
        raised: this.num(row.SubTotalAmount),
        pledgeStatusId: this.numOrNull(row.Pledge_Status_ID) ?? 0,
        pledgeStatus: this.str(row.Pledge_Status),
        tripLeader: this.bool(row.Trip_Leader),
        // Derived from the holder rather than the procedure's `isMyMission`
        // (`C.User_Account = @UserId`): the two agree, and this one keeps the
        // whole method keyed on contact ids.
        isMine: holder.contactId === scope.contactId,
        firstName: this.str(row.First_Name),
        lastName: this.str(row.Last_Name),
        startDate: this.str(row.Start_Date),
        endDate: this.str(row.End_Date),
        eventStartDate: this.str(row.Event_Start_Date),
        eventEndDate: this.str(row.Event_End_Date),
      });
    }
    return trips;
  }

  // ── Donors ──

  /**
   * `api_MPPW_GetMyMissionTripDonors`, scoped to one campaign.
   *
   * Two legacy behaviours are corrected here.
   *
   * **D4 — no campaign scope and no window.** The procedure takes only the
   * campaign *type*, so it returns the donors of every mission trip the caller
   * has ever pledged to, and unlike its two siblings it applies no pledge-status
   * or end-date filter at all — a trip from four years ago still hands back its
   * donor list, addresses included. Both are fixed by intersecting with the
   * pledges {@link mine} returned for this campaign, which carries the window
   * with it.
   *
   * **The `"--"` / `""` sentinels.** The procedure suppresses a flagged field by
   * emitting a placeholder string, which is a display concern that leaked into
   * the data layer. They become `null` here, and an address with nothing left in
   * it becomes a whole-object `null` rather than six nulls — an address is
   * suppressed as a unit and a half-rendered address block is worse than none.
   *
   * Legacy also de-duplicated by `(Contact_ID, Pledge_ID)`, which silently drops
   * a donor's second gift to the same participant. Not ported: every row here is
   * one `Donation_Distributions` row, which is what a thank-you list needs.
   */
  public async donors(
    contactId: number,
    campaignId: number,
    campaignTypeId: number
  ): Promise<MissionDonor[]> {
    await this.requireProc(MISSION_TRIP_PROCS.mine);
    await this.requireProc(MISSION_TRIP_PROCS.donors);

    const campaign = Number(campaignId);
    const scope = await this.resolveScope(contactId);
    const trips = await this.mineWithScope(scope, campaignTypeId);

    const visiblePledgeIds = new Set(
      trips
        .filter((t) => t.pledgeCampaignId === campaign)
        .map((t) => t.pledgeId)
    );
    // 403, never an empty array: an empty donor list is an ordinary state for a
    // participant nobody has given to yet, so it must not double as the answer
    // for a campaign the caller has nothing to do with — that would make the
    // campaign id space enumerable.
    if (visiblePledgeIds.size === 0) {
      throw new NotAParticipantError(campaign);
    }

    const result = await this.mp!.executeProcedure(MISSION_TRIP_PROCS.donors, {
      "@UserId": scope.userId,
      "@PledgeCampaignTypeId": Number(campaignTypeId),
      "@ImageBaseUrl": this.imageBaseUrl,
    });

    const rows = (result[0] as DonorRow[] | undefined) ?? [];
    return rows
      .filter(
        (row) =>
          Number(row.Pledge_Campaign_ID) === campaign &&
          visiblePledgeIds.has(Number(row.Pledge_ID))
      )
      .map((row) => this.mapDonor(row));
  }

  private mapDonor(row: DonorRow): MissionDonor {
    // Legacy defaults a missing `Anonymous` column to true. Fail-closed and
    // correct: the cost of being wrong is disclosing a donor who asked not to be.
    const anonymous = row.Anonymous == null ? true : this.bool(row.Anonymous);

    const donorName = anonymous
      ? ANONYMOUS_DONOR
      : this.sentinel(row.Pledge_Donor_Display_Name) ??
        this.sentinel(row.Donor_Display_Name) ??
        ANONYMOUS_DONOR;

    return {
      pledgeId: Number(row.Pledge_ID),
      pledgeCampaignId: Number(row.Pledge_Campaign_ID),
      campaignName: this.str(row.Campaign_Name),
      donorName,
      anonymous,
      amount: this.num(row.Amount),
      currency: this.str(row.Currency),
      notes: this.sentinel(row.Notes),
      // Wall-clock string, verbatim.
      donationDate: this.str(row.Donation_Date),
      // An anonymous donation carries no contact data at all — the procedure
      // already makes its `Contacts` join conditional on `Anonymous = 0`, and
      // this makes that unconditional on our side of the wire.
      address: anonymous ? null : this.mapAddress(row),
      phone: anonymous ? null : this.sentinel(row.Phone),
      email: anonymous ? null : this.sentinel(row.Email),
      imageUrl: anonymous ? null : this.sentinel(row.ImageUrl),
    };
  }

  private mapAddress(row: DonorRow): MissionDonorAddress | null {
    const address: MissionDonorAddress = {
      line1: this.sentinel(row.Address_Line_1),
      line2: this.sentinel(row.Address_Line_2),
      city: this.sentinel(row.City),
      stateRegion: this.sentinel(row.StateRegion),
      postalCode: this.sentinel(row.Postal_Code),
      // `Foreign_Country` is the column the procedure aliases. Legacy's C# read
      // `apiRecord["ForeignCountry"]`, a key that does not exist, so the field
      // was always null in the legacy widget.
      foreignCountry: this.sentinel(row.Foreign_Country),
    };
    return Object.values(address).every((v) => v === null) ? null : address;
  }

  // ── Team roster ──

  /**
   * `api_MPPW_GetMyMissionTripTeamProgress` for one campaign — **trip leaders
   * only**, which is the one real security fix in C76 (D1).
   *
   * The procedure has no `Trip_Leader` predicate anywhere: it hands every
   * teammate's email, mobile phone and fundraising position to any participant
   * on the trip. Both of legacy's gates run in the browser — the
   * `showteamprogress` attribute is markup a church author controls, and the
   * `tripLeader === true` filter runs over an array the browser already holds in
   * full.
   *
   * **The gate, stated exactly:** the roster for campaign *C* is returned when
   * *any* row {@link mine} returns for *C* has `tripLeader === true` — not when
   * the caller's own pledge does. The difference is the whole point. A parent
   * who is head of household, managing their teenager's trip, is precisely the
   * person legacy's household rule exists to serve, and the child holds the
   * pledge; a caller-only check 403s exactly that person on a widget legacy
   * showed them. Nothing is weakened by it, because the caller can only borrow
   * leadership from someone whose trips, donors and progress they were already
   * entitled to see.
   *
   * **D2 — the unlisted flags.** The sibling donors procedure is careful with
   * `Email_Unlisted` / `Mobile_Phone_Unlisted`; this one, written later, selects
   * `C.Email_Address` and `C.Mobile_Phone` raw, so the same contact whose mobile
   * is suppressed in the donor list is exposed in the roster. The flags are read
   * here and the fields nulled. A trip leader is not staff.
   */
  public async team(
    contactId: number,
    campaignId: number,
    campaignTypeId: number
  ): Promise<MissionTeamMember[]> {
    await this.requireProc(MISSION_TRIP_PROCS.mine);
    await this.requireProc(MISSION_TRIP_PROCS.team);

    const campaign = Number(campaignId);
    const scope = await this.resolveScope(contactId);
    const trips = await this.mineWithScope(scope, campaignTypeId);

    const onCampaign = trips.filter((t) => t.pledgeCampaignId === campaign);
    // "ANY visible pledge leads it", not "the caller's pledge leads it".
    if (!onCampaign.some((t) => t.tripLeader)) {
      throw new NotTripLeaderError(campaign);
    }

    const result = await this.mp!.executeProcedure(MISSION_TRIP_PROCS.team, {
      "@UserId": scope.userId,
      "@PledgeCampaignTypeId": Number(campaignTypeId),
      "@ImageBaseUrl": this.imageBaseUrl,
    });

    const rows = ((result[0] as TeamRow[] | undefined) ?? []).filter(
      (row) => Number(row.Pledge_Campaign_ID) === campaign
    );
    if (rows.length === 0) return [];

    const holders = await this.pledgeHolders(rows.map((r) => Number(r.Pledge_ID)));

    return rows.map((row) => {
      const pledgeId = Number(row.Pledge_ID);
      const holder = holders.get(pledgeId);
      // Fail closed when the holder cannot be resolved: an unknown privacy
      // setting is treated as "suppressed", never as "publish it".
      const emailUnlisted = holder ? holder.emailUnlisted : true;
      const phoneUnlisted = holder ? holder.mobilePhoneUnlisted : true;

      return {
        pledgeId,
        pledgeCampaignId: Number(row.Pledge_Campaign_ID),
        campaignName: this.str(row.Campaign_Name),
        firstName: this.str(row.First_Name),
        lastName: this.str(row.Last_Name),
        pledgeStatusId: this.numOrNull(row.Pledge_Status_ID) ?? 0,
        pledgeStatus: this.str(row.Pledge_Status),
        campaignGoal: this.num(row.Campaign_Goal),
        totalPledge: this.num(row.Total_Pledge),
        raised: this.num(row.SubTotalAmount),
        tripLeader: this.bool(row.Trip_Leader),
        email: emailUnlisted ? null : this.str(row.Email_Address),
        phone: phoneUnlisted ? null : this.str(row.Mobile_Phone),
        imageUrl: this.str(row.ImageUrl),
      };
    });
  }

  // ── Pledge → holder ──

  /**
   * Who holds each pledge, and what their two contact-privacy flags say.
   *
   * None of the three procedures returns the pledge holder's `Contact_ID`, and
   * the roster one does not return the privacy flags either, so both facts come
   * from one extra read. `Pledges → Donors → Contacts` is a two-hop traversal,
   * which the MP REST layer spells with the hops concatenated
   * (`Donor_ID_TABLE_Contact_ID_TABLE`, not dotted) — and, because `_TABLE`
   * appears at all, every base-table column in `$select` has to be qualified.
   */
  private async pledgeHolders(
    pledgeIds: number[]
  ): Promise<Map<number, PledgeHolder>> {
    const unique = [...new Set(pledgeIds.map(Number).filter(Number.isFinite))];
    const holders = new Map<number, PledgeHolder>();
    if (unique.length === 0) return holders;

    const select = [
      "Pledges.Pledge_ID",
      "Donor_ID_TABLE_Contact_ID_TABLE.Contact_ID AS Contact_ID",
      "Donor_ID_TABLE_Contact_ID_TABLE.Email_Unlisted AS Email_Unlisted",
      "Donor_ID_TABLE_Contact_ID_TABLE.Mobile_Phone_Unlisted AS Mobile_Phone_Unlisted",
    ].join(",");

    for (let i = 0; i < unique.length; i += ID_BATCH) {
      const batch = unique.slice(i, i + ID_BATCH);
      const rows = await this.mp!.getTableRecords<PledgeHolderRow>({
        table: "Pledges",
        select,
        filter: `Pledges.Pledge_ID IN (${batch.join(",")})`,
      });
      for (const row of rows) {
        holders.set(Number(row.Pledge_ID), {
          pledgeId: Number(row.Pledge_ID),
          contactId: this.numOrNull(row.Contact_ID),
          emailUnlisted: this.bool(row.Email_Unlisted),
          mobilePhoneUnlisted: this.bool(row.Mobile_Phone_Unlisted),
        });
      }
    }
    return holders;
  }

  // ── utils ──

  private idOrNull(value: number | null | undefined): number | null {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }

  private num(value: number | string | null | undefined): number {
    if (value == null || value === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private numOrNull(value: number | string | null | undefined): number | null {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private bool(value: boolean | number | string | null | undefined): boolean {
    return value === true || value === 1 || value === "1" || value === "True";
  }

  private str(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
  }

  /**
   * `str`, plus the donors procedure's suppression placeholders.
   *
   * `'--'` is what `IIF(<flag> = 0 AND <col> IS NOT NULL, <col>, '--')` emits
   * both when the church suppressed the field and when the column was simply
   * null. Both mean "there is nothing to show", so both become `null` and the
   * widget has one thing to branch on.
   */
  private sentinel(value: string | null | undefined): string | null {
    const text = this.str(value);
    return text === null || text === "--" ? null : text;
  }
}
