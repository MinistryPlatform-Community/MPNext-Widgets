/**
 * Tests for `<next-my-groups>` (W3: C13, C39, C79).
 *
 *   - signed out renders the shared sign-in panel, with no Try Again (C13);
 *   - `hide-group-life` set from script after mount reloads the widget (C39);
 *   - the flat `hidegrouplife` spelling still works and warns once (C79).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import { __resetLocaleSession } from "../i18n";
import "./my-groups";

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

const GROUPS = {
  groups: [
    {
      groupId: 49,
      groupName: "Kehayias Home Group",
      description: null,
      startDate: null,
      endDate: null,
      availableOnline: true,
      meetingDay: "Monday",
      meetingTime: "18:30",
      meetsOnline: false,
      isUserLeader: true,
      volunteerGroup: false,
      groupRoleId: 22,
      congregationId: 1,
      primaryContactId: 98,
      imageUrl: null,
      location: null,
    },
  ],
  cloudUrlPrefix: "mpi",
};

function mockFetch(opts: { signedIn?: boolean; mode?: string } = {}) {
  const signedIn = opts.signedIn ?? true;
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/embed/auth/config")) return jsonResponse({ mode: opts.mode ?? "legacy" });
    if (url.includes("/api/embed/session")) {
      return jsonResponse({ token: makeJwt(signedIn ? "user-guid" : "public") });
    }
    if (url.includes("/api/embed/my-groups")) {
      return signedIn
        ? jsonResponse(GROUPS)
        : jsonResponse({ error: "auth_required", message: "Authentication required." }, 401);
    }
    return jsonResponse({ error: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const shadow = (el: HTMLElement) => el.shadowRoot!;
const text = (el: HTMLElement) => shadow(el).textContent ?? "";

async function mountSettled(attrs = ""): Promise<HTMLElement> {
  document.body.innerHTML = `<next-my-groups api-host="${HOST}" ${attrs}></next-my-groups>`;
  const el = document.body.firstElementChild as HTMLElement;
  await vi.waitFor(() => expect(shadow(el).querySelector(".nw-groups")).not.toBeNull());
  await vi.waitFor(() => expect(shadow(el).querySelector(".spinner")).toBeNull());
  return el;
}

describe("<next-my-groups>", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    __resetLocaleSession();
    document.documentElement.removeAttribute("lang");
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("my-groups"),
      refresh: () => getAuthSession(HOST).refreshToken("my-groups"),
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

  describe("signed out (C13)", () => {
    it("offers sign-in, not Unable to Load with a Try Again", async () => {
      mockFetch({ signedIn: false });
      const el = await mountSettled();
      expect(shadow(el).querySelector("[data-nw-signin]")).not.toBeNull();
      expect(text(el)).toContain("Please sign in to view your groups.");
      expect(text(el)).not.toContain("Unable to Load");
      expect(shadow(el).querySelector('[data-action="retry"]')).toBeNull();
    });

    it("draws a Sign In button in dual mode that asks for login", async () => {
      mockFetch({ signedIn: false, mode: "dual" });
      const el = await mountSettled();
      const seen: unknown[] = [];
      el.addEventListener("loginRequired", (e) => {
        e.preventDefault();
        seen.push((e as CustomEvent).detail);
      });
      shadow(el).querySelector<HTMLButtonElement>('[data-action="login"]')!.click();
      expect(seen).toEqual([{ wid: "my-groups" }]);
    });

    it("names the page's own sign-in link in legacy mode, with no button", async () => {
      mockFetch({ signedIn: false, mode: "legacy" });
      const el = await mountSettled();
      expect(shadow(el).querySelector('[data-action="login"]')).toBeNull();
      expect(text(el)).toContain("Use the sign-in link on this page.");
    });
  });

  describe("hide-group-life (C39 / C79)", () => {
    it("shows the Group Connect link by default", async () => {
      const el = await mountSettled();
      expect(shadow(el).querySelector(".grouplife-btn")).not.toBeNull();
    });

    it("reloads when hide-group-life is set from script after mount", async () => {
      const fetchFn = mockFetch();
      const el = await mountSettled();
      const before = fetchFn.mock.calls.filter(([u]) => String(u).includes("/my-groups")).length;

      el.setAttribute("hide-group-life", "true");

      await vi.waitFor(() =>
        expect(fetchFn.mock.calls.filter(([u]) => String(u).includes("/my-groups")).length).toBe(before + 1),
      );
      await vi.waitFor(() => expect(shadow(el).querySelector(".group-card")).not.toBeNull());
      expect(shadow(el).querySelector(".grouplife-btn")).toBeNull();
    });

    it("still honours the legacy hidegrouplife spelling, and warns", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const el = await mountSettled('hidegrouplife="true"');
      expect(shadow(el).querySelector(".grouplife-btn")).toBeNull();
      expect(warn.mock.calls.some(([m]) => String(m).includes('"hidegrouplife" is deprecated'))).toBe(true);
    });
  });
});
