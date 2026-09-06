/**
 * Mode-branch tests for <next-user-menu> (packages/embed-sdk/src/components/user-menu.ts)
 *
 * Covers the auth-mode dispatch added for hardened widget auth:
 *   - placeholder until /api/embed/auth/config resolves
 *   - legacy: <mpp-user-login> injection (today's behavior)
 *   - dual / hardened: own Sign In button, loginRequired hook, no mpp-widgets_* writes
 *   - dual + prefer-mp-login: MP login element when MPWidgets.js is present
 *   - session-scope="tab" → sid in sessionStorage
 *   - hardened logout → cancelable userLogout with endSessionUrl
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthSession, getAuthSession, SID_KEY } from "../shared/auth-session";
import "./user-menu";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(extra: Record<string, unknown> = {}): string {
  return `${b64url({ alg: "HS256" })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 300, ...extra })}.sig`;
}
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([]),
  } as unknown as Response;
}
type Route = (init: RequestInit | undefined) => Response;
function mockFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [needle, handler] of Object.entries(routes)) {
      if (url.includes(needle)) return handler(init);
    }
    return jsonResponse({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const configOk = (mode: "legacy" | "dual" | "hardened") => () =>
  jsonResponse({
    mode,
    loginUrl: `${HOST}/api/embed/auth/login`,
    logoutUrl: `${HOST}/api/embed/auth/logout`,
    meUrl: `${HOST}/api/embed/auth/me`,
  });

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-user-menu api-host="${HOST}" mp-base-url="https://mp.example.com" ${attrs}></next-user-menu>`;
  return document.body.firstElementChild as HTMLElement;
}
const shadow = (el: HTMLElement) => el.shadowRoot!;

describe("<next-user-menu> auth modes", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    history.replaceState(null, "", "/page");
    // Widgets fetch through the SDK token provider; wire it to the AuthSession.
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("user-menu"),
      refresh: () => getAuthSession(HOST).refreshToken("user-menu"),
    };
    window.__nextSDKReady = Promise.resolve();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a neutral placeholder until the auth config resolves", async () => {
    let resolveConfig!: (r: Response) => void;
    mockFetch({
      "/api/embed/auth/config": () =>
        new Promise<Response>((r) => {
          resolveConfig = r;
        }) as unknown as Response,
    });
    const el = mount();
    expect(shadow(el).querySelector(".nw-placeholder")).not.toBeNull();
    expect(shadow(el).querySelector(".nw-login-btn")).toBeNull();
    expect(el.querySelector("mpp-user-login")).toBeNull();

    resolveConfig(configOk("hardened")());
    await vi.waitFor(() => expect(shadow(el).querySelector(".nw-login-btn")).not.toBeNull());
    expect(shadow(el).querySelector(".nw-placeholder")).toBeNull();
  });

  it("legacy mode: injects <mpp-user-login> into the light DOM and renders the slot", async () => {
    mockFetch({ "/api/embed/auth/config": configOk("legacy") });
    const el = mount();
    await vi.waitFor(() => expect(el.querySelector("mpp-user-login")).not.toBeNull());
    expect(shadow(el).querySelector("slot")).not.toBeNull();
    expect(shadow(el).querySelector(".nw-login-btn")).toBeNull();
  });

  it("legacy mode: falls back to legacy when the config fetch fails", async () => {
    mockFetch({
      "/api/embed/auth/config": () => {
        throw new Error("offline");
      },
    });
    const el = mount();
    await vi.waitFor(() => expect(el.querySelector("mpp-user-login")).not.toBeNull());
  });

  it("hardened mode: renders its own Sign In button, emits cancelable loginRequired, then navigates", async () => {
    mockFetch({ "/api/embed/auth/config": configOk("hardened") });
    const nav = vi
      .spyOn(AuthSession.prototype as unknown as { navigateTo: (u: string) => void }, "navigateTo")
      .mockImplementation(() => {});
    const el = mount();
    await vi.waitFor(() => expect(shadow(el).querySelector(".nw-login-btn")).not.toBeNull());
    expect(el.querySelector("mpp-user-login")).toBeNull();

    const seen: CustomEvent[] = [];
    document.addEventListener("loginRequired", (e) => seen.push(e as CustomEvent), { once: true });
    (shadow(el).querySelector(".nw-login-btn") as HTMLButtonElement).click();

    expect(seen).toHaveLength(1);
    expect(seen[0].detail).toEqual({ wid: "user-menu" });
    expect(seen[0].cancelable).toBe(true);
    expect(nav).toHaveBeenCalledTimes(1);
    const url = new URL(nav.mock.calls[0][0]);
    expect(url.pathname).toBe("/api/embed/auth/login");
    expect(url.searchParams.get("wid")).toBe("user-menu");
    expect(url.searchParams.get("origin")).toBe(window.location.origin);
    expect(localStorage.getItem("mpp-widgets_AuthToken")).toBeNull();
  });

  it("hardened mode: a host that preventDefault()s loginRequired suppresses SDK navigation", async () => {
    mockFetch({ "/api/embed/auth/config": configOk("hardened") });
    const nav = vi
      .spyOn(AuthSession.prototype as unknown as { navigateTo: (u: string) => void }, "navigateTo")
      .mockImplementation(() => {});
    const el = mount();
    await vi.waitFor(() => expect(shadow(el).querySelector(".nw-login-btn")).not.toBeNull());
    el.addEventListener("loginRequired", (e) => e.preventDefault());
    (shadow(el).querySelector(".nw-login-btn") as HTMLButtonElement).click();
    expect(nav).not.toHaveBeenCalled();
  });

  it("dual mode with prefer-mp-login and MPWidgets.js present uses <mpp-user-login>", async () => {
    if (!customElements.get("mpp-user-login")) {
      customElements.define("mpp-user-login", class extends HTMLElement {});
    }
    mockFetch({ "/api/embed/auth/config": configOk("dual") });
    const el = mount("prefer-mp-login");
    await vi.waitFor(() => expect(el.querySelector("mpp-user-login")).not.toBeNull());
    expect(shadow(el).querySelector(".nw-login-btn")).toBeNull();
    expect(shadow(el).querySelector("slot")).not.toBeNull();
  });

  it('session-scope="tab" stores the sid in sessionStorage', async () => {
    history.replaceState(null, "", "/page#nw_auth=CODE");
    const token = makeJwt({ sid: "S-TAB" });
    mockFetch({
      "/api/embed/auth/config": configOk("hardened"),
      "/api/embed/auth/exchange": () => jsonResponse({ sid: "S-TAB", token, expiresIn: 300 }),
      "/api/embed/auth/me": () => jsonResponse({ authenticated: true, user: { userGuid: "g", firstName: "Ada", lastName: "L", email: "" } }),
    });
    const el = mount('session-scope="tab"');
    await vi.waitFor(() => expect(sessionStorage.getItem(SID_KEY)).toBe("S-TAB"));
    expect(localStorage.getItem(SID_KEY)).toBeNull();
    await vi.waitFor(() => expect(shadow(el).querySelector(".nw-avatar-btn")).not.toBeNull());
  });

  it("hardened mode: shows the avatar from /me and logs out via the SDK with a cancelable userLogout", async () => {
    localStorage.setItem(SID_KEY, "S-IN");
    const token = makeJwt({ sid: "S-IN" });
    const fetchMock = mockFetch({
      "/api/embed/auth/config": configOk("hardened"),
      "/api/embed/session": () => jsonResponse({ token, expiresIn: 300, mode: "hardened" }),
      "/api/embed/auth/me": () =>
        jsonResponse({ authenticated: true, user: { userGuid: "g", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" } }),
      "/api/embed/auth/logout": () => jsonResponse({ endSessionUrl: "https://mp.example.com/end?x=1" }),
    });
    const el = mount('post-logout-redirect-uri="https://church.example.com/bye"');

    await vi.waitFor(() => expect(shadow(el).querySelector(".nw-avatar-initials")?.textContent?.trim()).toBe("AL"));
    // No MP userinfo / legacy writes in hardened mode.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/oauth/connect/userinfo"))).toBe(false);
    expect(localStorage.getItem("mpp-widgets_AuthToken")).toBeNull();

    (shadow(el).querySelector(".nw-avatar-btn") as HTMLButtonElement).click();
    expect(shadow(el).querySelector(".nw-dropdown-name")?.textContent?.trim()).toBe("Ada Lovelace");

    const logoutEvents: CustomEvent[] = [];
    el.addEventListener("userLogout", (e) => {
      logoutEvents.push(e as CustomEvent);
      e.preventDefault(); // host handles the redirect (jsdom cannot navigate)
    });
    (shadow(el).querySelector('[data-action="logout"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(logoutEvents).toHaveLength(1));
    expect(logoutEvents[0].cancelable).toBe(true);
    expect(logoutEvents[0].detail).toEqual({
      endSessionUrl: "https://mp.example.com/end?x=1",
      postLogoutRedirectUri: "https://church.example.com/bye",
    });
    const logoutCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/embed/auth/logout"))!;
    expect(JSON.parse((logoutCall[1] as RequestInit).body as string)).toEqual({
      sid: "S-IN",
      postLogoutRedirectUri: "https://church.example.com/bye",
    });
    expect(localStorage.getItem(SID_KEY)).toBeNull();
    await vi.waitFor(() => expect(shadow(el).querySelector(".nw-login-btn")).not.toBeNull());
  });
});
