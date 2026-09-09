/**
 * Pseudo-localisation — a development tool, not a shipped language.
 *
 * Transforms every English string into an accented, padded, bracketed version:
 *
 *   "Search events"  →  "[Ŝéàŕćĥ évéñtŝ ····]"
 *
 * That one view makes two otherwise tedious bugs obvious at a glance:
 *
 *  1. **Unextracted strings stay plain ASCII.** Anything still rendering as
 *     "Search events" is a literal that was never routed through `t()`. This is
 *     the visual counterpart to the `no-english-literals` guard test — the test
 *     catches them in CI, this catches them in the browser, including the ones
 *     held in variables that a regex scanner cannot see.
 *  2. **Layout that cannot take longer text breaks immediately.** Spanish and
 *     Portuguese run 20–30% longer than English, so the padding is sized to that
 *     and overflowing buttons, clipped table headers and wrapped tab strips show
 *     up before a customer finds them.
 *
 * Implemented on top of the label-override mechanism rather than as a fourth
 * locale: no new `LocaleCode`, no catalogue to maintain, and nothing to
 * accidentally ship. Nobody authors this — it is generated from `en`.
 *
 * Enable from the console on any page running the SDK:
 *
 *   MPNextEmbed.enablePseudoLocale()
 *   MPNextEmbed.disablePseudoLocale()
 */

import { en } from "./locales/en";
import { setOverrides } from "./overrides";

/**
 * Latin-1/Latin Extended-A lookalikes. Each stays visually recognisable as its
 * ASCII original — the point is to read the UI normally while seeing at a glance
 * which strings were *not* transformed.
 */
const ACCENTS: Record<string, string> = {
  a: "à", b: "b", c: "ć", d: "d", e: "é", f: "f", g: "ĝ", h: "ĥ",
  i: "í", j: "ĵ", k: "ķ", l: "ļ", m: "m", n: "ñ", o: "ö", p: "p",
  q: "q", r: "ŕ", s: "ŝ", t: "t", u: "ü", v: "v", w: "ŵ", x: "x",
  y: "ý", z: "ž",
  A: "À", B: "B", C: "Ć", D: "D", E: "É", F: "F", G: "Ĝ", H: "Ĥ",
  I: "Í", J: "Ĵ", K: "Ķ", L: "Ļ", M: "M", N: "Ñ", O: "Ö", P: "P",
  Q: "Q", R: "Ŕ", S: "Ŝ", T: "T", U: "Ü", V: "V", W: "Ŵ", X: "X",
  Y: "Ý", Z: "Ž",
};

/** Roughly the expansion Spanish and Portuguese actually cost over English. */
const PAD_RATIO = 0.35;

/**
 * Accent and pad one string, leaving `{placeholders}` untouched — a mangled
 * placeholder would render literally and look like a different bug.
 */
export function pseudoize(source: string): string {
  const accented = source.replace(/\{(\w+)\}|([A-Za-z])/g, (whole, ph, ch) => {
    if (ph !== undefined) return whole;
    return ACCENTS[ch as string] ?? whole;
  });
  const padCount = Math.ceil(source.length * PAD_RATIO);
  return `[${accented} ${"·".repeat(Math.max(padCount, 1))}]`;
}

/** Flatten the catalogue to dotted key paths, expanding plural branches. */
function flatten(
  node: unknown,
  prefix: string,
  out: Record<string, string>,
): void {
  if (typeof node === "string") {
    out[prefix] = node;
    return;
  }
  if (typeof node !== "object" || node === null) return;

  const entries = Object.entries(node as Record<string, unknown>);
  const isPlural =
    typeof (node as { other?: unknown }).other === "string" &&
    typeof (node as { one?: unknown }).one === "string";

  if (isPlural) {
    // The override layer stores flat strings, so a plural message cannot be
    // overridden branch-by-branch. Use `other` — the branch that renders for
    // every count but one, which is what a layout review cares about.
    out[prefix] = String((node as { other: string }).other);
    return;
  }

  for (const [key, value] of entries) {
    flatten(value, prefix ? `${prefix}.${key}` : key, out);
  }
}

/** Every English message, keyed by its dotted path. */
export function flattenEnglish(): Record<string, string> {
  const out: Record<string, string> = {};
  flatten(en, "", out);
  return out;
}

export function enablePseudoLocale(): void {
  const flat = flattenEnglish();
  const pseudo: Record<string, string> = {};
  for (const [key, value] of Object.entries(flat)) {
    pseudo[key] = pseudoize(value);
  }
  setOverrides("*", pseudo);
  console.info(
    `[mpnext-i18n] Pseudo-locale on for ${Object.keys(pseudo).length} keys. Anything still in plain English is an unextracted literal.`,
  );
}

export function disablePseudoLocale(): void {
  const cleared: Record<string, null> = {};
  for (const key of Object.keys(flattenEnglish())) cleared[key] = null;
  setOverrides("*", cleared);
  console.info("[mpnext-i18n] Pseudo-locale off.");
}
