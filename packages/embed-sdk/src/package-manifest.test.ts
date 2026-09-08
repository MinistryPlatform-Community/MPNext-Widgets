import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards `packages/embed-sdk/package.json` against advertising files the build
 * does not emit.
 *
 * The SDK is not a registry package. Its shipped artifact is content-hashed by
 * `scripts/hash-sdk.js` (`next-embed.<hash>.es.js`), so no static `exports`
 * map, `module`, or `main` can name it and stay correct across builds; the only
 * stable entry point is the generated `next-embed.js` loader, fetched over HTTP
 * from `public/embed-sdk/` by a `<script type="module">` tag. `vite build` also
 * wipes `dist/` (`emptyOutDir` defaults on), so a `tsc` emit into `dist/`
 * cannot survive either — the package's `tsc` step is a type gate only.
 *
 * The manifest therefore declares no entry points at all and is `private`.
 * This test fails if any file-path field comes back, unless whoever adds it
 * also makes it resolve to something a clean `pnpm build:sdk` really produces.
 */

const pkgDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(pkgDir, "../..");
const distDir = resolve(pkgDir, "dist");
const publicDir = resolve(repoRoot, "public/embed-sdk");

type Manifest = {
  name?: string;
  private?: boolean;
  type?: string;
  main?: string;
  module?: string;
  browser?: string;
  types?: string;
  typings?: string;
  bin?: unknown;
  files?: string[];
  exports?: unknown;
  scripts?: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf-8")) as Manifest;

/** Manifest fields whose value is a path into the published tree. */
const ENTRY_POINT_FIELDS = ["main", "module", "browser", "types", "typings"] as const;

/** Collect every "./path" string reachable from an `exports` value. */
function exportPaths(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    if (node.startsWith(".")) out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) exportPaths(child, out);
  } else if (node && typeof node === "object") {
    for (const child of Object.values(node)) exportPaths(child, out);
  }
  return out;
}

/** Every path the manifest promises a consumer can resolve. */
function declaredPaths(): string[] {
  const paths = ENTRY_POINT_FIELDS.map((f) => manifest[f]).filter(
    (v): v is string => typeof v === "string",
  );
  return [...paths, ...exportPaths(manifest.exports)];
}

describe("embed-sdk package manifest", () => {
  it("is private — the SDK ships over HTTP, not from a registry", () => {
    expect(manifest.private).toBe(true);
  });

  it("declares no entry points, because no built filename is stable", () => {
    for (const field of ENTRY_POINT_FIELDS) {
      expect(manifest[field], `package.json "${field}" must be absent`).toBeUndefined();
    }
    expect(manifest.exports, 'package.json "exports" must be absent').toBeUndefined();
    expect(manifest.files, 'package.json "files" must be absent').toBeUndefined();
  });

  it("type-checks without emitting, so vite's emptyOutDir cannot discard the emit", () => {
    expect(manifest.scripts?.build).toBe("tsc --noEmit && vite build");

    const tsconfig = readFileSync(resolve(pkgDir, "tsconfig.json"), "utf-8");
    expect(tsconfig).toContain('"noEmit": true');
    // Declaration emit here would land in a directory `vite build` clears.
    expect(tsconfig).not.toMatch(/"declaration(Map|Dir)?"\s*:/);
    expect(tsconfig).not.toMatch(/"outDir"\s*:/);
  });

  it("every path the manifest declares resolves to a build artifact", () => {
    // Vacuous while the manifest declares nothing; the check exists so that
    // re-adding a field is only green once the file is genuinely emitted.
    const built = existsSync(distDir) ? readdirSync(distDir) : [];
    if (built.length === 0) {
      expect(declaredPaths()).toEqual([]); // pre-build checkout: nothing may be promised
      return;
    }
    const missing = declaredPaths().filter((p) => !existsSync(resolve(pkgDir, p)));
    expect(missing).toEqual([]);
  });

  it("the loader is the SDK's only stable entry point", () => {
    if (!existsSync(publicDir)) return; // nothing built yet
    const staged = readdirSync(publicDir).filter((f) => f.startsWith("next-embed"));
    if (staged.length === 0) return; // pre-build checkout
    expect(staged).toContain("next-embed.js");
    // Exactly one content-hashed bundle, and it is not named by the manifest.
    const hashed = staged.filter((f) => /^next-embed\.[a-f0-9]+\.es\.js$/.test(f));
    expect(hashed).toHaveLength(1);
    expect(declaredPaths().some((p) => p.includes(hashed[0]))).toBe(false);
  });
});
