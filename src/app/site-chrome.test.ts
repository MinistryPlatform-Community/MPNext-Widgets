import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import robots from "./robots";

/**
 * TODO 26. The root layout advertised `/assets/icons/favicon.ico` while
 * `public/` contained nothing but `embed-sdk/`, so every page load logged a
 * 404 and the tab showed the browser's default globe. Same failure mode as the
 * SDK filename guarded by `sdk-loader-reference.test.ts`: a string pointing at
 * an asset that is not there compiles, typechecks, lints and ships.
 *
 * These tests pin the two answers — a real icon shipped through the App Router
 * file convention, and a real `/robots.txt` — and make the general case fail
 * loudly: any static asset URL named in `src/` must resolve to something.
 */

const repoRoot = resolve(import.meta.dirname, "../..");
const srcDir = resolve(repoRoot, "src");
const appDir = resolve(repoRoot, "src/app");
const publicDir = resolve(repoRoot, "public");

/** A root-relative URL ending in a static-asset extension, inside a string literal. */
const ASSET_URL =
  /["'`](\/[A-Za-z0-9._/-]+\.(?:ico|png|jpe?g|svg|gif|webp|avif|css|woff2?|txt|xml|webmanifest))["'`]/g;

/**
 * Root-relative URLs that no file under `public/` backs because an App Router
 * metadata file convention generates them. Each maps to the source file that
 * must exist for the URL to resolve.
 */
const METADATA_CONVENTIONS: Record<string, string[]> = {
  "/favicon.ico": ["favicon.ico"],
  "/robots.txt": ["robots.ts", "robots.js", "robots.txt"],
  "/sitemap.xml": ["sitemap.ts", "sitemap.js", "sitemap.xml"],
  "/manifest.webmanifest": ["manifest.ts", "manifest.js", "manifest.webmanifest"],
};

/** Comments describe old bugs and future plans; only real code references count. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function resolves(url: string): boolean {
  if (existsSync(join(publicDir, url))) return true;
  const convention = METADATA_CONVENTIONS[url];
  return convention?.some((file) => existsSync(join(appDir, file))) ?? false;
}

describe("favicon", () => {
  const icoPath = resolve(appDir, "favicon.ico");

  it("ships as the App Router file convention", () => {
    // `app/favicon.ico` is the only place the convention accepts, and its URL
    // (`/favicon.ico`) is one the proxy matcher already lets past.
    expect(existsSync(icoPath)).toBe(true);
  });

  it("is a real, small, multi-size icon and not a placeholder", () => {
    const ico = readFileSync(icoPath);

    expect(ico.byteLength).toBeLessThan(50 * 1024);
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon (2 would be a cursor)

    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);
    expect(ico.byteLength).toBeGreaterThan(6 + 16 * count);

    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const entry = 6 + 16 * i;
      const width = ico[entry] === 0 ? 256 : ico[entry];
      const height = ico[entry + 1] === 0 ? 256 : ico[entry + 1];
      const byteLength = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);

      expect(width).toBe(height);
      expect(byteLength).toBeGreaterThan(0);
      expect(offset + byteLength).toBeLessThanOrEqual(ico.byteLength);

      // Each entry must carry actual image bytes: a PNG stream or a DIB header.
      const payload = ico.subarray(offset, offset + byteLength);
      const isPng = payload.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
      const isDib = payload.readUInt32LE(0) === 40;
      expect(isPng || isDib).toBe(true);

      sizes.push(width);
    }

    expect(sizes).toContain(32);
  });

  it("the root layout does not name an icon path of its own", () => {
    // The convention emits the <link rel="icon"> already, and a hand-written
    // `icons` entry is exactly how the dead `/assets/...` path survived.
    const layout = stripComments(readFileSync(resolve(appDir, "layout.tsx"), "utf-8"));
    expect(layout).not.toMatch(/icons\s*:/);
  });
});

describe("robots.txt", () => {
  const rules = robots().rules;
  const rule = Array.isArray(rules) ? rules[0] : rules;

  it("applies to every crawler", () => {
    expect(Array.isArray(rules) ? rules : [rules]).toHaveLength(1);
    expect(rule.userAgent).toBe("*");
  });

  it("keeps the sign-in-gated app out of search results", () => {
    expect(rule.disallow).toBe("/");
  });

  it("still lets crawlers fetch the embed SDK", () => {
    // Host church sites are indexed by their owners, and a crawler rendering
    // one of their pages has to be able to fetch our bundle.
    expect(rule.allow).toBe("/embed-sdk/");
  });

  it("advertises no sitemap, because there is no public content", () => {
    expect(robots().sitemap).toBeUndefined();
  });
});

describe("static asset references in src/", () => {
  it("every referenced asset URL resolves to a file that exists", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(srcDir)) {
      const source = stripComments(readFileSync(file, "utf-8"));
      for (const [, url] of source.matchAll(ASSET_URL)) {
        if (!resolves(url)) offenders.push(`${relative(repoRoot, file)} → ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("detects a reference to a missing asset", () => {
    // Guards the guard: the check above is only worth having if it can fail.
    expect(resolves("/assets/icons/favicon.ico")).toBe(false);
    expect(resolves("/favicon.ico")).toBe(true);
    expect(resolves("/robots.txt")).toBe(true);
    expect(resolves("/embed-sdk/mp-widget-overrides.css")).toBe(true);
  });
});
