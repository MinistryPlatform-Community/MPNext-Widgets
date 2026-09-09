/**
 * The message formatter.
 *
 * Deliberately an ICU-*syntax* subset rather than an ICU implementation: named
 * interpolation (`{name}`) and plural selection driven by `Intl.PluralRules`.
 * The pre-i18n tree had exactly two pluralised strings, so a full ICU parser
 * would be ~10KB to serve two call sites. The syntax matches ICU so that moving
 * to a real parser later (Crowdin, Lokalise and POEditor all speak ICU) is a
 * parser swap, not a re-translation.
 *
 * No dependency, and nothing here allocates per call except the interpolation
 * result.
 */

import { en } from "./locales/en";
import type { MessageKey, Messages } from "./locales/en";
import type { MessageValue, MessageVars, PluralForms } from "./types";
import type { LocaleCode } from "./registry";
import { getOverride } from "./overrides";
import { listFormatter, pluralRules } from "./formatters";

export type Translator = (key: MessageKey, vars?: MessageVars) => string;

/**
 * Keys whose absence has already been reported, so a widget that re-renders on
 * every keystroke cannot flood the console.
 */
const reported = new Set<string>();

/**
 * Walk a dotted path through a catalogue. Returns `undefined` rather than
 * throwing, because a partially converted catalogue is a supported state.
 */
function lookup(tree: unknown, key: string): MessageValue | undefined {
  let node: unknown = tree;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") return node;
  if (isPlural(node)) return node;
  return undefined;
}

function isPlural(node: unknown): node is PluralForms {
  return (
    typeof node === "object" &&
    node !== null &&
    typeof (node as PluralForms).other === "string"
  );
}

/**
 * Pick the plural branch for `count` using the locale's own CLDR rules.
 *
 * Correct for the three shipped locales (all `one` / `other`) and correct for
 * free in a language with `few` / `many`, which is the entire reason for using
 * `Intl.PluralRules` over `count === 1`. Falls back through the CLDR category
 * order so a catalogue that only supplies `one` / `other` still renders in a
 * locale that selects `few`.
 */
function selectPlural(
  forms: PluralForms,
  count: number,
  locale: LocaleCode,
): string {
  let category: Intl.LDMLPluralRule = "other";
  try {
    category = pluralRules(locale).select(count);
  } catch {
    category = count === 1 ? "one" : "other";
  }
  return (
    forms[category] ??
    forms.other ??
    forms.one
  );
}

/**
 * Substitute `{name}` placeholders.
 *
 * Values are plain text. Every widget escapes at the interpolation boundary
 * (`escapeHtml` / `escapeAttr`), so a translation — or a church-supplied label
 * override — can never introduce markup into a shadow root. Keep that
 * invariant: it is why catalogue content needs no sanitising of its own.
 *
 * An array value is joined with `Intl.ListFormat`, so "Mon, Wed and Fri"
 * becomes "lun, mié y vie" without the catalogue carrying a conjunction.
 */
function interpolate(
  template: string,
  vars: MessageVars | undefined,
  locale: LocaleCode,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name];
    if (value === undefined) return whole;
    if (Array.isArray(value)) return listFormatter(locale).format(value);
    return String(value);
  });
}

/**
 * Build a translator bound to one locale and one loaded catalogue.
 *
 * Resolution order, and the reason for each rung:
 *
 *  1. **Label overrides** — a church renaming "Groups" to "Small Groups" wins
 *     over everything, including its own locale's catalogue.
 *  2. **The requested locale's catalogue.**
 *  3. **English** — so a widget converted before its locale namespace exists
 *     renders English rather than `undefined`. This is what makes the
 *     conversion safe to land one batch at a time.
 *  4. **The key itself**, plus a one-time console error. Reaching this rung
 *     means the key is absent from English too, which is a genuine bug rather
 *     than an expected gap, so it is reported in production as well as in dev.
 */
export function createTranslator(
  locale: LocaleCode,
  messages: Messages | typeof en,
): Translator {
  return (key: MessageKey, vars?: MessageVars): string => {
    const override = getOverride(locale, key);
    const raw =
      override ??
      lookup(messages, key) ??
      (messages === en ? undefined : lookup(en, key));

    if (raw === undefined) {
      if (!reported.has(key)) {
        reported.add(key);
        console.error(
          `[mpnext-i18n] No message for key "${key}" in "${locale}" or the English fallback. This is a missing catalogue entry, not a translation gap.`,
        );
      }
      return key;
    }

    const template =
      typeof raw === "string"
        ? raw
        : selectPlural(raw, Number(vars?.count ?? 0), locale);

    return interpolate(template, vars, locale);
  };
}

/**
 * A translator over English only, for the synchronous path before any
 * catalogue has loaded and for tests that do not care about locale.
 */
export const tEnglish: Translator = createTranslator("en", en);

/** Test seam: forget which missing keys have already been reported. */
export function __resetMissingKeyReports(): void {
  reported.clear();
}
