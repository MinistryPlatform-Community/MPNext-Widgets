/**
 * Guard: no widget stylesheet writes a raw brand value (C68, W7).
 *
 * The `--nw-*` contract (`theme-tokens.ts`) is only worth publishing if every
 * widget actually reads it — a half-converted token set is worse than none,
 * because a church cannot tell which rules a token reaches.
 *
 * This was a per-file ratchet (a `BUDGET` table, in the style of
 * `i18n/no-english-literals.test.ts`) while W7 converted the catalogue. It
 * reached zero on 2026-10-11 — the last three entries were the amber pending
 * stripe in `checkout-complete.ts` (now `--nw-color-warning`) and two font
 * stacks in `add-to-calendar.ts` / `my-giving.ts` that differed slightly from
 * the token stack (now `--nw-font-family`) — and collapsed into the plain
 * assertion below: **no file may contain any.**
 *
 * ## What is counted
 *
 * - `brandHex` — the seven brand-palette hexes (`#004C97 #002855 #F1BE48
 *   #009CDE #86AD3F #FF6D6A #2D2926`), case-insensitive.
 * - `fontStack` — a literal `ui-sans-serif` font stack (`--nw-font-family`).
 *
 * Not counted: comments, and a hex that is the **fallback** of a `var()`
 * (`var(--_nw-color-primary, #004C97)`). That form is legitimate where the
 * token block may be absent — light-DOM portal styles appended to
 * `document.head`, and the `--fc-classic-*` contract in
 * `full-calendar-styles.ts`. Everywhere else, write the bare `var(--_nw-…)`.
 *
 * Neutral greys, radii, spacing and shadows are tokenised too, but a raw
 * `8px` or `#e5e7eb` cannot be told apart from a deliberate per-component
 * value, so they are converted by hand (W7-theming-tokens.md, "How to
 * convert") rather than counted.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { THEME_TOKENS, THEME_TOKENS_CSS } from "./theme-tokens";

const SRC = resolve(import.meta.dirname, "..");
const REPO = resolve(SRC, "../../..");
const SCANNED_DIRS = ["components", "shared"];

/** The token module itself is where the defaults live, so it is exempt. */
const EXEMPT = new Set(["shared/theme-tokens.ts"]);

type ValueClass = "brandHex" | "fontStack";

const PATTERNS: Record<ValueClass, RegExp> = {
  brandHex: /#(?:004C97|002855|F1BE48|009CDE|86AD3F|FF6D6A|2D2926)(?![0-9a-f])/gi,
  fontStack: /ui-sans-serif/g,
};

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** Drop `var(--name, <fallback>)` fallbacks, innermost first. */
function stripVarFallbacks(text: string): string {
  let prev: string;
  let out = text;
  do {
    prev = out;
    out = out.replace(/var\(\s*(--[\w-]+)\s*,[^()]*\)/g, "var($1)");
  } while (out !== prev);
  return out;
}

function scannedFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const name of readdirSync(join(SRC, dir))) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name.endsWith(".d.ts")) continue;
      const rel = [dir, name].join("/");
      if (!EXEMPT.has(rel)) files.push(rel);
    }
  }
  return files.sort();
}

function countFile(rel: string): Record<ValueClass, number> {
  const text = stripVarFallbacks(stripComments(readFileSync(join(SRC, rel), "utf8")));
  const counts = {} as Record<ValueClass, number>;
  for (const [cls, re] of Object.entries(PATTERNS) as [ValueClass, RegExp][]) {
    counts[cls] = (text.match(re) ?? []).length;
  }
  return counts;
}

const files = scannedFiles();
const actual = Object.fromEntries(files.map((f) => [f, countFile(f)]));
const CLASSES = Object.keys(PATTERNS) as ValueClass[];

describe("theme tokens: no raw brand values", () => {
  it("scans the widget sources it is supposed to scan", () => {
    // A scanner that silently stopped finding files would always pass.
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain("components/event-finder.ts");
    expect(files).toContain("components/full-calendar-styles.ts");
  });

  it("strips var() fallbacks and comments before counting", () => {
    const sample = [
      "/* #004C97 */",
      "// #002855",
      "a { color: var(--_nw-color-primary, #004C97); }",
      "b { color: var(--x, var(--y, #F1BE48)); }",
      "c { color: #2d2926; background: #004C9799; }",
    ].join("\n");
    const text = stripVarFallbacks(stripComments(sample));
    expect(text.match(PATTERNS.brandHex)).toEqual(["#2d2926"]);
  });

  it("no widget source writes a raw brand hex or font stack", () => {
    const problems: string[] = [];
    for (const file of files) {
      for (const cls of CLASSES) {
        const found = actual[file][cls];
        if (found > 0) problems.push(`${file}: ${found} raw ${cls}`);
      }
    }
    expect(
      problems,
      'Use var(--_nw-…) instead -- see W7-theming-tokens.md "How to convert". A value with no token stays literal only if it is not one of these.',
    ).toEqual([]);
  });
});

describe("theme tokens: the contract", () => {
  it("declares a resolved private name for every public token", () => {
    for (const t of THEME_TOKENS) {
      expect(t.name).toMatch(/^nw-[a-z0-9-]+$/);
      expect(THEME_TOKENS_CSS).toContain(`--_${t.name}: var(--${t.name}, ${t.value});`);
    }
  });

  it("has unique token names", () => {
    const names = THEME_TOKENS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only references tokens that exist", () => {
    const names = new Set(THEME_TOKENS.map((t) => t.name));
    for (const t of THEME_TOKENS) {
      for (const ref of t.value.matchAll(/var\(--_(nw-[a-z0-9-]+)\)/g)) {
        expect(names.has(ref[1]), `${t.name} references unknown ${ref[1]}`).toBe(true);
      }
    }
  });

  it("is a :host block, so it pierces nothing it should not", () => {
    expect(THEME_TOKENS_CSS.startsWith(":host {")).toBe(true);
    expect(THEME_TOKENS_CSS.trim().endsWith("}")).toBe(true);
  });

  it("documents every token, with its default, in the README", () => {
    // The README "Theming" table is the published API; it must not drift.
    const readme = readFileSync(join(REPO, "README.md"), "utf8");
    for (const t of THEME_TOKENS) {
      expect(readme, `README is missing --${t.name}`).toContain(`\`--${t.name}\``);
    }
  });

  it("widget CSS reads only tokens that exist", () => {
    const names = new Set(THEME_TOKENS.map((t) => t.name));
    const unknown: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(SRC, file), "utf8");
      for (const m of text.matchAll(/var\(--_(nw-[a-z0-9-]+)/g)) {
        if (!names.has(m[1])) unknown.push(`${file}: --_${m[1]}`);
      }
    }
    expect(unknown, "var(--_nw-…) names with no token behind them").toEqual([]);
  });
});
