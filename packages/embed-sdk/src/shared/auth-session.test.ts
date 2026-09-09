/**
 * Unit tests for AuthSession (packages/embed-sdk/src/shared/auth-session.ts)
 *
 * Strategy:
 *   - `fetch` is stubbed with vi.stubGlobal and routed by URL so each test can
 *     script the config / session / exchange / logout / me responses.
 *   - localStorage / sessionStorage / location.hash / window.__nextAuthSession
 *     are reset in beforeEach so tests stay isolated.
 *   - `navigateTo` (the login() navigation seam) is spied on: jsdom cannot
 *     perform top-level navigation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AuthSession,
  getAuthSession,
  readLegacyToken,
  SID_KEY,
  LEGACY_TOKEN_KEY,
  LEGACY_EXPIRES_KEY,
} from "./auth-session";

const HOST = "https://widgets.example.com";

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build an unsigned-but-well-formed JWT with the given exp (epoch seconds). */
function makeJwt(exp: number, extra: Record<string, unknown> = {}): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "public", exp, ...extra })}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type Route = (init: RequestInit | undefined, url: string) => Response | Promise<Response>;

/** Install a URL-routed fetch mock. Returns the mock for call inspection. */
function mockFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [suffix, handler] of Object.entries(routes)) {
      if (url.endsWith(suffix)) return handler(init, url);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  return init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
}

function callsTo(fn: ReturnType<typeof vi.fn>, suffix: string): unknown[][] {
  return fn.mock.calls.filter((c) => String(c[0]).endsWith(suffix));
}

const configOk =
  (mode: "legacy" | "dual" | "hardened") =>
  () =>
    jsonResponse({
      mode,
      loginUrl: `${HOST}/api/embed/auth/login`,
      logoutUrl: `${HOST}/api/embed/auth/logout`,
      meUrl: `${HOST}/api/embed/auth/me`,
    });

const nowSec = () => Math.floor(Date.now() / 1000);

describe("AuthSession", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    delete (window as unknown as { __nextEmbedApiHost?: unknown }).__nextEmbedApiHost;
    history.replaceState(null, "", "/page?x=1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── config ─────────────────────────────────────────────────────

  describe("getConfig()", () => {
    it("fetches /api/embed/auth/config once and exposes the mode", async () => {
      const fetchMock = mockFetch({ "/api/embed/auth/config": configOk("dual") });
      const s = new AuthSession(HOST);
      expect(s.getMode()).toBeNull();

      const [a, b] = await Promise.all([s.getConfig(), s.getConfig()]);
      expect(a.mode).toBe("dual");
      expect(b).toBe(a);
      expect(s.getMode()).toBe("dual");
      expect(callsTo(fetchMock, "/api/embed/auth/config")).toHaveLength(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${HOST}/api/embed/auth/config`);
      expect(init.credentials).toBe("omit");
    });

    it("falls back to legacy with host-derived URLs when the config fetch fails", async () => {
      mockFetch({
        "/api/embed/auth/config": () => {
          throw new Error("network down");
        },
      });
      const s = new AuthSession(HOST);
      const cfg = await s.getConfig();
      expect(cfg).toEqual({
        mode: "legacy",
        loginUrl: `${HOST}/api/embed/auth/login`,
        logoutUrl: `${HOST}/api/embed/auth/logout`,
        meUrl: `${HOST}/api/embed/auth/me`,
      });
      expect(s.getMode()).toBe("legacy");
    });

    it("falls back to legacy on a non-2xx or malformed response", async () => {
      mockFetch({ "/api/embed/auth/config": () => jsonResponse({ error: "nope" }, 500) });
      expect((await new AuthSession(HOST).getConfig()).mode).toBe("legacy");

      mockFetch({ "/api/embed/auth/config": () => jsonResponse({ mode: "bogus" }) });
      expect((await new AuthSession(HOST).getConfig()).mode).toBe("legacy");
    });
  });

  // ── sid storage ────────────────────────────────────────────────

  describe("sid storage", () => {
    it("adopts a session left under the pre-rename key", () => {
      // Without this fallback the `nw_sid` -> `nextwidgets_sid` rename signs out
      // every already-signed-in congregant on the deploy that ships it: the SDK
      // finds nothing under the new key and mints a public token instead.
      localStorage.setItem("nw_sid", "old-session");
      const s = new AuthSession(HOST);

      expect(s.getSid()).toBe("old-session");
      // Migrated forward on read, so the old key is not consulted forever.
      expect(localStorage.getItem(SID_KEY)).toBe("old-session");
      expect(localStorage.getItem("nw_sid")).toBeNull();
    });

    it("prefers the current key when both are present", () => {
      localStorage.setItem("nw_sid", "old-session");
      localStorage.setItem(SID_KEY, "current-session");
      expect(new AuthSession(HOST).getSid()).toBe("current-session");
    });

    it("clears the pre-rename key on sign-out too", () => {
      // Otherwise `clearSid()` leaves the old value behind and the very next
      // `getSid()` adopts it — signing the user back in.
      localStorage.setItem("nw_sid", "old-session");
      const s = new AuthSession(HOST);
      s.clearSid();

      expect(localStorage.getItem("nw_sid")).toBeNull();
      expect(s.getSid()).toBeNull();
    });

    it("uses localStorage by default and sessionStorage for scope=tab", () => {
      const s = new AuthSession(HOST);
      s.setSid("sid-local");
      expect(localStorage.getItem(SID_KEY)).toBe("sid-local");
      expect(s.getSid()).toBe("sid-local");

      s.clearSid();
      expect(localStorage.getItem(SID_KEY)).toBeNull();
      expect(s.getSid()).toBeNull();

      s.setStorageScope("tab");
      s.setSid("sid-tab");
      expect(sessionStorage.getItem(SID_KEY)).toBe("sid-tab");
      expect(localStorage.getItem(SID_KEY)).toBeNull();
      expect(s.getSid()).toBe("sid-tab");

      // clearSid removes from both storages.
      localStorage.setItem(SID_KEY, "stale");
      s.clearSid();
      expect(sessionStorage.getItem(SID_KEY)).toBeNull();
      expect(localStorage.getItem(SID_KEY)).toBeNull();
    });

    it("notifies onChange subscribers on set/clear and unsubscribes cleanly", () => {
      const s = new AuthSession(HOST);
      const cb = vi.fn();
      const off = s.onChange(cb);

      s.setSid("a");
      expect(cb).toHaveBeenCalledTimes(1);
      s.setSid("a"); // unchanged → no notify
      expect(cb).toHaveBeenCalledTimes(1);
      s.clearSid();
      expect(cb).toHaveBeenCalledTimes(2);
      s.clearSid(); // already clear → no notify
      expect(cb).toHaveBeenCalledTimes(2);

      off();
      s.setSid("b");
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it("notifies on cross-tab storage events for the sid and legacy keys only", () => {
      const s = new AuthSession(HOST);
      const cb = vi.fn();
      s.onChange(cb);

      window.dispatchEvent(new StorageEvent("storage", { key: SID_KEY }));
      window.dispatchEvent(new StorageEvent("storage", { key: LEGACY_TOKEN_KEY }));
      window.dispatchEvent(new StorageEvent("storage", { key: LEGACY_EXPIRES_KEY }));
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
      expect(cb).toHaveBeenCalledTimes(3);
    });
  });

  // ── handoff fragment ───────────────────────────────────────────

  describe("consumeHandoffFromUrl()", () => {
    it("parses and strips #nextwidgets_auth while preserving other fragment params", () => {
      history.replaceState(null, "", "/page?x=1#nw-tab=profile&nextwidgets_auth=CODE123");
      const s = new AuthSession(HOST);

      expect(s.consumeHandoffFromUrl()).toEqual({ code: "CODE123" });
      expect(window.location.hash).toBe("#nw-tab=profile");
      expect(window.location.search).toBe("?x=1");
      // Returns once only.
      expect(s.consumeHandoffFromUrl()).toBeNull();
    });

    it("removes the hash entirely when nextwidgets_auth was the only param", () => {
      history.replaceState(null, "", "/page#nextwidgets_auth=ONLY");
      const s = new AuthSession(HOST);
      expect(s.consumeHandoffFromUrl()).toEqual({ code: "ONLY" });
      expect(window.location.hash).toBe("");
      expect(window.location.pathname).toBe("/page");
    });

    it("parses nextwidgets_auth_error, exposes it via getAuthError() and notifies", () => {
      history.replaceState(null, "", "/page#nextwidgets_auth_error=state_mismatch");
      const s = new AuthSession(HOST);
      const cb = vi.fn();
      s.onChange(cb);
      expect(s.consumeHandoffFromUrl()).toEqual({ error: "state_mismatch" });
      expect(s.getAuthError()).toBe("state_mismatch");
      expect(window.location.hash).toBe("");
      expect(cb).toHaveBeenCalled();
    });

    it("hasPendingHandoff() parses lazily and reports an unexchanged code", async () => {
      history.replaceState(null, "", "/page#nextwidgets_auth=PENDING");
      const s = new AuthSession(HOST);
      expect(s.hasPendingHandoff()).toBe(true);
      expect(window.location.hash).toBe("");
      // Already parsed — the return-once contract of consumeHandoffFromUrl holds.
      expect(s.consumeHandoffFromUrl()).toBeNull();

      mockFetch({
        "/api/embed/auth/config": configOk("hardened"),
        "/api/embed/auth/exchange": () => jsonResponse({ sid: "S", token: makeJwt(nowSec() + 300), expiresIn: 300 }),
      });
      await s.getToken("user-menu");
      expect(s.hasPendingHandoff()).toBe(false);
      expect(new AuthSession(HOST).hasPendingHandoff()).toBe(false);
    });

    it("returns null and leaves the URL alone when no handoff is present", () => {
      history.replaceState(null, "", "/page#section-2");
      const s = new AuthSession(HOST);
      expect(s.consumeHandoffFromUrl()).toBeNull();
      expect(window.location.hash).toBe("#section-2");
    });
  });

  // ── token ladder ───────────────────────────────────────────────

  describe("getToken()", () => {
    it("exchanges a pending handoff code first, stores the sid and caches the token", async () => {
      history.replaceState(null, "", "/page#nextwidgets_auth=HANDOFF");
      const token = makeJwt(nowSec() + 300, { sid: "S1" });
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("hardened"),
        "/api/embed/auth/exchange": () => jsonResponse({ sid: "S1", token, expiresIn: 300, mode: "hardened" }),
      });
      const s = new AuthSession(HOST);

      expect(await s.getToken("user-menu")).toBe(token);
      expect(s.getSid()).toBe("S1");
      expect(window.location.hash).toBe("");

      const ex = callsTo(fetchMock, "/api/embed/auth/exchange");
      expect(ex).toHaveLength(1);
      expect(bodyOf(ex[0])).toEqual({ code: "HANDOFF", wid: "user-menu" });
      expect(callsTo(fetchMock, "/api/embed/session")).toHaveLength(0);

      // Second call served from cache — no further network.
      expect(await s.getToken("user-menu")).toBe(token);
      expect(fetchMock).toHaveBeenCalledTimes(2); // config + exchange
    });

    it("falls back to the ladder when the handoff code is rejected", async () => {
      history.replaceState(null, "", "/page#nextwidgets_auth=BAD");
      const pub = makeJwt(nowSec() + 300);
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("hardened"),
        "/api/embed/auth/exchange": () => jsonResponse({ error: "invalid_code" }, 400),
        "/api/embed/session": () => jsonResponse({ token: pub, expiresIn: 300, mode: "hardened" }),
      });
      const s = new AuthSession(HOST);
      expect(await s.getToken("profile")).toBe(pub);
      expect(s.getSid()).toBeNull();
      expect(s.getAuthError()).toBe("invalid_code");
      expect(bodyOf(callsTo(fetchMock, "/api/embed/session")[0])).toEqual({ wid: "profile" });
    });

    it("mints with the stored sid", async () => {
      localStorage.setItem(SID_KEY, "S-EXISTING");
      const token = makeJwt(nowSec() + 300, { sid: "S-EXISTING" });
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ token, expiresIn: 300, mode: "dual" }),
      });
      const s = new AuthSession(HOST);
      expect(await s.getToken("profile")).toBe(token);
      const calls = callsTo(fetchMock, "/api/embed/session");
      expect(calls).toHaveLength(1);
      expect(bodyOf(calls[0])).toEqual({ wid: "profile", sid: "S-EXISTING" });
      const init = calls[0][1] as RequestInit;
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("omit");
    });

    it("clears the sid on 401 invalid_session and continues to a public token", async () => {
      localStorage.setItem(SID_KEY, "S-REVOKED");
      const pub = makeJwt(nowSec() + 300);
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("hardened"),
        "/api/embed/session": (init) => {
          const body = JSON.parse(init!.body as string) as { sid?: string };
          if (body.sid) return jsonResponse({ error: "invalid_session" }, 401);
          return jsonResponse({ token: pub, expiresIn: 300, mode: "hardened" });
        },
      });
      const s = new AuthSession(HOST);
      const cb = vi.fn();
      s.onChange(cb);

      expect(await s.getToken("profile")).toBe(pub);
      expect(s.getSid()).toBeNull();
      expect(localStorage.getItem(SID_KEY)).toBeNull();
      expect(cb).toHaveBeenCalled();

      const calls = callsTo(fetchMock, "/api/embed/session");
      expect(calls).toHaveLength(2);
      expect(bodyOf(calls[0])).toEqual({ wid: "profile", sid: "S-REVOKED" });
      expect(bodyOf(calls[1])).toEqual({ wid: "profile" });
    });

    it("silently upgrades a legacy MP token to a sid in dual mode", async () => {
      localStorage.setItem(LEGACY_TOKEN_KEY, "MP-ACCESS");
      localStorage.setItem(LEGACY_EXPIRES_KEY, new Date(Date.now() + 3600_000).toString());
      const token = makeJwt(nowSec() + 300, { sid: "S-NEW" });
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ token, expiresIn: 300, sid: "S-NEW", mode: "dual" }),
      });
      const s = new AuthSession(HOST);
      expect(await s.getToken("profile")).toBe(token);
      expect(s.getSid()).toBe("S-NEW");
      expect(bodyOf(callsTo(fetchMock, "/api/embed/session")[0])).toEqual({
        wid: "profile",
        mpUserToken: "MP-ACCESS",
      });
      // Legacy keys are read, never written.
      expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBe("MP-ACCESS");

      // Next mint uses the sid, not the MP token.
      await s.refreshToken("profile");
      expect(bodyOf(callsTo(fetchMock, "/api/embed/session")[1])).toEqual({ wid: "profile", sid: "S-NEW" });
    });

    it("sends the legacy MP token in legacy mode without storing a sid", async () => {
      localStorage.setItem(LEGACY_TOKEN_KEY, "MP-ACCESS");
      const token = makeJwt(nowSec() + 300);
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("legacy"),
        "/api/embed/session": () => jsonResponse({ token, expiresIn: 300, mode: "legacy" }),
      });
      const s = new AuthSession(HOST);
      expect(await s.getToken("user-menu")).toBe(token);
      expect(bodyOf(callsTo(fetchMock, "/api/embed/session")[0])).toEqual({
        wid: "user-menu",
        mpUserToken: "MP-ACCESS",
      });
      expect(s.getSid()).toBeNull();
    });

    it("ignores an expired legacy MP token", async () => {
      localStorage.setItem(LEGACY_TOKEN_KEY, "MP-ACCESS");
      localStorage.setItem(LEGACY_EXPIRES_KEY, new Date(Date.now() - 1000).toString());
      expect(readLegacyToken()).toBeNull();
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("legacy"),
        "/api/embed/session": () => jsonResponse({ token: makeJwt(nowSec() + 300), expiresIn: 300 }),
      });
      await new AuthSession(HOST).getToken("profile");
      expect(bodyOf(callsTo(fetchMock, "/api/embed/session")[0])).toEqual({ wid: "profile" });
    });

    it("ignores the legacy MP token entirely in hardened mode", async () => {
      localStorage.setItem(LEGACY_TOKEN_KEY, "MP-ACCESS");
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("hardened"),
        "/api/embed/session": () => jsonResponse({ token: makeJwt(nowSec() + 300), expiresIn: 300 }),
      });
      const s = new AuthSession(HOST);
      await s.getToken("profile");
      expect(bodyOf(callsTo(fetchMock, "/api/embed/session")[0])).toEqual({ wid: "profile" });
      expect(s.isAuthenticated()).toBe(false);
    });

    it("mints a public token when no credential is present", async () => {
      const pub = makeJwt(nowSec() + 300);
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ token: pub, expiresIn: 300, mode: "dual" }),
      });
      expect(await new AuthSession(HOST).getToken("event-finder")).toBe(pub);
      expect(bodyOf(callsTo(fetchMock, "/api/embed/session")[0])).toEqual({ wid: "event-finder" });
    });

    it("throws the server error when the session route fails (non-401)", async () => {
      mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ error: "Origin not allowed" }, 403),
      });
      await expect(new AuthSession(HOST).getToken("profile")).rejects.toThrow("Origin not allowed");
    });

    it("dedupes concurrent getToken calls into one mint", async () => {
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ token: makeJwt(nowSec() + 300), expiresIn: 300 }),
      });
      const s = new AuthSession(HOST);
      await Promise.all([s.getToken("a"), s.getToken("a"), s.getToken("a")]);
      expect(callsTo(fetchMock, "/api/embed/session")).toHaveLength(1);
    });
  });

  // ── cache / expiry ─────────────────────────────────────────────

  describe("token cache", () => {
    it("re-mints once the token is within 30s of its exp", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      let n = 0;
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ token: makeJwt(nowSec() + 120, { n: ++n }), expiresIn: 120 }),
      });
      const s = new AuthSession(HOST);

      const t1 = await s.getToken("p");
      expect(await s.getToken("p")).toBe(t1);
      expect(callsTo(fetchMock, "/api/embed/session")).toHaveLength(1);

      // 80s in: 40s left → still fresh.
      vi.advanceTimersByTime(80_000);
      expect(await s.getToken("p")).toBe(t1);
      expect(callsTo(fetchMock, "/api/embed/session")).toHaveLength(1);

      // 95s in: 25s left → inside the 30s skew → re-mint.
      vi.advanceTimersByTime(15_000);
      const t2 = await s.getToken("p");
      expect(t2).not.toBe(t1);
      expect(callsTo(fetchMock, "/api/embed/session")).toHaveLength(2);
    });

    it("uses expiresIn when the token payload has no exp", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      let n = 0;
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ token: `opaque-${++n}`, expiresIn: 60 }),
      });
      const s = new AuthSession(HOST);
      const t1 = await s.getToken("p");
      vi.advanceTimersByTime(20_000);
      expect(await s.getToken("p")).toBe(t1);
      vi.advanceTimersByTime(15_000); // 35s: 25s left → stale
      expect(await s.getToken("p")).toBe("opaque-2");
      expect(callsTo(fetchMock, "/api/embed/session")).toHaveLength(2);
    });

    it("refreshToken() bypasses the cache", async () => {
      let n = 0;
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ token: makeJwt(nowSec() + 300, { n: ++n }), expiresIn: 300 }),
      });
      const s = new AuthSession(HOST);
      const t1 = await s.getToken("p");
      const t2 = await s.refreshToken("p");
      expect(t2).not.toBe(t1);
      expect(callsTo(fetchMock, "/api/embed/session")).toHaveLength(2);
    });

    it("invalidates the cache when the credential changes (legacy login after a public mint)", async () => {
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("legacy"),
        "/api/embed/session": (init) => {
          const body = JSON.parse(init!.body as string) as { mpUserToken?: string };
          return jsonResponse({
            token: makeJwt(nowSec() + 300, { sub: body.mpUserToken ? "user" : "public" }),
            expiresIn: 300,
          });
        },
      });
      const s = new AuthSession(HOST);
      await s.getToken("p");
      // MPWidgets.js signs the visitor in (same tab).
      localStorage.setItem(LEGACY_TOKEN_KEY, "MP-ACCESS");
      await s.getToken("p");
      const calls = callsTo(fetchMock, "/api/embed/session");
      expect(calls).toHaveLength(2);
      expect(bodyOf(calls[1])).toEqual({ wid: "p", mpUserToken: "MP-ACCESS" });

      // Logout via MP clears the keys → back to public on the next mint.
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      await s.getToken("p");
      expect(bodyOf(callsTo(fetchMock, "/api/embed/session")[2])).toEqual({ wid: "p" });
    });
  });

  // ── isAuthenticated ────────────────────────────────────────────

  describe("isAuthenticated()", () => {
    it("is true with a sid in any mode", async () => {
      mockFetch({ "/api/embed/auth/config": configOk("hardened") });
      const s = new AuthSession(HOST);
      await s.getConfig();
      expect(s.isAuthenticated()).toBe(false);
      s.setSid("S");
      expect(s.isAuthenticated()).toBe(true);
    });

    it("honors a valid legacy token unless hardened", async () => {
      localStorage.setItem(LEGACY_TOKEN_KEY, "MP");
      const legacy = new AuthSession(HOST); // mode unknown → treated as legacy
      expect(legacy.isAuthenticated()).toBe(true);

      mockFetch({ "/api/embed/auth/config": configOk("hardened") });
      const hardened = new AuthSession(HOST);
      await hardened.getConfig();
      expect(hardened.isAuthenticated()).toBe(false);
    });
  });

  // ── login / logout / me ────────────────────────────────────────

  describe("login()", () => {
    it("navigates top-level to loginUrl with origin, return_to and wid", async () => {
      mockFetch({ "/api/embed/auth/config": configOk("dual") });
      const nav = vi
        .spyOn(AuthSession.prototype as unknown as { navigateTo: (u: string) => void }, "navigateTo")
        .mockImplementation(() => {});
      const s = new AuthSession(HOST);
      await s.getConfig();

      s.login({ wid: "event-details" });
      expect(nav).toHaveBeenCalledTimes(1);
      const url = new URL(nav.mock.calls[0][0]);
      expect(`${url.origin}${url.pathname}`).toBe(`${HOST}/api/embed/auth/login`);
      expect(url.searchParams.get("origin")).toBe(window.location.origin);
      expect(url.searchParams.get("return_to")).toBe(window.location.href);
      expect(url.searchParams.get("wid")).toBe("event-details");

      s.login({ wid: "user-menu", returnTo: "http://localhost:3000/after" });
      const url2 = new URL(nav.mock.calls[1][0]);
      expect(url2.searchParams.get("return_to")).toBe("http://localhost:3000/after");
      expect(url2.searchParams.get("wid")).toBe("user-menu");
    });

    it("uses the host-derived login URL before config resolves", () => {
      const nav = vi
        .spyOn(AuthSession.prototype as unknown as { navigateTo: (u: string) => void }, "navigateTo")
        .mockImplementation(() => {});
      new AuthSession(HOST).login();
      const url = new URL(nav.mock.calls[0][0]);
      expect(`${url.origin}${url.pathname}`).toBe(`${HOST}/api/embed/auth/login`);
      expect(url.searchParams.get("wid")).toBe("user-menu");
    });
  });

  describe("logout()", () => {
    it("POSTs the sid, clears it, drops the token cache and returns endSessionUrl", async () => {
      localStorage.setItem(SID_KEY, "S-OUT");
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("hardened"),
        "/api/embed/session": () => jsonResponse({ token: makeJwt(nowSec() + 300), expiresIn: 300 }),
        "/api/embed/auth/logout": () => jsonResponse({ endSessionUrl: "https://mp.example.com/oauth/connect/endsession?x=1" }),
      });
      const s = new AuthSession(HOST);
      await s.getToken("user-menu");
      const cb = vi.fn();
      s.onChange(cb);

      const url = await s.logout({ postLogoutRedirectUri: "https://church.example.com/" });
      expect(url).toBe("https://mp.example.com/oauth/connect/endsession?x=1");
      expect(s.getSid()).toBeNull();
      expect(localStorage.getItem(SID_KEY)).toBeNull();
      expect(cb).toHaveBeenCalled();

      const lo = callsTo(fetchMock, "/api/embed/auth/logout");
      expect(lo).toHaveLength(1);
      expect(bodyOf(lo[0])).toEqual({ sid: "S-OUT", postLogoutRedirectUri: "https://church.example.com/" });

      // Next mint is public (cache dropped, sid gone).
      await s.getToken("user-menu");
      const sess = callsTo(fetchMock, "/api/embed/session");
      expect(bodyOf(sess[sess.length - 1])).toEqual({ wid: "user-menu" });
    });

    it("also removes legacy mpp-widgets_* keys in dual mode so no silent re-upgrade happens", async () => {
      localStorage.setItem(SID_KEY, "S");
      localStorage.setItem(LEGACY_TOKEN_KEY, "MP");
      localStorage.setItem("mpp-widgets_IdToken", "ID");
      mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/auth/logout": () => jsonResponse({ endSessionUrl: "https://mp.example.com/end" }),
      });
      const s = new AuthSession(HOST);
      await s.getConfig();
      await s.logout();
      expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem("mpp-widgets_IdToken")).toBeNull();
      expect(s.isAuthenticated()).toBe(false);
    });

    it("clears the sid locally even when the logout request fails and returns null", async () => {
      localStorage.setItem(SID_KEY, "S");
      mockFetch({
        "/api/embed/auth/config": configOk("hardened"),
        "/api/embed/auth/logout": () => {
          throw new Error("offline");
        },
      });
      const s = new AuthSession(HOST);
      await s.getConfig();
      expect(await s.logout()).toBeNull();
      expect(s.getSid()).toBeNull();
    });

    it("returns null without a network call when there is no sid", async () => {
      const fetchMock = mockFetch({ "/api/embed/auth/config": configOk("hardened") });
      const s = new AuthSession(HOST);
      await s.getConfig();
      expect(await s.logout()).toBeNull();
      expect(callsTo(fetchMock, "/api/embed/auth/logout")).toHaveLength(0);
    });
  });

  describe("me()", () => {
    it("returns the server user with a Bearer token and caches per sid", async () => {
      localStorage.setItem(SID_KEY, "S-ME");
      const token = makeJwt(nowSec() + 300, { sid: "S-ME" });
      const user = { userGuid: "g", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };
      const fetchMock = mockFetch({
        "/api/embed/auth/config": configOk("hardened"),
        "/api/embed/session": () => jsonResponse({ token, expiresIn: 300 }),
        "/api/embed/auth/me": (init) => {
          expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`);
          return jsonResponse({ authenticated: true, user });
        },
      });
      const s = new AuthSession(HOST);
      expect(await s.me()).toEqual({ authenticated: true, user });
      expect(await s.me()).toEqual({ authenticated: true, user });
      expect(callsTo(fetchMock, "/api/embed/auth/me")).toHaveLength(1);

      // A new sid invalidates the cache.
      s.setSid("S-OTHER");
      await s.me();
      expect(callsTo(fetchMock, "/api/embed/auth/me")).toHaveLength(2);
    });

    it("short-circuits to unauthenticated without a sid", async () => {
      const fetchMock = mockFetch({ "/api/embed/auth/config": configOk("hardened") });
      expect(await new AuthSession(HOST).me()).toEqual({ authenticated: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns unauthenticated on a 401 from /me", async () => {
      localStorage.setItem(SID_KEY, "S");
      mockFetch({
        "/api/embed/auth/config": configOk("dual"),
        "/api/embed/session": () => jsonResponse({ token: makeJwt(nowSec() + 300), expiresIn: 300 }),
        "/api/embed/auth/me": () => jsonResponse({ authenticated: false }, 401),
      });
      expect(await new AuthSession(HOST).me()).toEqual({ authenticated: false });
    });
  });

  // ── singleton ──────────────────────────────────────────────────

  describe("getAuthSession()", () => {
    it("returns one instance per window, stored on window.__nextAuthSession", () => {
      const a = getAuthSession(HOST);
      const b = getAuthSession("https://other.example.com");
      expect(a).toBeInstanceOf(AuthSession);
      expect(b).toBe(a);
      expect(window.__nextAuthSession).toBe(a);
    });
  });
});
