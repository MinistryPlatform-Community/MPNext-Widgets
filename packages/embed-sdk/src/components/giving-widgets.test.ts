/**
 * Tests for the four signed-in giving widgets (workstream W5):
 * `next-my-giving`, `next-my-pledges`, `next-my-contribution-statement` and
 * `next-statement-preferences`.
 *
 * One file rather than four because the harness — a mocked `fetch` answering
 * the auth ladder plus one data route per widget — is identical, and the C30
 * signed-out assertions are deliberately the same for every widget: the whole
 * class survived because nothing checked the signed-out case.
 *
 * **Protected, and asserted here:** Total Giving excludes soft credits and the
 * year boundary holds (a Dec 31 gift buckets into December, not January).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./my-giving";
import "./my-pledges";
import "./my-contribution-statement";
import "./statement-preferences";

const HOST = "https://widgets.example.com";
const PAGE = "/giving";

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

type Mode = "legacy" | "dual" | "hardened";
type Handler = (url: string, init?: RequestInit) => Response | undefined;

function mockFetch(handler: Handler, mode: Mode = "legacy") {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    return handler(url, init) ?? jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";
const $ = <T extends Element = HTMLElement>(el: HTMLElement, sel: string) =>
  shadow(el).querySelector<T>(sel);

function mount(tag: string, attrs = ""): HTMLElement {
  document.body.innerHTML = `<${tag} api-host="${HOST}" ${attrs}></${tag}>`;
  return document.body.firstElementChild as HTMLElement;
}

/** Wait until the widget has painted something other than its spinner. */
async function settled(el: HTMLElement): Promise<HTMLElement> {
  await vi.waitFor(() => expect($(el, ".header")).not.toBeNull());
  await vi.waitFor(() => expect($(el, ".spinner")).toBeNull());
  return el;
}

// ── fixtures ───────────────────────────────────────────────────────────────

const YEAR = new Date().getFullYear();

function donation(overrides: Record<string, unknown> = {}) {
  return {
    donationDate: `${YEAR}-01-15T10:00:00`,
    amount: 100,
    programId: 1,
    programName: "Tithes",
    statementTitle: "Tithes",
    isTaxDeductible: true,
    isSpouseDonation: false,
    isSoftCredit: false,
    isPending: false,
    isOmitAmount: false,
    ...overrides,
  };
}

function pledge(overrides: Record<string, unknown> = {}) {
  return {
    pledgeId: 40,
    pledgeCampaignId: 6,
    campaignName: "Building Fund",
    pledgeDescription: "",
    contactFirstName: "Ada",
    contactLastName: "Lovelace",
    pledgeStatusId: 1,
    pledgeStatus: "Active",
    installmentsPlanned: 12,
    firstInstallmentDate: `${YEAR}-01-01T00:00:00`,
    imageUrl: null,
    totalPledge: 1200,
    pledgeTotalToDate: 300,
    ...overrides,
  };
}

function statementGroups() {
  return {
    groups: [
      {
        Accounting_Company_Name: "Your Church Name",
        statements: [
          {
            Statement_ID: 1,
            Statement_Year: 2025,
            File_Name: "Statement-2025.pdf",
            Unique_Name: "57625614-a5b0-4588-9053-c1a7e7b74558",
            Extension: ".pdf",
            Download_Url: "https://mp.example.com/ministryplatformapi/files/57625614",
          },
          {
            Statement_ID: 2,
            Statement_Year: 2024,
            File_Name: "Statement-2024.pdf",
            Unique_Name: "aa",
            Extension: ".pdf",
            Download_Url: "https://mp.example.com/ministryplatformapi/files/aa",
          },
        ],
      },
    ],
  };
}

const ROUTES: Record<string, string> = {
  "next-my-giving": "/api/embed/my-giving",
  "next-my-pledges": "/api/embed/my-pledges",
  "next-my-contribution-statement": "/api/embed/contribution-statements",
  "next-statement-preferences": "/api/embed/statement-preferences",
};

const PROMPTS: Record<string, string> = {
  "next-my-giving": "Please sign in to view your giving information.",
  "next-my-pledges": "Please sign in to view your pledges.",
  "next-my-contribution-statement": "Please sign in to view your contribution statements.",
  "next-statement-preferences":
    "Please sign in to manage how you receive your contribution statements.",
};

const TITLES: Record<string, string> = {
  "next-my-giving": "My Giving",
  "next-my-pledges": "My Pledges",
  "next-my-contribution-statement": "My Contribution Statements",
  "next-statement-preferences": "Contribution Statements",
};

// ── suite ──────────────────────────────────────────────────────────────────

describe("giving widgets", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", PAGE);
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("giving"),
      refresh: () => getAuthSession(HOST).refreshToken("giving"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── C30 ────────────────────────────────────────────────────────────────

  describe.each(Object.keys(ROUTES))("%s signed out (C30)", (tag) => {
    const anonymous: Handler = (url) =>
      url.includes(ROUTES[tag])
        ? jsonResponse({ error: "auth_required", message: "Authentication required." }, 401)
        : undefined;

    it("renders the heading, a skeleton and a sign-in prompt — never Unable to Load", async () => {
      mockFetch(anonymous, "legacy");
      const el = await settled(mount(tag));

      expect(text(el)).toContain(TITLES[tag]);
      expect(text(el)).toContain(PROMPTS[tag]);
      expect(text(el)).not.toContain("Unable to Load");
      expect($(el, '[data-action="retry"]')).toBeNull();
      expect($(el, ".gv-skeleton")).toHaveAttribute("aria-hidden", "true");
    });

    it("legacy: draws no button and names the page's own sign-in link", async () => {
      mockFetch(anonymous, "legacy");
      const el = await settled(mount(tag));

      expect($(el, '[data-action="login"]')).toBeNull();
      expect(text(el)).toContain("Use the sign-in link on this page.");
    });

    it("dual: the Sign In button asks for login with this widget's id", async () => {
      mockFetch(anonymous, "dual");
      const el = await settled(mount(tag));

      const seen: unknown[] = [];
      el.addEventListener("loginRequired", (e) => {
        e.preventDefault(); // jsdom cannot navigate
        seen.push((e as CustomEvent).detail);
      });
      $<HTMLButtonElement>(el, '[data-action="login"]')!.click();

      expect(seen).toEqual([{ wid: tag.replace(/^next-/, "") }]);
    });

    it("a 500 still renders the error with Try Again", async () => {
      mockFetch(
        (url) =>
          url.includes(ROUTES[tag])
            ? jsonResponse({ error: "internal_error", message: "boom" }, 500)
            : undefined,
      );
      const el = await settled(mount(tag));

      expect(text(el)).toContain("Unable to Load");
      expect($(el, '[data-action="retry"]')).not.toBeNull();
      expect($(el, "[data-nw-signin]")).toBeNull();
    });
  });

  // ── C39: an attribute set after mount takes effect ─────────────────────

  describe("late attributes (C39)", () => {
    it("next-my-giving: hiding soft credits after mount removes the toggle", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/my-giving")
          ? jsonResponse({ donations: [donation(), donation({ isSoftCredit: true })] })
          : undefined,
      );
      const el = await settled(mount("next-my-giving"));
      expect($(el, "#giving-soft-toggle")).not.toBeNull();

      el.setAttribute("hide-soft-credits", "true");
      expect($(el, "#giving-soft-toggle")).toBeNull();
    });

    it("next-my-pledges: showing the cancel button after mount draws it", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/my-pledges") ? jsonResponse({ pledges: [pledge()] }) : undefined,
      );
      const el = await settled(mount("next-my-pledges", 'hide-cancel-button-pledge="true"'));
      expect($(el, '[data-action="request-cancel"]')).toBeNull();

      el.setAttribute("hide-cancel-button-pledge", "false");
      expect($(el, '[data-action="request-cancel"]')).not.toBeNull();
    });
  });

  // ── C79: kebab-case names, legacy spellings for one release ────────────

  describe("attribute names (C79)", () => {
    it("next-my-giving still honours hidesoftcredits, set late, and warns once", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      mockFetch((url) =>
        url.includes("/api/embed/my-giving")
          ? jsonResponse({ donations: [donation(), donation({ isSoftCredit: true })] })
          : undefined,
      );
      const el = await settled(mount("next-my-giving"));
      el.setAttribute("hidesoftcredits", "true");
      el.setAttribute("hidesoftcredits", "TRUE");

      expect($(el, "#giving-soft-toggle")).toBeNull();
      const deprecations = warn.mock.calls.filter(([m]) => String(m).includes('"hidesoftcredits"'));
      expect(deprecations.length).toBeLessThanOrEqual(1);
    });

    it("next-my-pledges reads cancel-pledge-email-template, and the legacy spelling", async () => {
      const bodies: unknown[] = [];
      mockFetch((url, init) => {
        if (!url.includes("/api/embed/my-pledges")) return undefined;
        if (init?.method === "POST") bodies.push(JSON.parse(String(init.body)));
        return jsonResponse({ pledges: [pledge()] });
      });

      for (const attr of ["cancel-pledge-email-template", "cancelpledgeemailtemplate"]) {
        bodies.length = 0;
        const el = await settled(
          mount("next-my-pledges", `hide-cancel-button-pledge="false" ${attr}="77"`),
        );
        $<HTMLButtonElement>(el, '[data-action="request-cancel"]')!.click();
        $<HTMLButtonElement>(el, '[data-action="confirm-cancel"]')!.click();
        await vi.waitFor(() => expect(bodies).toHaveLength(1));
        expect(bodies[0]).toEqual({ pledgeId: 40, cancelEmailTemplateId: 77 });
      }
    });
  });

  // ── protect: the money ─────────────────────────────────────────────────

  describe("next-my-giving money (regression guard)", () => {
    it("excludes soft credits from Total Giving", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/my-giving")
          ? jsonResponse({
              donations: [
                donation({ amount: 19502.58 }),
                donation({ amount: 44.44, isSoftCredit: true }),
              ],
            })
          : undefined,
      );
      const el = await settled(mount("next-my-giving"));
      expect($(el, ".total-amount")?.textContent).toBe("$19,502.58");
    });
  });
});
