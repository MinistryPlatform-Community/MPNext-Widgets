/**
 * TODO 36: `dual` + `prefer-mp-login` must actually reach MP's login control.
 *
 * The attribute used to be gated on `customElements.get("mpp-user-login")`
 * being truthy at render time, which is a chicken-and-egg: MPWidgets.js is a
 * *loader* and only fetches `/widgets/dist/UserLogin.js` (the script that calls
 * `customElements.define`) for the widget tags it finds when it scans the page,
 * so on a page that carries no `mpp-*` tag of its own nothing is ever
 * registered until something appends one — which the old getter refused to do.
 * The attribute was therefore a silent no-op on exactly the pages it exists for.
 *
 * These cases run from a registry where `mpp-user-login` starts **unregistered**,
 * which is the one state the masking test in `user-menu.test.ts` never reached
 * (it called `customElements.define()` itself before mounting). `customElements`
 * cannot be un-defined, so the bootstrap case that registers the element has to
 * come last, and this needs its own file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAuthSession } from "../shared/auth-session";
import "./user-menu";

const HOST = "https://widgets.example.com";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([]),
  } as unknown as Response;
}

function mockDualConfig() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/embed/auth/config")) {
        return jsonResponse({
          mode: "dual",
          loginUrl: `${HOST}/api/embed/auth/login`,
          logoutUrl: `${HOST}/api/embed/auth/logout`,
          meUrl: `${HOST}/api/embed/auth/me`,
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    }),
  );
}

function mount(attrs = ""): HTMLElement {
  document.body.innerHTML = `<next-user-menu api-host="${HOST}" mp-base-url="https://mp.example.com" ${attrs}></next-user-menu>`;
  return document.body.firstElementChild as HTMLElement;
}
const shadow = (el: HTMLElement) => el.shadowRoot!;

/** The host page's own `<script id="MPWidgets">`, the evidence MP can register. */
function addMpWidgetsScript(): () => void {
  const script = document.createElement("script");
  script.id = "MPWidgets";
  script.src = "https://mp.example.com/widgets/dist/MPWidgets.js";
  document.head.appendChild(script);
  return () => script.remove();
}

/** Counts childList mutations on the widget — one per re-insertion attempt. */
function countLightDomMutations(el: HTMLElement): { get: () => number; stop: () => void } {
  let n = 0;
  const obs = new MutationObserver((records) => {
    for (const r of records) if (r.addedNodes.length) n += 1;
  });
  obs.observe(el, { childList: true });
  return { get: () => n, stop: () => obs.disconnect() };
}

describe("<next-user-menu> dual mode: prefer-mp-login", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let removeScript: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;
    window.__nextTokenProvider = {
      get: () => getAuthSession(HOST).getToken("user-menu"),
      refresh: () => getAuthSession(HOST).refreshToken("user-menu"),
    };
    window.__nextSDKReady = Promise.resolve();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDualConfig();
  });

  afterEach(() => {
    removeScript?.();
    removeScript = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("without the attribute: renders the SDK Sign In button and no MP tag (unchanged)", async () => {
    removeScript = addMpWidgetsScript();
    const el = mount();
    await vi.advanceTimersByTimeAsync(0);

    expect(shadow(el).querySelector(".nw-login-btn")).not.toBeNull();
    expect(el.querySelector("mpp-user-login")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("declines with one warning when MPWidgets.js is not on the page", async () => {
    const el = mount("prefer-mp-login");
    await vi.advanceTimersByTimeAsync(0);

    // Fail safe: the visitor still gets a working control.
    expect(shadow(el).querySelector(".nw-login-btn")).not.toBeNull();
    expect(el.querySelector("mpp-user-login")).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("prefer-mp-login");
    expect(message).toContain("MPWidgets.js");

    // And only once, however many times it re-renders.
    await vi.advanceTimersByTimeAsync(3000);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the SDK Sign In button when MP never registers the element", async () => {
    removeScript = addMpWidgetsScript();
    const el = mount("prefer-mp-login");
    await vi.advanceTimersByTimeAsync(0);

    // While the watch runs: MP's element is appended and 0x0, so the neutral
    // placeholder stands in rather than an empty menu.
    expect(el.querySelector("mpp-user-login")).not.toBeNull();
    expect(shadow(el).querySelector(".nw-placeholder")).not.toBeNull();
    expect(shadow(el).querySelector(".nw-login-btn")).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    // Watch budget is ~6s; after it gives up the SDK's own button takes over.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(shadow(el).querySelector(".nw-login-btn")).not.toBeNull();
    expect(shadow(el).querySelector(".nw-placeholder")).toBeNull();
    expect(el.querySelector("mpp-user-login")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("did not register");
  });

  // Last: this test registers `mpp-user-login`, and the registry is global.
  it("bootstraps MP's control on a page that carries no mpp-* tag of its own", async () => {
    removeScript = addMpWidgetsScript();
    const el = mount("prefer-mp-login");
    await vi.advanceTimersByTimeAsync(0);

    // The tag MPWidgets.js needs to find is now in the DOM, and it keeps being
    // re-inserted so MP's re-scan sees it whenever its observer goes live.
    expect(el.querySelector("mpp-user-login")).not.toBeNull();
    const mutations = countLightDomMutations(el);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mutations.get()).toBeGreaterThanOrEqual(3);
    expect(el.querySelectorAll("mpp-user-login")).toHaveLength(1);
    mutations.stop();

    // UserLogin.js finally lands and defines the element.
    customElements.define("mpp-user-login", class extends HTMLElement {});
    await vi.advanceTimersByTimeAsync(0);

    const login = el.querySelector("mpp-user-login")!;
    expect(login.constructor).not.toBe(HTMLElement);
    expect(shadow(el).querySelector("slot")).not.toBeNull();
    expect(shadow(el).querySelector(".nw-login-btn")).toBeNull();
    expect(shadow(el).querySelector(".nw-placeholder")).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    // The watch stopped once MP registered it.
    const after = countLightDomMutations(el);
    await vi.advanceTimersByTimeAsync(2000);
    expect(after.get()).toBe(0);
    after.stop();
  });
});
