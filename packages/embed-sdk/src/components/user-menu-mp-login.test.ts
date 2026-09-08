/**
 * TODO 35: <next-user-menu> must survive MPWidgets.js's tag-scanning window.
 *
 * MPWidgets.js is a loader — it scans the document on its own DOMContentLoaded
 * handler, fetches `/widgets/dist/UserLogin.js` only for the widget tags it
 * found, and installs the MutationObserver that re-scans *after* an awaited
 * CSRF round-trip in that same handler. Anything inserted in the gap between
 * those two is invisible to both. `<mpp-user-login>` is appended once
 * `GET /api/embed/auth/config` resolves, which measured ~10ms after
 * DOMContentLoaded and ~100ms before the observer existed: MP never loaded
 * UserLogin.js, the element never upgraded (0x0, no shadow root) and legacy
 * mode rendered no Sign In button at all.
 *
 * This lives in its own file because `customElements` cannot be un-defined:
 * these tests need a registry where `mpp-user-login` starts unregistered, and
 * `user-menu.test.ts` defines a stand-in for its dual + prefer-mp-login case.
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

function mockLegacyConfig() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/embed/auth/config")) {
        return jsonResponse({ mode: "legacy", loginUrl: "", logoutUrl: "", meUrl: "" });
      }
      return jsonResponse({ error: "not found" }, 404);
    }),
  );
}

function mount(): HTMLElement {
  document.body.innerHTML = `<next-user-menu api-host="${HOST}" mp-base-url="https://mp.example.com"></next-user-menu>`;
  return document.body.firstElementChild as HTMLElement;
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

describe("<next-user-menu> legacy mode: <mpp-user-login> registration watch", () => {
  let warn: ReturnType<typeof vi.spyOn>;

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
    mockLegacyConfig();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("appends <mpp-user-login> without warning, then keeps re-inserting it until MP registers it", async () => {
    const el = mount();
    await vi.advanceTimersByTimeAsync(0);

    // Appended, and — unlike before — no warning blaming a script that is loaded.
    expect(el.querySelector("mpp-user-login")).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();

    // Each re-insertion is the childList mutation MPWidgets.js's re-scan needs.
    const mutations = countLightDomMutations(el);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mutations.get()).toBeGreaterThanOrEqual(3);
    expect(el.querySelectorAll("mpp-user-login")).toHaveLength(1);
    mutations.stop();
  });

  it("warns once, and about what it actually observed, only after giving up", async () => {
    const script = document.createElement("script");
    script.id = "MPWidgets";
    script.src = "https://mp.example.com/widgets/dist/MPWidgets.js";
    document.head.appendChild(script);
    try {
      const el = mount();
      await vi.advanceTimersByTimeAsync(5000);
      expect(warn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain("MPWidgets.js is on this page");
      expect(message).toContain("did not register");
      // The old text asserted the script was absent, which a 200 contradicted.
      expect(message).not.toContain("does not appear to be loaded");

      // Giving up stops the timer rather than warning on every tick.
      const mutations = countLightDomMutations(el);
      await vi.advanceTimersByTimeAsync(3000);
      expect(mutations.get()).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      mutations.stop();
    } finally {
      script.remove();
    }
  });

  it("stops re-inserting and re-renders once MPWidgets.js defines the element", async () => {
    const el = mount();
    await vi.advanceTimersByTimeAsync(1000);

    // MPWidgets.js finally loads UserLogin.js, which defines the element.
    customElements.define("mpp-user-login", class extends HTMLElement {});
    await vi.advanceTimersByTimeAsync(0);

    const mutations = countLightDomMutations(el);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mutations.get()).toBe(0);
    mutations.stop();

    // The element upgraded, the slot is still what the shadow root renders,
    // and the watch never reached its give-up warning.
    const login = el.querySelector("mpp-user-login")!;
    expect(login.constructor).not.toBe(HTMLElement);
    expect(el.shadowRoot!.querySelector("slot")).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
