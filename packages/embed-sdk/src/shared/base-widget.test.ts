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

  describe("connectedCallback", () => {
    it("is invoked when the element is attached to the document", () => {
      const widget = makeWidget();
      expect(widget.connectedCalled).toBe(0);
      document.body.appendChild(widget);
      expect(widget.connectedCalled).toBe(1);
    });
  });
});
