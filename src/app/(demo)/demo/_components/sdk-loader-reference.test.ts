import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the SDK script URL the app hands to browsers.
 *
 * The build renames Vite's `next-embed.es.js` to a content-hashed
 * `next-embed.<hash>.es.js` and writes a small, stable loader beside it
 * (`scripts/hash-sdk.js`). Only the loader has a filename that survives a
 * rebuild, so it is the only SDK filename application code and docs may name.
 *
 * This test fails if anything under `src/` points at the unhashed Vite output
 * (a 404 on every clean deploy) or hardcodes a content hash (a 404 on the next
 * deploy).
 */

const repoRoot = resolve(import.meta.dirname, "../../../../..");
const hashSdkScript = resolve(repoRoot, "scripts/hash-sdk.js");
const srcDir = resolve(repoRoot, "src");

/** Filenames referenced as `/embed-sdk/<name>.js` — placeholders included. */
const EMBED_SDK_JS_REF = /embed-sdk\/(next-embed[^"'`\s)>]*\.js)/g;

/** A route/doc placeholder rather than a concrete filename. */
function isPlaceholder(name: string): boolean {
  return name.includes("<") || name.includes(":") || name.includes("${");
}

function collectFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, exts));
    } else if (exts.some((e) => entry.endsWith(e)) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const hashSdkSource = readFileSync(hashSdkScript, "utf-8");

/** The stable loader filename the build actually emits, read from the build script. */
const loaderName = (() => {
  const match = /writeFileSync\(resolve\(dist,\s*"([^"]+)"\),\s*loaderCode\)/.exec(hashSdkSource);
  return match?.[1];
})();

describe("SDK loader reference", () => {
  it("hash-sdk.js emits a stable, unhashed loader", () => {
    expect(loaderName).toBe("next-embed.js");
  });

  it("hash-sdk.js does not leave an unhashed bundle behind", () => {
    // The Vite output is *renamed* (not copied) to the hashed name, so
    // `next-embed.es.js` does not exist in dist/ — nor in public/embed-sdk/ —
    // after a clean build.
    expect(hashSdkSource).toMatch(/renameSync\(esSrc,\s*hashedBundlePath\)/);
    expect(hashSdkSource).toMatch(/next-embed\.\$\{bundleHash\}\.es\.js/);
  });

  it("no source file references the unhashed Vite output", () => {
    const offenders = collectFiles(srcDir, [".ts", ".tsx"]).filter((f) =>
      readFileSync(f, "utf-8").includes("next-embed.es.js"),
    );
    expect(offenders.map((f) => relative(repoRoot, f))).toEqual([]);
  });

  it("every /embed-sdk/ script URL in src/ names the loader", () => {
    const bad: string[] = [];
    for (const file of collectFiles(srcDir, [".ts", ".tsx"])) {
      const content = readFileSync(file, "utf-8");
      for (const [, name] of content.matchAll(EMBED_SDK_JS_REF)) {
        if (name !== loaderName) bad.push(`${relative(repoRoot, file)} → ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every /embed-sdk/ script URL in the README names the loader", () => {
    const readme = readFileSync(resolve(repoRoot, "README.md"), "utf-8");
    const bad: string[] = [];
    for (const [, name] of readme.matchAll(EMBED_SDK_JS_REF)) {
      if (!isPlaceholder(name) && name !== loaderName) bad.push(name);
    }
    expect(bad).toEqual([]);
  });

  it("the demo page injects the loader", () => {
    const demo = readFileSync(resolve(srcDir, "app/(demo)/demo/_components/widget-demo.tsx"), "utf-8");
    expect(demo).toContain(`script.src = "/embed-sdk/${loaderName}"`);
    expect(demo).toContain(`script[src="/embed-sdk/${loaderName}"]`);
  });

  it("the copy-paste snippet offers the loader", () => {
    const snippet = readFileSync(
      resolve(srcDir, "app/(demo)/demo/_components/implementation-code.tsx"),
      "utf-8",
    );
    expect(snippet).toContain(`/embed-sdk/${loaderName}"></script>`);
  });

  it("the referenced loader exists once the SDK has been built", () => {
    const publicDir = resolve(repoRoot, "public/embed-sdk");
    if (!existsSync(publicDir)) return; // nothing built yet — nothing to check
    const built = readdirSync(publicDir).filter((f) => f.startsWith("next-embed"));
    if (built.length === 0) return; // pre-build checkout
    expect(built).toContain(loaderName);
  });
});
