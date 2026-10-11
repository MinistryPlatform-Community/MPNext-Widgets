/**
 * Tests for `<next-my-mission-trips>` (C76).
 *
 * The load-bearing ones:
 *
 *   - **`show-team-progress` unset means no request to `/team` at all.** The
 *     attribute is a display hint, but a widget that fetched the roster anyway
 *     and hid it client-side would be legacy's defect with extra steps.
 *   - **`not_trip_leader` hides the panel silently.** A participant who is not
 *     the leader is in an ordinary state; rendering "Only the trip leader can
 *     see the team's progress." on every teammate's card would be noise. Same
 *     for `not_a_participant` on donors.
 *   - **a suppressed contact field renders nothing** — no label, no empty
 *     address block. `Home_Address_Unlisted` nulls the whole address object,
 *     and an anonymous donation carries no contact data at all.
 *   - signed out renders sign-in, not "Unable to Load" (`C13` / `C30` / `C46`).
 *   - `initLocale()` resolves before the first `render()`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./my-mission-trips";

const HOST = "https://widgets.example.com";
const PAGE = "/my-trips";

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

function myTrip(overrides: Record<string, unknown> = {}) {
  return {
    pledgeId: 7,
    pledgeCampaignId: 4,
    campaignName: "Tanzania Mission Trip",
    description: null,
    imageUrl: null,
    campaignGoal: 5000,
    totalPledge: 2000,
    raised: 500,
    pledgeStatusId: 1,
    pledgeStatus: "Active",
    tripLeader: false,
    isMine: true,
    firstName: "Ada",
    lastName: "Lovelace",
    startDate: null,
    endDate: null,
    eventStartDate: "2027-06-04T00:00:00",
    eventEndDate: "2027-06-11T00:00:00",
    ...overrides,
  };
}

function donor(overrides: Record<string, unknown> = {}) {
  return {
    pledgeId: 7,
    pledgeCampaignId: 4,
    campaignName: "Tanzania Mission Trip",
    donorName: "Grace Hopper",
    anonymous: false,
    amount: 250,
    currency: "USD",
    notes: null,
    donationDate: "2026-08-01T00:00:00",
    address: {
      line1: "1 Navy Way",
      line2: null,
      city: "Arlington",
      stateRegion: "VA",
      postalCode: "22202",
      foreignCountry: null,
    },
    phone: "555-0100",
    email: "grace@example.com",
    imageUrl: null,
    ...overrides,
  };
}

function teamMember(overrides: Record<string, unknown> = {}) {
  return {
    pledgeId: 8,
    pledgeCampaignId: 4,
    campaignName: "Tanzania Mission Trip",
    firstName: "Caleb",
    lastName: "Hyatt",
    pledgeStatusId: 1,
    pledgeStatus: "Active",
    campaignGoal: 5000,
    totalPledge: 2000,
    raised: 1000,
    tripLeader: false,
    email: null,
    phone: null,
    imageUrl: null,
    ...overrides,
  };
}

interface Routes {
  mine?: Response;
  donors?: Response;
  team?: Response;
}

function mockFetch(routes: Routes = {}) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/mission-trips/mine")) {
      return routes.mine ?? jsonResponse({ trips: [myTrip()] });
    }
    if (url.includes("/mission-trips/donors")) {
      return routes.donors ?? jsonResponse({ donors: [donor()] });
    }
    if (url.includes("/mission-trips/team")) {
      return routes.team ?? jsonResponse({ team: [teamMember()] });
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function requestsTo(fn: ReturnType<typeof mockFetch>, fragment: string) {
  return fn.mock.calls.map(([input]) => String(input)).filter((u) => u.includes(fragment));
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";

function mount(attrs = 'campaign-type-id="2"'): HTMLElement {
  document.body.innerHTML = `<next-my-mission-trips api-host="${HOST}" ${attrs}></next-my-mission-trips>`;
  return document.body.firstElementChild as HTMLElement;
}

async function mountSettled(attrs = 'campaign-type-id="2"'): Promise<HTMLElement> {
  const el = mount(attrs);
  // Both conditions matter: `.mmt` proves the first render has happened at all
  // (an empty shadow root has no spinner either), and the absent spinner proves
  // the load has settled.
  await vi.waitFor(() => expect(shadow(el).querySelector(".mmt")).not.toBeNull());
  await vi.waitFor(() => expect(shadow(el).querySelector(".mmt-spinner")).toBeNull());
  return el;
}

describe("<next-my-mission-trips>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("my-mission-trips"),
      refresh: () => getAuthSession(HOST).refreshToken("my-mission-trips"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers as next-my-mission-trips", () => {
    expect(customElements.get("next-my-mission-trips")).toBeTruthy();
  });

  describe("localisation ordering", () => {
    it("resolves the catalogue before the first render", async () => {
      const order: string[] = [];
      const proto = Object.getPrototypeOf(
        document.createElement("next-my-mission-trips"),
      ) as { render: () => void; initLocale: () => Promise<void> };

      const renderSpy = vi.spyOn(proto, "render").mockImplementation(() => {
        order.push("render");
      });
      const initSpy = vi
        .spyOn(proto as unknown as { initLocale: () => Promise<void> }, "initLocale")
        .mockImplementation(async () => {
          order.push("initLocale");
        });

      mount();
      await vi.waitFor(() => expect(order).toContain("render"));

      expect(order[0]).toBe("initLocale");
      renderSpy.mockRestore();
      initSpy.mockRestore();
    });

    it("renders Portuguese under <html lang=pt-BR> with no English leak", async () => {
      document.documentElement.setAttribute("lang", "pt-BR");
      const el = await mountSettled();

      expect(text(el)).toContain("Minhas viagens missionárias");
      expect(text(el)).not.toContain("My Mission Trips");
      expect(text(el)).not.toContain("My Support Progress");
      // MP-authored content stays as the church wrote it.
      expect(text(el)).toContain("Tanzania Mission Trip");
    });
  });

  it("emits an h2 (C35)", async () => {
    const el = await mountSettled();
    expect(shadow(el).querySelector("h2")?.textContent).toContain("My Mission Trips");
  });

  describe("signed out", () => {
    it("offers sign-in rather than an error (C13 / C30 / C46)", async () => {
      mockFetch({ mine: jsonResponse({ error: "auth_required", message: "No token" }, 401) });
      const el = await mountSettled();

      expect(shadow(el).querySelector(".mmt-signin")).not.toBeNull();
      expect(shadow(el).querySelector(".mmt-error")).toBeNull();
      expect(text(el)).toContain("Please sign in to view your mission trips");
      expect(text(el)).not.toContain("Unable to Load");
    });

    it("asks for login when the sign-in button is pressed", async () => {
      mockFetch({ mine: jsonResponse({ error: "auth_required" }, 401) });
      const el = await mountSettled();

      const seen: unknown[] = [];
      el.addEventListener("loginRequired", (e) => seen.push((e as CustomEvent).detail));
      shadow(el).querySelector<HTMLButtonElement>('[data-action="login"]')!.click();

      expect(seen).toEqual([{ wid: "my-mission-trips" }]);
    });
  });

  describe("the trip list", () => {
    it("shows the campaign name, dates with the year, and a progress bar", async () => {
      const el = await mountSettled();

      expect(shadow(el).querySelector(".mmt-name")?.textContent).toBe("Tanzania Mission Trip");
      expect(shadow(el).querySelector(".mmt-dates")?.textContent).toContain("2027");
      expect(shadow(el).querySelector(".mmt-progress-text")?.textContent).toContain("$500.00");
      expect(shadow(el).querySelector<HTMLElement>(".mmt-fill")!.style.width).toBe("25%");
    });

    it("separates a household member's trip into the Family section", async () => {
      mockFetch({
        mine: jsonResponse({
          trips: [
            myTrip(),
            myTrip({ pledgeId: 9, isMine: false, firstName: "Sarah", campaignName: "Kenya" }),
          ],
        }),
      });
      const el = await mountSettled();

      expect(shadow(el).querySelector(".mmt-section")?.textContent).toContain(
        "Family Mission Trips",
      );
      const lists = shadow(el).querySelectorAll(".mmt-list");
      expect(lists.length).toBe(2);
      expect(lists[0].textContent).toContain("Tanzania Mission Trip");
      expect(lists[1].textContent).toContain("Kenya");
    });

    it("omits the Family section entirely when every row is the caller's own", async () => {
      const el = await mountSettled();
      expect(shadow(el).querySelector(".mmt-section")).toBeNull();
    });

    it("badges a trip leader", async () => {
      mockFetch({ mine: jsonResponse({ trips: [myTrip({ tripLeader: true })] }) });
      const el = await mountSettled();
      expect(shadow(el).querySelector(".mmt-badge--leader")?.textContent).toContain(
        "Trip leader",
      );
    });

    it("translates MP's four pledge statuses through the my-pledges keys", async () => {
      document.documentElement.setAttribute("lang", "es");
      const el = await mountSettled();
      expect(shadow(el).querySelector(".mmt-badge--active")?.textContent).toBe("Activo");
    });

    it("renders the empty state rather than an error for no trips", async () => {
      mockFetch({ mine: jsonResponse({ trips: [] }) });
      const el = await mountSettled();

      expect(shadow(el).querySelector(".mmt-empty")).not.toBeNull();
      expect(shadow(el).querySelector(".mmt-error")).toBeNull();
    });

    it("renders the catalogue sentence for an error code, never the server's English", async () => {
      mockFetch({
        mine: jsonResponse(
          {
            error: "mission_trips_unavailable",
            message: "api_MPPW_GetMyMissionTrips is not installed on this domain",
          },
          503,
        ),
      });
      const el = await mountSettled();

      expect(text(el)).toContain("Mission trips are not set up for this site yet");
      expect(text(el)).not.toContain("api_MPPW_GetMyMissionTrips");
    });
  });

  describe("the display hints decide whether the widget asks", () => {
    it("makes no request to /team or /donors when both attributes are unset", async () => {
      const fetchMock = mockFetch();
      const el = await mountSettled();

      expect(requestsTo(fetchMock, "/mission-trips/team")).toEqual([]);
      expect(requestsTo(fetchMock, "/mission-trips/donors")).toEqual([]);
      expect(shadow(el).querySelector(".mmt-panel")).toBeNull();
    });

    it("makes no request to /team when only show-donors is set", async () => {
      const fetchMock = mockFetch();
      await mountSettled('campaign-type-id="2" show-donors="true"');

      expect(requestsTo(fetchMock, "/mission-trips/donors").length).toBe(1);
      expect(requestsTo(fetchMock, "/mission-trips/team")).toEqual([]);
    });

    it("treats any value but the string \"true\" as off, matching legacy", async () => {
      const fetchMock = mockFetch();
      await mountSettled('campaign-type-id="2" show-donors="" show-team-progress="1"');

      expect(requestsTo(fetchMock, "/mission-trips/donors")).toEqual([]);
      expect(requestsTo(fetchMock, "/mission-trips/team")).toEqual([]);
    });

    it("asks once per campaign, not once per pledge", async () => {
      mockFetch({
        mine: jsonResponse({
          trips: [myTrip(), myTrip({ pledgeId: 9, isMine: false })],
        }),
      });
      const fetchMock = vi.mocked(fetch) as unknown as ReturnType<typeof mockFetch>;
      await mountSettled('campaign-type-id="2" show-donors="true"');

      expect(requestsTo(fetchMock, "/mission-trips/donors").length).toBe(1);
    });

    it("scopes each panel request to the campaign and the campaign type", async () => {
      const fetchMock = mockFetch();
      await mountSettled('campaign-type-id="2" show-team-progress="true"');

      const url = new URL(requestsTo(fetchMock, "/mission-trips/team")[0], HOST);
      expect(url.searchParams.get("campaignId")).toBe("4");
      expect(url.searchParams.get("campaignTypeId")).toBe("2");
    });
  });

  describe("the roster is the server's decision", () => {
    it("hides the panel silently on not_trip_leader", async () => {
      mockFetch({
        team: jsonResponse(
          { error: "not_trip_leader", message: "Caller holds no leader pledge" },
          403,
        ),
      });
      const el = await mountSettled('campaign-type-id="2" show-team-progress="true"');

      // No panel, no error state, and nothing about trip leaders anywhere.
      expect(shadow(el).querySelector(".mmt-panel")).toBeNull();
      expect(shadow(el).querySelector(".mmt-error")).toBeNull();
      expect(text(el)).not.toContain("Only the trip leader");
      expect(text(el)).not.toContain("Team Progress");
      // The trip itself still renders.
      expect(text(el)).toContain("Tanzania Mission Trip");
    });

    it("hides the donor panel silently on not_a_participant", async () => {
      mockFetch({
        donors: jsonResponse({ error: "not_a_participant", message: "No visible pledge" }, 403),
      });
      const el = await mountSettled('campaign-type-id="2" show-donors="true"');

      expect(shadow(el).querySelector(".mmt-panel")).toBeNull();
      expect(shadow(el).querySelector(".mmt-error")).toBeNull();
      expect(text(el)).not.toContain("You are not signed up for that trip");
    });

    it("renders the roster for a leader, with a per-member progress bar", async () => {
      const el = await mountSettled('campaign-type-id="2" show-team-progress="true"');

      expect(text(el)).toContain("Team Progress");
      expect(text(el)).toContain("Caleb Hyatt");
      expect(text(el)).toContain("Support Goal");
      expect(text(el)).toContain("Amount Raised");
    });

    it("renders nothing for a teammate whose unlisted flags nulled their contact fields", async () => {
      const el = await mountSettled('campaign-type-id="2" show-team-progress="true"');
      // The fixture teammate has email and phone null (D2's fix).
      expect(shadow(el).querySelectorAll(".mmt-donor-line").length).toBe(0);
    });

    it("shows a teammate's contact details when the flags allow it", async () => {
      mockFetch({
        team: jsonResponse({
          team: [teamMember({ email: "caleb@example.com", phone: "555-0111" })],
        }),
      });
      const el = await mountSettled('campaign-type-id="2" show-team-progress="true"');

      expect(text(el)).toContain("caleb@example.com");
      expect(text(el)).toContain("555-0111");
    });

    it("shows the roster's empty state when the leader is the only participant", async () => {
      mockFetch({ team: jsonResponse({ team: [] }) });
      const el = await mountSettled('campaign-type-id="2" show-team-progress="true"');

      expect(shadow(el).querySelector(".mmt-panel-empty")?.textContent).toContain(
        "No team members yet",
      );
    });
  });

  describe("donors", () => {
    it("lists a donor with their amount and contact details", async () => {
      const el = await mountSettled('campaign-type-id="2" show-donors="true"');

      expect(text(el)).toContain("My Donors");
      expect(shadow(el).querySelector(".mmt-donor-name")?.textContent).toBe("Grace Hopper");
      expect(shadow(el).querySelector(".mmt-amount")?.textContent).toContain("250");
      expect(text(el)).toContain("1 Navy Way, Arlington, VA 22202");
    });

    it("renders name and amount cleanly when every contact field is suppressed", async () => {
      mockFetch({
        donors: jsonResponse({
          donors: [donor({ address: null, phone: null, email: null })],
        }),
      });
      const el = await mountSettled('campaign-type-id="2" show-donors="true"');

      expect(shadow(el).querySelector(".mmt-donor-name")?.textContent).toBe("Grace Hopper");
      expect(shadow(el).querySelector(".mmt-amount")?.textContent).toContain("250");
      // No empty address block, no stray labels.
      expect(shadow(el).querySelectorAll(".mmt-donor-line").length).toBe(0);
    });

    it("shows the translated anonymous label and no contact data at all", async () => {
      mockFetch({
        donors: jsonResponse({
          donors: [
            donor({
              anonymous: true,
              donorName: "Anonymous Donor",
              // Fail-closed: even if the route leaked contact fields on an
              // anonymous row, the widget must not render them.
              phone: "555-0100",
              email: "grace@example.com",
            }),
          ],
        }),
      });
      document.documentElement.setAttribute("lang", "es");
      const el = await mountSettled('campaign-type-id="2" show-donors="true"');

      expect(shadow(el).querySelector(".mmt-donor-name")?.textContent).toBe("Donante anónimo");
      expect(text(el)).not.toContain("grace@example.com");
      expect(text(el)).not.toContain("555-0100");
      expect(text(el)).not.toContain("Navy Way");
    });

    it("shows the warm empty state when nobody has given yet", async () => {
      mockFetch({ donors: jsonResponse({ donors: [] }) });
      const el = await mountSettled('campaign-type-id="2" show-donors="true"');

      expect(shadow(el).querySelector(".mmt-panel-empty")?.textContent).toContain(
        "Once people start donating",
      );
    });

    it("shows only the donors of the row's own pledge", async () => {
      mockFetch({
        mine: jsonResponse({ trips: [myTrip(), myTrip({ pledgeId: 9, isMine: false })] }),
        donors: jsonResponse({
          donors: [donor(), donor({ pledgeId: 9, donorName: "Alan Turing" })],
        }),
      });
      const el = await mountSettled('campaign-type-id="2" show-donors="true"');

      const cards = shadow(el).querySelectorAll(".mmt-card");
      expect(cards[0].textContent).toContain("Grace Hopper");
      expect(cards[0].textContent).not.toContain("Alan Turing");
      expect(cards[1].textContent).toContain("Alan Turing");
    });

    it("escapes an MP-authored donor name rather than trusting it as markup", async () => {
      mockFetch({
        donors: jsonResponse({
          donors: [donor({ donorName: '<img src=x onerror="boom()">' })],
        }),
      });
      const el = await mountSettled('campaign-type-id="2" show-donors="true"');

      expect(shadow(el).querySelector("img")).toBeNull();
      expect(shadow(el).querySelector(".mmt-donor-name")?.textContent).toContain("boom()");
    });
  });
});
