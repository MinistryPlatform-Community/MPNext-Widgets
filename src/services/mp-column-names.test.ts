/**
 * Guard: services must not write MP column names that do not exist.
 *
 * MinistryPlatform's REST layer does not reject an unknown key in a record —
 * it ignores it. So a misspelled column is silent on every axis that normally
 * catches a mistake: the request succeeds, the response looks right, the types
 * are fine, and the created row is plausible because the database supplies its
 * own default. Nothing fails until a domain's default differs from the value
 * the code intended to write, at which point the symptom appears somewhere
 * unrelated.
 *
 * `C83` is the worked example. `planYourVisitService` resolved the Active
 * `Contact_Status_ID` correctly and then wrote it as `Status:` — a column
 * `Contacts` does not have. It survived because it was a faithful port of
 * legacy's shared `ContactManager.CreateContact`, which makes the same mistake,
 * and because the stock default happens to be Active.
 *
 * ## Why this is a source scan and not a behavioural test
 *
 * The honest answer is that the behavioural test is better and this is what is
 * affordable. `createContact` is private behind `saveVisitDetails`, a flow that
 * writes a household, an address, several contacts, participants and milestone
 * assignments; standing that up to assert one key is a large fixture for a
 * narrow claim. This scan instead catches the whole *class*, including the way
 * the defect actually arrives — someone copies a record literal out of the
 * legacy .NET source, which is wrong about this column and may be wrong about
 * others.
 *
 * **Add to `FORBIDDEN` whenever MP disproves a column name.** Each entry should
 * name the real column, so the failure message fixes the problem rather than
 * merely reporting it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const servicesDir = resolve(import.meta.dirname);

interface ForbiddenColumn {
  /** The key as it would be written in a record literal. */
  wrong: string;
  /** The column MP actually has. */
  right: string;
  /** Why anyone would write the wrong one. */
  note: string;
}

const FORBIDDEN: ForbiddenColumn[] = [
  {
    wrong: "Status",
    right: "Contact_Status_ID",
    note:
      "`Contacts` has no `Status` column — confirmed against the live domain. " +
      "Legacy's ContactManager.CreateContact writes `Status`, so a port from it " +
      "reproduces the bug. See .claude/TODO/Comparison/C83-*.",
  },
];

/** Every non-test service source. */
function serviceFiles(): string[] {
  return readdirSync(servicesDir)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .map((n) => join(servicesDir, n));
}

describe("MP column names in service record literals", () => {
  it("scans the service sources it is supposed to scan", () => {
    // A guard against the guard: a broken path would make the assertion below
    // pass vacuously.
    const files = serviceFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("planYourVisitService.ts"))).toBe(true);
  });

  for (const { wrong, right, note } of FORBIDDEN) {
    it(`never writes \`${wrong}:\` as a record key (use \`${right}\`)`, () => {
      // Anchored to a record-literal key position: start of line or an opening
      // brace or comma, then the bare key and a colon. A bare /Status:/ would
      // also match `Contact_Status_ID:`, `Participation_Status_ID:` and the
      // word inside a comment or a `$select` string, all of which are fine.
      const pattern = new RegExp(String.raw`(?:^|[{,])\s*${wrong}:\s`, "gm");

      const offenders: string[] = [];
      for (const file of serviceFiles()) {
        const source = readFileSync(file, "utf-8");
        if (pattern.test(source)) {
          offenders.push(file.slice(servicesDir.length + 1));
        }
        pattern.lastIndex = 0;
      }

      expect(offenders, `${note} Use \`${right}\`.`).toEqual([]);
    });
  }

  it("still finds the real column, so the fix is present rather than merely absent", () => {
    // The paired assertion. Deleting the write entirely would satisfy the
    // scan above while leaving a required MP column unset.
    const source = readFileSync(join(servicesDir, "planYourVisitService.ts"), "utf-8");
    expect(source).toContain("Contact_Status_ID: c.statusId");
  });
});
