/**
 * Tests for `<next-group-finder>` (W3: C10, C15, C18, C64).
 *
 * The search itself is not re-tested here — filter parity against
 * `api_MPPW_SearchGroups` is a server concern and was proved live. What is
 * pinned is the shell: real card links, the sign-in gate before the
 * Suggest-a-Group form, attribute pre-seeding, and the empty / no-photo states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./group-finder";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(sub: string): string {
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

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 49,
    title: "Kehayias Home Group",
    description: "Weekly study",
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
    ...overrides,
  };
}

interface Routes {
  search?: Response;
  suggest?: Response;
}

function mockFetch(routes: Routes = {}, opts: { signedIn?: boolean; mode?: string } = {}) {
  const signedIn = opts.signedIn ?? false;
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: opts.mode ?? "legacy" });
    if (url.includes("/api/embed/session")) {
      return jsonResponse({ token: makeJwt(signedIn ? "user-guid" : "public") });
    }
    if (url.includes("/group-finder/config")) {
      return jsonResponse({
        congregations: [{ id: 1, name: "Main Congregation" }],
        parentGroups: [],
        groupFocuses: [],
        lifeStages: [],
      });
    }
    if (url.includes("/group-finder/suggest")) return routes.suggest ?? jsonResponse({ success: true });
    if (url.includes("/group-finder")) return routes.search ?? jsonResponse({ groups: [card()] });
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";

function searchUrls(fn: ReturnType<typeof mockFetch>): string[] {
  return fn.mock.calls
    .map(([input]) => String(input))
    .filter((u) => u.includes("/api/embed/group-finder") && !u.includes("/config") && !u.includes("/suggest"));
}

async function mountSettled(attrs = 'target-url="/groups/detail"'): Promise<HTMLElement> {
  document.body.innerHTML = `<next-group-finder api-host="${HOST}" ${attrs}></next-group-finder>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector(".nw-gf")).not.toBeNull());
  await vi.waitFor(() => expect(shadow(el).querySelector(".nw-gf-spinner")).toBeNull());
  return el;
}

describe("<next-group-finder>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.history.replaceState(null, "", "/groups");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("group-finder"),
      refresh: () => getAuthSession(HOST).refreshToken("group-finder"),
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

  describe("result cards (C10)", () => {
    it("renders each card as a real link to the detail page", async () => {
      const el = await mountSettled('target-url="/groups/detail" id-parameter-name="gid"');
      const a = shadow(el).querySelector<HTMLAnchorElement>("a.nw-gf-card")!;
      expect(a).not.toBeNull();
      expect(a.getAttribute("href")).toBe("http://localhost:3000/groups/detail?gid=49");
      expect(a.hasAttribute("tabindex")).toBe(false);
      expect(a.getAttribute("role")).toBeNull();
      // No interactive element nested inside the link.
      expect(a.querySelector("a, button")).toBeNull();
    });

    it("emits groupSelected and leaves navigation to the anchor", async () => {
      const el = await mountSettled();
      const seen: unknown[] = [];
      el.addEventListener("groupSelected", (e) => seen.push((e as CustomEvent).detail));
      const a = shadow(el).querySelector<HTMLAnchorElement>("a.nw-gf-card")!;
      const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
      a.dispatchEvent(click);
      expect(seen).toEqual([{ groupId: 49 }]);
      expect(click.defaultPrevented).toBe(false);
    });

    it("renders a non-interactive article when there is no target-url", async () => {
      const el = await mountSettled("");
      expect(shadow(el).querySelector("a.nw-gf-card")).toBeNull();
      expect(shadow(el).querySelector('.nw-gf-card[role="article"]')).not.toBeNull();
      expect(shadow(el).querySelector('[role="link"], [tabindex]')).toBeNull();
    });
  });

  describe("Suggest a Group gate (C15)", () => {
    const ATTRS = 'target-url="/groups/detail" show-suggest-a-group-button="true"';

    function openSuggest(el: HTMLElement) {
      shadow(el).querySelector<HTMLButtonElement>('[data-action="open-suggest"]')!.click();
    }

    it("signed out, shows a sign-in prompt instead of the form (legacy: no button)", async () => {
      const fetchFn = mockFetch();
      const base = fetchFn.getMockImplementation()!;
      fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/group-details/me")
          ? jsonResponse({ error: "auth_required" }, 401)
          : base(input, init),
      );
      const el = await mountSettled(ATTRS);
      openSuggest(el);

      await vi.waitFor(() => expect(shadow(el).querySelector("[data-nw-signin]")).not.toBeNull());
      expect(shadow(el).querySelector("#gf-suggest-form")).toBeNull();
      expect(shadow(el).querySelector('[data-action="login"]')).toBeNull();
      expect(text(el)).toContain("Please sign in to suggest a group.");
      expect(text(el)).toContain("Use the sign-in link on this page.");
    });

    it("signed out in dual mode, offers a Sign In button", async () => {
      const fetchFn = mockFetch({}, { mode: "dual" });
      const base = fetchFn.getMockImplementation()!;
      fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/group-details/me")
          ? jsonResponse({ error: "auth_required" }, 401)
          : base(input, init),
      );
      const el = await mountSettled(ATTRS);
      openSuggest(el);
      await vi.waitFor(() =>
        expect(shadow(el).querySelector('[data-nw-signin] [data-action="login"]')).not.toBeNull(),
      );
    });

    it("signed in, opens the form", async () => {
      const fetchFn = mockFetch({}, { signedIn: true });
      const base = fetchFn.getMockImplementation()!;
      fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/group-details/me")
          ? jsonResponse({ contact: { contactId: 98, members: [] } })
          : base(input, init),
      );
      const el = await mountSettled(ATTRS);
      openSuggest(el);
      await vi.waitFor(() => expect(shadow(el).querySelector("#gf-suggest-form")).not.toBeNull());
      expect(shadow(el).querySelector("[data-nw-signin]")).toBeNull();
    });

    it("keeps typed values when the session lapses before submit", async () => {
      const fetchFn = mockFetch({}, { signedIn: true });
      const base = fetchFn.getMockImplementation()!;
      fetchFn.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/group-details/me")) return jsonResponse({ contact: { contactId: 98 } });
        if (url.includes("/group-finder/suggest")) return jsonResponse({ error: "auth_required" }, 401);
        if (url.includes("/api/embed/session") && fetchFn.mock.calls.some(([u]) => String(u).includes("/suggest"))) {
          return jsonResponse({ token: makeJwt("public") });
        }
        return base(input, init);
      });
      const el = await mountSettled(ATTRS);
      openSuggest(el);
      await vi.waitFor(() => expect(shadow(el).querySelector("#gf-suggest-form")).not.toBeNull());

      const root = shadow(el);
      root.querySelector<HTMLInputElement>('[name="groupName"]')!.value = "Tuesday Men";
      root.querySelector<HTMLTextAreaElement>('[name="description"]')!.value = "Coffee and Bible";
      root.querySelector<HTMLSelectElement>('[name="newGroupCongregationId"]')!.value = "1";
      root.querySelector<HTMLFormElement>("#gf-suggest-form")!.dispatchEvent(
        new Event("submit", { cancelable: true }),
      );

      await vi.waitFor(() =>
        expect(root.querySelector("#gf-suggest-message [data-nw-signin]")).not.toBeNull(),
      );
      expect(root.querySelector<HTMLInputElement>('[name="groupName"]')!.value).toBe("Tuesday Men");
    });
  });

  describe("city-postal-code (C64)", () => {
    it("pre-scopes the first search and pre-fills the field", async () => {
      const fetchFn = mockFetch();
      const el = await mountSettled('target-url="/g" city-postal-code="90210"');
      expect(searchUrls(fetchFn)[0]).toContain("cityPostalCode=90210");
      expect(shadow(el).querySelector<HTMLInputElement>("#gf-city")!.value).toBe("90210");
    });

    it("re-searches when set from script after mount", async () => {
      const fetchFn = mockFetch();
      const el = await mountSettled();
      el.setAttribute("city-postal-code", "32801");
      await vi.waitFor(() => expect(searchUrls(fetchFn).at(-1)).toContain("cityPostalCode=32801"));
    });
  });
});
