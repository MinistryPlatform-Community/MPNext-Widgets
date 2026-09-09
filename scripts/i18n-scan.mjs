/**
 * Scanner for user-facing English literals still embedded in widget source.
 *
 * Shared by the guard test (`packages/embed-sdk/src/i18n/no-english-literals.test.ts`)
 * and by `pnpm i18n:check`, so the number CI enforces and the number a developer
 * sees locally cannot drift apart.
 *
 * ## Why a per-file budget rather than a string allowlist
 *
 * ~1,200 strings across 30 files makes a literal allowlist unreadable and a
 * merge conflict on every PR. Instead each file carries a **budget**: the count
 * of literals still awaiting conversion. The test fails if a file goes *over*
 * (a regression — someone hardcoded new English) and equally if it comes in
 * *under* (the budget must be ratcheted down in the same commit that converts
 * the strings). That keeps the number honest, makes progress objectively
 * measurable, and gives the conversion a finish line: every budget at zero.
 *
 * ## Precision
 *
 * This is not a parser and deliberately does not try to be one. It needs to be
 * *stable* — the same input must always yield the same count, or the ratchet
 * means nothing. Three detectors, all confined to **template literal bodies**,
 * which is where the only markup in this codebase lives:
 *
 *   1. text between `>` and `<`
 *   2. the value of a user-facing attribute (`placeholder`, `aria-label`,
 *      `title`, `alt`)
 *   3. `value="…"` on a submit/button/reset input, where it is a label
 *
 * Confining them to template literals is what makes the count trustworthy. An
 * earlier draft scanned whole files and reported TypeScript generics as UI copy
 * — `Promise<void>` opens an angle bracket that the next `<` appears to pair
 * with — so `base-widget.ts` and `api-client.ts` came back "full of English"
 * while containing none. CSS in `getStyles()` is excluded for free (`.a > .b` is
 * never followed by `<`), as is SVG path data, which lives in attributes this
 * does not read.
 *
 * Strings held in variables are invisible to it. That gap is covered by the
 * pseudo-locale (`MPNextEmbed.enablePseudoLocale()`), which makes them obvious
 * in the browser — anything still rendering in plain ASCII was never extracted.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const COMPONENTS_DIR = "packages/embed-sdk/src/components";
const SHARED_DIR = "packages/embed-sdk/src/shared";

/** User-facing attributes whose values a visitor reads. */
const TEXT_ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"];

/**
 * Stands in for one character of a masked `${…}` interpolation.
 *
 * Must be a single character that cannot occur in markup prose:
 * `maskInterpolations` repeats it to preserve source offsets, and
 * `isUserFacing` rejects any text containing it. An empty string here would
 * silently reject every finding, since `"".includes("")` is true.
 */
const MASK = "\u0001";

/**
 * Strip comments so prose in a JSDoc block is never counted as UI copy.
 * Block comments first, then line comments.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) =>
      p1 + " ".repeat(m.length - p1.length),
    );
}

/**
 * Extract every template literal body, with its start offset in `source`,
 * **including templates nested inside `${…}` interpolations**.
 *
 * The nesting matters more than it sounds. These widgets build most conditional
 * markup as a nested template inside a ternary:
 *
 *   ${filtered.length === 0
 *     ? `<div class="empty">No invoices found.</div>`
 *     : `<div class="table">…</div>`}
 *
 * A single-level scan masks the whole `${…}` and never sees "No invoices
 * found." — which silently under-counted `my-invoices.ts` at 13 when it really
 * had 31, and would have let a conversion "finish" with a third of the copy
 * still hardcoded. So each span is re-scanned for templates of its own.
 */
function templateLiterals(source, baseOffset = 0) {
  const spans = topLevelTemplates(source, baseOffset);
  // Recurse into each body: within it, a nested template reads as top-level.
  for (const span of [...spans]) {
    spans.push(...templateLiterals(span.body, span.start));
  }
  return spans;
}

/**
 * Templates at the current nesting level only.
 *
 * Hand-rolled rather than a regex because it has to know which quote style it
 * is inside: a backtick within a `"…"` string does not open a template.
 */
function topLevelTemplates(source, baseOffset) {
  const spans = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\") i++;
        else if (source[i] === "\n") break; // unterminated; resynchronise
        i++;
      }
      i++;
      continue;
    }

    if (ch === "`") {
      const start = i + 1;
      i++;
      let depth = 0;
      while (i < n) {
        const c = source[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        // A `${ … }` may itself hold a nested template literal; track brace
        // depth and let the nested one be picked up on its own pass.
        if (c === "$" && source[i + 1] === "{") {
          depth++;
          i += 2;
          continue;
        }
        // A **plain** `{` inside an interpolation counts too, and forgetting it
        // was a real bug: an object literal in an interpolation —
        // `${this.t("k", { date })}` — closed the interpolation on the object's
        // own `}`, so `depth` hit 0 early and the *next* backtick was mistaken
        // for the template's terminator. From there every span in the file was
        // off by one, and ~40 lines of ordinary TypeScript got scanned as
        // markup: `() => this.retryLoad());` reads as a text node between the
        // `>` of an arrow and the `<` of a generic. `maskInterpolations` below
        // already counted plain braces; these two must agree, and now do.
        //
        // Latent until `pre-check.ts` (C78), which is simply the first widget
        // to put an object literal inside an interpolation inside a *nested*
        // template.
        if (depth > 0 && c === "{") {
          depth++;
          i++;
          continue;
        }
        if (depth > 0 && c === "}") {
          depth--;
          i++;
          continue;
        }
        if (depth === 0 && c === "`") break;
        i++;
      }
      spans.push({ start: baseOffset + start, body: source.slice(start, i) });
      i++;
      continue;
    }

    i++;
  }

  return spans;
}

/**
 * Replace `${…}` interpolations with MASK, preserving length so offsets — and
 * therefore reported line numbers — stay correct.
 *
 * Preserving them also stops `>${name}<` collapsing to an empty text node,
 * which would otherwise read as a finding-free template.
 */
function maskInterpolations(body) {
  let out = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "$" && body[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}") depth--;
        j++;
      }
      out += MASK.repeat(j - i);
      i = j;
      continue;
    }
    out += body[i];
    i++;
  }
  return out;
}

/**
 * Is this text something a visitor reads, as opposed to markup noise?
 *
 * Rejects masked interpolations, entity- and punctuation-only strings, anything
 * without two consecutive letters, and all-caps tokens ("USD", "PDF", "ZIP")
 * that read identically in all three shipped languages.
 */
function isUserFacing(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes(MASK)) return false;

  const withoutEntities = trimmed.replace(/&[a-zA-Z]+;|&#\d+;/g, "");
  if (!/[A-Za-z]{2}/.test(withoutEntities)) return false;
  if (!/[a-z]/.test(withoutEntities)) return false;

  return true;
}

/**
 * Is the template literal starting at `offset` an argument to a `console.*`
 * call?
 *
 * Looks back over the preceding characters, skipping the argument list that may
 * sit between the call and this literal (`console.warn("prefix", \`…\`)`). The
 * window is bounded so a `console` call earlier in the function cannot capture
 * an unrelated template.
 */
function isConsoleArgument(source, offset) {
  const WINDOW = 200;
  // `offset` points at the body, i.e. one past the opening backtick — so stop at
  // `offset - 1` to leave that backtick out. Including it made the
  // `[^()\`]*$` tail fail every time and the whole check a no-op.
  const before = source.slice(Math.max(0, offset - WINDOW), Math.max(0, offset - 1));
  // The last call-opening paren before this literal, with only argument-ish
  // characters in between.
  const match = before.match(
    /console\s*\.\s*(?:log|warn|error|info|debug|trace)\s*\([^()`]*$/,
  );
  return match !== null;
}

/** Every user-facing literal in one source file, with its line number. */
export function scanSource(source, file = "<source>") {
  const cleaned = stripComments(source);
  const findings = [];

  const lineOf = (index) => {
    let line = 1;
    for (let i = 0; i < index && i < cleaned.length; i++) {
      if (cleaned[i] === "\n") line++;
    }
    return line;
  };

  const push = (kind, text, offset) => {
    if (!isUserFacing(text)) return;
    findings.push({ file, line: lineOf(offset), kind, text: text.trim() });
  };

  for (const { start, body } of templateLiterals(cleaned)) {
    // A developer diagnostic is not congregant-facing copy and must never be
    // translated — a Spanish console warning helps nobody. These get counted
    // anyway when the message embeds sample markup, e.g. `user-menu.ts`
    // advising a site owner to add `<script id="MPWidgets" …>`, which puts prose
    // between a `>` and a `<`.
    if (isConsoleArgument(cleaned, start)) continue;

    const masked = maskInterpolations(body);

    // 1. Text nodes: >Some text<
    for (const m of masked.matchAll(/>([^<>]{2,200})</g)) {
      push("text", m[1], start + m.index);
    }

    // 2. User-facing attributes: placeholder="Search events"
    const attrPattern = new RegExp(
      `\\b(${TEXT_ATTRIBUTES.join("|")})="([^"]{2,200})"`,
      "g",
    );
    for (const m of masked.matchAll(attrPattern)) {
      push(m[1], m[2], start + m.index);
    }

    // 3. value="Submit" on a button — a label, unlike value on other inputs.
    for (const m of masked.matchAll(
      /type="(?:submit|button|reset)"[^>]*\bvalue="([^"]{2,200})"/g,
    )) {
      push("value", m[1], start + m.index);
    }
  }

  return findings;
}

/** The widget source files in scope, relative to the repo root. */
export function scannedFiles(repoRoot) {
  const files = [];
  for (const dir of [COMPONENTS_DIR, SHARED_DIR]) {
    const abs = resolve(repoRoot, dir);
    for (const name of readdirSync(abs)) {
      if (!name.endsWith(".ts")) continue;
      if (name.endsWith(".test.ts")) continue;
      // Pure stylesheet modules carry no copy by construction.
      if (name.endsWith("-styles.ts")) continue;
      files.push(`${dir}/${name}`);
    }
  }
  return files.sort();
}

/** `{ "path/to/file.ts": [finding, …] }` for every file with findings. */
export function scanRepo(repoRoot) {
  const result = {};
  for (const relative of scannedFiles(repoRoot)) {
    const source = readFileSync(join(repoRoot, relative), "utf-8");
    const findings = scanSource(source, relative);
    if (findings.length) result[relative] = findings;
  }
  return result;
}

/** `{ "path/to/file.ts": 12 }` — the shape the budget table is written in. */
export function scanCounts(repoRoot) {
  const counts = {};
  for (const [file, findings] of Object.entries(scanRepo(repoRoot))) {
    counts[file] = findings.length;
  }
  return counts;
}
