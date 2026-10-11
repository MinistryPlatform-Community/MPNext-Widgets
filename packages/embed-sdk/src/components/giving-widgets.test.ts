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
import { __resetLocaleSession, getLocaleSession } from "../i18n";
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

  // ── C31: cancel is on by default ───────────────────────────────────────

  describe("next-my-pledges cancel default (C31)", () => {
    const pledges: Handler = (url) =>
      url.includes("/api/embed/my-pledges")
        ? jsonResponse({
            pledges: [pledge(), pledge({ pledgeId: 41, pledgeStatus: "Completed" })],
          })
        : undefined;

    it("a bare element shows Cancel Pledge on every Active pledge, and only those", async () => {
      mockFetch(pledges);
      const el = await settled(mount("next-my-pledges"));
      const buttons = shadow(el).querySelectorAll<HTMLElement>('[data-action="request-cancel"]');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].dataset.id).toBe("40");
    });

    it('hide-cancel-button-pledge="true" hides it, and so does the legacy spelling', async () => {
      for (const attr of ["hide-cancel-button-pledge", "hidecancelbuttonpledge"]) {
        mockFetch(pledges);
        const el = await settled(mount("next-my-pledges", `${attr}="true"`));
        expect($(el, '[data-action="request-cancel"]')).toBeNull();
      }
    });

    it("warns once when cancel is offered with no confirmation-email template", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      mockFetch(pledges);
      const el = await settled(mount("next-my-pledges"));
      $<HTMLButtonElement>(el, '[data-action="request-cancel"]')!.click();

      const hits = warn.mock.calls.filter(([m]) => String(m).includes("cancel-pledge-email-template"));
      expect(hits).toHaveLength(1);
    });

    it("cancel still runs end to end: confirm → POST → success message", async () => {
      const posts: unknown[] = [];
      mockFetch((url, init) => {
        if (!url.includes("/api/embed/my-pledges")) return undefined;
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return jsonResponse({ pledges: [pledge({ pledgeStatus: "Discontinued" })] });
        }
        return jsonResponse({ pledges: [pledge()] });
      });
      const el = await settled(mount("next-my-pledges", 'cancel-pledge-email-template="9"'));
      $<HTMLButtonElement>(el, '[data-action="request-cancel"]')!.click();
      $<HTMLButtonElement>(el, '[data-action="confirm-cancel"]')!.click();

      await vi.waitFor(() => expect(text(el)).toContain("Pledge canceled"));
      expect(posts).toEqual([{ pledgeId: 40, cancelEmailTemplateId: 9 }]);
      expect($(el, '[data-action="request-cancel"]')).toBeNull();
    });
  });

  // ── C35: a heading outline ─────────────────────────────────────────────

  describe("headings (C35)", () => {
    const loaded: Handler = (url) => {
      if (url.includes("/api/embed/my-giving")) return jsonResponse({ donations: [donation()] });
      if (url.includes("/api/embed/my-pledges")) return jsonResponse({ pledges: [pledge()] });
      if (url.includes("/api/embed/contribution-statements")) return jsonResponse(statementGroups());
      if (url.includes("/api/embed/statement-preferences")) {
        return jsonResponse({ donorId: 6, statementMethodId: 2, paperless: true });
      }
      return undefined;
    };
    const outline = (el: HTMLElement) =>
      [...shadow(el).querySelectorAll("h1,h2,h3,h4,h5,h6")].map(
        (h) => `${h.tagName}:${h.textContent?.trim()}`,
      );

    it.each(Object.keys(ROUTES))("%s titles itself with an h2 by default", async (tag) => {
      mockFetch(loaded);
      const el = await settled(mount(tag));
      expect(outline(el)[0]).toBe(`H2:${TITLES[tag]}`);
    });

    it("next-my-giving: title, then By Month / By Program / Donations one level down", async () => {
      mockFetch(loaded);
      const el = await settled(mount("next-my-giving", 'heading-level="3"'));
      expect(outline(el)).toEqual(["H3:My Giving", "H4:By Month", "H4:By Program", "H4:Donations"]);
    });

    it("next-my-pledges: campaign as h3, owner as h4, and a real progressbar", async () => {
      mockFetch(loaded);
      const el = await settled(mount("next-my-pledges"));
      expect(outline(el)).toEqual(["H2:My Pledges", "H3:Building Fund", "H4:Ada Lovelace"]);

      const bar = $(el, '[role="progressbar"]')!;
      expect(bar).toHaveAttribute("aria-valuenow", "25");
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
      expect(bar).toHaveAttribute("aria-valuetext", "$300.00 of $1,200.00 (25%)");
      expect(bar).toHaveAttribute("aria-label", "Building Fund");
    });

    it("next-my-contribution-statement: the accounting company is a sub-heading", async () => {
      mockFetch(loaded);
      const el = await settled(mount("next-my-contribution-statement"));
      expect(outline(el)).toEqual(["H2:My Contribution Statements", "H3:Your Church Name"]);
    });

    it("heading-level set after mount re-renders, and nonsense falls back to 2", async () => {
      mockFetch(loaded);
      const el = await settled(mount("next-statement-preferences"));
      el.setAttribute("heading-level", "1");
      expect(outline(el)).toEqual(["H1:Contribution Statements"]);
      el.setAttribute("heading-level", "nine");
      expect(outline(el)).toEqual(["H2:Contribution Statements"]);
    });

    it("the signed-out state keeps the heading", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/my-giving") ? jsonResponse({ error: "auth_required" }, 401) : undefined,
      );
      const el = await settled(mount("next-my-giving"));
      expect(outline(el)).toEqual(["H2:My Giving"]);
    });
  });

  // ── C33: the By Month chart says what each month was ───────────────────

  describe("next-my-giving By Month chart (C33)", () => {
    const gifts = [
      donation({ donationDate: `${YEAR}-01-15T10:00:00`, amount: 1250 }),
      donation({ donationDate: `${YEAR}-01-20T10:00:00`, amount: 250 }),
    ];
    const giving = (list = gifts): Handler => (url) =>
      url.includes("/api/embed/my-giving") ? jsonResponse({ donations: list }) : undefined;

    it("gives every month a tooltip and prints the value over a non-zero bar", async () => {
      mockFetch(giving());
      const el = await settled(mount("next-my-giving"));

      const months = shadow(el).querySelectorAll(".chart-svg .chart-month");
      expect(months).toHaveLength(12);
      expect(months[0].querySelector("title")?.textContent).toBe(`January ${YEAR}: $1,500.00`);
      expect(months[0].querySelector(".chart-value")?.textContent).toBe("$1.5K");
      expect(months[1].querySelector(".chart-value")).toBeNull();
    });

    it("carries a visually hidden table of month and amount, up to this month", async () => {
      mockFetch(giving());
      const el = await settled(mount("next-my-giving"));

      const rows = [...shadow(el).querySelectorAll("table.nw-sr-only tbody tr")];
      expect(rows).toHaveLength(new Date().getMonth() + 1);
      expect(rows[0].textContent).toBe(`January ${YEAR}$1,500.00`);
    });

    it("stays visible under a month filter", async () => {
      mockFetch(giving());
      const el = await settled(mount("next-my-giving"));
      const select = $<HTMLSelectElement>(el, "#giving-month-select")!;
      select.value = "1";
      select.dispatchEvent(new Event("change"));
      await settled(el);

      expect(shadow(el).querySelector(".chart-svg")).not.toBeNull();
      expect($(el, ".chart-month--selected title")?.textContent).toContain("January");
    });

    it("buckets a Dec 31 23:30 gift into December of that year (year boundary)", async () => {
      mockFetch(
        giving([donation({ donationDate: `${YEAR - 1}-12-31T23:30:00`, amount: 44.44 })]),
      );
      const el = await settled(mount("next-my-giving"));
      $<HTMLButtonElement>(el, '[data-action="prev-year"]')!.click();
      await settled(el);

      const months = shadow(el).querySelectorAll(".chart-svg .chart-month");
      expect(months[11].querySelector("title")?.textContent).toBe(`December ${YEAR - 1}: $44.44`);
      expect(months[0].querySelector("title")?.textContent).toBe(`January ${YEAR - 1}: $0.00`);
    });
  });

  // ── C37: month labels and the soft-credit note ─────────────────────────

  describe("next-my-giving copy (C37)", () => {
    const withSoft: Handler = (url) =>
      url.includes("/api/embed/my-giving")
        ? jsonResponse({
            donations: [donation({ amount: 100 }), donation({ amount: 44.44, isSoftCredit: true })],
          })
        : undefined;
    const NOTE = "excluded from your Total Giving";

    it("puts the year on every month option", async () => {
      mockFetch(withSoft);
      const el = await settled(mount("next-my-giving"));
      const options = [...shadow(el).querySelectorAll("#giving-month-select option")].map(
        (o) => o.textContent,
      );
      expect(options[0]).toBe(`All Months ${YEAR}`);
      expect(options[1]).toBe(`January ${YEAR}`);
      expect(options[12]).toBe(`December ${YEAR}`);
    });

    it("explains soft credits whenever they exist, ticked or not, and says they are excluded", async () => {
      mockFetch(withSoft);
      const el = await settled(mount("next-my-giving"));
      expect(text(el)).toContain(NOTE);
      expect($(el, ".total-amount")?.textContent).toBe("$100.00");

      const toggle = $<HTMLInputElement>(el, "#giving-soft-toggle")!;
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      expect(text(el)).toContain(NOTE);
      // Listed, and still excluded from the headline total.
      expect(shadow(el).querySelectorAll(".donation-row")).toHaveLength(2);
      expect($(el, ".total-amount")?.textContent).toBe("$100.00");
    });

    it("says nothing about soft credits when there are none, or they are hidden", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/my-giving") ? jsonResponse({ donations: [donation()] }) : undefined,
      );
      const el = await settled(mount("next-my-giving"));
      expect(text(el)).not.toContain(NOTE);

      mockFetch(withSoft);
      const hidden = await settled(mount("next-my-giving", 'hide-soft-credits="true"'));
      expect(text(hidden)).not.toContain(NOTE);
    });

    it("renders the Spanish month option with its year", async () => {
      document.documentElement.setAttribute("lang", "es");
      mockFetch(withSoft);
      const el = await settled(mount("next-my-giving"));
      const first = shadow(el).querySelectorAll("#giving-month-select option")[1];
      expect(first.textContent).toBe(`enero de ${YEAR}`);
    });
  });

  // ── C34: Save as PDF saves a file ──────────────────────────────────────

  describe("next-my-contribution-statement Save as PDF (C34)", () => {
    const PDF_URL = "https://mp.example.com/ministryplatformapi/files/57625614";
    let clicked: { href: string; download: string }[];

    beforeEach(() => {
      clicked = [];
      (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:local/1");
      (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
      });
    });

    function statements(pdf: () => Response | Promise<Response>): Handler {
      return (url) => {
        if (url.includes("/api/embed/contribution-statements")) return jsonResponse(statementGroups());
        if (url === PDF_URL) return pdf() as Response;
        return undefined;
      };
    }
    const pdfResponse = () =>
      ({ ok: true, status: 200, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }) }) as unknown as Response;

    async function press(el: HTMLElement) {
      $<HTMLButtonElement>(el, '[data-action="download"]')!.click();
    }

    it("downloads the statement under its own file name, with no tab", async () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      mockFetch(statements(pdfResponse));
      const el = await settled(mount("next-my-contribution-statement"));
      const events: unknown[] = [];
      el.addEventListener("statementDownloaded", (e) => events.push((e as CustomEvent).detail));

      await press(el);
      await vi.waitFor(() => expect(clicked).toHaveLength(1));

      expect(clicked[0]).toEqual({ href: "blob:local/1", download: "Statement-2025.pdf" });
      expect(open).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(events).toHaveLength(1));
      expect(events[0]).toMatchObject({ statementId: 1, year: 2025, method: "download" });
    });

    it("falls back to a new tab when MP's file host refuses the cross-origin read", async () => {
      const tab = { opener: window } as unknown as Window;
      const open = vi.spyOn(window, "open").mockReturnValue(tab);
      mockFetch(statements(() => Promise.reject(new TypeError("Failed to fetch"))));
      const el = await settled(mount("next-my-contribution-statement"));

      await press(el);
      await vi.waitFor(() => expect(open).toHaveBeenCalledWith(PDF_URL, "_blank"));
      expect(tab.opener).toBeNull();
      expect($(el, ".download-fallback")).toBeNull();
    });

    it("offers a real link when the fallback tab is blocked too", async () => {
      vi.spyOn(window, "open").mockReturnValue(null);
      mockFetch(statements(() => Promise.reject(new TypeError("Failed to fetch"))));
      const el = await settled(mount("next-my-contribution-statement"));

      await press(el);
      await vi.waitFor(() => expect($(el, ".download-fallback a")).not.toBeNull());
      const link = $(el, ".download-fallback a")!;
      expect(link).toHaveAttribute("href", PDF_URL);
      expect(link).toHaveAttribute("rel", "noopener");
      expect(text(el)).toContain("Your browser blocked the statement from opening.");
    });
  });

  // ── C38: Go Paperless inside the statement widget ──────────────────────

  describe("next-my-contribution-statement show-paperless-toggle (C38)", () => {
    const both = (method = 2): Handler => (url) => {
      if (url.includes("/api/embed/contribution-statements")) return jsonResponse(statementGroups());
      if (url.includes("/api/embed/statement-preferences")) {
        return jsonResponse({ donorId: 6, statementMethodId: method, paperless: method === 2 });
      }
      return undefined;
    };
    const prefs = (el: HTMLElement) =>
      shadow(el).querySelector<HTMLElement>("next-statement-preferences");

    it("is off by default — nothing changes for a host that does not ask", async () => {
      const fn = mockFetch(both());
      const el = await settled(mount("next-my-contribution-statement"));
      expect(prefs(el)).toBeNull();
      expect(fn.mock.calls.some(([u]) => String(u).includes("statement-preferences"))).toBe(false);
    });

    it("embeds next-statement-preferences, which reads Statement_Method_ID correctly", async () => {
      mockFetch(both(1)); // 1 = Postal Mail: legacy showed this as paperless; we must not
      const el = await settled(
        mount("next-my-contribution-statement", 'show-paperless-toggle="true" heading-level="3"'),
      );
      const inner = prefs(el)!;
      expect(inner).not.toBeNull();
      expect(inner.closest(".nw-extras")).not.toHaveAttribute("hidden");
      await settled(inner);
      expect(inner.shadowRoot!.querySelector<HTMLInputElement>("#paperless-toggle")!.checked).toBe(false);
      expect(inner).toHaveAttribute("heading-level", "3");
      expect(inner).toHaveAttribute("api-host", HOST);
    });

    it("survives a year click without being rebuilt", async () => {
      mockFetch(both());
      const el = await settled(mount("next-my-contribution-statement", 'show-paperless-toggle="true"'));
      const before = prefs(el);
      $<HTMLButtonElement>(el, '[data-year="2024"]')!.click();
      expect(prefs(el)).toBe(before);
    });

    it("can be switched on and off after mount", async () => {
      mockFetch(both());
      const el = await settled(mount("next-my-contribution-statement"));
      el.setAttribute("show-paperless-toggle", "true");
      expect(prefs(el)).not.toBeNull();
      el.setAttribute("show-paperless-toggle", "false");
      expect(prefs(el)).toBeNull();
    });

    it("is hidden while signed out, so the visitor sees one prompt", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/contribution-statements") || url.includes("/statement-preferences")
          ? jsonResponse({ error: "auth_required" }, 401)
          : undefined,
      );
      const el = await settled(mount("next-my-contribution-statement", 'show-paperless-toggle="true"'));
      expect($(el, ".nw-extras")).toHaveAttribute("hidden");
    });
  });

  // ── C62: link across to My Giving ──────────────────────────────────────

  describe("next-my-contribution-statement my-giving-url (C62)", () => {
    const loaded: Handler = (url) =>
      url.includes("/api/embed/contribution-statements") ? jsonResponse(statementGroups()) : undefined;

    it("renders nothing when the attribute is absent", async () => {
      mockFetch(loaded);
      const el = await settled(mount("next-my-contribution-statement"));
      expect($(el, ".my-giving-link")).toBeNull();
    });

    it("renders a link to the My Giving page when set", async () => {
      mockFetch(loaded);
      const el = await settled(mount("next-my-contribution-statement", 'my-giving-url="/giving/history"'));
      const link = $(el, ".my-giving-link")!;
      expect(link).toHaveAttribute("href", "/giving/history");
      expect(link.textContent).toBe("See my giving →");
    });

    it("refuses a javascript: URL", async () => {
      mockFetch(loaded);
      const el = await settled(
        mount("next-my-contribution-statement", 'my-giving-url="javascript:alert(1)"'),
      );
      expect($(el, ".my-giving-link")).toBeNull();
    });

    it("also shows on the empty state, and when set after mount", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/contribution-statements") ? jsonResponse({ groups: [] }) : undefined,
      );
      const el = await settled(mount("next-my-contribution-statement"));
      el.setAttribute("my-giving-url", "https://church.example.org/giving");
      expect($(el, ".my-giving-link")).toHaveAttribute("href", "https://church.example.org/giving");
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

  // ── A page-wide language change must not leave the buttons dead ─────────
  //
  // The base class re-renders through `render()` alone on a locale change.
  // These widgets used to bind their listeners in a separate call after each
  // internal render, so the switch repainted the markup with nothing bound.

  describe("locale switch keeps listeners bound", () => {
    it("next-my-giving: the previous-year button still loads after a switch to Spanish", async () => {
      const fetchMock = mockFetch((url) =>
        url.includes("/api/embed/my-giving") ? jsonResponse({ donations: [donation()] }) : undefined,
      );
      const el = await settled(mount("next-my-giving"));
      await getLocaleSession().setLocale("es");
      await vi.waitFor(() => expect(el).toHaveAttribute("lang", "es"));

      const calls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/embed/my-giving")).length;
      const before = calls();
      $<HTMLButtonElement>(el, '[data-action="prev-year"]')!.click();
      await vi.waitFor(() => expect(calls()).toBe(before + 1));
    });

    it("next-my-pledges: Cancel Pledge still opens its confirmation after a switch", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/my-pledges") ? jsonResponse({ pledges: [pledge()] }) : undefined,
      );
      const el = await settled(mount("next-my-pledges", 'cancel-pledge-email-template="9"'));
      await getLocaleSession().setLocale("es");
      await vi.waitFor(() => expect(el).toHaveAttribute("lang", "es"));

      $<HTMLButtonElement>(el, '[data-action="request-cancel"]')!.click();
      expect($(el, '[data-action="confirm-cancel"]')).not.toBeNull();
    });

    it("next-my-contribution-statement: a year button still selects after a switch", async () => {
      mockFetch((url) =>
        url.includes("/api/embed/contribution-statements") ? jsonResponse(statementGroups()) : undefined,
      );
      const el = await settled(mount("next-my-contribution-statement"));
      await getLocaleSession().setLocale("es");
      await vi.waitFor(() => expect(el).toHaveAttribute("lang", "es"));

      $<HTMLButtonElement>(el, '[data-year="2024"]')!.click();
      expect($(el, '[data-year="2024"]')).toHaveClass("year-btn--active");
    });

    it("does not double-bind: one click after a switch fires one request", async () => {
      const fetchMock = mockFetch((url) =>
        url.includes("/api/embed/my-giving") ? jsonResponse({ donations: [donation()] }) : undefined,
      );
      const el = await settled(mount("next-my-giving"));
      await getLocaleSession().setLocale("es");
      await vi.waitFor(() => expect(el).toHaveAttribute("lang", "es"));
      await getLocaleSession().setLocale("en");
      await vi.waitFor(() => expect(el).toHaveAttribute("lang", "en"));

      const calls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/embed/my-giving")).length;
      const before = calls();
      $<HTMLButtonElement>(el, '[data-action="prev-year"]')!.click();
      await vi.waitFor(() => expect(calls()).toBe(before + 1));
      await new Promise((r) => setTimeout(r, 10));
      expect(calls()).toBe(before + 1);
    });
  });
});
