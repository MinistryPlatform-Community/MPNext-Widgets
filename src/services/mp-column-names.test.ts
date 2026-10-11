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
import { readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
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
      "reproduces the bug. See comparison finding C83.",
  },
];

interface ForbiddenSelect {
  /** The MP table the `$select` reads. */
  table: string;
  /** A column that table does not have. */
  column: string;
  /** Where the value really comes from. */
  note: string;
}

/**
 * Columns that are real on a *procedure's* result but not on the table of the
 * same name, so declaring them in a proc-row interface is fine and selecting
 * them from the table is not. Table-scoped for exactly that reason.
 */
const FORBIDDEN_SELECT: ForbiddenSelect[] = [
  {
    table: "Invoices",
    column: "Amount_Paid",
    note:
      "`Invoices` has no `Amount_Paid` column (12 columns, confirmed live) — MP " +
      "500s the whole GET. The paid total comes from the `api_MPPW_GetInvoice` " +
      "header via `invoiceService.getCheckoutInvoiceByGuid`. See comparison " +
      "finding C40.",
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

  for (const { table, column, note } of FORBIDDEN_SELECT) {
    it(`never selects \`${column}\` from the \`${table}\` table`, () => {
      // A record-key scan cannot see this class: a `$select` naming a column
      // the table lacks is a string, not a key. Unlike an unknown write key,
      // MP does *not* ignore it — the whole GET answers 500 — so this is the
      // failure that took every payment write down in C40.
      //
      // Matches each `table: "<T>", select: "<cols>"` pair (whitespace and a
      // line break between them allowed), then checks the column list.
      const pattern = new RegExp(
        String.raw`table:\s*"${table}"\s*,\s*select:\s*"([^"]*)"`,
        "g"
      );
      const offenders: string[] = [];
      for (const file of serviceFiles()) {
        const source = readFileSync(file, "utf-8");
        for (const match of source.matchAll(pattern)) {
          const cols = (match[1] ?? "").split(",").map((c) => c.trim());
          if (cols.includes(column)) {
            offenders.push(file.slice(servicesDir.length + 1));
          }
        }
      }
      expect(offenders, note).toEqual([]);
    });
  }

  it("the select scan recognises the shape it guards", () => {
    // Guard against the guard: if the call-site shape drifted, the scan above
    // would pass vacuously. `invoiceService` selects from `Invoices` today.
    const source = readFileSync(join(servicesDir, "invoiceService.ts"), "utf-8");
    expect(source).toMatch(/table:\s*"Invoices"\s*,\s*select:\s*"/);
  });

  it("still finds the real column, so the fix is present rather than merely absent", () => {
    // The paired assertion. Deleting the write entirely would satisfy the
    // scan above while leaving a required MP column unset.
    const source = readFileSync(join(servicesDir, "planYourVisitService.ts"), "utf-8");
    expect(source).toContain("Contact_Status_ID: c.statusId");
  });
});

// ── Model-checked `$select` scan (W8, C40 class) ────────────────────────────
//
// `FORBIDDEN_SELECT` above is a denylist: it only catches a phantom column
// someone has already been bitten by. This scan checks every statically
// resolvable `{ table, select }` pair in the services against the generated
// table models in `src/lib/providers/ministry-platform/models/` (one interface
// per MP table, generated from MP's column metadata), so the *next* phantom
// column fails here rather than as an MP 500 in a customer's browser.
//
// It is conservative on purpose. A select item is checked only when, once a
// trailing `AS alias` is removed, it is a bare column (`Col`, `[Col]`) or a
// column qualified with the primary table's own name (`Invoices.Col`).
// Skipped, because the model of the primary table cannot judge them:
// `_TABLE` traversals (`Household_ID_Table.Col`, `X_ID_TABLE_Y_ID_TABLE.Col`),
// function calls and expressions (`ISNULL(...)`, `CASE ...`, `'lit' + ...`),
// `dp_` system columns (`dp_fileUniqueId` is real but not in the models),
// `*`, and anything built from a runtime value. Tables with no model, and
// selects that are not statically resolvable (e.g. built by a method with
// branches), are skipped too.
//
// The models are a generated snapshot, so a column added to MP after
// generation would read as phantom. That is why a hit is reported for a human
// to verify against MP rather than auto-fixed -- and why
// `SELECT_KNOWN_DEFECTS` below carries a reason per entry.

const modelsDir = resolve(import.meta.dirname, "../lib/providers/ministry-platform/models");

/** MP table name (lower-cased) -> lower-cased column names, from the generated interfaces. */
function loadModels(): Map<string, Set<string>> {
  const models = new Map<string, Set<string>>();
  for (const name of readdirSync(modelsDir)) {
    if (!name.endsWith(".ts") || name.endsWith("Schema.ts") || name === "index.ts") continue;
    const source = readFileSync(join(modelsDir, name), "utf-8");
    const table = /\*\s*Table:\s*(\S+)/.exec(source)?.[1];
    if (!table) continue;
    const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const columns = new Set<string>();
    for (const stmt of sf.statements) {
      if (!ts.isInterfaceDeclaration(stmt)) continue;
      for (const member of stmt.members) {
        if (ts.isPropertySignature(member)) {
          columns.add(member.name.getText(sf).replace(/^["']|["']$/g, "").toLowerCase());
        }
      }
    }
    if (columns.size > 0) models.set(table.toLowerCase(), columns);
  }
  return models;
}

/** Stands in for a runtime value inside a resolved select string. */
const DYNAMIC = "\u0000";

/**
 * The static text of a `select` expression, or `null` when it cannot be
 * resolved. Follows string literals, templates (substitutions become
 * `DYNAMIC`), `+`, `[...].join(sep)`, same-file `const`s, and zero-argument
 * `this.method()` calls whose body is a single `return`.
 */
function resolveSelect(expr: ts.Expression, sf: ts.SourceFile, depth = 0): string | null {
  if (depth > 5) return null;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isParenthesizedExpression(expr)) return resolveSelect(expr.expression, sf, depth);
  if (ts.isTemplateExpression(expr)) {
    return [expr.head.text, ...expr.templateSpans.map((s) => DYNAMIC + s.literal.text)].join("");
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = resolveSelect(expr.left, sf, depth + 1);
    const r = resolveSelect(expr.right, sf, depth + 1);
    return l === null || r === null ? null : l + r;
  }
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === "join" &&
    ts.isArrayLiteralExpression(expr.expression.expression)
  ) {
    const sepArg = expr.arguments[0];
    const sep = sepArg === undefined ? "," : resolveSelect(sepArg, sf, depth + 1);
    if (sep === null) return null;
    const parts = expr.expression.expression.elements.map((e) => resolveSelect(e, sf, depth + 1));
    return parts.some((p) => p === null) ? null : parts.join(sep);
  }
  if (ts.isIdentifier(expr)) {
    let found: ts.Expression | undefined;
    const find = (n: ts.Node): void => {
      if (found) return;
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === expr.text &&
        n.initializer &&
        ts.isVariableDeclarationList(n.parent) &&
        (n.parent.flags & ts.NodeFlags.Const) !== 0
      ) {
        found = n.initializer;
        return;
      }
      ts.forEachChild(n, find);
    };
    find(sf);
    return found ? resolveSelect(found, sf, depth + 1) : null;
  }
  if (
    ts.isCallExpression(expr) &&
    expr.arguments.length === 0 &&
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    const name = expr.expression.name.text;
    let body: ts.Expression | undefined;
    const find = (n: ts.Node): void => {
      if (body) return;
      if (ts.isMethodDeclaration(n) && n.name.getText(sf) === name && n.body) {
        const stmts = n.body.statements;
        if (stmts.length === 1 && ts.isReturnStatement(stmts[0]) && stmts[0].expression) {
          body = stmts[0].expression;
        }
        return;
      }
      ts.forEachChild(n, find);
    };
    find(sf);
    return body ? resolveSelect(body, sf, depth + 1) : null;
  }
  return null;
}

/** Splits a select list on top-level commas (not inside parens, brackets or quotes). */
function splitSelect(select: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote = false;
  let bracket = false;
  let start = 0;
  for (let i = 0; i < select.length; i++) {
    const c = select[i];
    if (quote) {
      if (c === "'") quote = false;
    } else if (bracket) {
      if (c === "]") bracket = false;
    } else if (c === "'") quote = true;
    else if (c === "[") bracket = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      items.push(select.slice(start, i));
      start = i + 1;
    }
  }
  items.push(select.slice(start));
  return items.map((s) => s.trim()).filter(Boolean);
}

/**
 * The primary-table column a select item names, or `null` when the item is
 * not something this scan judges (see the rules above).
 */
function bareColumn(item: string, table: string): string | null {
  if (item.includes(DYNAMIC)) return null;
  const expr = item.replace(/\s+as\s+(\[[^\]]+\]|\w+)\s*$/i, "").trim();
  const m = /^(?:(\w+)\.)?(\[[^\]]+\]|\w+)$/.exec(expr);
  if (!m) return null;
  const [, qualifier, rawColumn] = m;
  if (qualifier && qualifier.toLowerCase() !== table.toLowerCase()) return null;
  const column = rawColumn.replace(/^\[|\]$/g, "");
  if (/^dp_/i.test(column)) return null;
  return column;
}

interface SelectSite {
  file: string;
  line: number;
  table: string;
  select: string;
}

/** Every `{ table: "<T>", select: <expr> }` object literal in a service source. */
function selectSites(file: string, source: string): { sites: SelectSite[]; unresolved: number } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const sites: SelectSite[] = [];
  let unresolved = 0;
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      let table: string | null = null;
      let selectExpr: ts.Expression | null = null;
      for (const p of n.properties) {
        const key = p.name?.getText(sf).replace(/^["']|["']$/g, "");
        if (key === "table" && ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) {
          table = p.initializer.text;
        }
        if (key === "select" || key === "$select") {
          if (ts.isPropertyAssignment(p)) selectExpr = p.initializer;
          else if (ts.isShorthandPropertyAssignment(p)) selectExpr = p.name;
        }
      }
      if (table && selectExpr) {
        const select = resolveSelect(selectExpr, sf);
        if (select === null) unresolved++;
        else {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
          sites.push({ file, line, table, select });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { sites, unresolved };
}

/** Every non-test service source, `_shared/` included. */
function allServiceFiles(dir = servicesDir, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) allServiceFiles(path, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

interface PhantomSelect {
  /** Path relative to `src/services/`, forward slashes. */
  file: string;
  table: string;
  column: string;
  lineAtWriting: number;
  reason: string;
}

/**
 * Columns the scan flagged when it was written. Each is absent from the
 * generated model; verify against MP before acting (the model may be stale).
 * INTEGRATOR: fix the select (or regenerate the model if MP has the column),
 * then delete the entry -- a stale entry fails the run.
 */
const SELECT_KNOWN_DEFECTS: PhantomSelect[] = [];

/**
 * Columns MP *does* have that the generated model lacks. Not defects -- each
 * entry cites the evidence that the select succeeds live. Regenerate the models
 * (`pnpm mp:generate:models`) before adding one; a stale entry fails the run.
 *
 * Note the generator skips `DataType: "Separator"` columns on purpose: those are
 * field-group headings in MP's edit screen, not data, and always read `null`.
 * `Forms.Standalone_Form_Use_Only` was one; it sat here until the 2026-10-11
 * regeneration showed why the model lacked it, and the select dropped it.
 */
const MODEL_GAPS: PhantomSelect[] = [];

interface PhantomHit {
  file: string;
  table: string;
  column: string;
  line: number;
}

function phantomSelects(): { hits: PhantomHit[]; scanned: number } {
  const models = loadModels();
  const hits: PhantomHit[] = [];
  let scanned = 0;
  for (const path of allServiceFiles()) {
    const file = path.slice(servicesDir.length + 1).split("\\").join("/");
    for (const site of selectSites(file, readFileSync(path, "utf-8")).sites) {
      const columns = models.get(site.table.toLowerCase());      if (!columns) continue;
      scanned++;
      for (const item of splitSelect(site.select)) {
        const column = bareColumn(item, site.table);
        if (column && column !== "*" && !columns.has(column.toLowerCase())) {
          hits.push({ file, table: site.table, column, line: site.line });
        }
      }
    }
  }
  return { hits, scanned };
}

const sameSelect = (
  a: { file: string; table: string; column: string },
  b: { file: string; table: string; column: string },
) => a.file === b.file && a.table === b.table && a.column.toLowerCase() === b.column.toLowerCase();

describe("MP column names in service $select strings (model-checked)", () => {
  it("bareColumn judges only primary-table columns", () => {
    expect(bareColumn("Invoice_ID", "Invoices")).toBe("Invoice_ID");
    expect(bareColumn("Invoices.Amount_Paid", "Invoices")).toBe("Amount_Paid");
    expect(bareColumn("Invoice_Total AS Total", "Invoices")).toBe("Invoice_Total");
    expect(bareColumn("[State/Region] as State", "Addresses")).toBe("State/Region");
    expect(bareColumn("Contacts.Household_ID", "Invoices")).toBeNull();
    expect(bareColumn("Household_ID_Table.Congregation_ID", "Contacts")).toBeNull();
    expect(bareColumn("Donor_ID_TABLE_Contact_ID_TABLE.Contact_ID AS Contact_ID", "Pledges")).toBeNull();
    expect(bareColumn("ISNULL(Available_Online, 1) AS Online", "Attributes")).toBeNull();
    expect(bareColumn("dp_fileUniqueId AS ImageGuid", "Contacts")).toBeNull();
    expect(
      bareColumn(["'", DYNAMIC, "' + CONVERT(varchar(40), dp_FileUniqueID) AS ImageUrl"].join(""), "Contacts"),
    ).toBeNull();
    expect(bareColumn("COUNT(*) AS N", "Responses")).toBeNull();
  });

  it("splitSelect keeps commas inside parens, brackets and quotes", () => {
    expect(splitSelect("A, ISNULL(B, 1) AS B, [C,D] AS E, 'x,y' + F AS G,H")).toEqual([
      "A",
      "ISNULL(B, 1) AS B",
      "[C,D] AS E",
      "'x,y' + F AS G",
      "H",
    ]);
  });

  it("the scan reaches the selects and the models it is supposed to", () => {
    // Guard against the guard: a broken path or a drifted call shape would
    // make the phantom check below pass vacuously.
    const models = loadModels();
    expect(models.size).toBeGreaterThan(200);
    expect(models.get("invoices")?.has("invoice_total")).toBe(true);
    expect(models.get("invoices")?.has("amount_paid")).toBe(false);
    expect(phantomSelects().scanned).toBeGreaterThan(100);
    // And it would have caught C40, and C20's Attributes.Available_Online.
    const fixture = [
      'mp.getTableRecords({ table: "Invoices", select: "Invoice_ID,Invoice_Total,Amount_Paid" });',
      'const SEL = ["Attributes.Attribute_ID", "Attributes.Available_Online AS Online"].join(",");',
      'mp.getTableRecords({ table: "Attributes", select: SEL });',
    ].join("\n");
    const found = selectSites("fixture.ts", fixture).sites.flatMap((s) =>
      splitSelect(s.select)
        .map((i) => bareColumn(i, s.table))
        .filter((c): c is string => !!c && !models.get(s.table.toLowerCase())!.has(c.toLowerCase())),
    );
    expect(found).toEqual(["Amount_Paid", "Available_Online"]);
  });

  it("no service selects a primary-table column its model does not have", () => {
    const { hits } = phantomSelects();
    const unexplained = hits.filter(
      (h) => ![...SELECT_KNOWN_DEFECTS, ...MODEL_GAPS].some((d) => sameSelect(d, h)),
    );
    expect(
      unexplained.map((h) => `src/services/${h.file}:${h.line} ${h.table}.${h.column}`),
      [
        "A $select names a column the generated MP model for that table does not have.",
        "MP answers the whole GET with 500 'Invalid column name' (C20, C40).",
        "Verify against MP; fix the select, or regenerate the model if MP has the column.",
      ].join(" "),
    ).toEqual([]);
  });

  it("every SELECT_KNOWN_DEFECTS / MODEL_GAPS entry still matches (no stale entries)", () => {
    const { hits } = phantomSelects();
    const stale = [...SELECT_KNOWN_DEFECTS, ...MODEL_GAPS].filter(
      (d) => !hits.some((h) => sameSelect(d, h)),
    );
    expect(stale.map((d) => `${d.file} ${d.table}.${d.column}`)).toEqual([]);
  });
});
