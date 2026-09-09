/**
 * Type layer for the widget message catalogue.
 *
 * The English catalogue (`locales/en/`) is the single source of truth for the
 * *shape* of every other locale. `Messages` is derived from it, so:
 *
 *   - a missing key in `es.ts` is a `tsc --noEmit` failure
 *   - a misspelled or extra key is a `tsc --noEmit` failure
 *   - adding a language is "write the file and let the compiler enumerate what
 *     is left" rather than diffing a spreadsheet
 *
 * That is the whole reason the catalogue is TypeScript rather than JSON.
 */

/**
 * A pluralised message. Branches are selected at render time by
 * `Intl.PluralRules(locale).select(count)`, so a locale only has to supply the
 * CLDR categories its own language actually uses.
 *
 * English, Spanish and Brazilian Portuguese all use `one` / `other` only —
 * those two are required. The rest are optional so a future locale with `few` /
 * `many` (Polish, Russian, Arabic) can add them without touching `en`.
 */
export interface PluralForms {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** A plural message as written in the English catalogue (literal types). */
type PluralLiteral = { readonly one: string; readonly other: string };

/**
 * Maps the English catalogue's literal-typed tree onto the shape a *translated*
 * catalogue must satisfy: strings widen from their literal to `string`, plural
 * objects widen to allow any CLDR category, and namespaces recurse.
 */
export type Localized<T> = {
  [K in keyof T]: T[K] extends PluralLiteral
    ? PluralForms
    : T[K] extends string
      ? string
      : Localized<T[K]>;
};

/**
 * Every dotted key path through the catalogue that resolves to a renderable
 * message — a string or a plural object. Namespaces themselves are not keys.
 *
 * This is what gives `t()` autocomplete and a compile error on a typo.
 */
export type MessagePaths<T> = {
  [K in keyof T & string]: T[K] extends PluralLiteral
    ? K
    : T[K] extends string
      ? K
      : `${K}.${MessagePaths<T[K]>}`;
}[keyof T & string];

/** Interpolation values. Arrays are joined with `Intl.ListFormat`. */
export type MessageVars = Record<
  string,
  string | number | readonly string[] | undefined
>;

/** A resolved, renderable catalogue entry. */
export type MessageValue = string | PluralForms;
