/**
 * Unit tests for cdn-loader (packages/embed-sdk/src/shared/cdn-loader.ts)
 *
 * The module keeps a module-level Map<string, Promise<void>> cache, so each
 * test re-imports the module via vi.resetModules() to start from a clean slate.
 *
 * Note: the current implementation does NOT append a cache-busting query
 * string — that responsibility lives in the dedicated `cdn-loader.js` shipped
 * under public/embed-sdk. These tests assert the actual behavior of the
 * TypeScript helper (load + dedupe + reuse).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type CdnLoader = typeof import("./cdn-loader");

async function loadFresh(): Promise<CdnLoader> {
  vi.resetModules();
  return await import("./cdn-loader");
}

describe("cdn-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure a clean <head> per test so duplicate-script detection is deterministic.
    document.head.innerHTML = "";
  });

  afterEach(() => {
    document.head.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("loadScript()", () => {
    it("creates a <script> with src, async=true and appends to <head>", async () => {
      const { loadScript } = await loadFresh();

      const promise = loadScript("https://cdn.example.com/widget.js");

      const scriptEl = document.head.querySelector(
        'script[src="https://cdn.example.com/widget.js"]',
      ) as HTMLScriptElement | null;
      expect(scriptEl).not.toBeNull();
      expect(scriptEl!.async).toBe(true);

      // Fire onload to resolve the promise.
      scriptEl!.onload?.(new Event("load"));
      await expect(promise).resolves.toBeUndefined();
    });

    it("rejects when the script fails to load", async () => {
      const { loadScript } = await loadFresh();

      const promise = loadScript("https://cdn.example.com/broken.js");

      const scriptEl = document.head.querySelector(
        'script[src="https://cdn.example.com/broken.js"]',
      ) as HTMLScriptElement | null;
      expect(scriptEl).not.toBeNull();

      scriptEl!.onerror?.(new Event("error"));
      await expect(promise).rejects.toThrow(
        "Failed to load script: https://cdn.example.com/broken.js",
      );
    });

    it("deduplicates concurrent calls for the same URL (cache hit)", async () => {
      const { loadScript } = await loadFresh();

      const p1 = loadScript("https://cdn.example.com/a.js");
      const p2 = loadScript("https://cdn.example.com/a.js");

      // Only one <script> tag should be injected.
      const scripts = document.head.querySelectorAll(
        'script[src="https://cdn.example.com/a.js"]',
      );
      expect(scripts.length).toBe(1);

      // Both calls return the same cached Promise instance.
      expect(p1).toBe(p2);

      (scripts[0] as HTMLScriptElement).onload?.(new Event("load"));
      await expect(p1).resolves.toBeUndefined();
      await expect(p2).resolves.toBeUndefined();
    });

    it("resolves immediately when a matching <script> already exists in the document", async () => {
      const { loadScript } = await loadFresh();

      // Pre-seed a script tag (without the helper).
      const existing = document.createElement("script");
      existing.src = "https://cdn.example.com/already.js";
      document.head.appendChild(existing);

      const promise = loadScript("https://cdn.example.com/already.js");

      // No second script tag should be injected.
      const matches = document.head.querySelectorAll(
        'script[src="https://cdn.example.com/already.js"]',
      );
      expect(matches.length).toBe(1);

      // Promise should resolve without us firing onload.
      await expect(promise).resolves.toBeUndefined();
    });

    it("treats different URLs as separate cache entries", async () => {
      const { loadScript } = await loadFresh();

      const pA = loadScript("https://cdn.example.com/a.js");
      const pB = loadScript("https://cdn.example.com/b.js");

      const elA = document.head.querySelector(
        'script[src="https://cdn.example.com/a.js"]',
      ) as HTMLScriptElement;
      const elB = document.head.querySelector(
        'script[src="https://cdn.example.com/b.js"]',
      ) as HTMLScriptElement;
      expect(elA).not.toBeNull();
      expect(elB).not.toBeNull();
      expect(elA).not.toBe(elB);

      elA.onload?.(new Event("load"));
      elB.onload?.(new Event("load"));
      await expect(pA).resolves.toBeUndefined();
      await expect(pB).resolves.toBeUndefined();
    });
  });

  describe("injectExternalCSS()", () => {
    it("appends a <link rel=stylesheet> to the shadow root and resolves on load", async () => {
      const { injectExternalCSS } = await loadFresh();

      const host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "open" });

      const promise = injectExternalCSS(shadow, "https://cdn.example.com/styles.css");

      const link = shadow.querySelector("link") as HTMLLinkElement | null;
      expect(link).not.toBeNull();
      expect(link!.rel).toBe("stylesheet");
      expect(link!.href).toBe("https://cdn.example.com/styles.css");

      link!.onload?.(new Event("load"));
      await expect(promise).resolves.toBeUndefined();
    });

    it("rejects when the CSS link emits an error", async () => {
      const { injectExternalCSS } = await loadFresh();

      const host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "open" });

      const promise = injectExternalCSS(shadow, "https://cdn.example.com/missing.css");

      const link = shadow.querySelector("link") as HTMLLinkElement;
      link.onerror?.(new Event("error"));

      await expect(promise).rejects.toThrow(
        "Failed to load CSS: https://cdn.example.com/missing.css",
      );
    });
  });
});
