/**
 * Tests for `<next-group-details>` (W3: C11, C14, C16, C17, C19, C39).
 *
 * The flows are driven through the real shadow DOM with `fetch` stubbed, so
 * what is asserted is what a visitor would see and what the server would
 * receive.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./group-details";

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
  } as unknown as Response;
}

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: 49,
    title: "Kehayias Home Group",
    description: "<p>Weekly study</p>",
    imageUrl: null,
    noImageText: "Small Group",
    location: "Main Congregation",
    meetingDay: "Monday",
    meetingTime: "18:30:00",
    startDate: "2020-01-01T00:00:00",
    isFull: false,
    meetsOnline: false,
    totalParticipantsCount: 2,
    targetSize: 20,
    latitude: null,
    longitude: null,
    address: null,
    lifeStage: null,
    groupFocus: "Bible & Book Study",
    meetingFrequency: "Every Other Week",
    userHasInquired: false,
    userHasSignedUp: false,
    contacts: [],
    ...overrides,
  };
}

const ME = {
  contactId: 98,
  firstName: "Christopher",
  lastName: "Kehayias",
  emailAddress: "chris@example.com",
  mobilePhoneNumber: "321-794-1376",
  householdId: 40,
  members: [
    { contactId: 98, displayName: "Kehayias, Chris", firstName: "Christopher", nickname: "Chris" },
    { contactId: 99, displayName: "Kehayias, Sarah", firstName: "Sarah", nickname: null },
  ],
};

interface Routes {
  me?: Response;
  detail?: Response;
  inquire?: Response;
  signup?: Response;
}

function mockFetch(routes: Routes = {}, opts: { signedIn?: boolean; mode?: string } = {}) {
  const signedIn = opts.signedIn ?? true;
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: opts.mode ?? "legacy" });
    if (url.includes("/api/embed/session")) {
      return jsonResponse({ token: makeJwt(signedIn ? "user-guid" : "public") });
    }
    if (url.includes("/group-details/me")) {
      return routes.me ?? (signedIn ? jsonResponse({ contact: ME }) : jsonResponse({ error: "auth_required" }, 401));
    }
    if (url.includes("/group-details/inquire")) return routes.inquire ?? jsonResponse({ success: true });
    if (url.includes("/group-details/signup")) return routes.signup ?? jsonResponse({ success: true });
    if (url.includes("/group-details/has-")) return jsonResponse({ hasInquired: false, hasSignedUp: false });
    if (url.includes("/group-details/")) return routes.detail ?? jsonResponse({ group: group() });
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";

function postsTo(fn: ReturnType<typeof mockFetch>, fragment: string): Record<string, unknown>[] {
  return fn.mock.calls
    .filter(([input]) => String(input).includes(fragment))
    .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")));
}

async function mountSettled(attrs = 'group-id="49"'): Promise<HTMLElement> {
  document.body.innerHTML = `<next-group-details api-host="${HOST}" ${attrs}></next-group-details>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector(".gd")).not.toBeNull());
  await vi.waitFor(() => expect(shadow(el).querySelector(".gd-spinner")).toBeNull());
  return el;
}

function select(el: HTMLElement, selector: string, value: string) {
  const s = shadow(el).querySelector<HTMLSelectElement>(selector)!;
  s.value = value;
  s.dispatchEvent(new Event("change"));
}

function fill(el: HTMLElement, formSel: string, values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    const input = shadow(el).querySelector<HTMLInputElement>(`${formSel} [name="${name}"]`)!;
    input.value = value;
  }
}

function clickTab(el: HTMLElement, tab: "inquire" | "signup") {
  shadow(el).querySelector<HTMLElement>(`[data-tab="${tab}"][role="tab"], .gd-tab[data-tab="${tab}"]`)!.click();
}

function submit(el: HTMLElement, tab: "inquire" | "signup") {
  shadow(el).querySelector<HTMLButtonElement>(`.gd-submit[data-tab="${tab}"]`)!.click();
}

describe("<next-group-details>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("group-details"),
      refresh: () => getAuthSession(HOST).refreshToken("group-details"),
    };
    window.__nextSDKReady = Promise.resolve();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("sign-up as Someone else (C14)", () => {
    it("offers Someone else… on the sign-up picker", async () => {
      const el = await mountSettled();
      clickTab(el, "signup");
      const opts = Array.from(shadow(el).querySelectorAll<HTMLOptionElement>("#gd-signup-as option")).map(
        (o) => o.textContent,
      );
      expect(opts).toEqual(["Kehayias, Chris", "Kehayias, Sarah", "Someone else…"]);
    });

    it("reveals required identity fields and posts them with no contact", async () => {
      const fetchFn = mockFetch();
      const el = await mountSettled();
      clickTab(el, "signup");
      select(el, "#gd-signup-as", "blank");

      const blank = shadow(el).querySelector<HTMLElement>("#gd-signup-blank")!;
      expect(blank.style.display).toBe("");
      expect(blank.querySelector<HTMLInputElement>('[name="firstName"]')!.required).toBe(true);

      fill(el, "#gd-signup-form", {
        firstName: "Grace",
        lastName: "Hopper",
        emailAddress: "grace@example.com",
        mobilePhoneNumber: "555-0101",
      });
      submit(el, "signup");

      await vi.waitFor(() => expect(postsTo(fetchFn, "/group-details/signup")).toHaveLength(1));
      expect(postsTo(fetchFn, "/group-details/signup")[0]).toMatchObject({
        targetId: 49,
        contactId: null,
        firstName: "Grace",
        lastName: "Hopper",
        emailAddress: "grace@example.com",
      });
    });

    it("does not submit Someone else… with the fields empty", async () => {
      const fetchFn = mockFetch();
      const el = await mountSettled();
      clickTab(el, "signup");
      select(el, "#gd-signup-as", "blank");
      submit(el, "signup");
      await Promise.resolve();
      expect(postsTo(fetchFn, "/group-details/signup")).toHaveLength(0);
    });
  });

  describe("notification emails (C11)", () => {
    it("posts the configured template ids with the write", async () => {
      const fetchFn = mockFetch();
      const el = await mountSettled(
        'group-id="49" inquiry-email-template="665" signup-email-template="664" leader-signup-email-template="663"',
      );
      submit(el, "inquire");
      await vi.waitFor(() => expect(postsTo(fetchFn, "/group-details/inquire")).toHaveLength(1));
      expect(postsTo(fetchFn, "/group-details/inquire")[0]).toMatchObject({ inquiryEmailTemplate: 665 });

      clickTab(el, "signup");
      submit(el, "signup");
      await vi.waitFor(() => expect(postsTo(fetchFn, "/group-details/signup")).toHaveLength(1));
      expect(postsTo(fetchFn, "/group-details/signup")[0]).toMatchObject({
        signupEmailTemplate: 664,
        leaderSignupEmailTemplate: 663,
      });
    });

    it("says the email did not go when the server reports a soft warning", async () => {
      mockFetch({ inquire: jsonResponse({ success: true, warning: "email_not_sent" }) });
      const el = await mountSettled('group-id="49" inquiry-email-template="665"');
      submit(el, "inquire");
      await vi.waitFor(() => expect(text(el)).toContain("could not send the confirmation email"));
      expect(shadow(el).querySelector(".gd-message--warning")).not.toBeNull();
    });
  });

  describe("inquiry phone (C16)", () => {
    it("requires the phone on an anonymous inquiry and names the field", async () => {
      const fetchFn = mockFetch({}, { signedIn: false });
      const el = await mountSettled();
      const phone = shadow(el).querySelector<HTMLInputElement>('#gd-inquire-form [name="mobilePhoneNumber"]')!;
      expect(phone.required).toBe(true);
      expect(phone.type).toBe("tel");
      // A real accessible name: <label for=id>.
      expect(shadow(el).querySelector(`label[for="${phone.id}"]`)?.textContent).toContain("Mobile Phone");

      fill(el, "#gd-inquire-form", { firstName: "Grace", lastName: "Hopper", emailAddress: "g@example.com" });
      submit(el, "inquire");
      await vi.waitFor(() => expect(text(el)).toContain("Mobile Phone is required."));
      expect(postsTo(fetchFn, "/group-details/inquire")).toHaveLength(0);
    });

    it("lets a church opt out with require-inquiry-phone=\"false\"", async () => {
      const fetchFn = mockFetch({}, { signedIn: false });
      const el = await mountSettled('group-id="49" require-inquiry-phone="false"');
      expect(
        shadow(el).querySelector<HTMLInputElement>('#gd-inquire-form [name="mobilePhoneNumber"]')!.required,
      ).toBe(false);
      fill(el, "#gd-inquire-form", { firstName: "Grace", lastName: "Hopper", emailAddress: "g@example.com" });
      submit(el, "inquire");
      await vi.waitFor(() => expect(postsTo(fetchFn, "/group-details/inquire")).toHaveLength(1));
    });

    it("does not require hidden identity fields when a household member is picked", async () => {
      const fetchFn = mockFetch();
      const el = await mountSettled();
      const first = shadow(el).querySelector<HTMLInputElement>('#gd-inquire-form [name="firstName"]')!;
      expect(first.required).toBe(false);
      submit(el, "inquire");
      await vi.waitFor(() => expect(postsTo(fetchFn, "/group-details/inquire")).toHaveLength(1));
      expect(postsTo(fetchFn, "/group-details/inquire")[0]).toMatchObject({ contactId: 98 });
    });
  });
});
