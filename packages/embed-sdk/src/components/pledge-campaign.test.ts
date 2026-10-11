/**
 * Tests for `<next-pledge-campaign>`'s registration window and capacity gate
 * (C76 phase 1).
 *
 * This widget is also the mission-trip **details** page:
 * `api_MPPW_GetPledgeCampaign` declares `@IsMissionTrip bit` and never
 * references it in the body, so `mpp-mission-trip` and `mpp-pledge-campaign`
 * received byte-identical data and no `next-mission-trip` element exists.
 *
 * What phase 1 fixed: the widget gated only on `allowOnlinePledge` and the
 * campaign end date, so a campaign with `Maximum_Registrants` set accepted
 * pledges forever — a trip with a full bus, and equally a capital campaign with
 * a seat cap. The four fields were on the wire all along.
 *
 * The states must stay **distinct**. "This campaign is no longer accepting new
 * Pledges" for a window that opens next month is not merely vague, it is wrong:
 * the visitor should come back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./pledge-campaign";

const HOST = "https://widgets.example.com";
const PAGE = "/give/campaign";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** yyyy-mm-dd, `days` from today, as MP would write a wall clock. */
function wallClock(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}T00:00:00`;
}

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    pledgeCampaignId: 3,
    title: "Tanzania Mission Trip",
    description: null,
    imageUrl: null,
    campaignGoal: 50000,
    fundraisingGoal: null,
    pledged: 1000,
    received: 500,
    numberOfPledges: 4,
    startDate: wallClock(-30),
    endDate: wallClock(300),
    allowOnlinePledge: true,
    pledgeBeyondEndDate: false,
    onlineThankYouMessage: null,
    forceLogin: false,
    eventId: null,
    customFormId: null,
    customFormGuid: null,
    maximumRegistrants: null,
    currentRegistrants: 0,
    registrationStart: null,
    registrationEnd: null,
    ...overrides,
  };
}

function mockFetch(campaignBody = campaign()) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/pledge-campaign/basic-contact")) {
      return jsonResponse({ error: "auth_required" }, 401);
    }
    if (url.includes("/pledge-campaign/frequencies")) {
      return jsonResponse({ frequencies: [{ id: 12, name: "Monthly" }] });
    }
    if (url.includes("/api/embed/pledge-campaign/")) {
      return jsonResponse({ campaign: campaignBody, userHasAlreadyPledged: false });
    }
    if (url.includes("/api/embed/household")) return jsonResponse({ members: [] });
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";
const form = (el: HTMLElement) => shadow(el).querySelector("#pc-form");
const banner = (el: HTMLElement) =>
  shadow(el).querySelector("#pc-message")?.textContent?.trim() ?? "";

async function mountSettled(body = campaign()): Promise<HTMLElement> {
  mockFetch(body);
  document.body.innerHTML = `<next-pledge-campaign api-host="${HOST}" campaign-id="3"></next-pledge-campaign>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector(".pc-detail")).not.toBeNull());
  return el;
}

describe("<next-pledge-campaign> registration window and capacity", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("pledge-campaign"),
      refresh: () => getAuthSession(HOST).refreshToken("pledge-campaign"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("an open campaign", () => {
    it("renders the pledge form", async () => {
      const el = await mountSettled();
      expect(form(el)).not.toBeNull();
      expect(banner(el)).toBe("");
    });

    it("treats a null seat cap as uncapped, however many have registered", async () => {
      const el = await mountSettled(
        campaign({ maximumRegistrants: null, currentRegistrants: 999 }),
      );
      expect(form(el)).not.toBeNull();
    });

    it("treats a zero seat cap as uncapped too", async () => {
      // Churches leave `Maximum_Registrants` at 0 as often as at null; reading
      // 0 as "no seats" would close every uncapped campaign in the domain.
      const el = await mountSettled(
        campaign({ maximumRegistrants: 0, currentRegistrants: 999 }),
      );
      expect(form(el)).not.toBeNull();
    });

    it("keeps the form open on the last remaining seat", async () => {
      const el = await mountSettled(
        campaign({ maximumRegistrants: 12, currentRegistrants: 11 }),
      );
      expect(form(el)).not.toBeNull();
    });

    it("keeps the form open on the day registration opens", async () => {
      const el = await mountSettled(campaign({ registrationStart: wallClock(0) }));
      expect(form(el)).not.toBeNull();
    });

    it("keeps the form open on the day registration closes", async () => {
      // A wall-clock window is compared as whole days: a window that closes
      // "today" is open all of today, not at midnight this morning.
      const el = await mountSettled(campaign({ registrationEnd: wallClock(0) }));
      expect(form(el)).not.toBeNull();
    });
  });

  describe("a full campaign", () => {
    it("blocks the form and says the campaign is full", async () => {
      const el = await mountSettled(
        campaign({ maximumRegistrants: 12, currentRegistrants: 12 }),
      );

      expect(form(el)).toBeNull();
      expect(banner(el)).toContain("This campaign is full");
      expect(banner(el)).not.toContain("no longer accepting");
    });

    it("stays full when registrations overshoot the cap", async () => {
      const el = await mountSettled(
        campaign({ maximumRegistrants: 12, currentRegistrants: 40 }),
      );
      expect(banner(el)).toContain("This campaign is full");
    });

    it("says full rather than open, even inside the registration window", async () => {
      const el = await mountSettled(
        campaign({
          maximumRegistrants: 12,
          currentRegistrants: 12,
          registrationStart: wallClock(-10),
          registrationEnd: wallClock(10),
        }),
      );
      expect(banner(el)).toContain("This campaign is full");
    });
  });

  describe("a registration window that has not opened", () => {
    it("blocks the form and names the opening date", async () => {
      const el = await mountSettled(campaign({ registrationStart: wallClock(30) }));

      expect(form(el)).toBeNull();
      expect(banner(el)).toContain("Registration opens on");
      // Distinct from both the full state and the generic closed state — a
      // visitor should come back for this one.
      expect(banner(el)).not.toContain("This campaign is full");
      expect(banner(el)).not.toContain("no longer accepting");
    });
  });

  describe("a registration window that has closed", () => {
    it("blocks the form and names the closing date", async () => {
      const el = await mountSettled(campaign({ registrationEnd: wallClock(-1) }));

      expect(form(el)).toBeNull();
      expect(banner(el)).toContain("Registration for this campaign closed on");
      expect(banner(el)).not.toContain("This campaign is full");
    });
  });

  describe("the states already there before C76", () => {
    it("still blocks when the campaign disallows online pledges", async () => {
      const el = await mountSettled(campaign({ allowOnlinePledge: false }));

      expect(form(el)).toBeNull();
      expect(banner(el)).toContain("no longer accepting");
    });

    it("still blocks past the campaign end date", async () => {
      const el = await mountSettled(campaign({ endDate: wallClock(-1) }));

      expect(form(el)).toBeNull();
      expect(banner(el)).toContain("no longer accepting");
    });
  });

  describe("localisation", () => {
    it("says the campaign is full in Spanish, with no English leak", async () => {
      document.documentElement.setAttribute("lang", "es");
      const el = await mountSettled(
        campaign({ maximumRegistrants: 12, currentRegistrants: 12 }),
      );

      expect(banner(el)).toContain("Esta campaña está completa");
      expect(text(el)).not.toContain("This campaign is full");
    });

    it("dates the opening in Portuguese", async () => {
      document.documentElement.setAttribute("lang", "pt-BR");
      const el = await mountSettled(campaign({ registrationStart: wallClock(30) }));

      expect(banner(el)).toContain("As inscrições abrem em");
      expect(text(el)).not.toContain("Registration opens");
    });
  });

  describe("late attributes (C39)", () => {
    it("re-inits when campaign-id changes on a widget whose first load failed", async () => {
      const fn = mockFetch();
      const base = fn.getMockImplementation()!;
      fn.mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/embed/pledge-campaign/99")) {
          return jsonResponse({ error: "not_found" }, 404);
        }
        return base(input);
      });

      document.body.innerHTML = `<next-pledge-campaign api-host="${HOST}" campaign-id="99"></next-pledge-campaign>`;
      const el = document.body.firstElementChild as HTMLElement;
      await vi.waitFor(() => expect(text(el)).toContain("No pledge campaign found."));
      expect(shadow(el).querySelector(".pc-detail")).toBeNull();

      el.setAttribute("campaign-id", "3");
      await vi.waitFor(() => expect(shadow(el).querySelector(".pc-detail")).not.toBeNull());
    });
  });
});
