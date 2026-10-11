/**
 * Tests for `<next-my-household>`.
 *
 *   - C79: the attribute is `hide-add-household-member`; the legacy
 *     `hideaddhouseholdmember` spelling is still read (one release) and warns.
 *   - C39: a late attribute set takes effect without a reload of the page —
 *     the "create, insert, then configure" shape of CMS hosts.
 *   - C57 (keep ours): a member birthday renders month and day, no year.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./my-household";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub: "user-guid", exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    contactId: 98,
    firstName: "Chris",
    middleName: null,
    lastName: "Kehayias",
    displayName: "Kehayias, Chris",
    nickName: null,
    prefixId: null,
    suffixId: null,
    suffixName: null,
    emailAddress: null,
    mobilePhoneNumber: null,
    workPhoneNumber: null,
    homePhoneNumber: null,
    householdId: 85,
    householdPositionId: 1,
    householdPositionName: "Head of Household",
    dateOfBirth: "1980-03-04T00:00:00",
    genderId: null,
    maritalStatusId: null,
    bulkEmailOptOut: false,
    emailUnlisted: false,
    doNotText: false,
    mobilePhoneUnlisted: false,
    removeFromDirectory: false,
    congregationId: 1,
    imageUrl: null,
    ...overrides,
  };
}

const HOUSEHOLD = {
  household: {
    householdId: 85,
    name: "Kehayias",
    homePhone: null,
    congregationId: 1,
    congregationName: "Main",
    address: null,
    alternativeAddress: null,
    alternativeAddressStart: null,
    alternativeAddressEnd: null,
    alternativeAddressRepeatAnnually: false,
    homePhoneUnlisted: false,
    homeAddressUnlisted: false,
  },
  members: [member()],
  isHeadOfHousehold: true,
  lookups: {
    prefixes: [],
    suffixes: [],
    genders: [],
    maritalStatuses: [],
    householdPositions: [],
    congregations: [],
    countries: [],
  },
  googleMapsApiKey: null,
};

function mockFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "dual" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/api/embed/household")) return jsonResponse(HOUSEHOLD);
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const addButton = (el: HTMLElement) => shadow(el).querySelector('[data-action="add-member"]');

async function mountSettled(attrs = ""): Promise<HTMLElement> {
  document.body.innerHTML = `<next-my-household api-host="${HOST}" ${attrs}></next-my-household>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector('[data-action="edit-household"]')).not.toBeNull());
  return el;
}

describe("<next-my-household>", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("my-household"),
      refresh: () => getAuthSession(HOST).refreshToken("my-household"),
    };
    window.__nextSDKReady = Promise.resolve();
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows Add Member to a head of household by default", async () => {
    const el = await mountSettled();
    expect(addButton(el)).not.toBeNull();
  });

  it("hides it with hide-add-household-member (C79)", async () => {
    const el = await mountSettled('hide-add-household-member="true"');
    expect(addButton(el)).toBeNull();
  });

  it("still reads the legacy spelling, with a deprecation warning", async () => {
    const el = await mountSettled('hideaddhouseholdmember="true"');
    expect(addButton(el)).toBeNull();
    expect(warn.mock.calls.flat().join(" ")).toContain("hide-add-household-member");
  });

  it("applies an attribute set after the first paint, without re-fetching (C39)", async () => {
    const fetchFn = mockFetch();
    const el = await mountSettled();
    const loads = () => fetchFn.mock.calls.filter(([u]) => String(u).includes("/api/embed/household")).length;
    const before = loads();

    el.setAttribute("hide-add-household-member", "true");
    expect(addButton(el)).toBeNull();
    el.setAttribute("hide-add-household-member", "false");
    expect(addButton(el)).not.toBeNull();
    expect(loads()).toBe(before);
  });

  it("renders a member birthday as month and day, never the year (C57, kept)", async () => {
    const el = await mountSettled();
    const text = shadow(el).textContent ?? "";
    expect(text).toMatch(/Mar(ch)?\s+4/);
    expect(text).not.toContain("1980");
  });
});
