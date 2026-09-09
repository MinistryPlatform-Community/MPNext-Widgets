/**
 * Guard: no new hardcoded English in widget markup, and the existing count only
 * ever goes down.
 *
 * This is the test that keeps the localisation layer alive. Without it the layer
 * decays within a few PRs — someone adds a feature, writes the label inline
 * because that is what the surrounding code looked like when they started, and
 * the Spanish page silently grows an English patch that nobody notices until a
 * customer does.
 *
 * ## The ratchet
 *
 * Each file carries a **budget**: how many markup-embedded English literals it
 * still has. The test fails in both directions:
 *
 *   - **over budget** — a regression. New hardcoded copy, or a conversion that
 *     missed a spot.
 *   - **under budget** — the budget must be lowered in the same commit that did
 *     the conversion. Annoying by design: it is what stops the table drifting
 *     into fiction, and it makes progress objectively measurable rather than a
 *     matter of opinion.
 *
 * The conversion has a finish line: every entry at 0, at which point the whole
 * table can be replaced by a single "no file may contain any" assertion.
 *
 * ## What the number is, and is not
 *
 * The scanner (`scripts/i18n-scan.mjs`) reports text nodes and user-facing
 * attribute values inside template literals. That is the regression-prone
 * surface, not the total string count — copy held in a variable, built by a
 * helper, or thrown as an `Error` is invisible to it, so the real catalogue is
 * larger than the sum of these budgets. The pseudo-locale
 * (`MPNextEmbed.enablePseudoLocale()`) covers that gap in the browser: anything
 * still rendering in plain ASCII was never extracted.
 */

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { scanCounts, scanRepo, scannedFiles } from "../../../../scripts/i18n-scan.mjs";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const PREFIX = "packages/embed-sdk/src/";
const NEWLINE = String.fromCharCode(10);

/**
 * Files still carrying hardcoded English, with the count each still has.
 *
 * **Empty, and it should stay that way.** The conversion completed on
 * 2026-09-09: all 30 widget sources route their copy through `this.t(...)`, so
 * the ratchet's job is now purely to keep new literals out. It started from a
 * baseline of 395 across 27 files.
 *
 * An entry here means someone is mid-migration on a newly added widget. Add one
 * only with a plan to remove it — never to silence a failure.
 */
const BUDGET: Record<string, number> = {};

const counts = scanCounts(repoRoot) as Record<string, number>;

/** Counts re-keyed to the short paths the budget table uses. */
const actual: Record<string, number> = {};
for (const [file, count] of Object.entries(counts)) {
  actual[file.startsWith(PREFIX) ? file.slice(PREFIX.length) : file] = count;
}

describe("no hardcoded English in widget markup", () => {
  it("scans the widget sources it is supposed to scan", () => {
    // A guard against the guard: a scanner that silently stopped finding files
    // would make every budget assertion below pass.
    const files = scannedFiles(repoRoot) as string[];
    expect(files.length).toBeGreaterThan(25);
    expect(files).toContain("packages/embed-sdk/src/components/event-details.ts");
  });

  it("has no budget entry for a file that no longer exists", () => {
    const files = new Set(
      (scannedFiles(repoRoot) as string[]).map((f) =>
        f.startsWith(PREFIX) ? f.slice(PREFIX.length) : f,
      ),
    );
    const stale = Object.keys(BUDGET).filter((f) => !files.has(f));
    expect(stale, "budget entries for missing files").toEqual([]);
  });

  it("introduces no hardcoded English in a file with no budget", () => {
    const unbudgeted = Object.entries(actual)
      .filter(([file]) => BUDGET[file] === undefined)
      .map(([file, count]) => `${file} (${count})`);

    expect(
      unbudgeted,
      "These files have no budget entry, so every literal in them is new. Route the copy through `this.t(...)` — see WIDGET-I18N-PLAN.md.",
    ).toEqual([]);
  });

  for (const [file, budget] of Object.entries(BUDGET)) {
    it(`${file} stays at or below its budget of ${budget}`, () => {
      const found = actual[file] ?? 0;

      if (found > budget) {
        const detail = describeFindings(file);
        throw new Error(
          [
            `${file} has ${found} hardcoded English literals, over its budget of ${budget}.`,
            "New user-facing copy must go through `this.t(...)` and the catalogue.",
            detail,
          ].join("\n"),
        );
      }

      if (found < budget) {
        throw new Error(
          [
            `${file} is down to ${found} hardcoded literals, below its budget of ${budget}.`,
            found === 0
              ? `Lower the entry in BUDGET to 0, or delete it — this file is done.`
              : `Lower the entry in BUDGET to ${found}.`,
            "The ratchet only means something if the number is kept honest.",
          ].join("\n"),
        );
      }

      expect(found).toBe(budget);
    });
  }
});

/** The offending lines, so a failure is actionable without re-running a script. */
function describeFindings(shortFile: string): string {
  const full = `${PREFIX}${shortFile}`;
  const findings = (
    scanRepo(repoRoot) as Record<
      string,
      { line: number; kind: string; text: string }[]
    >
  )[full];
  if (!findings) return "";
  return findings
    .map((f) => `  ${full}:${f.line} [${f.kind}] ${JSON.stringify(f.text)}`)
    .join(NEWLINE);
}
