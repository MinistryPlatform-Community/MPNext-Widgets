/**
 * `pnpm i18n:check` — catalogue health, and `pnpm i18n:sync` to record baselines.
 *
 * Three problems this reports, in rising order of how easily they hide:
 *
 *  1. **Completeness.** Keys a locale is missing, or carries that English does
 *     not. Also enforced by `tsc` (`satisfies Messages`) and by
 *     `catalogue-parity.test.ts`; repeated here so a developer gets a readable
 *     list rather than a type error pointing at a spread.
 *
 *  2. **Staleness — the real failure mode of a file-based catalogue.** If the
 *     English string changes and the Spanish one does not, nothing catches it:
 *     the key is present, the type is right, and the widget renders a
 *     confidently wrong sentence. So each translation records a hash of the
 *     English it was made from, in `i18n-sources/<locale>.json`, and this
 *     command reports every translation whose source has since moved.
 *
 *     The hashes live in one generated file per locale rather than inline in the
 *     catalogues, so translating is still just editing prose and
 *     `pnpm i18n:sync` is a single command after a review pass.
 *
 *  3. **Literal budget.** The per-file counts from `scripts/i18n-scan.mjs`,
 *     summarised, so progress through the conversion is visible without reading
 *     a test failure.
 *
 * Usage:
 *   node scripts/i18n-check.mjs          # report; exit 1 on any problem
 *   node scripts/i18n-check.mjs --sync   # record current English as the baseline
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scanCounts } from "./i18n-scan.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const SOURCES_DIR = resolve(repoRoot, "packages/embed-sdk/i18n-sources");
const sync = process.argv.includes("--sync");

/** Short, stable content hash of one English string. */
function hash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

/**
 * Load the catalogues straight from source.
 *
 * Run under `tsx` (see the `i18n:check` / `i18n:sync` package scripts), which
 * strips the types on import — so this script never parses TypeScript itself and
 * never reads a stale build. The catalogues are plain data with no runtime
 * imports beyond a type-only one, so nothing else gets pulled in.
 */
async function loadCatalogues() {
  const load = (p) => import(pathToFileURL(resolve(repoRoot, p)).href);
  const [enMod, esMod, ptMod] = await Promise.all([
    load("packages/embed-sdk/src/i18n/locales/en/index.ts"),
    load("packages/embed-sdk/src/i18n/locales/es/index.ts"),
    load("packages/embed-sdk/src/i18n/locales/pt-BR/index.ts"),
  ]);
  return { en: enMod.en, es: esMod.es, "pt-BR": ptMod.ptBR };
}

/**
 * Flatten a catalogue to dotted paths, treating a **plural message as one key**.
 *
 * Not flattening plurals into `key.one` / `key.other` is the point. A locale is
 * *required* to carry every CLDR category its own language selects, and Spanish
 * and Brazilian Portuguese both select `many` (whole millions) where English does
 * not. Branch-level flattening reported those mandatory branches as "keys
 * English does not have" — the tool telling you to delete the thing
 * `catalogue-parity.test.ts` demands you add.
 *
 * The `other` branch stands in for hashing, since it is the one every locale has
 * and the one that renders for all but a couple of counts.
 */
function flatten(node, prefix = "", out = {}) {
  if (typeof node === "string") {
    out[prefix] = node;
    return out;
  }
  if (typeof node !== "object" || node === null) return out;

  if (typeof node.other === "string" && typeof node.one === "string") {
    out[prefix] = node.other;
    return out;
  }

  for (const [key, value] of Object.entries(node)) {
    flatten(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function readSources(locale) {
  const file = resolve(SOURCES_DIR, `${locale}.json`);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

function writeSources(locale, map) {
  mkdirSync(SOURCES_DIR, { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(map).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(
    resolve(SOURCES_DIR, `${locale}.json`),
    `${JSON.stringify(sorted, null, 2)}\n`,
  );
}

const problems = [];
const note = (line) => console.log(line);

const catalogues = await loadCatalogues();
const english = flatten(catalogues.en);
const englishKeys = Object.keys(english);

note(`English catalogue: ${englishKeys.length} messages`);

for (const locale of ["es", "pt-BR"]) {
  const flat = flatten(catalogues[locale]);
  const keys = Object.keys(flat);

  const missing = englishKeys.filter((k) => !(k in flat));
  const extra = keys.filter((k) => !(k in english));

  if (sync) {
    const map = {};
    for (const key of englishKeys) {
      if (key in flat) map[key] = hash(english[key]);
    }
    writeSources(locale, map);
    note(`  ${locale}: recorded ${Object.keys(map).length} source hashes`);
    continue;
  }

  const sources = readSources(locale);
  const stale = englishKeys.filter(
    (k) => k in flat && sources[k] && sources[k] !== hash(english[k]),
  );
  const unrecorded = englishKeys.filter((k) => k in flat && !sources[k]);

  note(`  ${locale}: ${keys.length} messages`);

  if (missing.length) {
    problems.push(`${locale} is missing ${missing.length} key(s)`);
    note(`    MISSING (${missing.length}):`);
    for (const k of missing.slice(0, 20)) note(`      ${k}`);
    if (missing.length > 20) note(`      … and ${missing.length - 20} more`);
  }
  if (extra.length) {
    problems.push(`${locale} has ${extra.length} key(s) English does not`);
    note(`    EXTRA (${extra.length}):`);
    for (const k of extra.slice(0, 20)) note(`      ${k}`);
  }
  if (stale.length) {
    problems.push(`${locale} has ${stale.length} stale translation(s)`);
    note(`    STALE — the English moved after this was translated (${stale.length}):`);
    for (const k of stale.slice(0, 20)) {
      note(`      ${k}`);
      note(`        now: ${JSON.stringify(english[k])}`);
      note(`        has: ${JSON.stringify(flat[k])}`);
    }
    if (stale.length > 20) note(`      … and ${stale.length - 20} more`);
  }
  if (unrecorded.length) {
    // Not a failure: a translation added since the last sync simply has no
    // baseline yet. Reported so `--sync` is an obvious next step.
    note(
      `    ${unrecorded.length} translation(s) have no recorded source — run 'pnpm i18n:sync'`,
    );
  }
}

// ── Literal budget ─────────────────────────────────────────────────────────

if (!sync) {
  const counts = scanCounts(repoRoot);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const files = Object.keys(counts).length;
  note("");
  note(
    `Hardcoded English still in widget markup: ${total} literal(s) across ${files} file(s)`,
  );
  const worst = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  for (const [file, count] of worst) {
    note(`  ${String(count).padStart(4)}  ${file.replace("packages/embed-sdk/src/", "")}`);
  }
  if (total === 0) {
    note("  none — every widget routes its copy through the catalogue.");
  }
}

if (sync) {
  note("");
  note("Source hashes recorded. Commit i18n-sources/ with the translations.");
  process.exit(0);
}

note("");
if (problems.length) {
  note(`FAIL: ${problems.length} problem(s)`);
  for (const p of problems) note(`  - ${p}`);
  process.exit(1);
}
note("OK: catalogues are complete and no translation is stale.");
