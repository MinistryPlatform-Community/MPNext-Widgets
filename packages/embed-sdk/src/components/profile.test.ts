/**
 * Tests for `<next-profile>`.
 *
 * C51: typing non-numeric text into a phone field used to be rewritten to ""
 * on every keystroke, skip the `v && …` validator, and save `null` — silently
 * deleting the stored number. The load-bearing assertions here:
 *   - typed text survives in the field and produces a visible error;
 *   - no PUT is sent while a phone is invalid;
 *   - an unchanged phone is never in the payload (so it can never be nulled);
 *   - only a field the visitor emptied on purpose sends `null`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import { normalizePhone, phoneChanged } from "./profile";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(sub = "user-guid"): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp: Math.floor(Date.now() / 1000) + 300 })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob(),
  } as unknown as Response;
}

const PROFILE = {
  Contact_ID: 98,
  Contact_GUID: "g",
  Prefix_ID: null,
  First_Name: "Chris",
  Middle_Name: null,
  Last_Name: "Kehayias",
  Nickname: null,
  Suffix_ID: null,
  Gender_ID: null,
  Date_of_Birth: null,
  Marital_Status_ID: null,
  Mobile_Phone: "321-794-1376",
  Company_Phone: "(321) 555-0100 x12", // a stored format this form would not accept
  Email_Address: "chris@example.org",
  Do_Not_Text: false,
  Bulk_Email_Opt_Out: false,
  Prefix: null,
  Suffix: null,
  Gender: null,
  Marital_Status: null,
};
const LOOKUPS = { prefixes: [], suffixes: [], genders: [], maritalStatuses: [] };

let puts: Record<string, unknown>[] = [];

function mockFetch(profileStatus = 200) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: "dual" });
    if (url.includes("/api/embed/session")) return jsonResponse({ token: makeJwt() });
    if (url.includes("/api/embed/profile/photo")) return jsonResponse({}, 404);
    if (url.includes("/api/embed/profile")) {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return jsonResponse({ success: true });
      }
      if (profileStatus !== 200) return jsonResponse({ error: "auth_required" }, profileStatus);
      return jsonResponse({ profile: { ...PROFILE }, lookups: LOOKUPS });
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;

async function mountSettled(): Promise<HTMLElement> {
  document.body.innerHTML = `<next-profile api-host="${HOST}"></next-profile>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector("#profile-form")).not.toBeNull());
  return el;
}

function input(el: HTMLElement, id: string): HTMLInputElement {
  return shadow(el).querySelector(`#${id}`) as HTMLInputElement;
}

function type(field: HTMLInputElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("blur"));
}

function submit(el: HTMLElement) {
  const form = shadow(el).querySelector("#profile-form") as HTMLFormElement;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("<next-profile> phone fields (C51)", () => {
  beforeEach(async () => {
    puts = [];
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("profile"),
      refresh: () => getAuthSession(HOST).refreshToken("profile"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch();
    await import("./profile");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("typing letters leaves the text in the field, shows an error, and sends nothing", async () => {
    const el = await mountSettled();
    const mobile = input(el, "Mobile_Phone");
    type(mobile, "ZZTEST-abc");
    expect(mobile.value).toBe("ZZTEST-abc");

    submit(el);
    await Promise.resolve();
    expect(mobile.getAttribute("aria-invalid")).toBe("true");
    expect(shadow(el).querySelector('[data-mpx-error-for="Mobile_Phone"]')?.textContent).toBeTruthy();
    expect(puts).toHaveLength(0);
  });

  it("an unchanged phone is never in the payload, so the stored number cannot be nulled", async () => {
    const el = await mountSettled();
    type(input(el, "First_Name"), "Christopher");
    submit(el);
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].First_Name).toBe("Christopher");
    expect("Mobile_Phone" in puts[0]).toBe(false);
    // A stored number in a format the form would reject must not block the save.
    expect("Company_Phone" in puts[0]).toBe(false);
  });

  it("a pasted international number is normalised on blur and sent", async () => {
    const el = await mountSettled();
    const mobile = input(el, "Mobile_Phone");
    type(mobile, "+1 (407) 555-0199");
    expect(mobile.value).toBe("407-555-0199");
    submit(el);
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].Mobile_Phone).toBe("407-555-0199");
  });

  it("only a field the visitor emptied on purpose sends null", async () => {
    const el = await mountSettled();
    type(input(el, "Mobile_Phone"), "");
    submit(el);
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].Mobile_Phone).toBeNull();
    expect("Company_Phone" in puts[0]).toBe(false);
  });
});

describe("normalizePhone / phoneChanged", () => {
  it("formats 10 digits, or 11 with a leading 1", () => {
    expect(normalizePhone("3217941376")).toBe("321-794-1376");
    expect(normalizePhone("(321) 794.1376")).toBe("321-794-1376");
    expect(normalizePhone("+1 321 794 1376")).toBe("321-794-1376");
  });

  it("never destroys input it cannot format", () => {
    expect(normalizePhone("ZZTEST-abc")).toBe("ZZTEST-abc");
    expect(normalizePhone("+1 (321) 794-1376 x204")).toBe("+1 (321) 794-1376 x204");
    expect(normalizePhone("12345")).toBe("12345");
    expect(normalizePhone("")).toBe("");
  });

  it("compares trimmed values and treats null as empty", () => {
    expect(phoneChanged("321-794-1376 ", "321-794-1376")).toBe(false);
    expect(phoneChanged("", null)).toBe(false);
    expect(phoneChanged("", "321-794-1376")).toBe(true);
  });
});
