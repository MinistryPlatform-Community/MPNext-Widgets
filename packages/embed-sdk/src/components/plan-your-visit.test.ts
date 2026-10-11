/**
 * Tests for `<next-plan-your-visit>`.
 *
 * Load-bearing:
 *   - C24: a real phone number must submit. MP's display mask `xxx-xxx-xxxx`
 *     was once rendered as an HTML `pattern`, which matched only that literal
 *     text, so no visitor could ever complete the form.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import { isPlausiblePhone } from "./plan-your-visit";

const HOST = "https://widgets.example.com";
const PAGE = "/visit";

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

const CONFIG = {
  congregations: [{ id: 1, name: "Main Campus" }],
  genders: [
    { id: 1, name: "Male" },
    { id: 2, name: "Female" },
  ],
  countries: [{ code: "US", name: "United States of America" }],
  phoneMask: "xxx-xxx-xxxx",
};
const AGE_GROUPS = [
  { id: 10, value: "Nursery", ageInMonthsToPromote: 24 },
  { id: 11, value: "Kindergarten", ageInMonthsToPromote: 72 },
];

function mockFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "legacy" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/plan-your-visit/verify")) {
      return jsonResponse({ success: true, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" });
    }
    if (url.includes("/plan-your-visit/config")) return jsonResponse(CONFIG);
    if (url.includes("/plan-your-visit/age-groups")) return jsonResponse({ ageOrGradeGroups: AGE_GROUPS });
    if (url.includes("/plan-your-visit/register")) return jsonResponse({ success: true });
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function posted(fn: ReturnType<typeof mockFetch>, fragment: string) {
  return fn.mock.calls
    .filter(([input, init]) => String(input).includes(fragment) && (init as RequestInit | undefined)?.body)
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const input = (el: HTMLElement, name: string) =>
  shadow(el).querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
const detailsForm = (el: HTMLElement) => shadow(el).querySelector<HTMLFormElement>("#pyv-details-form");

function set(el: HTMLElement, name: string, value: string) {
  const c = input(el, name);
  c.value = value;
  c.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mountDetails(attrs = ""): Promise<HTMLElement> {
  window.history.replaceState(null, "", `${PAGE}?mpp-verify-id=tok123`);
  document.body.innerHTML = `<next-plan-your-visit api-host="${HOST}" ${attrs}></next-plan-your-visit>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(detailsForm(el)).not.toBeNull());
  return el;
}

function fillRequired(el: HTMLElement, phone: string) {
  set(el, "congregationId", "1");
  set(el, "whenCanWeExpectYou", "This Sunday");
  set(el, "headMobilePhone", phone);
}

function submit(el: HTMLElement) {
  detailsForm(el)!.dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("isPlausiblePhone", () => {
  it.each(["321-555-0100", "3215550100", "(321) 555-0100", "+1 321 555 0100", "321.555.0100"])(
    "accepts %s",
    (v) => expect(isPlausiblePhone(v)).toBe(true)
  );
  it.each(["abc", "xxx-xxx-xxxx", "123", "1234567890123456", "321-555-0100 ext"])(
    "rejects %s",
    (v) => expect(isPlausiblePhone(v)).toBe(false)
  );
});

describe("<next-plan-your-visit>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("plan-your-visit"),
      refresh: () => getAuthSession(HOST).refreshToken("plan-your-visit"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // jsdom has no layout, so no scrollIntoView; the widget scrolls messages into view.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", PAGE);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("phone (C24)", () => {
    it("renders the phone as a labelled tel input with the mask as placeholder, never a pattern", async () => {
      mockFetch();
      const el = await mountDetails();
      const phone = input(el, "headMobilePhone") as HTMLInputElement;
      expect(phone.type).toBe("tel");
      expect(phone).not.toHaveAttribute("pattern");
      expect(phone).toHaveAttribute("placeholder", "xxx-xxx-xxxx");
      expect(phone).toHaveAttribute("autocomplete", "tel");
      expect(phone.labels?.length).toBe(1);
      expect(input(el, "spousePhone")).not.toHaveAttribute("pattern");
    });

    it.each(["321-555-0100", "3215550100", "(321) 555-0100"])(
      "submits with a real number: %s",
      async (phone) => {
        const fetchFn = mockFetch();
        const el = await mountDetails();
        fillRequired(el, phone);
        submit(el);
        await vi.waitFor(() => expect(posted(fetchFn, "/plan-your-visit/register")).toHaveLength(1));
        const body = posted(fetchFn, "/plan-your-visit/register")[0];
        expect((body.headOfHousehold as Record<string, unknown>).mobilePhoneNumber).toBe(phone);
      }
    );

    it("blocks a non-number and never reaches the network", async () => {
      const fetchFn = mockFetch();
      const el = await mountDetails();
      fillRequired(el, "abc");
      submit(el);
      await vi.waitFor(() =>
        expect(shadow(el).querySelector(".mpx-field-error")?.textContent).toBe("Enter a valid phone number.")
      );
      expect(posted(fetchFn, "/plan-your-visit/register")).toHaveLength(0);
    });

    it("lets an empty optional spouse phone through but checks a filled one", async () => {
      const fetchFn = mockFetch();
      const el = await mountDetails();
      fillRequired(el, "321-555-0100");
      set(el, "spousePhone", "12");
      submit(el);
      await vi.waitFor(() => expect(shadow(el).querySelector(".mpx-field-error")).not.toBeNull());
      expect(posted(fetchFn, "/plan-your-visit/register")).toHaveLength(0);

      set(el, "spousePhone", "");
      submit(el);
      await vi.waitFor(() => expect(posted(fetchFn, "/plan-your-visit/register")).toHaveLength(1));
    });
  });
});
