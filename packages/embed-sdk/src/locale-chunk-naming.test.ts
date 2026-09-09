import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the one localisation bug that only exists in a deployed build.
 *
 * `es` and `pt-BR` are lazy chunks (`i18n/registry.ts` reaches them through
 * `() => import("./locales/es")`). Three separate files have to agree on the
 * filename rolldown gives those chunks, and nothing else checks that they do:
 *
 *   1. `vite.config.ts` pins `chunkFileNames`.
 *   2. `scripts/copy-sdk.js` decides what to publish into `public/embed-sdk/`,
 *      and what to prune from it, with
 *      `isBuildOwned(name) → name.startsWith("next-embed") || …`.
 *   3. `vercel.json` supplies CORS and cache headers per exact `source`
 *      pattern. These chunks are fetched cross-origin from church sites.
 *
 * Break (1) and the chunk is built, never published, and 404s for every
 * customer. Break (3) and it is published but blocked by CORS. Either way the
 * SDK swallows the failed import, every widget silently renders English, and
 * **nothing looks broken** — the page works, it is just monolingual.
 *
 * None of that reproduces in development: `vite dev` serves the dynamic import
 * straight off the filesystem, so the demo pages and the Playwright specs are
 * all perfectly happy. Hence a test that reads the config files themselves
 * rather than exercising a running server.
 */

const pkgDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(pkgDir, "../..");
const distDir = resolve(pkgDir, "dist");
const publicDir = resolve(repoRoot, "public/embed-sdk");

/** The prefix `scripts/copy-sdk.js` treats as build-owned. */
const PUBLISH_PREFIX = "next-embed";

/** Matches a published locale chunk: `next-embed-locale-es.C0HYlHXA.js`. */
const CHUNK_NAME = /^next-embed-locale-[A-Za-z-]+\.[A-Za-z0-9_-]+\.js$/;

describe("locale chunk naming contract", () => {
  it("pins chunkFileNames with the publishable prefix in vite.config.ts", () => {
    const config = readFileSync(resolve(pkgDir, "vite.config.ts"), "utf-8");
    const match = config.match(/chunkFileNames:\s*"([^"]+)"/);

    expect(
      match,
      "vite.config.ts must pin `chunkFileNames`. Rolldown's default name is not `next-embed`-prefixed, so copy-sdk.js would never publish the locale chunks.",
    ).not.toBeNull();
    expect(match?.[1]).toMatch(new RegExp(`^${PUBLISH_PREFIX}`));
    // `[hash]` is what makes the `immutable` cache header in vercel.json safe.
    expect(match?.[1]).toContain("[hash]");
  });

  it("agrees with copy-sdk.js's isBuildOwned predicate", () => {
    // Read the predicate's prefix out of the script rather than restating it,
    // so this test fails if someone narrows it.
    const script = readFileSync(resolve(repoRoot, "scripts/copy-sdk.js"), "utf-8");
    expect(script).toContain(`name.startsWith("${PUBLISH_PREFIX}")`);
  });

  it("gives the locale chunks CORS and immutable caching in vercel.json", () => {
    const config = JSON.parse(
      readFileSync(resolve(repoRoot, "vercel.json"), "utf-8"),
    ) as {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };

    const entry = config.headers.find((h) =>
      h.source.includes("next-embed-locale-"),
    );
    expect(
      entry,
      "vercel.json needs a `source` entry for the locale chunks. Without it they are served without `Access-Control-Allow-Origin`, so a church site cannot import them and every widget silently falls back to English.",
    ).toBeDefined();

    const keys = Object.fromEntries(
      (entry?.headers ?? []).map((h) => [h.key, h.value]),
    );
    expect(keys["Access-Control-Allow-Origin"]).toBe("*");
    expect(keys["Cache-Control"]).toContain("immutable");
  });

  it("emits one chunk per lazily-loaded locale", () => {
    // `dist/` only exists after a build; skip rather than fail so a clean
    // checkout can run the unit suite.
    if (!existsSync(distDir)) return;

    const chunks = readdirSync(distDir).filter((f) => CHUNK_NAME.test(f));
    const registry = readFileSync(
      resolve(pkgDir, "src/i18n/registry.ts"),
      "utf-8",
    );
    // Every locale with a `load` (i.e. every one but the inlined default).
    const lazy = [...registry.matchAll(/import\("\.\/locales\/([^"]+)"\)/g)].map(
      (m) => m[1] as string,
    );

    expect(lazy.length).toBeGreaterThan(0);
    expect(chunks.length).toBe(lazy.length);
    for (const code of lazy) {
      expect(
        chunks.some((c) => c.startsWith(`next-embed-locale-${code}.`)),
        `no built chunk for "${code}"`,
      ).toBe(true);
    }
  });

  it("keeps the published chunks out of git", () => {
    // `.gitignore` covers the main bundle with `next-embed.*.js`, which does
    // *not* match `next-embed-locale-es.<hash>.js` — the separator is a hyphen,
    // not a dot. Without its own pattern every build drops two new tracked
    // files into `public/embed-sdk/`.
    const ignore = readFileSync(resolve(repoRoot, ".gitignore"), "utf-8");
    expect(ignore).toContain("public/embed-sdk/next-embed-locale-*.js");
    expect(ignore).toContain("public/embed-sdk/next-embed-locale-*.js.map");
  });

  it("publishes every built locale chunk into public/embed-sdk", () => {
    if (!existsSync(distDir) || !existsSync(publicDir)) return;

    const built = readdirSync(distDir).filter((f) => CHUNK_NAME.test(f));
    if (built.length === 0) return;

    const published = new Set(readdirSync(publicDir));
    const missing = built.filter((f) => !published.has(f));
    expect(
      missing,
      "Built but not published — this is the 404 that does not reproduce in dev.",
    ).toEqual([]);
  });
});
