/**
 * Tests for `<next-mission-trip-finder>` (C76).
 *
 * The load-bearing ones, none of which is about styling:
 *
 *   - **cards are real links.** `C05`, `C10` and `C22` are the same
 *     accessibility defect filed three times — a `div` with `role="link"` and a
 *     click handler. An `<a href>` is keyboard-activatable with no `tabindex`
 *     bookkeeping, and this test is what stops a fourth filing.
 *   - **card dates carry the year** (`C09`). A finder listing next June's trip
 *     beside the June after it is ambiguous exactly when it matters.
 *   - **a full trip says so on the card**, not only by being filtered out —
 *     legacy had the filter and it was inverted.
 *   - the server's English `message` reaches the shadow root **never**.
 *   - `initLocale()` resolves before the first `render()`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./mission-trip-finder";

const HOST = "https://widgets.example.com";
const PAGE = "/missions";

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

interface TripOverrides {
  pledgeCampaignId?: number;
  campaignName?: string;
  description?: string | null;
  imageUrl?: string | null;
  congregationName?: string | null;
  programName?: string | null;
  ministryName?: string | null;
  eventStartDate?: string | null;
  eventEndDate?: string | null;
  registrationStart?: string | null;
  registrationEnd?: string | null;
  maximumRegistrants?: number | null;
  currentRegistrants?: number;
  isFull?: boolean;
}

/** A trip whose event runs in 2027, so the year is unambiguous in assertions. */
function trip(overrides: TripOverrides = {}) {
  return {
    pledgeCampaignId: 42,
    campaignName: "Tanzania Mission Trip",
    description: "Two weeks serving alongside our partner church.",
    imageUrl: null,
    congregationName: "Main Campus",
    programName: "Global Outreach",
    ministryName: "Missions",
    eventId: 18,
    eventStartDate: "2027-06-04T00:00:00",
    eventEndDate: "2027-06-11T00:00:00",
    registrationStart: null,
    registrationEnd: null,
    maximumRegistrants: null,
    currentRegistrants: 0,
    isFull: false,
    ...overrides,
  };
}

function mockFetch(search: Response | (() => Response) = jsonResponse({ trips: [trip()] })) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/api/embed/mission-trips")) {
      return typeof search === "function" ? search() : search;
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";
const cards = (el: HTMLElement) => shadow(el).querySelectorAll(".mtf-card");

const ATTRS = 'campaign-type-id="2" target="/demo-pledge-campaign.html"';

function mount(attrs = ATTRS): HTMLElement {
  document.body.innerHTML = `<next-mission-trip-finder api-host="${HOST}" ${attrs}></next-mission-trip-finder>`;
  return document.body.firstElementChild as HTMLElement;
}

async function mountSettled(attrs = ATTRS): Promise<HTMLElement> {
  const el = mount(attrs);
  await vi.waitFor(() =>
    expect(shadow(el).querySelector(".mtf-state, .mtf-grid")).not.toBeNull(),
  );
  await vi.waitFor(() => expect(shadow(el).querySelector(".mtf-spinner")).toBeNull());
  return el;
}

/** The query string the widget sent to the search route. */
function searchQuery(fn: ReturnType<typeof mockFetch>): URLSearchParams {
  const call = fn.mock.calls
    .map(([input]) => String(input))
    .find((u) => u.includes("/api/embed/mission-trips"));
  return new URLSearchParams(new URL(call!, HOST).search);
}

describe("<next-mission-trip-finder>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("mission-trip-finder"),
      refresh: () => getAuthSession(HOST).refreshToken("mission-trip-finder"),
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

  it("registers as next-mission-trip-finder", () => {
    expect(customElements.get("next-mission-trip-finder")).toBeTruthy();
  });

  describe("localisation ordering", () => {
    it("resolves the catalogue before the first render", async () => {
      const order: string[] = [];
      const proto = Object.getPrototypeOf(
        document.createElement("next-mission-trip-finder"),
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

    it("renders Spanish under <html lang=es> with no English leak", async () => {
      document.documentElement.setAttribute("lang", "es");
      const el = await mountSettled();

      expect(text(el)).toContain("Viajes misioneros");
      expect(text(el)).not.toContain("Mission Trips");
      expect(text(el)).not.toContain("See Details");
      // The campaign name is MP-authored content and is never translated.
      expect(text(el)).toContain("Tanzania Mission Trip");
    });
  });

  describe("the heading", () => {
    it("emits an h2 (C35)", async () => {
      const el = await mountSettled();
      expect(shadow(el).querySelector("h2")?.textContent).toContain("Mission Trips");
    });
  });

  describe("cards are links, not click-handled divs (C05 / C10 / C22)", () => {
    it("renders each card as an anchor carrying the details URL", async () => {
      const el = await mountSettled();
      const card = cards(el)[0] as HTMLAnchorElement;

      expect(card.tagName).toBe("A");
      expect(card.getAttribute("href")).toBe(
        new URL("/demo-pledge-campaign.html?id=42", window.location.href).toString(),
      );
    });

    it("needs no tabindex or role to be keyboard-activatable", async () => {
      const el = await mountSettled();
      const card = cards(el)[0];

      // An anchor with an href is focusable and Enter-activatable natively. A
      // `role="link"` div is the defect this asserts against.
      expect(card.getAttribute("role")).toBeNull();
      expect(card.getAttribute("tabindex")).toBeNull();
      expect(card.getAttribute("href")).toBeTruthy();
    });

    it("honours a custom id-parameter-name", async () => {
      const el = await mountSettled(
        'campaign-type-id="2" target="/trip" id-parameter-name="campaignId"',
      );
      const href = cards(el)[0].getAttribute("href")!;
      expect(new URL(href, window.location.href).searchParams.get("campaignId")).toBe("42");
    });

    it("falls back to an article when no target is set", async () => {
      const el = await mountSettled('campaign-type-id="2"');
      const card = cards(el)[0];
      expect(card.tagName).toBe("ARTICLE");
      expect(card.getAttribute("href")).toBeNull();
    });

    it("emits missionTripSelected without preventing navigation", async () => {
      const el = await mountSettled();
      const seen: unknown[] = [];
      el.addEventListener("missionTripSelected", (e) => seen.push((e as CustomEvent).detail));

      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      cards(el)[0].dispatchEvent(event);

      expect(seen).toEqual([{ campaignId: 42 }]);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("card content", () => {
    it("includes the year in the trip dates (C09)", async () => {
      const el = await mountSettled();
      const dates = shadow(el).querySelector(".mtf-card-dates")?.textContent ?? "";
      expect(dates).toContain("2027");
    });

    it("still shows the year when the trip has only a start date", async () => {
      mockFetch(jsonResponse({ trips: [trip({ eventEndDate: null })] }));
      const el = await mountSettled();
      expect(shadow(el).querySelector(".mtf-card-dates")?.textContent).toContain("2027");
    });

    it("shows MP-authored congregation, program and ministry names untranslated", async () => {
      const el = await mountSettled();
      expect(shadow(el).querySelector(".mtf-card-sub")?.textContent).toContain(
        "Main Campus · Global Outreach · Missions",
      );
    });

    it("escapes MP-authored names rather than trusting them as markup", async () => {
      mockFetch(
        jsonResponse({ trips: [trip({ campaignName: '<img src=x onerror="boom()">Trip' })] }),
      );
      const el = await mountSettled();

      expect(shadow(el).querySelector("img")).toBeNull();
      expect(shadow(el).querySelector(".mtf-card-title")?.textContent).toContain("boom()");
    });
  });

  describe("capacity", () => {
    it("badges a full trip visibly rather than only filtering it out", async () => {
      mockFetch(
        jsonResponse({
          trips: [trip({ isFull: true, maximumRegistrants: 12, currentRegistrants: 12 })],
        }),
      );
      const el = await mountSettled();

      expect(shadow(el).querySelector(".mtf-badge--full")?.textContent).toContain(
        "Trip is full",
      );
      // …and no seats-left line, which would contradict the badge.
      expect(shadow(el).querySelector(".mtf-card-spots")).toBeNull();
    });

    it("counts the seats left on a capped trip that still has some", async () => {
      mockFetch(
        jsonResponse({
          trips: [trip({ maximumRegistrants: 12, currentRegistrants: 11 })],
        }),
      );
      const el = await mountSettled();

      expect(shadow(el).querySelector(".mtf-card-spots")?.textContent).toContain("1 spot left");
      expect(shadow(el).querySelector(".mtf-badge--full")).toBeNull();
    });

    it("treats a null or zero cap as uncapped", async () => {
      mockFetch(
        jsonResponse({
          trips: [
            trip({ pledgeCampaignId: 1, maximumRegistrants: null, currentRegistrants: 40 }),
            trip({ pledgeCampaignId: 2, maximumRegistrants: 0, currentRegistrants: 40 }),
          ],
        }),
      );
      const el = await mountSettled();

      expect(shadow(el).querySelectorAll(".mtf-card-spots").length).toBe(0);
      expect(shadow(el).querySelectorAll(".mtf-badge--full").length).toBe(0);
    });
  });

  describe("the registration window", () => {
    it("says when registration opens, for a window that has not started", async () => {
      mockFetch(jsonResponse({ trips: [trip({ registrationStart: "2099-01-15T00:00:00" })] }));
      const el = await mountSettled();
      expect(shadow(el).querySelector(".mtf-card-reg")?.textContent).toContain(
        "Registration opens",
      );
    });

    it("says registration is closed once the window has passed", async () => {
      mockFetch(jsonResponse({ trips: [trip({ registrationEnd: "2001-01-15T00:00:00" })] }));
      const el = await mountSettled();
      expect(shadow(el).querySelector(".mtf-card-reg")?.textContent).toContain(
        "Registration closed",
      );
    });

    it("says the trip is open when no window is configured", async () => {
      const el = await mountSettled();
      expect(shadow(el).querySelector(".mtf-card-reg")?.textContent).toContain(
        "Open for registration",
      );
    });
  });

  describe("the query", () => {
    it("sends the campaign type, the default show-full-trips and the default cap", async () => {
      const fetchMock = mockFetch();
      await mountSettled();
      const params = searchQuery(fetchMock);

      expect(params.get("campaignTypeId")).toBe("2");
      expect(params.get("showFullTrips")).toBe("true");
      expect(params.get("maxResults")).toBe("100");
    });

    it("passes the church's filters through", async () => {
      const fetchMock = mockFetch();
      await mountSettled(
        'campaign-type-id="2" target="/t" congregation-id="1" ministry-id="5" program-id="9" keyword="Kenya" show-full-trips="false" max-results="10"',
      );
      const params = searchQuery(fetchMock);

      expect(params.get("congregationId")).toBe("1");
      expect(params.get("ministryId")).toBe("5");
      expect(params.get("programId")).toBe("9");
      expect(params.get("keyword")).toBe("Kenya");
      expect(params.get("showFullTrips")).toBe("false");
      expect(params.get("maxResults")).toBe("10");
    });

    it("re-queries with the keyword the visitor typed", async () => {
      const fetchMock = mockFetch();
      const el = await mountSettled();

      shadow(el).querySelector<HTMLInputElement>("#mtf-keyword")!.value = "  Tanzania  ";
      shadow(el)
        .querySelector<HTMLFormElement>("#mtf-form")!
        .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));

      await vi.waitFor(() => {
        const searches = fetchMock.mock.calls
          .map(([input]) => String(input))
          .filter((u) => u.includes("/api/embed/mission-trips"));
        expect(searches.length).toBeGreaterThan(1);
        expect(searches[searches.length - 1]).toContain("keyword=Tanzania");
      });
    });
  });

  describe("states", () => {
    it("renders the empty state rather than an error for zero results", async () => {
      mockFetch(jsonResponse({ trips: [] }));
      const el = await mountSettled();

      expect(shadow(el).querySelector(".mtf-empty")).not.toBeNull();
      expect(shadow(el).querySelector(".mtf-error")).toBeNull();
    });

    it("renders the catalogue sentence for an error code, never the server's English", async () => {
      mockFetch(
        jsonResponse(
          {
            error: "mission_trips_unavailable",
            message: "api_MPPW_SearchMissionTrips is not installed on this domain",
          },
          503,
        ),
      );
      const el = await mountSettled();

      expect(text(el)).toContain("Mission trips are not set up for this site yet");
      expect(text(el)).not.toContain("api_MPPW_SearchMissionTrips");
    });

    it("degrades an unmapped code to the generic sentence", async () => {
      mockFetch(jsonResponse({ error: "kaboom", message: "Kaboom happened at line 12" }, 500));
      const el = await mountSettled();

      expect(text(el)).toContain("Something went wrong");
      expect(text(el)).not.toContain("line 12");
    });
  });
});
