/**
 * Tests for `<next-opportunity-finder>`.
 *
 *   - C22: a result card is a real `<a href>` (Enter, middle-click, copy-link),
 *     never `div role="link" tabindex="0"` with a click-only handler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./opportunity-finder";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub: "public", exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface Opp {
  id: number;
  title: string;
  description: string | null;
  imageUrl: string | null;
  location: string | null;
  meetingDay: string | null;
  meetingTime: string | null;
  ribbonText: string | null;
  attributes: string[];
}

const opp = (id: number, extra: Partial<Opp> = {}): Opp => ({
  id,
  title: `Opportunity ${id}`,
  description: null,
  imageUrl: null,
  location: "Main Congregation",
  meetingDay: "Ongoing",
  meetingTime: null,
  ribbonText: null,
  attributes: [],
  ...extra,
});

let results: Opp[] = [];

function mockFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/opportunity-finder/config")) {
      return jsonResponse({ congregations: [], ministries: [], genders: [], attributeTypes: [] });
    }
    if (url.includes("/api/embed/opportunity-finder")) return jsonResponse({ opportunities: results });
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const cards = (el: HTMLElement) => Array.from(shadow(el).querySelectorAll<HTMLElement>(".nw-of-card"));

async function mount(attrs = ""): Promise<HTMLElement> {
  document.body.innerHTML = `<next-opportunity-finder api-host="${HOST}" ${attrs}></next-opportunity-finder>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(cards(el).length).toBe(results.length));
  return el;
}

describe("<next-opportunity-finder>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("opportunity-finder"),
      refresh: () => getAuthSession(HOST).refreshToken("opportunity-finder"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    results = [opp(3), opp(5)];
    mockFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("reconfigure (C39)", () => {
    it("searches again when a filter attribute changes after first paint", async () => {
      const fn = vi.mocked(fetch);
      const el = await mount();
      el.setAttribute("keyword", "greeter");
      await vi.waitFor(() =>
        expect(fn.mock.calls.some(([u]) => String(u).includes("opportunity-finder?keyword=greeter"))).toBe(true)
      );
    });
  });

  describe("when (C25)", () => {
    const sub = (el: HTMLElement, i: number) =>
      cards(el)[i].querySelector(".nw-of-card-sub")?.textContent ?? "";

    it("shows a dated one-time opportunity's date, not a pluralised weekday", async () => {
      results = [opp(5, { meetingDay: "Friday", meetingTime: "2027-12-31T00:00:00" }), opp(6)];
      const el = await mount();
      expect(sub(el, 0)).toBe("Main Congregation · Fri, Dec 31, 2027");
      expect(sub(el, 0)).not.toMatch(/Fridays/);
      expect(sub(el, 1)).toBe("Main Congregation · Ongoing");
    });

    it("keeps a real start time", async () => {
      results = [opp(5, { meetingDay: "Friday", meetingTime: "2027-12-31T18:30:00" })];
      const el = await mount();
      expect(sub(el, 0)).toBe("Main Congregation · Fri, Dec 31, 2027, 6:30 PM");
    });

    it("localises the date and a dateless weekday", async () => {
      results = [
        opp(5, { meetingDay: "Friday", meetingTime: "2027-12-31T00:00:00" }),
        opp(7, { meetingDay: "Friday", meetingTime: null }),
      ];
      document.documentElement.setAttribute("lang", "es");
      const el = await mount();
      await vi.waitFor(() => expect(sub(el, 1)).toBe("Main Congregation · Cada viernes"));
      expect(sub(el, 0)).toMatch(/2027/);
      expect(sub(el, 0)).not.toMatch(/Friday/);
    });

    it("renders RibbonText in the badge slot", async () => {
      results = [opp(5, { ribbonText: "1 hour" })];
      const el = await mount();
      expect(shadow(el).querySelector(".nw-of-badge")?.textContent).toBe("1 hour");
    });
  });

  describe("cards (C22)", () => {
    it("renders each card as a real link to the detail page", async () => {
      const el = await mount('target-url="https://church.example/serve/details" id-parameter-name="oid"');
      const [first] = cards(el);
      expect(first.tagName).toBe("A");
      expect(first.getAttribute("href")).toBe("https://church.example/serve/details?oid=3");
      expect(first).not.toHaveAttribute("role");
      expect(first).not.toHaveAttribute("tabindex");
    });

    it("emits opportunitySelected without navigating by script", async () => {
      const el = await mount('target-url="/serve/details"');
      const selected = vi.fn();
      el.addEventListener("opportunitySelected", (e) => selected((e as CustomEvent).detail));
      const card = cards(el)[1];
      // Stop jsdom's own navigation; the point is that the widget does not
      // assign window.location itself — the anchor is the navigation.
      card.addEventListener("click", (e) => e.preventDefault());
      card.click();
      expect(selected).toHaveBeenCalledWith({ opportunityId: 5 });
    });

    it("renders a non-interactive article with no target-url", async () => {
      const el = await mount();
      const [first] = cards(el);
      expect(first.tagName).toBe("DIV");
      expect(first).toHaveAttribute("role", "article");
      expect(first).not.toHaveAttribute("tabindex");
      expect(shadow(el).querySelector(".nw-of-card-cta")).toBeNull();
    });
  });
});
