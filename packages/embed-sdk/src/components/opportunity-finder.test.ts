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
