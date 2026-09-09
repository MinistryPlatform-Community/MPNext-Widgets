/**
 * Guard: every error code the API can emit resolves to a translated sentence.
 *
 * `src/app/api/embed/**` answers `{ error: "<code>", message: "<English>" }`,
 * and widgets render `errorText(payload)` — the code looked up in the `errors`
 * namespace, the English `message` logged and never shown. That contract has a
 * quiet failure mode: add a route with a new code, forget the catalogue entry,
 * and every visitor who hits that path gets "Something went wrong" instead of
 * the real reason. Nothing else catches it — the response is well-formed, the
 * types are fine, and the widget renders a plausible sentence.
 *
 * So this test reads the codes straight out of the route sources and asserts
 * each one has a message. It is the reason a new route can be added safely.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { ptBR } from "./locales/pt-BR";
import { WIRE_CODE_KEYS } from "../shared/base-widget";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const routesDir = resolve(repoRoot, "src/app/api/embed");

/** Every `route.ts` under `src/app/api/embed`, recursively. */
function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      routeFiles(full, out);
    } else if (name === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Matches `error: "code"` **as an object property only**.
 *
 * The leading `{` / `,` / line-start anchor is load-bearing: a bare
 * `/error:\s*"…"/` also matches the inside of a string literal, and
 * `auth/callback/route.ts` contains `console.error("Embed login callback
 * error:", …)`. That route is a top-level navigation that reports failures as a
 * `#nextwidgets_auth_error=<code>` fragment rather than a JSON body, so it has no error
 * bodies to find and every match in it was noise.
 */
const ERROR_PROPERTY = /(?:^|[{,])\s*error:\s*"([^"]+)"/gm;

/** `{ code: [files that emit it] }` across every embed route. */
function emittedCodes(): Map<string, string[]> {
  const codes = new Map<string, string[]>();
  for (const file of routeFiles(routesDir)) {
    const source = readFileSync(file, "utf-8");
    const relative = file.slice(repoRoot.length + 1).replace(/\\/g, "/");
    for (const match of source.matchAll(ERROR_PROPERTY)) {
      const code = match[1] as string;
      const seen = codes.get(code) ?? [];
      if (!seen.includes(relative)) seen.push(relative);
      codes.set(code, seen);
    }
  }
  return codes;
}

/** Resolve a dotted key path in a catalogue. */
function lookup(tree: unknown, key: string): unknown {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** The catalogue key `errorText` would use for a wire code. */
function keyFor(code: string): string {
  return WIRE_CODE_KEYS[code] ?? `errors.${code}`;
}

const codes = emittedCodes();

describe("API error codes", () => {
  it("finds the embed routes", () => {
    // Guard against the guard: a broken path here would make every assertion
    // below pass vacuously.
    expect(routeFiles(routesDir).length).toBeGreaterThan(30);
    expect(codes.size).toBeGreaterThan(10);
  });

  it("emits only machine codes, never English prose", () => {
    // The whole point of the migration: a route must not answer with a sentence,
    // or the widget would render an untranslatable string.
    const prose = [...codes.keys()].filter((c) => !/^[a-z][a-z0-9_]*$/.test(c));
    expect(
      prose,
      "These routes still answer with English prose in `error`. Use a snake_case code and put the English in `message`.",
    ).toEqual([]);
  });

  it("has an English message for every code", () => {
    const missing: string[] = [];
    for (const [code, files] of codes) {
      if (typeof lookup(en, keyFor(code)) !== "string") {
        missing.push(`${code} (${keyFor(code)}) emitted by ${files.join(", ")}`);
      }
    }
    expect(
      missing,
      "Add these to the `errors` namespace in locales/*/core.ts, or map them in WIRE_CODE_KEYS.",
    ).toEqual([]);
  });

  it("has a Spanish and Portuguese message for every code", () => {
    // Structural parity is already enforced per-catalogue; this asserts it for
    // the specific keys the API can reach, which is the set that matters most.
    const gaps: string[] = [];
    for (const [code] of codes) {
      const key = keyFor(code);
      if (typeof lookup(es, key) !== "string") gaps.push(`es: ${key}`);
      if (typeof lookup(ptBR, key) !== "string") gaps.push(`pt-BR: ${key}`);
    }
    expect(gaps).toEqual([]);
  });

  it("carries a debug `message` alongside every code", () => {
    // The English message is the only diagnostic left once the visitor-facing
    // string comes from the catalogue, so a code without one is a route that
    // logs nothing useful when it fires.
    const withoutMessage: string[] = [];
    for (const file of routeFiles(routesDir)) {
      const source = readFileSync(file, "utf-8");
      const relative = file.slice(repoRoot.length + 1).replace(/\\/g, "/");
      // Same object-property anchoring as ERROR_PROPERTY, plus the rest of the
      // line so the neighbouring `message:` is visible.
      for (const match of source.matchAll(
        /(?:^|[{,])\s*error:\s*"([^"]+)"([^\n]*)/gm,
      )) {
        const code = match[1] as string;
        const rest = match[2] as string;
        // `invalid_session` and `invalid_code` predate the migration and are
        // read by the SDK's auth ladder as protocol signals rather than
        // rendered, so they legitimately carry no message.
        if (code === "invalid_session" || code === "invalid_code") continue;
        if (!rest.includes("message:")) {
          withoutMessage.push(`${relative}: ${code}`);
        }
      }
    }
    expect(withoutMessage).toEqual([]);
  });

  it("maps every WIRE_CODE_KEYS entry to a real catalogue key", () => {
    const broken = Object.entries(WIRE_CODE_KEYS).filter(
      ([, key]) => typeof lookup(en, key) !== "string",
    );
    expect(broken).toEqual([]);
  });

  it("keeps the protocol codes the auth ladder depends on", () => {
    // `AuthSession` clears the stored `sid` on `invalid_session`, and the
    // handoff exchange reports `invalid_code`. Renaming either silently breaks
    // sign-in rather than failing a type check.
    expect(codes.has("invalid_session")).toBe(true);
    expect(codes.has("invalid_code")).toBe(true);
  });
});
