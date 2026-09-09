/**
 * The shipped locales, and how an arbitrary BCP-47 tag resolves to one of them.
 *
 * Adding a language is a developer step, deliberately: write
 * `locales/<code>/*.ts` (the compiler enumerates every key you still owe — see
 * `types.ts`), add an entry here, and deploy. There is no MinistryPlatform
 * configuration, no database read, and no per-tenant setup.
 *
 * `load` is a dynamic `import()` on purpose. Rolldown code-splits it into its
 * own content-hashed chunk (verified against Vite 8.2.2 in lib mode), so the
 * English path keeps exactly today's bundle size and today's zero extra
 * requests, and a non-English page pays one ~12KB gzip fetch that every widget
 * on the page shares. `vite.config.ts` pins `chunkFileNames` to a
 * `next-embed`-prefixed pattern so `scripts/copy-sdk.js` publishes these
 * chunks; `vercel.json` gives them CORS. Both are required — see
 * `WIDGET-I18N-PLAN.md` §3.
 */

import type { Messages } from "./locales/en";

export type LocaleCode = "en" | "es" | "pt-BR";

export interface LocaleDefinition {
  /** Text direction. Reflected onto each widget host as a `dir` attribute. */
  dir: "ltr" | "rtl";
  /** Default currency when a record carries no explicit currency code. */
  currency: string;
  /**
   * Loads the catalogue. `null` for `en`, which is statically imported and
   * therefore inlined in the bundle as the fallback for every other locale.
   */
  load: (() => Promise<{ messages: Messages }>) | null;
}

export const SUPPORTED_LOCALES: Record<LocaleCode, LocaleDefinition> = {
  en: { dir: "ltr", currency: "USD", load: null },
  es: {
    dir: "ltr",
    currency: "USD",
    load: () => import("./locales/es").then((m) => ({ messages: m.es })),
  },
  "pt-BR": {
    dir: "ltr",
    currency: "USD",
    load: () => import("./locales/pt-BR").then((m) => ({ messages: m.ptBR })),
  },
};

export const DEFAULT_LOCALE: LocaleCode = "en";

export const LOCALE_CODES = Object.keys(SUPPORTED_LOCALES) as LocaleCode[];

/**
 * Regional variants that resolve to a shipped locale.
 *
 * We ship region-neutral Spanish and Brazilian Portuguese: `es` serves the
 * whole US diaspora, and `pt-BR` is overwhelmingly the diaspora variant. A tag
 * not listed here still resolves by truncation (`es-CO` → `es`), so this table
 * only has to carry the cases truncation gets wrong — namely `pt-*`, where the
 * truncated `pt` is not itself a shipped code.
 */
const ALIASES: Record<string, LocaleCode> = {
  pt: "pt-BR",
  "pt-pt": "pt-BR",
  "pt-ao": "pt-BR",
  "pt-mz": "pt-BR",
};

/**
 * Resolve any BCP-47 tag (or a list of them, as `navigator.languages` gives)
 * to a shipped locale, falling back to `en`.
 *
 * Matching is case-insensitive and tries, in order: an exact shipped code, the
 * alias table, then progressive truncation at each `-`. So `es-MX` → `es`,
 * `pt-PT` → `pt-BR`, `zh-Hans-CN` → `en`.
 */
export function resolveLocale(
  requested: string | readonly string[] | null | undefined,
): LocaleCode {
  const tags = typeof requested === "string" ? [requested] : (requested ?? []);

  for (const raw of tags) {
    if (!raw) continue;
    const match = matchOne(raw.trim());
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

function matchOne(tag: string): LocaleCode | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();

  // Exact shipped code, case-insensitively ("PT-br" → "pt-BR").
  for (const code of LOCALE_CODES) {
    if (code.toLowerCase() === lower) return code;
  }

  if (ALIASES[lower]) return ALIASES[lower];

  // Progressive truncation: "es-419-u-nu-latn" → "es-419" → "es".
  let candidate = lower;
  while (candidate.includes("-")) {
    candidate = candidate.slice(0, candidate.lastIndexOf("-"));
    for (const code of LOCALE_CODES) {
      if (code.toLowerCase() === candidate) return code;
    }
    if (ALIASES[candidate]) return ALIASES[candidate];
  }

  return null;
}

/** True when `tag` names a shipped locale exactly. */
export function isSupportedLocale(tag: string): tag is LocaleCode {
  return (LOCALE_CODES as string[]).includes(tag);
}

/**
 * The language's own name for itself ("Español", "Português (Brasil)"), for the
 * locale selector's options.
 *
 * `Intl.DisplayNames` already knows every language name in every locale, so the
 * selector costs zero translated strings. Falls back to the raw code on the
 * (2026-unlikely) browsers without it.
 */
export function endonym(code: LocaleCode): string {
  try {
    const dn = new Intl.DisplayNames([code], { type: "language" });
    const name = dn.of(code);
    if (name && name !== code) {
      return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
    }
  } catch {
    /* fall through */
  }
  return code;
}
