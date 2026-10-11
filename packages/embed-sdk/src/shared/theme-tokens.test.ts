/**
 * Guard: raw brand values in widget stylesheets only ever go down (C68, W7).
 *
 * The `--nw-*` contract (`theme-tokens.ts`) is only worth publishing if every
 * widget actually reads it — a half-converted token set is worse than none,
 * because a church cannot tell which rules a token reaches. This ratchet keeps
 * the conversion honest, in the style of `i18n/no-english-literals.test.ts`.
 *
 * ## The ratchet
 *
 * Each style-bearing file carries a **budget** per value class: how many raw
 * values a token covers that it still writes as literals. The test fails in
 * both directions:
 *
 *   - **over budget** — a regression: new CSS wrote a brand hex instead of
 *     `var(--_nw-…)`.
 *   - **under budget** — lower the number in the same commit that did the
 *     conversion, so the table never drifts into fiction.
 *
 * Finish line: every entry at 0, then collapse the table into one "no file may
 * contain any" assertion.
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

/**
 * Raw values a token covers that each file still writes as literals.
 * Keys are paths under `packages/embed-sdk/src/`. Omitted classes are 0.
 *
 * Baseline 2026-10-11 (W7a): 497 brand hexes and 35 font stacks across 37
 * files. That is after the reference conversion — `event-finder.ts` (was
 * 18 + 1) and `shared/card-link.ts` (was 1) went to 0, and
 * `full-calendar-styles.ts` (was 50) mapped eight brand `--fc-classic-*`
 * defaults onto the tokens with the old hex as the `var()` fallback.
 */
const BUDGET: Record<string, Partial<Record<ValueClass, number>>> = {
  "components/add-to-calendar.ts": { brandHex: 7, fontStack: 1 },
  "components/checkout-complete.ts": { brandHex: 9, fontStack: 1 },
  "components/checkout.ts": { brandHex: 17, fontStack: 1 },
  "components/custom-form.ts": { brandHex: 6, fontStack: 1 },
  "components/event-details.ts": { brandHex: 29, fontStack: 1 },
  "components/full-calendar-styles.ts": { brandHex: 42, fontStack: 1 },
  "components/full-calendar.ts": { brandHex: 7 },
  "components/giving-shared.ts": { brandHex: 2 },
  "components/group-details.ts": { brandHex: 18, fontStack: 1 },
  "components/group-finder.ts": { brandHex: 21, fontStack: 1 },
  "components/locale-selector.ts": { brandHex: 9, fontStack: 1 },
  "components/mission-trip-finder.ts": { brandHex: 15, fontStack: 1 },
  "components/my-contribution-statement.ts": { brandHex: 17, fontStack: 1 },
  "components/my-giving.ts": { brandHex: 27, fontStack: 3 },
  "components/my-groups.ts": { brandHex: 7, fontStack: 1 },
  "components/my-invoices.ts": { brandHex: 19, fontStack: 1 },
  "components/my-mission-trips.ts": { brandHex: 18, fontStack: 1 },
  "components/my-pledges.ts": { brandHex: 12, fontStack: 1 },
  "components/opportunity-details.ts": { brandHex: 20, fontStack: 1 },
  "components/opportunity-finder.ts": { brandHex: 17, fontStack: 1 },
  "components/pay.ts": { brandHex: 13, fontStack: 1 },
  "components/plan-your-visit.ts": { brandHex: 14, fontStack: 1 },
  "components/pledge-campaign.ts": { brandHex: 17, fontStack: 1 },
  "components/prayer-feedback.ts": { brandHex: 14, fontStack: 1 },
  "components/pre-check.ts": { brandHex: 20, fontStack: 1 },
  "components/statement-preferences.ts": { brandHex: 6, fontStack: 1 },
  "components/subscribe-to-publication.ts": { brandHex: 13, fontStack: 1 },
  "components/unsubscribe.ts": { brandHex: 10, fontStack: 1 },
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

describe("theme tokens: raw brand values ratchet", () => {
  it("scans the widget sources it is supposed to scan", () => {
    // A scanner that silently stopped finding files would pass every budget.
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain("components/event-finder.ts");
    expect(files).toContain("components/full-calendar-styles.ts");
  });

  it("has no budget entry for a file that no longer exists", () => {
    const stale = Object.keys(BUDGET).filter((f) => !files.includes(f));
    expect(stale, "budget entries for missing files").toEqual([]);
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

  for (const file of files) {
    it(`${file} stays at its budget`, () => {
      const budget = BUDGET[file] ?? {};
      const problems: string[] = [];
      for (const cls of CLASSES) {
        const allowed = budget[cls] ?? 0;
        const found = actual[file][cls];
        if (found > allowed) {
          problems.push(
            `${cls}: ${found} raw values, over the budget of ${allowed}. Use var(--_nw-…) — see W7-theming-tokens.md "How to convert".`,
          );
        } else if (found < allowed) {
          problems.push(
            `${cls}: down to ${found}, below the budget of ${allowed}. Lower the entry in BUDGET to ${found}${found === 0 ? " (or delete it)" : ""} — the ratchet only means something if the number is kept honest.`,
          );
        }
      }
      if (problems.length > 0) {
        throw new Error([`${file}:`, ...problems].join("\n"));
      }
    });
  }
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
