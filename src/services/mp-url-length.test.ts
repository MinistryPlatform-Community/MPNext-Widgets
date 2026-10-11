/**
 * Guard: no service builds an MP request whose query string IIS will refuse.
 *
 * MP sits behind IIS, whose default `maxQueryString` is 2048. A request over it
 * is answered with an IIS HTML 404 before ASP.NET (and so MP's own error
 * handling) ever sees it, and `MPHelper` surfaces that as `404 Not Found` -- a
 * message that looks nothing like "your query is too long". C50 is the worked
 * example: every `next-online-directory` search failed that way, invisibly to
 * every unit test, because the overflow came from a `$select` that inlined the
 * deployment's base URL and only a real browser against a real host hit it.
 *
 * ## How this measures
 *
 * Nothing here mocks `MPHelper`. Each case drives a service's *real* read path
 * through the real `MPHelper` -> provider -> `HttpClient.buildUrl` stack, with
 * `fetch` stubbed at the bottom. The stub records every URL actually requested
 * and answers with a per-case fixture, so the assertion is about bytes that
 * would really have gone over the wire -- including the `@ImageBaseUrl` proc
 * parameter several services put on the query string, and `IN (...)` / `OR`
 * lists whose length depends on what MP returned to an earlier read.
 *
 * The base URL is deliberately long (>= 120 chars): the C50 overflow scaled
 * with the host name, so a short test host could mask the whole class.
 *
 * **What is measured is the query string** (everything after `?`), against
 * 2048: that is the limit IIS enforces and the one C50 tripped. The full URL is
 * also held to IIS's `maxUrl` default (4096). Holding the *full* URL to 2048
 * would mostly measure the length of the test's own fake host name.
 *
 * Inputs are the worst case the route layer lets through: long keywords
 * (routes pass `keyword` through uncapped), accented text (6 encoded bytes per
 * character), quotes (doubled for SQL), and fixture responses with many rows
 * so data-driven id lists reach a size a large church produces.
 *
 * ## Adding a case
 *
 * Add a row to `CASES`. `expect` names the request that makes the case
 * meaningful (a regex over the path), so a case whose service throws before
 * building that request fails rather than passing vacuously.
 *
 * A case that overflows today and cannot be fixed in this change goes in
 * `KNOWN_DEFECTS` with the reason. The test then asserts it *still* overflows,
 * so fixing it fails the run until the entry is removed (a ratchet).
 */

import { appendFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const IIS_MAX_QUERY_STRING = 2048;
const IIS_MAX_URL = 4096;

const LONG_BASE = [
  "https://a-very-long-church-subdomain-for-url-length-testing-env",
  ".ministryplatform-hosting.example.org",
  "/ministryplatformapi",
].join("");

vi.stubEnv("MINISTRY_PLATFORM_BASE_URL", LONG_BASE);
vi.stubEnv("MINISTRY_PLATFORM_CLIENT_ID", "test-client");
vi.stubEnv("MINISTRY_PLATFORM_CLIENT_SECRET", "test-secret");
vi.stubEnv("CALENDAR_ADMIN_GROUP_IDS", "22,23,24,25,26,27,28,29,30,31");

// ── fetch stub ──────────────────────────────────────────────────────────────

interface CapturedRequest {
  method: string;
  url: string;
  /** Path below the base URL, without the query string. */
  path: string;
  query: URLSearchParams;
}

type Responder = (req: CapturedRequest) => unknown;

let captured: CapturedRequest[] = [];
let responder: Responder | undefined;

function defaultResponse(req: CapturedRequest): unknown {
  if (req.path.startsWith("/oauth/")) return { access_token: "test-token", expires_in: 3600 };
  if (req.path === "/domain") {
    return { DisplayName: "Test", TimeZoneName: "Eastern Standard Time", CultureName: "en-US" };
  }
  if (req.path === "/procs") return [];
  if (req.path.startsWith("/procs/")) return [[], [], [], [], []];
  return [];
}

const fetchStub = vi.fn(async (input: unknown, init?: { method?: string }) => {
  const url = String(input);
  const u = new URL(url);
  const basePath = new URL(LONG_BASE).pathname;
  const path = decodeURIComponent(u.pathname.slice(basePath.length));
  const req: CapturedRequest = {
    method: (init?.method ?? "GET").toUpperCase(),
    url,
    path,
    query: u.searchParams,
  };
  if (!path.startsWith("/oauth/")) captured.push(req);
  const body = responder?.(req) ?? defaultResponse(req);
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([]),
  };
});

vi.stubGlobal("fetch", fetchStub);

/** The query string exactly as sent, i.e. everything after the first `?`. */
function queryStringOf(url: string): string {
  const at = url.indexOf("?");
  return at < 0 ? "" : url.slice(at + 1);
}

// ── services ────────────────────────────────────────────────────────────────

const services = {
  addToCalendar: (await import("./addToCalendarService")).AddToCalendarService,
  configSettings: (await import("./configSettingsService")).ConfigSettingsService,
  contactAttribute: (await import("./contactAttributeService")).ContactAttributeService,
  contributionStatement: (await import("./contributionStatementService")).ContributionStatementService,
  customForm: (await import("./customFormService")).CustomFormService,
  eventDetails: (await import("./eventDetailsService")).EventDetailsService,
  eventFinder: (await import("./eventFinderService")).EventFinderService,
  fullCalendar: (await import("./fullCalendarService")).FullCalendarService,
  groups: (await import("./groupsService")).GroupsService,
  household: (await import("./householdService")).HouseholdService,
  invoice: (await import("./invoiceService")).InvoiceService,
  missionTrip: (await import("./missionTripService")).MissionTripService,
  myGiving: (await import("./myGivingService")).MyGivingService,
  myGroups: (await import("./myGroupsService")).MyGroupsService,
  myPledges: (await import("./myPledgesService")).MyPledgesService,
  onlineDirectory: (await import("./onlineDirectoryService")).OnlineDirectoryService,
  opportunityDetails: (await import("./opportunityDetailsService")).OpportunityDetailsService,
  opportunityFinder: (await import("./opportunityFinderService")).OpportunityFinderService,
  planYourVisit: (await import("./planYourVisitService")).PlanYourVisitService,
  pledgeCampaign: (await import("./pledgeCampaignService")).PledgeCampaignService,
  prayerFeedback: (await import("./prayerFeedbackService")).PrayerFeedbackService,
  preCheck: (await import("./preCheckService")).PreCheckService,
  products: (await import("./productsService")).ProductsService,
  profile: (await import("./profileService")).ProfileService,
  statementPreferences: (await import("./statementPreferencesService")).StatementPreferencesService,
  subscription: (await import("./subscriptionService")).SubscriptionService,
};
const { DomainTimezoneService } = await import("./domainTimezoneService");

interface Singleton<T> {
  getInstance(): Promise<T> | T;
}

/** A fresh instance, so no cache from an earlier case short-circuits a read. */
async function fresh<T>(cls: Singleton<T>): Promise<T> {
  (cls as unknown as { instance: unknown }).instance = undefined;
  return await cls.getInstance();
}

// ── worst-case inputs ───────────────────────────────────────────────────────

/** A pasted sentence: spaces, punctuation, a quote, accents. 200 code points. */
const LONG_KEYWORD = "Église São Paulo O'Brien-Smith youth & family retreat, "
  .repeat(4)
  .slice(0, 200);
/** 80 two-byte characters: 6 encoded bytes each. */
const ACCENTED_KEYWORD = "é".repeat(80);
/** RFC 5321's maximum address length, with a quote in the local part. */
const LONG_EMAIL = ["o'", "x".repeat(60), "@", "sub.".repeat(46), "example.org"].join("").slice(0, 254);
const LONG_NAME = "Montgomery-Fitzwilliam O'Brien de la Cruz y Santos";
const GUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const BIG_ID = 9_999_999;

/** `n` distinct seven-digit ids. */
function ids(n: number, from = 1_000_000): number[] {
  return Array.from({ length: n }, (_, i) => from + i * 7);
}

// ── fixtures ────────────────────────────────────────────────────────────────

const USER_ROW = { User_ID: BIG_ID, User_GUID: GUID, Contact_ID: BIG_ID };
const CONTACT_ROW = {
  Contact_ID: BIG_ID,
  Household_ID: BIG_ID,
  Household_Position_ID: 1,
  User_Account: BIG_ID,
  Donor_ID: BIG_ID,
  First_Name: LONG_NAME,
  Last_Name: LONG_NAME,
  Nickname: LONG_NAME,
  Display_Name: LONG_NAME,
  Email_Address: LONG_EMAIL,
};

/** Answers the user/contact lookups most signed-in flows start with. */
function withIdentity(inner?: Responder): Responder {
  return (req) => {
    const own = inner?.(req);
    if (own !== undefined) return own;
    if (req.path === "/tables/dp_Users") return [USER_ROW];
    if (req.path === "/tables/Contacts") return [CONTACT_ROW];
    return undefined;
  };
}

/**
 * A busy six-week grid at a large multi-site church: 400 events across 60
 * programs (30 ministries), 40 locations, 12 campuses and 25 event types.
 */
const CALENDAR = { events: 400, programs: 60, ministries: 30, locations: 40, campuses: 12, types: 25 };

function calendarEvents() {
  const programs = ids(CALENDAR.programs, 2_000_000);
  const locations = ids(CALENDAR.locations, 3_000_000);
  const campuses = ids(CALENDAR.campuses, 4_000_000);
  const types = ids(CALENDAR.types, 5_000_000);
  return ids(CALENDAR.events).map((Event_ID, i) => ({
    Event_ID,
    Event_Title: "e",
    Event_Start_Date: "2026-10-30T09:00:00",
    Event_End_Date: "2026-11-02T17:00:00",
    Event_Type_ID: types[i % types.length],
    Congregation_ID: campuses[i % campuses.length],
    Location_ID: locations[i % locations.length],
    Program_ID: programs[i % programs.length],
    Primary_Contact: BIG_ID,
  }));
}

const calendarFixture: Responder = (req) => {
  if (req.path === "/tables/Events") return calendarEvents();
  if (req.path === "/tables/Programs") {
    const ministries = ids(CALENDAR.ministries, 6_000_000);
    return ids(CALENDAR.programs, 2_000_000).map((Program_ID, i) => ({
      Program_ID,
      Program_Name: "p",
      Ministry_ID: ministries[i % ministries.length],
    }));
  }
  if (req.path === "/tables/dp_User_User_Groups") return [];
  return undefined;
};

/** 120 invoices over the years (a family registering several children), 60 products. */
const invoiceFixture: Responder = (req) => {
  const invoices = ids(120, 7_000_000);
  const products = ids(60, 8_000_000);
  if (req.path === "/tables/Invoices") {
    return invoices.map((Invoice_ID) => ({ Invoice_ID, Invoice_Status_ID: 1, Invoice_Total: 10 }));
  }
  if (req.path === "/tables/Invoice_Detail") {
    return invoices.map((Invoice_ID, i) => ({
      Invoice_Detail_ID: Invoice_ID,
      Invoice_ID,
      Product_ID: products[i % products.length],
    }));
  }
  return undefined;
};

const missionTripFixture: Responder = (req) => {
  if (req.path === "/procs") {
    return [
      "api_MPPW_SearchMissionTrips",
      "api_MPPW_GetMyMissionTrips",
      "api_MPPW_GetMyMissionTripDonors",
      "api_MPPW_GetMyMissionTripTeamProgress",
    ].map((Name) => ({ Name }));
  }
  if (req.path === "/tables/Contacts") return [CONTACT_ROW];
  if (req.path === "/procs/api_MPPW_GetMyMissionTrips") {
    return [ids(250).map((Pledge_ID) => ({ Pledge_ID, Pledge_Campaign_ID: BIG_ID, Trip_Leader: 1 }))];
  }
  if (req.path === "/tables/Pledges") {
    const batch = /IN \(([^)]*)\)/.exec(req.query.get("$filter") ?? "")?.[1] ?? "";
    return batch
      .split(",")
      .filter(Boolean)
      .map((id) => ({ Pledge_ID: Number(id), Contact_ID: BIG_ID }));
  }
  return undefined;
};

// ── cases ───────────────────────────────────────────────────────────────────

interface UrlCase {
  name: string;
  /** Path (below the base URL) of the request that makes this case meaningful. */
  expect: RegExp;
  responder?: Responder;
  run: () => Promise<unknown>;
}

const CASES: UrlCase[] = [
  // onlineDirectoryService (C50) -- the case this guard exists for.
  ...[
    ["3-char keyword", "Keh"],
    ["display name", "Chris Kehayias"],
    ["last, first", "Kehayias, Chris"],
    ["household chip", "hh 85"],
    ["long keyword", LONG_KEYWORD],
    ["accented keyword", ACCENTED_KEYWORD],
    ["long last, first", "Montgomery-Fitzwilliam, Bartholomew"],
  ].map(
    ([label, keyword]): UrlCase => ({
      name: `onlineDirectory.search: ${label}`,
      expect: /^\/tables\/Contacts$/,
      run: async () =>
        (await fresh(services.onlineDirectory)).search({ keyword, congregationId: BIG_ID }),
    }),
  ),
  {
    name: "onlineDirectory.getConfig",
    expect: /^\/tables\//,
    run: async () => (await fresh(services.onlineDirectory)).getConfig(),
  },
  {
    name: "onlineDirectory.canAccessDirectory",
    expect: /^\/tables\//,
    responder: withIdentity(),
    run: async () => (await fresh(services.onlineDirectory)).canAccessDirectory(BIG_ID),
  },

  // fullCalendarService: every distinct program / location / congregation /
  // event type in the window becomes one `X_ID = n OR ...` term.
  {
    name: "fullCalendar.getEvents: busy six-week grid",
    expect: /^\/tables\/Programs$/,
    responder: withIdentity(calendarFixture),
    run: async () =>
      (await fresh(services.fullCalendar)).getEvents(
        "2026-11-01T00:00:00-04:00",
        "2026-12-13T00:00:00-05:00",
        GUID,
      ),
  },
  {
    name: "fullCalendar.getEventDetail",
    expect: /^\/tables\/Events$/,
    responder: withIdentity((req) =>
      req.path === "/tables/Events" ? calendarEvents().slice(0, 1) : undefined,
    ),
    run: async () => (await fresh(services.fullCalendar)).getEventDetail(BIG_ID, GUID),
  },

  // Keyword searches that go to a stored procedure on the query string, next
  // to `@ImageBaseUrl` (the base URL again).
  {
    name: "eventFinder.searchEvents: long keyword",
    expect: /^\/procs\/api_MPPW_SearchEvents$/,
    run: async () =>
      (await fresh(services.eventFinder)).searchEvents({
        keyword: LONG_KEYWORD,
        congregationId: BIG_ID,
        ministryId: BIG_ID,
        programId: BIG_ID,
        eventTypeId: BIG_ID,
        monthId: 12,
        signupType: 2,
        isFeatured: true,
        isStaffUser: true,
      }),
  },
  {
    name: "eventFinder.getConfigurations",
    expect: /^\/(tables|procs)\//,
    run: async () => (await fresh(services.eventFinder)).getConfigurations(),
  },
  {
    name: "groups.searchGroups: long keyword and postal code, every filter",
    expect: /^\/procs\/api_MPPW_SearchGroups$/,
    run: async () =>
      (await fresh(services.groups)).searchGroups(
        {
          keyword: LONG_KEYWORD,
          cityPostalCode: LONG_KEYWORD,
          congregationId: BIG_ID,
          ministryId: BIG_ID,
          parentGroupId: BIG_ID,
          groupFocusId: BIG_ID,
          lifeStageId: BIG_ID,
          groupTypeId: BIG_ID,
          meetingDays: [1, 2, 3, 4, 5, 6, 7],
          meetingTimes: ["morning", "lunchtime", "afternoon", "evening"],
          meetsOnline: true,
          showFullGroups: true,
          showFutureGroups: true,
          countGroupInquiries: true,
        },
        BIG_ID,
      ),
  },
  {
    name: "groups.getGroupDetails",
    expect: /^\/(tables|procs)\//,
    responder: withIdentity(),
    run: async () => (await fresh(services.groups)).getGroupDetails(BIG_ID, true, true, BIG_ID),
  },
  {
    name: "groups.getConfigurations",
    expect: /^\/(tables|procs)\//,
    run: async () => (await fresh(services.groups)).getConfigurations(),
  },
  {
    name: "groups.getCurrentContact",
    expect: /^\/tables\//,
    responder: withIdentity(),
    run: async () => (await fresh(services.groups)).getCurrentContact(BIG_ID),
  },
  {
    name: "opportunityFinder.searchOpportunities: long keyword, 150 results",
    expect: /^\/tables\/Responses$/,
    responder: (req) =>
      req.path === "/procs/api_MPPW_SearchOpportunities"
        ? [ids(150).map((Id) => ({ Id, Title: "t", MaximumNeeded: 10 }))]
        : undefined,
    run: async () =>
      (await fresh(services.opportunityFinder)).searchOpportunities({
        keyword: LONG_KEYWORD,
        attributeIds: ids(40).join(","),
        congregationId: BIG_ID,
        ministryId: BIG_ID,
        programId: BIG_ID,
        eventId: BIG_ID,
        genderId: 2,
        minimumAge: 99,
        frequency: 2,
        isStaffUser: true,
      }),
  },
  {
    name: "opportunityFinder.getConfigurations",
    expect: /^\/tables\//,
    run: async () => (await fresh(services.opportunityFinder)).getConfigurations(),
  },
  {
    name: "missionTrip.search: long keyword",
    expect: /^\/procs\/api_MPPW_SearchMissionTrips$/,
    responder: missionTripFixture,
    run: async () =>
      (await fresh(services.missionTrip)).search({
        campaignTypeId: BIG_ID,
        keyword: LONG_KEYWORD,
        congregationId: BIG_ID,
        ministryId: BIG_ID,
        programId: BIG_ID,
        maxResults: 500,
      }),
  },
  {
    name: "missionTrip.mine: head of household with 250 pledges",
    expect: /^\/tables\/Pledges$/,
    responder: missionTripFixture,
    run: async () => (await fresh(services.missionTrip)).mine(BIG_ID, BIG_ID),
  },
  {
    name: "missionTrip.team",
    expect: /^\/procs\/api_MPPW_GetMyMissionTrips$/,
    responder: missionTripFixture,
    run: async () => (await fresh(services.missionTrip)).team(BIG_ID, BIG_ID, BIG_ID),
  },
  {
    name: "missionTrip.donors",
    expect: /^\/procs\/api_MPPW_GetMyMissionTrips$/,
    responder: missionTripFixture,
    run: async () => (await fresh(services.missionTrip)).donors(BIG_ID, BIG_ID, BIG_ID),
  },

  // invoiceService: one `Invoice_ID = n OR ...` term per invoice the
  // purchaser has ever had, then one `Product_ID = n OR ...` per product.
  {
    name: "invoice.getInvoices: purchaser with 120 invoices (client credentials)",
    expect: /^\/tables\/Invoice_Detail$/,
    responder: invoiceFixture,
    run: async () => (await fresh(services.invoice)).getInvoices(BIG_ID),
  },
  {
    name: "invoice.getInvoices: purchaser with 120 invoices (user token)",
    expect: /^\/tables\/Products$/,
    responder: invoiceFixture,
    run: async () =>
      (await fresh(services.invoice)).getInvoices(BIG_ID, "user-token", {
        congregationId: BIG_ID,
        monthId: 12,
        invoiceStatus: 1,
      }),
  },
  {
    name: "invoice.getInvoiceDetail",
    expect: /^\/tables\//,
    responder: invoiceFixture,
    run: async () => (await fresh(services.invoice)).getInvoiceDetail(BIG_ID, BIG_ID, "user-token"),
  },
  {
    name: "invoice.getCheckoutInvoiceByGuid",
    expect: /^\/procs\//,
    run: async () => (await fresh(services.invoice)).getCheckoutInvoiceByGuid(GUID, BIG_ID),
  },

  {
    name: "myGroups.getGroups: staff member in 80 groups",
    expect: /^\/tables\/Congregations$/,
    responder: (req) =>
      req.path === "/procs/api_MPPW_GetMyGroups"
        ? [
            ids(80).map((GroupId, i) => ({
              GroupId,
              GroupName: "g",
              AvailableOnline: 1,
              OffsiteMeetingAddressId: i % 2 === 0 ? GroupId : null,
              CongregationId: 1_000_000 + (i % 25),
            })),
          ]
        : undefined,
    run: async () => (await fresh(services.myGroups)).getGroups(BIG_ID),
  },
  {
    name: "myGroups.getUserByGuid + getCloudUrlPrefix",
    expect: /^\/tables\/dp_Users$/,
    run: async () => {
      const svc = await fresh(services.myGroups);
      await svc.getCloudUrlPrefix();
      return svc.getUserByGuid(GUID);
    },
  },

  // Fixed-shape reads: no list grows with data, but the base URL, a GUID, a
  // long name or a long email can still land on the query string.
  {
    name: "addToCalendar.getEventForCalendar",
    expect: /^\/tables\/Events$/,
    run: async () => (await fresh(services.addToCalendar)).getEventForCalendar(BIG_ID),
  },
  {
    name: "configSettings.getGoogleMapsApiKey",
    expect: /^\/tables\/dp_Configuration_Settings$/,
    run: async () => (await fresh(services.configSettings)).getGoogleMapsApiKey(),
  },
  {
    name: "contactAttribute.getContactIdByUserGuid + getForContact",
    expect: /^\/tables\//,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.contactAttribute);
      await svc.getContactIdByUserGuid(GUID);
      return svc.getForContact(BIG_ID);
    },
  },
  {
    name: "contributionStatement.getUserByGuid + getStatements",
    expect: /^\/(tables|procs)\//,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.contributionStatement);
      await svc.getUserByGuid(GUID);
      return svc.getStatements(BIG_ID);
    },
  },
  {
    name: "customForm.getDefinition by GUID",
    expect: /^\/tables\/Form_Fields$/,
    responder: (req) =>
      req.path === "/tables/Forms" ? [{ Form_ID: BIG_ID, Form_Title: "f", Form_GUID: GUID }] : undefined,
    run: async () => (await fresh(services.customForm)).getDefinition({ formGuid: GUID }),
  },
  {
    name: "eventDetails reads",
    expect: /^\/procs\/api_MPPW_GetEventById$/,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.eventDetails);
      await svc.getUserByGuid(GUID);
      await svc.getContactInfo(BIG_ID);
      await svc.getBasicContact(BIG_ID);
      await svc.hasRegistered(BIG_ID, BIG_ID);
      await svc.checkPendingEventAvailability(BIG_ID);
      await svc
        .checkAvailability(
          BIG_ID,
          ids(30).map((optionPriceId) => ({ optionPriceId, qty: 99 })),
        )
        .catch(() => undefined);
      await svc.getEventParticipantsByInvoice(GUID, BIG_ID).catch(() => undefined);
      return svc.getEventById(BIG_ID, true);
    },
  },
  {
    name: "household.getHouseholdBundle + getLookups",
    expect: /^\/tables\//,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.household);
      await svc.getLookups();
      return svc.getHouseholdBundle(GUID);
    },
  },
  {
    name: "myGiving.getDonations",
    expect: /^\/(tables|procs)\//,
    run: async () => (await fresh(services.myGiving)).getDonations(BIG_ID, 2026, 12),
  },
  {
    name: "myPledges.getPledges",
    expect: /^\/(tables|procs)\//,
    run: async () => (await fresh(services.myPledges)).getPledges(BIG_ID),
  },
  {
    name: "opportunityDetails.getOpportunityById + hasResponded",
    expect: /^\/(tables|procs)\//,
    run: async () => {
      const svc = await fresh(services.opportunityDetails);
      await svc.hasResponded(BIG_ID, BIG_ID);
      return svc.getOpportunityById(BIG_ID, { showFullAddress: true });
    },
  },
  {
    name: "planYourVisit reads with long name and email",
    expect: /^\/tables\/Contacts$/,
    run: async () => {
      const svc = await fresh(services.planYourVisit);
      await svc.getConfigurations().catch(() => undefined);
      await svc.getAgeOrGradeGroups(BIG_ID).catch(() => undefined);
      await svc.getCongregationEmailTemplate(BIG_ID).catch(() => undefined);
      return svc.findContact(LONG_NAME, LONG_NAME, LONG_EMAIL);
    },
  },
  {
    name: "pledgeCampaign reads",
    expect: /^\/procs\/api_MPPW_GetPledgeCampaign$/,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.pledgeCampaign);
      await svc.getUserByGuid(GUID);
      await svc.hasPledged(BIG_ID, BIG_ID);
      await svc.getBasicContact(BIG_ID);
      return svc.getCampaign(BIG_ID);
    },
  },
  {
    name: "prayerFeedback reads with long name and email",
    expect: /^\/tables\/Contacts$/,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.prayerFeedback);
      await svc.getFeedbackTypes(ids(40)).catch(() => undefined);
      await svc.getContactIdByUserGuid(GUID);
      await svc.getContactSummary(BIG_ID);
      await svc.getSubmitterOptions(BIG_ID).catch(() => undefined);
      await svc.isInSameHousehold(BIG_ID, BIG_ID - 1);
      return svc.findContact(LONG_NAME, LONG_NAME, LONG_EMAIL);
    },
  },
  {
    name: "preCheck.getPreCheckRows",
    expect: /^\/procs\//,
    responder: (req) =>
      req.path === "/procs" ? [{ Name: "api_MPPW_GetPreCheck" }, { Name: "api_MPPW_SavePreCheck" }] : undefined,
    run: async () => {
      const svc = await fresh(services.preCheck);
      await svc.isAvailable();
      return svc.getPreCheckRows(BIG_ID, "2026-12-31");
    },
  },
  {
    name: "products.getProduct + validPromoCode with a long code",
    expect: /^\/(tables|procs)\//,
    run: async () => {
      const svc = await fresh(services.products);
      await svc.validPromoCode(BIG_ID, "O'".repeat(50), true, BIG_ID, BIG_ID).catch(() => undefined);
      return svc.getProduct(BIG_ID, BIG_ID, BIG_ID, BIG_ID, BIG_ID);
    },
  },
  {
    name: "profile.getProfileByUserGuid + getLookups",
    expect: /^\/tables\/Contacts$/,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.profile);
      await svc.getLookups();
      await svc.getProfilePhoto(BIG_ID).catch(() => undefined);
      return svc.getProfileByUserGuid(GUID);
    },
  },
  {
    name: "statementPreferences reads",
    expect: /^\/tables\//,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.statementPreferences);
      await svc.getUserByGuid(GUID);
      return svc.getPreference(BIG_ID);
    },
  },
  {
    name: "subscription reads with a long email",
    expect: /^\/tables\/dp_Publications$/,
    responder: withIdentity(),
    run: async () => {
      const svc = await fresh(services.subscription);
      await svc.getContactIdByUserGuid(GUID);
      await svc.getBulkEmailOptOut(BIG_ID);
      await svc.getContactByContactGuid(GUID);
      await svc.findContactIdByEmail(LONG_EMAIL);
      await svc.getOnlinePublication(BIG_ID);
      return svc.getSubscriptions(BIG_ID, BIG_ID);
    },
  },
];

/**
 * Cases that overflow today. Each is a real defect, reported here rather than
 * silenced: fix the service, then delete the entry (the test fails until you do).
 */
const KNOWN_DEFECTS: Record<string, string> = {
  // INTEGRATOR: fix invoiceService.getProductSummaries, then delete both entries.
  "invoice.getInvoices: purchaser with 120 invoices (client credentials)": [
    "invoiceService.ts getProductSummaries (line 264 at time of writing) builds one",
    "`Invoice_ID = n OR ...` term (~26 encoded chars) per invoice the purchaser has ever",
    "had, unbatched, so the Invoice_Detail read overflows at roughly 75 invoices. The",
    "catch logs a warning and every Product_Summary on next-my-invoices silently becomes",
    "null. Batch the ids (missionTripService.pledgeHolders does, 100 per IN list) or use",
    "`Invoice_ID IN (...)`. getProductMap's `Product_ID = n OR ...` list (lines 319/365)",
    "has the same shape and is at 1600 chars with 60 distinct products.",
  ].join(" "),
  "invoice.getInvoices: purchaser with 120 invoices (user token)": [
    "Same defect as the client-credentials case: the Invoice_Detail read is unbatched.",
  ].join(" "),
};

// ── tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  captured = [];
  responder = undefined;
  (DomainTimezoneService as unknown as { instance: unknown }).instance = null;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("MP request URL length (C50 class)", () => {
  it("measures against a base URL long enough to matter", () => {
    expect(LONG_BASE.length).toBeGreaterThanOrEqual(120);
  });

  for (const c of CASES) {
    it(c.name, async () => {
      responder = c.responder;
      // Services log their own degraded paths; that is noise here.
      const quiet = (["log", "warn", "error"] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => undefined),
      );
      try {
        await c.run();
      } catch {
        // A thrown read is fine here (empty fixtures make some flows bail
        // out); what matters is every URL built before it, and `expect`
        // below proves the interesting one was built.
      } finally {
        for (const spy of quiet) spy.mockRestore();
      }
      const report = captured.map(
        (r) => `${r.method} ${r.path} qs=${queryStringOf(r.url).length} url=${r.url.length}`,
      );
      // MP_URL_LENGTH_DEBUG=<file> appends every case's measurements there.
      const debugFile = process.env.MP_URL_LENGTH_DEBUG;
      if (debugFile) appendFileSync(debugFile, [c.name, ...report, ""].join("\n  "));
      expect(
        captured.some((r) => c.expect.test(r.path)),
        [`no request matched ${String(c.expect)}; captured:`, ...report].join("\n"),
      ).toBe(true);

      const over = captured.filter(
        (r) => queryStringOf(r.url).length > IIS_MAX_QUERY_STRING || r.url.length > IIS_MAX_URL,
      );
      const known = KNOWN_DEFECTS[c.name];
      if (known) {
        expect(
          over.length,
          `KNOWN_DEFECTS entry "${c.name}" no longer overflows -- remove it. (${known})`,
        ).toBeGreaterThan(0);
        console.warn(`[mp-url-length] KNOWN DEFECT ${c.name}: ${known}\n${report.join("\n")}`);
        return;
      }
      expect(
        over.map((r) => `${r.method} ${r.path} qs=${queryStringOf(r.url).length} url=${r.url.length}`),
        "query string over IIS maxQueryString (2048) -- MP answers with an IIS 404",
      ).toEqual([]);
    });
  }

  it("every KNOWN_DEFECTS entry names a case", () => {
    const names = new Set(CASES.map((c) => c.name));
    expect(Object.keys(KNOWN_DEFECTS).filter((k) => !names.has(k))).toEqual([]);
  });
});
