import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the demo pages against a placeholder that silently never resolves.
 *
 * `vite.config.ts`'s `demo-env-replace` plugin swaps `__API_HOST__`,
 * `__MP_BASE_URL__` and `__UNIVERSAL_SETUP__` in `transformIndexHtml`, which
 * only ever sees the page's markup. Vite extracts every inline
 * `<script type="module">` into its own `?html-proxy&index=N.js` module first,
 * so a placeholder written inside one is never substituted -- it survives into
 * the browser as the literal string and the code around it fails quietly
 * (a fetch to `http://localhost:5173/__API_HOST__/...` 404s, an attribute is
 * set to nonsense). That is exactly how every auth-mode banner came to read
 * "legacy (config unavailable)" while the API was answering `dual`.
 *
 * Classic (non-module) inline scripts *are* left in the HTML, so the fix is to
 * publish the value from one of those -- `window.__nextEmbedApiHost`, which the
 * SDK's own host detection already reads -- or from a markup attribute, as
 * `demo-custom-form.html` does. Both keep the placeholder in substituted
 * territory. This test fails if a placeholder is ever written back inside an
 * inline module script.
 */

const pkgDir = resolve(import.meta.dirname, "..");

/** Placeholder tokens `transformIndexHtml` rewrites, e.g. `__API_HOST__`. */
const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

/** `define`d at build time by Vite, so it *does* resolve inside module code. */
const DEFINED_AT_BUILD_TIME = new Set(["__ORG_NAME__"]);

type Script = { line: number; attrs: string; body: string };

/** Every `<script>` element in a page, with its 1-based start line. */
function scripts(html: string): Script[] {
  const out: Script[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({
      line: html.slice(0, m.index).split("\n").length,
      attrs: m[1],
      body: m[2],
    });
  }
  return out;
}

const isInlineModule = (s: Script) =>
  !/\bsrc\s*=/i.test(s.attrs) && /\btype\s*=\s*["']?module/i.test(s.attrs);

const demoPages = readdirSync(pkgDir)
  .filter((f) => f === "index.html" || /^demo-.*\.html$/.test(f))
  .sort();

describe("demo page placeholder substitution", () => {
  it("finds the demo pages", () => {
    expect(demoPages.length).toBeGreaterThan(20);
    expect(demoPages).toContain("index.html");
  });

  it("writes no build placeholder inside an inline module script", () => {
    const offenders: string[] = [];
    for (const page of demoPages) {
      const html = readFileSync(resolve(pkgDir, page), "utf-8");
      for (const script of scripts(html).filter(isInlineModule)) {
        for (const token of new Set(script.body.match(PLACEHOLDER) ?? [])) {
          if (DEFINED_AT_BUILD_TIME.has(token)) continue;
          offenders.push(`${page}:${script.line} -> ${token}`);
        }
      }
    }
    expect(
      offenders,
      "Vite cannot substitute placeholders inside inline module scripts. " +
        "Publish the value from a classic <script> (window.__nextEmbedApiHost) " +
        "or a markup attribute instead, and read it from the module.",
    ).toEqual([]);
  });

  it("gives every page that reads __nextEmbedApiHost a classic script that sets it", () => {
    for (const page of demoPages) {
      const html = readFileSync(resolve(pkgDir, page), "utf-8");
      const readers = scripts(html).filter(
        (s) => isInlineModule(s) && s.body.includes("__nextEmbedApiHost"),
      );
      if (readers.length === 0) continue;

      const setter = scripts(html).find(
        (s) =>
          !isInlineModule(s) &&
          !/\bsrc\s*=/i.test(s.attrs) &&
          /window\.__nextEmbedApiHost\s*=\s*"__API_HOST__"/.test(s.body),
      );
      expect(
        setter,
        `${page} reads window.__nextEmbedApiHost from a module script but no ` +
          "classic <script> assigns it from __API_HOST__",
      ).toBeDefined();
      // A classic script is executed in document order, so it has to come
      // first -- module scripts are deferred, but relying on that is fragile.
      expect(setter!.line, `${page}: the classic script must precede its readers`).toBeLessThan(
        Math.min(...readers.map((r) => r.line)),
      );
    }
  });
});
