/**
 * Guard: every shipped catalogue stays structurally identical to English.
 *
 * `satisfies Messages` in each locale's `index.ts` already fails `tsc --noEmit`
 * on a missing or extra key, so most of this is belt-and-braces. It is worth
 * having anyway, because the type check is exactly the thing that stops
 * protecting you when someone excludes a locale file from a tsconfig, reaches
 * for `as any`, or lands a `@ts-expect-error` — and the failure mode then is a
 * silently English widget on a Spanish page, which nobody notices for months.
 *
 * The interpolation and plural checks below are *not* covered by the type
 * system at all: `"Use al menos {mn} caracteres."` is a perfectly well-typed
 * string that renders a literal `{mn}` to a congregant.
 */

import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { ptBR } from "./locales/pt-BR";
import { LOCALE_CODES } from "./registry";

type Flat = Map<string, string | Record<string, string>>;

/** Flatten a catalogue to dotted paths. Plural messages stay as objects. */
function flatten(node: unknown, prefix = "", out: Flat = new Map()): Flat {
  if (typeof node === "string") {
    out.set(prefix, node);
    return out;
  }
  if (typeof node !== "object" || node === null) return out;

  const record = node as Record<string, unknown>;
  if (typeof record.other === "string" && typeof record.one === "string") {
    out.set(prefix, record as Record<string, string>);
    return out;
  }
  for (const [key, value] of Object.entries(record)) {
    flatten(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/** `{name}` placeholders in a message, as a sorted, de-duplicated list. */
function placeholders(message: string | Record<string, string>): string[] {
  const text =
    typeof message === "string" ? message : Object.values(message).join(" ");
  const found = new Set(
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string),
  );
  return [...found].sort();
}

const CATALOGUES = { es, "pt-BR": ptBR } as const;
const english = flatten(en);

describe("catalogue parity", () => {
  it("ships a catalogue for every registered locale except the inlined default", () => {
    // `en` is statically imported rather than lazily loaded, so it has no entry
    // in CATALOGUES. Every other registered code must.
    const lazy = LOCALE_CODES.filter((c) => c !== "en");
    expect(Object.keys(CATALOGUES).sort()).toEqual([...lazy].sort());
  });

  it("has a non-trivial English catalogue", () => {
    // A guard against the guard: if `en` were ever emptied, every parity
    // assertion below would pass vacuously.
    expect(english.size).toBeGreaterThan(50);
  });

  for (const [code, catalogue] of Object.entries(CATALOGUES)) {
    describe(code, () => {
      const flat = flatten(catalogue);

      it("has exactly the English keyset — nothing missing", () => {
        const missing = [...english.keys()].filter((k) => !flat.has(k));
        expect(missing, `missing from ${code}`).toEqual([]);
      });

      it("has exactly the English keyset — nothing extra", () => {
        // An extra key is dead weight that also hides a rename: the English
        // side moved, this one did not, and `t()` silently falls back.
        const extra = [...flat.keys()].filter((k) => !english.has(k));
        expect(extra, `not present in English`).toEqual([]);
      });

      it("keeps every message the same kind as English", () => {
        const mismatched: string[] = [];
        for (const [key, value] of english) {
          const translated = flat.get(key);
          if (translated === undefined) continue;
          const enKind = typeof value === "string" ? "string" : "plural";
          const trKind = typeof translated === "string" ? "string" : "plural";
          if (enKind !== trKind) mismatched.push(`${key}: ${enKind} → ${trKind}`);
        }
        expect(mismatched).toEqual([]);
      });

      it("carries every interpolation placeholder English carries", () => {
        // The failure this catches renders a literal "{count}" to a visitor.
        const broken: string[] = [];
        for (const [key, value] of english) {
          const translated = flat.get(key);
          if (translated === undefined) continue;
          const expected = placeholders(value);
          const actual = placeholders(translated);
          if (expected.join(",") !== actual.join(",")) {
            broken.push(`${key}: expected {${expected}}, found {${actual}}`);
          }
        }
        expect(broken).toEqual([]);
      });

      it("supplies every plural branch the locale can select", () => {
        // `Intl.PluralRules` decides which branch renders, so a catalogue that
        // omits a category its own language uses would fall back to `other`
        // and read wrong. All three shipped locales are one/other, but this is
        // the assertion that makes adding a `few`/`many` language safe.
        const rules = new Intl.PluralRules(code);
        const categories = rules.resolvedOptions().pluralCategories;
        const gaps: string[] = [];

        for (const [key, value] of flat) {
          if (typeof value === "string") continue;
          for (const category of categories) {
            if (typeof value[category] !== "string") {
              gaps.push(`${key} missing "${category}"`);
            }
          }
        }
        expect(gaps).toEqual([]);
      });

      it("leaves no message empty or untranslated-by-copy-paste", () => {
        const suspicious: string[] = [];
        for (const [key, value] of flat) {
          const texts =
            typeof value === "string" ? [value] : Object.values(value);
          for (const text of texts) {
            if (!text.trim()) suspicious.push(`${key} is empty`);
          }
        }
        expect(suspicious).toEqual([]);
      });
    });
  }
});
