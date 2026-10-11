/**
 * Unit tests for MPNextWidget (packages/embed-sdk/src/shared/base-widget.ts)
 *
 * Strategy:
 *   - jsdom supports HTMLElement + Shadow DOM, so we register a concrete test
 *     subclass via `customElements.define`. To avoid double-registration when
 *     the module is reset across describe blocks, we use a unique tag name
 *     per test file.
 *   - We expose the protected `fetch()` helper through a public method on the
 *     subclass so tests can drive it.
 *   - `window.__nextTokenProvider` / `window.__nextSDKReady` are reset in
 *     beforeEach to keep tests isolated.
 *   - `globalThis.fetch` is mocked per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MPNextWidget } from "./base-widget";
import { AuthSession } from "./auth-session";

// Concrete test subclass with public hooks into the protected API.
class TestWidget extends MPNextWidget {
  public renderCalled = 0;
  public connectedCalled = 0;
  render(): void {
    this.renderCalled += 1;
  }
  connectedCallback(): void {
    this.connectedCalled += 1;
  }
  // Expose protected helpers for testing.
  public callFetch(path: string, init?: RequestInit): Promise<Response> {
    return (this as unknown as { fetch: MPNextWidget["fetch"] }).fetch(path, init);
  }
  public callInjectStyles(css: string): void {
    (this as unknown as { injectStyles: MPNextWidget["injectStyles"] }).injectStyles(css);
  }
  public callEmit(name: string, detail?: unknown): void {
    (this as unknown as { emit: MPNextWidget["emit"] }).emit(name, detail);
  }
  public callRequestLogin(wid: string): void {
    (this as unknown as { requestLogin: MPNextWidget["requestLogin"] }).requestLogin(wid);
  }
  public callIsNeedsAuth(input: unknown): boolean {
    return (this as unknown as { isNeedsAuth: (i: unknown) => boolean }).isNeedsAuth(input);
  }
  public callRenderSignInRequired(opts?: Record<string, string>): string {
    return (
      this as unknown as { renderSignInRequired: (o?: Record<string, string>) => string }
    ).renderSignInRequired(opts);
  }
  public getRoot(): ShadowRoot {
    return (this as unknown as { root: ShadowRoot }).root;
  }
  public getApiHost(): string {
    return (this as unknown as { apiHost: string }).apiHost;
  }
}

const TAG = "test-mpnext-widget";
if (!customElements.get(TAG)) {
  customElements.define(TAG, TestWidget);
}

function makeWidget(): TestWidget {
  return document.createElement(TAG) as TestWidget;
}

function makeResponse(
  body: unknown,
  init: { status?: number; ok?: boolean } = {},
): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    status,
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("MPNextWidget", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Reset SDK globals that base-widget reads.
    delete (window as unknown as { __nextTokenProvider?: unknown }).__nextTokenProvider;
    delete (window as unknown as { __nextSDKReady?: unknown }).__nextSDKReady;
    delete (window as unknown as { __nextEmbedApiHost?: unknown }).__nextEmbedApiHost;
    delete (window as unknown as { __nextAuthSession?: unknown }).__nextAuthSession;

    // Clean any leftover SDK script tags inserted by previous tests.
    document.querySelectorAll('script[src*="next-embed"]').forEach((el) => el.remove());
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("construction", () => {
    it("attaches an open Shadow DOM root", () => {
      const widget = makeWidget();
      expect(widget.shadowRoot).not.toBeNull();
      expect(widget.getRoot()).toBe(widget.shadowRoot);
    });

    it("reads api-host from the element attribute when provided", () => {
      const widget = document.createElement(TAG) as TestWidget;
      widget.setAttribute("api-host", "https://api.from-attr.com");
      // Re-construct so the attribute is read in the constructor path.
      const widget2 = document.createElement(TAG) as TestWidget;
      widget2.setAttribute("api-host", "https://api.from-attr.com");
      // jsdom calls the constructor when createElement runs. setAttribute after
      // construction won't change the captured apiHost, so we instead use a
      // fresh element where the attribute is set BEFORE construction is
      // exercised via upgrade. Use innerHTML to ensure attributes parse first.
      document.body.innerHTML = `<${TAG} api-host="https://api.from-attr.com"></${TAG}>`;
      const upgraded = document.body.firstElementChild as TestWidget;
      expect(upgraded.getApiHost()).toBe("https://api.from-attr.com");

      // Silence unused-var lint on the two earlier-built widgets.
      void widget;
      void widget2;
    });

    it("falls back to window.__nextEmbedApiHost when no attribute is set", () => {
      (window as unknown as { __nextEmbedApiHost?: string }).__nextEmbedApiHost =
        "https://api.from-global.com";
      const widget = makeWidget();
      expect(widget.getApiHost()).toBe("https://api.from-global.com");
    });

    it("falls back to the SDK script-tag origin when no other hint is present", () => {
      const script = document.createElement("script");
      script.src = "https://cdn.example.com/sdk/next-embed.es.js";
      document.body.appendChild(script);

      const widget = makeWidget();
      expect(widget.getApiHost()).toBe("https://cdn.example.com");
    });

    it("returns empty apiHost when nothing is configured", () => {
      const widget = makeWidget();
      expect(widget.getApiHost()).toBe("");
    });
  });

  describe("token-provider acquisition", () => {
    it("does not require a token provider at construction time", () => {
      // No __nextTokenProvider on window — construction must not throw.
      expect(() => makeWidget()).not.toThrow();
    });

    it("uses the token provider once when fetching with a valid token", async () => {
      const get = vi.fn(async () => "abc123");
      (window as unknown as {
        __nextTokenProvider: { get: () => Promise<string> };
      }).__nextTokenProvider = { get };

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true }));

      const widget = makeWidget();
      widget.setAttribute("api-host", "https://api.example.com");
      // Need the apiHost captured at construction time; rebuild via innerHTML.
      document.body.innerHTML = `<${TAG} api-host="https://api.example.com"></${TAG}>`;
      const upgraded = document.body.firstElementChild as TestWidget;

      const res = await upgraded.callFetch("/me");
      expect(res.ok).toBe(true);
      expect(get).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.example.com/me");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer abc123",
      );
      expect(init.credentials).toBe("omit");
      expect(init.mode).toBe("cors");
    });

    it("awaits window.__nextSDKReady before reading the token provider", async () => {
      let resolveReady!: () => void;
      const ready = new Promise<void>((r) => {
        resolveReady = r;
      });
      (window as unknown as { __nextSDKReady: Promise<void> }).__nextSDKReady = ready;

      // Token provider is not present yet.
      const widget = makeWidget();
      const fetchPromise = widget.callFetch("/x");

      // Should not have called fetch yet because the SDK is "not ready" and
      // there's no token provider.
      expect(fetchMock).not.toHaveBeenCalled();

      // Provide the token provider, then resolve the ready promise.
      const get = vi.fn(async () => "late-token");
      (window as unknown as {
        __nextTokenProvider: { get: () => Promise<string> };
      }).__nextTokenProvider = { get };
      resolveReady();

      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true }));
      await fetchPromise;

      expect(get).toHaveBeenCalledTimes(1);
    });

    it("throws when the token resolves to empty", async () => {
      (window as unknown as {
        __nextTokenProvider: { get: () => Promise<string> };
      }).__nextTokenProvider = { get: async () => "" };

      const widget = makeWidget();
      await expect(widget.callFetch("/x")).rejects.toThrow(
        "Authentication token not available.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("fetch() with auto-refresh on 401", () => {
    it("calls refresh() and retries the request with the new token on 401", async () => {
      const get = vi.fn(async () => "stale-token");
      const refresh = vi.fn(async () => "fresh-token");
      (window as unknown as {
        __nextTokenProvider: {
          get: () => Promise<string>;
          refresh: () => Promise<string>;
        };
      }).__nextTokenProvider = { get, refresh };

      // First call: 401. Second call (after refresh): 200.
      fetchMock
        .mockResolvedValueOnce(makeResponse({}, { status: 401, ok: false }))
        .mockResolvedValueOnce(makeResponse({ ok: true }, { status: 200 }));

      document.body.innerHTML = `<${TAG} api-host="https://api.example.com"></${TAG}>`;
      const widget = document.body.firstElementChild as TestWidget;

      const res = await widget.callFetch("/secure");
      expect(res.status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Second fetch must use the refreshed token.
      const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      const headers = secondInit.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer fresh-token");
    });

    it("does not retry on 401 when no refresh() function is provided", async () => {
      const get = vi.fn(async () => "stale-token");
      (window as unknown as {
        __nextTokenProvider: { get: () => Promise<string> };
      }).__nextTokenProvider = { get };

      fetchMock.mockResolvedValueOnce(makeResponse({}, { status: 401, ok: false }));

      const widget = makeWidget();
      const res = await widget.callFetch("/secure");
      expect(res.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not refresh or retry a 401 when the token sent was already public", async () => {
      const b64 = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const publicToken = `${b64({ alg: "HS256" })}.${b64({ sub: "public" })}.sig`;
      const get = vi.fn(async () => publicToken);
      const refresh = vi.fn(async () => publicToken);
      window.__nextTokenProvider = { get, refresh };

      fetchMock.mockResolvedValueOnce(makeResponse({ error: "auth_required" }, { status: 401, ok: false }));

      const widget = makeWidget();
      const res = await widget.callFetch("/secure");
      expect(res.status).toBe(401);
      expect(refresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // And the signed-out state still reads correctly off that one response.
      expect(widget.callIsNeedsAuth(res)).toBe(true);
    });

    it("still refreshes a 401 for a signed-in (non-public) token", async () => {
      const b64 = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const userToken = `${b64({ alg: "HS256" })}.${b64({ sub: "user-guid" })}.sig`;
      const refresh = vi.fn(async () => "fresh-token");
      window.__nextTokenProvider = { get: vi.fn(async () => userToken), refresh };

      fetchMock
        .mockResolvedValueOnce(makeResponse({}, { status: 401, ok: false }))
        .mockResolvedValueOnce(makeResponse({ ok: true }, { status: 200 }));

      const widget = makeWidget();
      const res = await widget.callFetch("/secure");
      expect(res.status).toBe(200);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("does not retry on non-401 errors", async () => {
      const get = vi.fn(async () => "tok");
      const refresh = vi.fn(async () => "new-tok");
      (window as unknown as {
        __nextTokenProvider: {
          get: () => Promise<string>;
          refresh: () => Promise<string>;
        };
      }).__nextTokenProvider = { get, refresh };

      fetchMock.mockResolvedValueOnce(makeResponse({ err: "no" }, { status: 500, ok: false }));

      const widget = makeWidget();
      const res = await widget.callFetch("/oops");
      expect(res.status).toBe(500);
      expect(refresh).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("injectStyles()", () => {
    it("uses adoptedStyleSheets when available", () => {
      const widget = makeWidget();
      widget.callInjectStyles(":host { color: red; }");

      // In jsdom (modern enough), adoptedStyleSheets is supported.
      const sheets = widget.getRoot().adoptedStyleSheets;
      if (sheets && sheets.length > 0) {
        expect(sheets.length).toBe(1);
        expect(sheets[0]).toBeInstanceOf(CSSStyleSheet);
      } else {
        // Fallback path: a <style> tag must exist in shadow root.
        const styleTags = widget.getRoot().querySelectorAll("style");
        expect(styleTags.length).toBeGreaterThan(0);
        expect(styleTags[0].textContent).toContain("color: red");
      }
    });

    // C68 part 1: the widget's sheet must never clobber one a host page adopted
    // into the open shadow root — the previous `adoptedStyleSheets = [sheet]`
    // assignment threw every host override away on the next inject.
    /**
     * jsdom implements neither `adoptedStyleSheets` nor `CSSStyleSheet.replace`,
     * so without this the C68 tests would silently exercise the `<style>`
     * fallback. A WeakMap-backed accessor is all the code under test touches.
     */
    function polyfillAdoptedStyleSheets(): () => void {
      const store = new WeakMap<object, CSSStyleSheet[]>();
      const accessor: PropertyDescriptor = {
        configurable: true,
        get(this: object) {
          return store.get(this) ?? [];
        },
        set(this: object, value: CSSStyleSheet[]) {
          store.set(this, [...value]);
        },
      };
      const hadReplace = "replace" in CSSStyleSheet.prototype;
      Object.defineProperty(Document.prototype, "adoptedStyleSheets", accessor);
      Object.defineProperty(ShadowRoot.prototype, "adoptedStyleSheets", accessor);
      if (!hadReplace) {
        Object.defineProperty(CSSStyleSheet.prototype, "replace", {
          configurable: true,
          value: async () => undefined,
        });
      }
      return () => {
        delete (Document.prototype as unknown as Record<string, unknown>).adoptedStyleSheets;
        delete (ShadowRoot.prototype as unknown as Record<string, unknown>).adoptedStyleSheets;
        if (!hadReplace) {
          delete (CSSStyleSheet.prototype as unknown as Record<string, unknown>).replace;
        }
      };
    }

    let restorePolyfill: (() => void) | null = null;
    afterEach(() => {
      restorePolyfill?.();
      restorePolyfill = null;
    });

    it("keeps a host-adopted sheet across re-injection and render (C68)", () => {
      restorePolyfill = polyfillAdoptedStyleSheets();
      const widget = makeWidget();
      document.body.appendChild(widget);
      widget.callInjectStyles(":host { color: red; }");

      const hostSheet = new CSSStyleSheet();
      hostSheet.replaceSync(":host { color: purple; }");
      const root = widget.getRoot();
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, hostSheet];

      widget.callInjectStyles(":host { color: blue; }");
      widget.render();

      const sheets = root.adoptedStyleSheets;
      expect(sheets).toContain(hostSheet);
      expect(sheets).toHaveLength(2);
      // The widget's own sheet stays first, so the host's rules win on equal
      // specificity.
      expect(sheets[1]).toBe(hostSheet);
      expect(sheets[0]).not.toBe(hostSheet);
    });

    it("replaces only its own sheet on re-inject rather than stacking copies", () => {
      restorePolyfill = polyfillAdoptedStyleSheets();
      const widget = makeWidget();
      widget.callInjectStyles(":host { color: red; }");
      widget.callInjectStyles(":host { color: blue; }");
      widget.callInjectStyles(":host { color: green; }");
      expect(widget.getRoot().adoptedStyleSheets).toHaveLength(1);
    });

    it("falls back to a <style> tag when adoptedStyleSheets path throws", () => {
      const widget = makeWidget();

      // Force the constructable stylesheet path to throw.
      const original = CSSStyleSheet.prototype.replaceSync;
      const spy = vi
        .spyOn(CSSStyleSheet.prototype, "replaceSync")
        .mockImplementation(() => {
          throw new Error("not supported");
        });

      try {
        widget.callInjectStyles(":host { color: green; }");
        const styleTags = widget.getRoot().querySelectorAll("style");
        expect(styleTags.length).toBe(1);
        expect(styleTags[0].textContent).toContain("color: green");
      } finally {
        spy.mockRestore();
        // Ensure prototype isn't permanently altered.
        CSSStyleSheet.prototype.replaceSync = original;
      }
    });
  });

  describe("emit()", () => {
    it("dispatches a composed, bubbling CustomEvent with detail", () => {
      const widget = makeWidget();
      document.body.appendChild(widget);

      const handler = vi.fn();
      document.body.addEventListener("widget:done", handler as EventListener);

      widget.callEmit("widget:done", { id: 42 });

      expect(handler).toHaveBeenCalledTimes(1);
      const ev = handler.mock.calls[0][0] as CustomEvent;
      expect(ev.detail).toEqual({ id: 42 });
      expect(ev.bubbles).toBe(true);
      expect(ev.composed).toBe(true);
    });
  });

  describe("requestLogin()", () => {
    function spyNavigate() {
      return vi
        .spyOn(AuthSession.prototype as unknown as { navigateTo: (u: string) => void }, "navigateTo")
        .mockImplementation(() => {});
    }
    function stubMode(mode: "legacy" | "dual" | "hardened" | null) {
      vi.spyOn(AuthSession.prototype, "getMode").mockReturnValue(mode);
    }

    it("dispatches a cancelable, composed, bubbling loginRequired event with { wid }", () => {
      stubMode("hardened");
      spyNavigate();
      const widget = makeWidget();
      document.body.appendChild(widget);
      const handler = vi.fn();
      document.addEventListener("loginRequired", handler as EventListener, { once: true });

      widget.callRequestLogin("event-details");

      expect(handler).toHaveBeenCalledTimes(1);
      const ev = handler.mock.calls[0][0] as CustomEvent;
      expect(ev.detail).toEqual({ wid: "event-details" });
      expect(ev.cancelable).toBe(true);
      expect(ev.bubbles).toBe(true);
      expect(ev.composed).toBe(true);
    });

    it("navigates to login in dual/hardened when the event is not prevented", () => {
      stubMode("dual");
      const nav = spyNavigate();
      const widget = makeWidget();
      document.body.appendChild(widget);
      widget.callRequestLogin("group-details");
      expect(nav).toHaveBeenCalledTimes(1);
      expect(new URL(nav.mock.calls[0][0], "http://localhost").searchParams.get("wid")).toBe("group-details");
    });

    it("does not navigate when a host listener calls preventDefault()", () => {
      stubMode("hardened");
      const nav = spyNavigate();
      const widget = makeWidget();
      document.body.appendChild(widget);
      widget.addEventListener("loginRequired", (e) => e.preventDefault());
      widget.callRequestLogin("custom-form");
      expect(nav).not.toHaveBeenCalled();
    });

    it("never navigates in legacy mode or before the mode is known", () => {
      const nav = spyNavigate();
      const widget = makeWidget();
      document.body.appendChild(widget);

      stubMode("legacy");
      widget.callRequestLogin("plan-your-visit");
      stubMode(null);
      widget.callRequestLogin("plan-your-visit");
      expect(nav).not.toHaveBeenCalled();
    });
  });

  describe("signed-out state (C81 / CROSS-1)", () => {
    function jwt(claims: Record<string, unknown>): string {
      const b64 = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`;
    }
    function stubMode(mode: "legacy" | "dual" | "hardened" | null) {
      vi.spyOn(AuthSession.prototype, "getMode").mockReturnValue(mode);
    }
    async function widgetAfter401(sub: string | null): Promise<TestWidget> {
      const token = sub === null ? "opaque-token" : jwt({ sub });
      window.__nextTokenProvider = { get: vi.fn().mockResolvedValue(token) };
      fetchMock.mockResolvedValue(makeResponse({ error: "auth_required" }, { status: 401 }));
      const widget = makeWidget();
      document.body.appendChild(widget);
      await widget.callFetch("/api/embed/thing");
      return widget;
    }

    describe("isNeedsAuth()", () => {
      it("is true for a 401 carried by a public token", async () => {
        const widget = await widgetAfter401("public");
        expect(widget.callIsNeedsAuth({ status: 401, ok: false })).toBe(true);
      });

      it("is false for a 401 that reaches a signed-in visitor — that is a fault, not a state", async () => {
        const widget = await widgetAfter401("user-guid-1");
        expect(widget.callIsNeedsAuth({ status: 401, ok: false })).toBe(false);
      });

      it("falls back to AuthSession.isAuthenticated() when the token is not a readable JWT", async () => {
        const signedOut = vi.spyOn(AuthSession.prototype, "isAuthenticated").mockReturnValue(false);
        const widget = await widgetAfter401(null);
        expect(widget.callIsNeedsAuth({ status: 401 })).toBe(true);
        signedOut.mockReturnValue(true);
        expect(widget.callIsNeedsAuth({ status: 401 })).toBe(false);
      });

      it("is false for every non-401 status, 403 and 500 included", async () => {
        const widget = await widgetAfter401("public");
        for (const status of [200, 400, 403, 404, 500, 503]) {
          expect(widget.callIsNeedsAuth({ status }), String(status)).toBe(false);
        }
      });

      it("reads machine codes from a parsed body, never message text", async () => {
        const widget = await widgetAfter401("public");
        expect(widget.callIsNeedsAuth({ error: "auth_required" })).toBe(true);
        expect(widget.callIsNeedsAuth({ error: "session_expired" })).toBe(true);
        expect(widget.callIsNeedsAuth({ error: "invalid_session" })).toBe(true);
        expect(widget.callIsNeedsAuth({ error: "internal_error", message: "Authentication required" })).toBe(false);
        expect(widget.callIsNeedsAuth(null)).toBe(false);
        expect(widget.callIsNeedsAuth("auth_required")).toBe(false);
      });
    });

    describe("renderSignInRequired()", () => {
      function mountPanel(widget: TestWidget, opts?: Record<string, string>) {
        widget.getRoot().innerHTML = widget.callRenderSignInRequired(opts);
        return widget.getRoot();
      }

      it("draws a Sign In button in dual and hardened mode, and no retry", () => {
        for (const mode of ["dual", "hardened"] as const) {
          vi.restoreAllMocks();
          stubMode(mode);
          const widget = makeWidget();
          const root = mountPanel(widget);
          expect(root.querySelector('[data-action="login"]'), mode).not.toBeNull();
          expect(root.querySelector('[data-action="retry"]'), mode).toBeNull();
          expect(root.textContent).toContain("Please sign in to continue.");
        }
      });

      it("draws no button in legacy mode or before the mode is known", () => {
        for (const mode of ["legacy", null] as const) {
          vi.restoreAllMocks();
          stubMode(mode);
          const root = mountPanel(makeWidget());
          expect(root.querySelector('[data-action="login"]'), String(mode)).toBeNull();
          expect(root.querySelector('[data-action="retry"]'), String(mode)).toBeNull();
          expect(root.textContent).toContain("Use the sign-in link on this page.");
        }
      });

      it("uses the caller's legacy sentence in place of the default pair", () => {
        stubMode("legacy");
        const root = mountPanel(makeWidget(), {
          message: "Sign in to see your giving.",
          legacyMessage: "Use the sign-in link above to see your giving.",
        });
        expect(root.textContent).toContain("Use the sign-in link above to see your giving.");
        expect(root.textContent).not.toContain("Sign in to see your giving.");
      });

      it("binds the button itself: one click, one loginRequired with the subject", () => {
        stubMode("dual");
        vi.spyOn(
          AuthSession.prototype as unknown as { navigateTo: (u: string) => void },
          "navigateTo",
        ).mockImplementation(() => {});
        const widget = makeWidget();
        document.body.appendChild(widget);
        const root = mountPanel(widget, { subject: "my-giving" });
        const seen: unknown[] = [];
        widget.addEventListener("loginRequired", (e) => seen.push((e as CustomEvent).detail));

        root.querySelector<HTMLButtonElement>('[data-action="login"]')!.click();
        expect(seen).toEqual([{ wid: "my-giving" }]);
      });

      it("defaults the subject to the tag name without its next- prefix", () => {
        stubMode("dual");
        const root = mountPanel(makeWidget());
        expect(root.querySelector<HTMLElement>("[data-nw-signin]")!.dataset.subject).toBe(
          "test-mpnext-widget",
        );
      });

      it("announces loginRequired once in legacy mode, however often it re-renders", async () => {
        stubMode("legacy");
        const widget = makeWidget();
        document.body.appendChild(widget);
        const seen: unknown[] = [];
        widget.addEventListener("loginRequired", (e) => seen.push((e as CustomEvent).detail));

        mountPanel(widget, { subject: "my-groups" });
        mountPanel(widget, { subject: "my-groups" });
        await Promise.resolve();
        expect(seen).toEqual([{ wid: "my-groups", passive: true }]);
      });

      it("escapes caller-supplied copy", () => {
        stubMode("dual");
        const root = mountPanel(makeWidget(), { message: "<img src=x onerror=alert(1)>" });
        expect(root.querySelector("img")).toBeNull();
      });
    });
  });

  describe("readAttr() (C79)", () => {
    class AliasWidget extends MPNextWidget {
      static readonly attributeAliases = { "hide-soft-credits": "hidesoftcredits" };
      render(): void {}
      connectedCallback(): void {}
      public read(name: string, alias?: string): string | null {
        return this.readAttr(name, alias);
      }
    }
    class OtherAliasWidget extends AliasWidget {}
    const ATAG = "test-alias-widget";
    const OTAG = "test-other-alias-widget";
    if (!customElements.get(ATAG)) customElements.define(ATAG, AliasWidget);
    if (!customElements.get(OTAG)) customElements.define(OTAG, OtherAliasWidget);

    it("prefers the kebab-case name and does not warn", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      document.body.innerHTML = `<${ATAG} hide-soft-credits="true" hidesoftcredits="false"></${ATAG}>`;
      const el = document.body.firstElementChild as AliasWidget;
      expect(el.read("hide-soft-credits")).toBe("true");
      expect(warn).not.toHaveBeenCalled();
    });

    it("falls back to the class's declared alias, warning once per element class", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      document.body.innerHTML = `<${OTAG} hidesoftcredits="true"></${OTAG}><${OTAG} hidesoftcredits="false"></${OTAG}>`;
      const [a, b] = Array.from(document.body.children) as AliasWidget[];
      expect(a.read("hide-soft-credits")).toBe("true");
      expect(a.read("hide-soft-credits")).toBe("true");
      expect(b.read("hide-soft-credits")).toBe("false");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('"hidesoftcredits" is deprecated; use "hide-soft-credits"');
    });

    it("accepts an explicit alias argument, and returns null when neither is set", () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      document.body.innerHTML = `<${ATAG} hidegrouplife="true"></${ATAG}>`;
      const el = document.body.firstElementChild as AliasWidget;
      expect(el.read("hide-group-life", "hidegrouplife")).toBe("true");
      expect(el.read("hide-address")).toBeNull();
      expect(el.read("hide-address", "hideaddress")).toBeNull();
    });
  });

  describe("reconfigure() convention (C39)", () => {
    class ReconfigWidget extends MPNextWidget {
      static get observedAttributes() {
        return ["campaign-id"];
      }
      public reloads = 0;
      render(): void {}
      connectedCallback(): void {
        this.render();
        this.painted = true;
      }
      protected override reload(): void {
        this.reloads += 1;
      }
    }
    const RTAG = "test-reconfig-widget";
    if (!customElements.get(RTAG)) customElements.define(RTAG, ReconfigWidget);

    it("reloads on the first set of an attribute absent at upgrade (oldValue === null)", () => {
      const el = document.createElement(RTAG) as ReconfigWidget;
      document.body.appendChild(el);
      el.setAttribute("campaign-id", "4");
      expect(el.reloads).toBe(1);
    });

    it("reloads on a change and on removal, not on a same-value set", () => {
      document.body.innerHTML = `<${RTAG} campaign-id="4"></${RTAG}>`;
      const el = document.body.firstElementChild as ReconfigWidget;
      el.setAttribute("campaign-id", "4");
      expect(el.reloads).toBe(0);
      el.setAttribute("campaign-id", "5");
      el.removeAttribute("campaign-id");
      expect(el.reloads).toBe(2);
    });

    it("is a no-op before the first paint and once disconnected", () => {
      const el = document.createElement(RTAG) as ReconfigWidget;
      el.setAttribute("campaign-id", "1"); // not connected, not painted
      expect(el.reloads).toBe(0);
      document.body.appendChild(el);
      el.remove();
      el.setAttribute("campaign-id", "2");
      expect(el.reloads).toBe(0);
    });
  });

  describe("connectedCallback", () => {
    it("is invoked when the element is attached to the document", () => {
      const widget = makeWidget();
      expect(widget.connectedCalled).toBe(0);
      document.body.appendChild(widget);
      expect(widget.connectedCalled).toBe(1);
    });
  });
});
