import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fails if any source file joins two template literals with `+`.
 *
 * Next 16 / Turbopack's production minifier miscompiles a `+` chain of
 * template literals whose interpolations are all compile-time constants: it
 * folds the chain and drops literal text. A real incident in a sibling repo
 * sent MP the filter `Pertains_To_Page_ID=376From_Contact=142157` -- the
 * trailing ` AND ` of the first literal and the whole middle literal were gone
 * -- and MP answered `Invalid column name 'From_Contact'`. The same source ran
 * correctly under `next dev`, `tsx` and Vitest, because none of them minify, so
 * it reproduced only in the deployed bundle.
 *
 * A chain with at least one runtime interpolation folds correctly today, which
 * is why the fault stayed invisible until a query built entirely from module
 * constants finally executed. That distinction is too subtle to police by
 * review, so the rule here is the blunt one: never `+` two template literals.
 * Write one literal, or an array and `.join(...)`.
 *
 * Plain quoted strings (`"a" + "b"`) are unaffected and allowed, as is a
 * template literal added to a runtime expression (`` `<b>` + items.join("") ``).
 *
 * See `.claude/references/nextjs.build-hazards.md` for the full incident and
 * the "grep the built chunk" diagnostic.
 */

const repoRoot = resolve(import.meta.dirname, "../..");

const ROOTS = ["src", "packages", "e2e", "scripts"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "playwright-report",
  "test-results",
]);
const SOURCE = /\.(?:m?[jt]sx?|cts|mts)$/;

/** Whitespace and comments, which may sit between the literals and the `+`. */
function skipTrivia(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    return i;
  }
}

/** True when a `/` at `i` opens a regex literal rather than a division. */
function isRegexStart(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  return j < 0 || "(,=:[!&|?{};+-*%~^".includes(src[j]);
}

/**
 * Character offsets of every `+` that joins the close of one template literal
 * to the open of the next. Walks the file as a small state machine (strings,
 * comments, regexes, and `${}` nesting) rather than by regex, so a backtick
 * inside a comment or a quoted string cannot produce a phantom hit.
 */
function findTemplateConcats(src: string): number[] {
  const hits: number[] = [];
  /** Brace depth each open template resumes at -- one entry per `${` we are inside. */
  const resumeAt: number[] = [];
  let braceDepth = 0;
  let inTemplate = false;
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (inTemplate) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "$" && src[i + 1] === "{") {
        resumeAt.push(braceDepth);
        braceDepth++;
        inTemplate = false;
        i += 2;
        continue;
      }
      if (c === "`") {
        inTemplate = false;
        const plus = skipTrivia(src, i + 1);
        if (src[plus] === "+" && src[skipTrivia(src, plus + 1)] === "`") hits.push(plus);
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === "/" && isRegexStart(src, i)) {
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) {
          i++;
          break;
        } else if (src[i] === "\n") break;
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote || src[i] === "\n") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      i++;
      continue;
    }
    if (c === "{") {
      braceDepth++;
      i++;
      continue;
    }
    if (c === "}") {
      braceDepth--;
      if (resumeAt.length > 0 && resumeAt[resumeAt.length - 1] === braceDepth) {
        resumeAt.pop();
        inTemplate = true;
      }
      i++;
      continue;
    }
    i++;
  }

  return hits;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (SOURCE.test(name)) out.push(path);
  }
  return out;
}

describe("no template-literal `+` chains", () => {
  it("the scanner flags a chain and ignores the lookalikes", () => {
    const flagged = [
      "const f = `a=${x} ` +\n  `AND b=${y}`;",
      "const f = `a` + `b`;",
      "const f = `a` /* why */ + `b`;",
    ];
    const clean = [
      'const f = "a" + "b";',
      'const f = `<b>` + items.join("");',
      "// `a` + `b` in a comment",
      "/** JSDoc mentioning `Foo` + `Bar` */\nconst f = 1;",
      "const s = 'it`s fine' + `ok`;",
      "const re = /[`]/;\nconst f = `a`;",
      "const f = `outer ${`inner`} done`;",
    ];
    for (const src of flagged) expect(findTemplateConcats(src), src).toHaveLength(1);
    for (const src of clean) expect(findTemplateConcats(src), src).toHaveLength(0);
  });

  it("no source file joins two template literals with `+`", () => {
    const violations: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(resolve(repoRoot, root))) {
        const src = readFileSync(file, "utf8");
        for (const at of findTemplateConcats(src)) {
          const line = src.slice(0, at).split("\n").length;
          const path = relative(repoRoot, file).split("\\").join("/");
          violations.push(`${path}:${line}`);
        }
      }
    }
    expect(
      violations,
      [
        "Template literals joined with `+` are folded incorrectly by the production minifier.",
        "Use one literal, or an array and .join(...).",
        "See .claude/references/nextjs.build-hazards.md.",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });
});
