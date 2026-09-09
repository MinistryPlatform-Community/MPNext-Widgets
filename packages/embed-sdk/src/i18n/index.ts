/**
 * Public surface of the widget localisation layer.
 *
 * Widgets do not import from here directly — `shared/base-widget.ts` exposes
 * `this.t` and `this.fmt`, so every widget reaches localisation through one path
 * for the same reason they reach the API through one `fetch` wrapper. This
 * module is the entry point for the SDK bootstrap (`../index.ts`) and for tests.
 *
 * See `WIDGET-I18N-PLAN.md` for the design and the deliberate limits — chiefly
 * that MP-authored content (event titles, group names, Custom Form field labels)
 * is not translated by a file-based catalogue, and cannot be.
 */

export { en } from "./locales/en";
export type { Messages, MessageKey } from "./locales/en";

export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_CODES,
  resolveLocale,
  isSupportedLocale,
  endonym,
  type LocaleCode,
  type LocaleDefinition,
} from "./registry";

export {
  LocaleSession,
  getLocaleSession,
  LOCALE_KEY,
  __resetLocaleSession,
} from "./locale-session";

export {
  createTranslator,
  tEnglish,
  __resetMissingKeyReports,
  type Translator,
} from "./t";

export {
  getFormatters,
  parseWallClock,
  pluralRules,
  listFormatter,
  __resetFormatterCaches,
  type Formatters,
  type DateStyle,
} from "./formatters";

export {
  setOverrides,
  getOverride,
  hasOverrides,
  onOverridesChange,
  __clearOverrides,
  type OverrideScope,
} from "./overrides";

export {
  enablePseudoLocale,
  disablePseudoLocale,
  pseudoize,
  flattenEnglish,
} from "./pseudo";

export type {
  PluralForms,
  Localized,
  MessagePaths,
  MessageVars,
  MessageValue,
} from "./types";
