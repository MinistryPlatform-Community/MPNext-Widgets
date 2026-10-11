import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Fails if a service swallows an error into an empty result without logging.
 *
 * C20 is the worked example. `OpportunityFinderService.getAttributeTypes()`
 * selected a column MP does not have; MP answered 500, and the surrounding
 * `try { ... } catch { return []; }` turned that into an empty list with
 * nothing logged. The widget then silently rendered no Attributes filter --
 * no console error, no failed request in the network tab (the route answered
 * 200 with `[]`) -- for the whole life of the widget. An empty result is
 * indistinguishable from "there is no data", so a catch that produces one is
 * exactly the place a log line is the only evidence that anything went wrong.
 *
 * The rule: under `src/services/**`, a catch that produces an empty result
 * (`[]`, `null`, `undefined`, a bare `return`, `{}`, `new Map()`, `new Set()`)
 * must contain a `console.*` or logger call. Four shapes are recognised:
 *
 *   catch { return []; }
 *   catch (e) { return null; }
 *   try { ... } catch {} return [];     // empty catch, then an empty return
 *   const rows = await p.catch(() => []);   // promise handler, value used
 *
 * A `.catch(() => undefined)` whose value is discarded (a cleanup step written
 * as a statement) is not a result and is not flagged.
 *
 * Note that `MPHelper`'s provider layer already `console.error`s every failed
 * MP call. That records the raw error, but not that a feature then degraded to
 * "no data" -- which is the fact someone debugging an empty widget needs.
 *
 * Returning the empty value is often right (degrade, don't 500); returning it
 * *silently* is the defect. Rethrowing is always fine.
 *
 * Parsed with the TypeScript compiler API rather than by regex, so a `return`
 * inside a nested callback, a brace in a string, or a commented-out catch
 * cannot produce a phantom hit.
 *
 * ## When this fails
 *
 * Add a `console.warn`/`console.error` (with the error) to the catch. If the
 * silence is genuinely intended -- the failure is an expected, uninteresting
 * outcome -- add an `ALLOWLIST` entry with the reason. Entries are keyed by
 * file and enclosing function name (not line numbers), and an entry that no
 * longer matches anything fails the run, so the list cannot rot.
 */

const repoRoot = resolve(import.meta.dirname, "../..");
const servicesRoot = resolve(repoRoot, "src/services");

// ── detector ────────────────────────────────────────────────────────────────

export interface SilentCatch {
  /** Enclosing function, method or variable name; `<anonymous>` if none. */
  fn: string;
  /** 1-based line of the `catch` keyword. */
  line: number;
  /** The empty value produced, as written (`[]`, `null`, `return;` ...). */
  returns: string;
}

const EMPTY_CONSTRUCTORS = new Set(["Map", "Set", "Array"]);

/** True for an expression that is an empty result: `[]`, `null`, `undefined`, `{}`, `new Map()` ... */
function isEmptyValue(expr: ts.Expression | undefined): boolean {
  if (!expr) return true; // bare `return;`
  let e: ts.Expression = expr;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isNonNullExpression(e)
  ) {
    e = e.expression;
  }
  if (e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(e) && e.text === "undefined") return true;
  if (ts.isVoidExpression(e)) return true;
  if (ts.isArrayLiteralExpression(e)) return e.elements.length === 0;
  if (ts.isObjectLiteralExpression(e)) return e.properties.length === 0;
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression)) {
    return EMPTY_CONSTRUCTORS.has(e.expression.text) && (e.arguments?.length ?? 0) === 0;
  }
  return false;
}

/** Visits `node`'s descendants, not descending into nested functions or classes. */
function forEachInBody(node: ts.Node, visit: (n: ts.Node) => void): void {
  ts.forEachChild(node, (child) => {
    if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
    visit(child);
    forEachInBody(child, visit);
  });
}

/** True when the block calls `console.*` or anything named like a logger. */
function logs(block: ts.Block): boolean {
  let found = false;
  forEachInBody(block, (n) => {
    if (found || !ts.isCallExpression(n)) return;
    const callee = n.expression.getText();
    if (/^console\./.test(callee) || /(^|\.)(log|logger|logError|logWarn|report\w*)\b/i.test(callee)) {
      found = true;
    }
  });
  return found;
}

/** True when control cannot fall out of the bottom of the block. */
function exits(block: ts.Block): boolean {
  const last = block.statements[block.statements.length - 1];
  return !!last && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
}

/** True when a call's value is thrown away (`x.catch(...)` or `await x.catch(...)` as a statement). */
function resultDiscarded(call: ts.CallExpression): boolean {
  let n: ts.Node = call;
  while (ts.isParenthesizedExpression(n.parent) || ts.isAwaitExpression(n.parent) || ts.isVoidExpression(n.parent)) {
    if (ts.isVoidExpression(n.parent)) return true;
    n = n.parent;
  }
  return ts.isExpressionStatement(n.parent);
}

function enclosingName(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (
      (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n)) &&
      n.name
    ) {
      return n.name.getText();
    }
    if (ts.isConstructorDeclaration(n)) return "constructor";
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)) {
      return n.parent.name.getText();
    }
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isPropertyAssignment(n.parent)) {
      return n.parent.name.getText();
    }
  }
  return "<anonymous>";
}

/** Every catch clause in `source` that produces an empty result without logging. */
export function findSilentEmptyCatches(source: string, fileName = "fixture.ts"): SilentCatch[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: SilentCatch[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && !logs(node.block)) {
      let returns: string | null = null;

      // Shape 1/2: an empty `return` inside the catch block itself.
      forEachInBody(node.block, (n) => {
        if (returns === null && ts.isReturnStatement(n) && isEmptyValue(n.expression)) {
          returns = n.expression ? n.expression.getText() : "return;";
        }
      });

      // Shape 3: the catch falls through, and the statement right after the
      // `try` is an empty return.
      if (returns === null && !exits(node.block)) {
        const tryStmt = node.parent;
        const container = tryStmt.parent;
        if (ts.isBlock(container) || ts.isSourceFile(container) || ts.isCaseClause(container)) {
          const stmts = container.statements;
          const next = stmts[stmts.indexOf(tryStmt as ts.Statement) + 1];
          if (next && ts.isReturnStatement(next) && isEmptyValue(next.expression)) {
            returns = next.expression ? next.expression.getText() : "return;";
          }
        }
      }

      if (returns !== null) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        hits.push({ fn: enclosingName(node), line, returns });
      }
    }

    // Shape 4: a promise `.catch(() => [])` whose value is used. A discarded
    // one (`await x.catch(() => undefined);` as a statement) is cleanup, not a
    // result, and is left alone.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch" &&
      node.arguments.length === 1 &&
      (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0])) &&
      !resultDiscarded(node)
    ) {
      const handler = node.arguments[0] as ts.ArrowFunction | ts.FunctionExpression;
      let returns: string | null = null;
      if (ts.isBlock(handler.body)) {
        if (!logs(handler.body)) {
          forEachInBody(handler.body, (n) => {
            if (returns === null && ts.isReturnStatement(n) && isEmptyValue(n.expression)) {
              returns = n.expression ? n.expression.getText() : "return;";
            }
          });
          if (returns === null && !exits(handler.body)) returns = "return;";
        }
      } else if (isEmptyValue(handler.body)) {
        returns = handler.body.getText();
      }
      if (returns !== null) {
        const line = sf.getLineAndCharacterOfPosition(node.expression.name.getStart(sf)).line + 1;
        hits.push({ fn: enclosingName(node), line, returns });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// ── allowlist and known defects ─────────────────────────────────────────────

interface Entry {
  /** Path relative to `src/services/`, forward slashes. */
  file: string;
  /** Enclosing function or method name, as `SilentCatch.fn` reports it. */
  fn: string;
  reason: string;
}

/**
 * Intentional silence. Every entry needs a reason a reviewer can check: the
 * failure is an *expected* outcome whose absence is the normal case, not an
 * error someone would want to know about.
 */
const ALLOWLIST: Entry[] = [
  // The three entries below wrap exactly one call, `MPHelper.getFilesByRecord`,
  // whose FileService already `console.error`s every failure before rethrowing.
  // "No image" is the normal answer for most records, the result is cosmetic,
  // and a per-record log would repeat once per event / form / contact.
  {
    file: "fullCalendarService.ts",
    fn: "resolveEventImages",
    reason:
      "Per-event default-image probe, up to one per event in the window; a failed probe " +
      "renders the event without an image. FileService logs the underlying error.",
  },
  {
    file: "profileService.ts",
    fn: "getProfilePhoto",
    reason:
      "Default-photo probe for one contact; failure renders the initials avatar. " +
      "FileService logs the underlying error.",
  },
  {
    file: "customFormService.ts",
    fn: "toHeader",
    reason:
      "`.catch(() => [])` on the form's default-image probe; failure renders the form " +
      "without a header image. FileService logs the underlying error.",
  },
];

/**
 * Real defects found when this guard was written: errors that should be logged
 * and are not. Listed here so the guard could land green without changing
 * service code in the same change. INTEGRATOR: add the log line, then delete
 * the entry -- the stale-entry check fails the run until you do.
 */
const KNOWN_DEFECTS: (Entry & { lineAtWriting: number })[] = [];

// ── scan ────────────────────────────────────────────────────────────────────

function serviceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) serviceFiles(path, out);
    else if (name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

function scan(): (SilentCatch & { file: string })[] {
  const all: (SilentCatch & { file: string })[] = [];
  for (const path of serviceFiles(servicesRoot)) {
    const file = relative(servicesRoot, path).split("\\").join("/");
    for (const hit of findSilentEmptyCatches(readFileSync(path, "utf8"), file)) {
      all.push({ ...hit, file });
    }
  }
  return all;
}

const matches = (e: Entry, h: { file: string; fn: string }) => e.file === h.file && e.fn === h.fn;

describe("no silent empty catch in services (C20 class)", () => {
  it("the detector flags the three shapes and ignores the lookalikes", () => {
    const flagged = [
      "function a() { try { x(); } catch { return []; } }",
      "function a() { try { x(); } catch (e) { return null; } }",
      "function a() { try { x(); } catch {} return []; }",
      "function a() { try { x(); } catch (err) { /* ignore */ } return null; }",
      "async function a() { try { await x(); } catch { if (y) return undefined; return; } }",
      "class S { m() { try { x(); } catch { return new Map(); } } }",
      "const f = () => { try { return x(); } catch { return {} as Record<string, string>; } };",
      "async function a() { const rows = await p.catch(() => [] as Row[]); return rows; }",
      "async function a() { return p.catch(() => { return null; }); }",
      "const v = p.catch(function () {});",
    ];
    const clean = [
      // Logs before returning empty.
      "function a() { try { x(); } catch (e) { console.warn('x failed', e); return []; } }",
      "function a() { try { x(); } catch (e) { this.logger.error(e); return null; } }",
      // Rethrows.
      "function a() { try { x(); } catch (e) { throw new Error('wrapped', { cause: e }); } }",
      // Returns something non-empty.
      "function a() { try { x(); } catch { return [1]; } }",
      "function a() { try { x(); } catch { return fallback; } }",
      "function a() { try { x(); } catch { return false; } }",
      // The empty return is inside a nested callback, not the catch.
      "function a() { try { x(); } catch { queue.push(() => { return []; }); } }",
      // Falls through, but the next statement is not an empty return.
      "function a() { try { x(); } catch {} return rows; }",
      // Catch exits on its own; the following empty return is unrelated.
      "function a() { try { x(); } catch (e) { throw e; } return []; }",
      // Text in a string or comment.
      "const s = 'try {} catch { return []; }'; // catch { return null }",
      // Promise handlers that log, rethrow, return a real fallback, or whose
      // value is discarded (cleanup).
      "async function a() { return p.catch((e) => { console.warn(e); return []; }); }",
      "async function a() { return p.catch((e) => console.warn('x', e)); }",
      "async function a() { return p.catch((e) => { throw e; }); }",
      "async function a() { return p.catch(() => fallback); }",
      "async function a() { await store.kvDelete(k).catch(() => undefined); }",
      "function a() { void p.catch(() => null); }",
      "async function a() { return p.catch(handleFailure); }",
    ];
    for (const src of flagged) expect(findSilentEmptyCatches(src), src).toHaveLength(1);
    for (const src of clean) expect(findSilentEmptyCatches(src), src).toEqual([]);
  });

  it("reports the enclosing function name used as the allowlist key", () => {
    const src = [
      "class Svc {",
      "  async getThings() {",
      "    try { return await x(); } catch { return []; }",
      "  }",
      "}",
    ].join("\n");
    expect(findSilentEmptyCatches(src)).toEqual([{ fn: "getThings", line: 3, returns: "[]" }]);
  });

  it("scans the service sources it is supposed to scan", () => {
    // Guard against the guard: a broken path makes the assertion below vacuous.
    const files = serviceFiles(servicesRoot).map((p) => relative(servicesRoot, p).split("\\").join("/"));
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("opportunityFinderService.ts");
    expect(files.some((f) => f.startsWith("_shared/"))).toBe(true);
  });

  it("no service swallows an error into an empty result without logging", () => {
    const hits = scan();
    const unexplained = hits.filter(
      (h) => !ALLOWLIST.some((e) => matches(e, h)) && !KNOWN_DEFECTS.some((e) => matches(e, h)),
    );
    expect(
      unexplained.map((h) => `src/services/${h.file}:${h.line} ${h.fn}() catch -> ${h.returns}`),
      [
        "A catch that returns an empty result must log the error (C20): an empty",
        "result is indistinguishable from 'no data', so the log is the only evidence.",
        "Add console.warn/error with the error, or an ALLOWLIST entry with a reason.",
      ].join(" "),
    ).toEqual([]);

    for (const d of KNOWN_DEFECTS) {
      const at = hits.filter((h) => matches(d, h)).map((h) => h.line);
      if (at.length > 0) {
        console.warn(
          `[no-silent-empty-catch] KNOWN DEFECT src/services/${d.file}:${at.join(",")} ${d.fn}(): ${d.reason}`,
        );
      }
    }
  });

  it("every ALLOWLIST and KNOWN_DEFECTS entry still matches a catch (no stale entries)", () => {
    const hits = scan();
    const stale = [...ALLOWLIST, ...KNOWN_DEFECTS]
      .filter((e) => !hits.some((h) => matches(e, h)))
      .map((e) => `${e.file} ${e.fn}()`);
    expect(stale, "Remove entries that no longer match -- the catch was fixed or renamed.").toEqual([]);
  });
});
