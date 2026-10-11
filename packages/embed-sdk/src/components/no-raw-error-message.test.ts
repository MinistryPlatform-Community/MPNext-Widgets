/**
 * Guard: a caught error's `message` never reaches a congregant.
 *
 * Every widget used to render `err instanceof Error ? err.message : …`. That is
 * safe for the errors a widget throws itself (already translated by
 * `errorText` / `t`), and wrong for everything else a `catch` sees — above all
 * the browser's `TypeError: Failed to fetch`, which is English on every page
 * and worded differently per browser (`pledge-campaign` showed it verbatim).
 *
 * The contract (`shared/base-widget.ts`):
 *   - a translated error is thrown as `new WidgetError(this.errorText(…))` or
 *     `new WidgetError(this.t(…))`;
 *   - a `catch` renders `this.caughtText(err, fallbackKey)`, which returns a
 *     WidgetError's message and logs and replaces anything else.
 *
 * This is a static scan, so it has two halves: no component reads a caught
 * error's `.message` itself, and no component throws a translated sentence in
 * a plain `Error` (which `caughtText` would then — correctly — refuse to show,
 * silently swapping a precise message for the fallback).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(import.meta.dirname, "..");
const SCANNED_DIRS = ["components", "shared"];

/** `caughtText` itself is the one place allowed to read `.message`. */
const EXEMPT_FILES = new Set(["shared/base-widget.ts"]);

/**
 * Reads that never reach markup. Each entry is a file plus a substring of the
 * offending line, with the reason. Keep it short.
 */
const ALLOWED: { file: string; line: string; why: string }[] = [
  {
    file: "components/full-calendar.ts",
    line: "raw: err instanceof Error ? err.message : String(err)",
    why: "debug detail on the host-page `fullCalendarError` event; the rendered text is fullCalendar.initFailed",
  },
];

/** A caught error's message: `err.message`, `error.message`, `e.message`, … */
const CAUGHT_MESSAGE = /\b(?:err|error|e|ex|caught|reason)\.message\b/;
/** A translated sentence thrown in a plain Error rather than a WidgetError. */
const PLAIN_TRANSLATED_THROW = /new Error\(\s*this\.(?:errorText|t)\(/;

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const name of readdirSync(join(SRC, dir))) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const file = `${dir}/${name}`;
      if (EXEMPT_FILES.has(file)) continue;
      out.push({ file, text: readFileSync(join(SRC, dir, name), "utf8") });
    }
  }
  return out;
}

/** Strip `//` and `/* *\/` comments, keeping line numbers. */
function code(text: string): string[] {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlock.split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1"));
}

describe("caught error messages are never rendered", () => {
  const files = sources();

  it("scans the widget sources", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("no component reads a caught error's .message (use this.caughtText)", () => {
    const hits: string[] = [];
    for (const { file, text } of files) {
      code(text).forEach((line, i) => {
        if (!CAUGHT_MESSAGE.test(line)) return;
        if (ALLOWED.some((a) => a.file === file && line.includes(a.line))) return;
        hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("translated errors are thrown as WidgetError, not Error", () => {
    const hits: string[] = [];
    for (const { file, text } of files) {
      // Joined, so a throw split across lines is still seen.
      const joined = code(text).join("\n");
      const re = new RegExp(PLAIN_TRANSLATED_THROW.source, "g");
      for (const m of joined.matchAll(re)) {
        const lineNo = joined.slice(0, m.index).split("\n").length;
        hits.push(`${file}:${lineNo}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("every ALLOWED entry still matches a line (delete stale ones)", () => {
    for (const a of ALLOWED) {
      const src = files.find((f) => f.file === a.file);
      expect(src?.text, `${a.file} not scanned`).toBeDefined();
      expect(src!.text.includes(a.line), `stale ALLOWED entry: ${a.file}`).toBe(true);
    }
  });

  it("the scan can fail", () => {
    expect(CAUGHT_MESSAGE.test("this.error = err instanceof Error ? err.message : x;")).toBe(true);
    expect(CAUGHT_MESSAGE.test("this.message = { type, text };")).toBe(false);
    expect(PLAIN_TRANSLATED_THROW.test("throw new Error(\n  this.errorText(body))")).toBe(true);
    expect(PLAIN_TRANSLATED_THROW.test("throw new WidgetError(this.errorText(body))")).toBe(false);
  });
});
