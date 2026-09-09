/**
 * The page-wide locale singleton.
 *
 * Deliberately shaped like `shared/auth-session.ts`, the pattern this codebase
 * already relies on for page-wide widget state: one instance parked on
 * `window`, resolved once, cached, `onChange` so sibling widgets stay
 * consistent, the visitor's choice persisted the way `nextwidgets_sid` is, and a
 * `storage` listener so switching language in one tab reaches the others.
 *
 * ## Resolution precedence
 *
 * Highest first. Rung 1 is per-element; the rest are page-wide.
 *
 *  1. `lang` attribute on the widget element — `<next-event-finder lang="es">`
 *  2. `MPNextEmbed.setLocale("es")` / `MPNextEmbed.init({ locale })`
 *  3. The visitor's persisted choice (`nextwidgets_locale`)
 *  4. The nearest `[lang]` ancestor, else `<html lang>`
 *  5. `navigator.languages`
 *  6. `en`
 *
 * Rung 4 is the one that matters in practice: a bilingual church site on
 * WordPress/Polylang (or any CMS that marks up its own pages correctly) already
 * sets `<html lang>`, so those sites get translated widgets with **no snippet
 * change at all**. The locale selector widget exists for sites that cannot.
 */

import { en } from "./locales/en";
import type { Messages } from "./locales/en";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveLocale,
  type LocaleCode,
} from "./registry";
import { createTranslator, type Translator } from "./t";
import { getFormatters, type Formatters } from "./formatters";

export const LOCALE_KEY = "nextwidgets_locale";

/**
 * The key this used to be, read once so the rename does not discard a
 * visitor's language choice. Deleted forward on read.
 *
 * Lower stakes than the `sid` rename — losing this drops the visitor back to
 * `<html lang>` or their browser preference rather than signing them out — but
 * a congregant who deliberately picked Spanish should not silently get English
 * back because we renamed a key. Safe to remove on the same schedule as
 * `LEGACY_SID_KEY` in `shared/auth-session.ts`.
 */
const LEGACY_LOCALE_KEY = "nw_locale";

export class LocaleSession {
  /** The page-wide locale, once resolved. */
  private locale: LocaleCode = DEFAULT_LOCALE;

  /** Explicit choice from `setLocale()` / `init({ locale })` — rung 2. */
  private explicit: LocaleCode | null = null;

  /** Loaded catalogues, keyed by locale. `en` is present from the start. */
  private catalogues = new Map<LocaleCode, Messages | typeof en>([
    [DEFAULT_LOCALE, en],
  ]);

  /** In-flight loads, so N widgets on a page trigger one fetch, not N. */
  private loading = new Map<LocaleCode, Promise<void>>();

  private listeners = new Set<() => void>();
  private storageListenerAttached = false;
  private scope: "tab" | "page" = "page";

  /** Resolves when the *current* locale's catalogue is usable. */
  ready: Promise<void>;

  constructor() {
    this.locale = this.resolveFromEnvironment();
    this.ready = this.load(this.locale);
    // Deliberately NOT re-broadcasting override changes here. This session's
    // listeners are locale listeners, and `base-widget.ts` guards them with a
    // locale-equality check so a page-wide switch does not re-render a widget
    // pinned by its own `lang`. Folding overrides into the same signal made
    // that guard swallow them. Widgets subscribe to `onOverridesChange`
    // separately instead.
  }

  // ── Resolution ───────────────────────────────────────────────────────────

  private resolveFromEnvironment(): LocaleCode {
    if (this.explicit) return this.explicit;

    const stored = this.readStored();
    if (stored) return stored;

    const fromDocument = this.readDocumentLang();
    if (fromDocument) return fromDocument;

    if (typeof navigator !== "undefined") {
      const tags = navigator.languages?.length
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : [];
      if (tags.length) return resolveLocale(tags);
    }

    return DEFAULT_LOCALE;
  }

  /** `<html lang>` — read through `resolveLocale` so `es-MX` lands on `es`. */
  private readDocumentLang(): LocaleCode | null {
    if (typeof document === "undefined") return null;
    const declared = document.documentElement?.getAttribute("lang");
    if (!declared) return null;
    const resolved = resolveLocale(declared);
    // `resolveLocale` falls back to `en` for anything unrecognised; treat that
    // as "the page declared nothing useful" so the next rung still gets a turn.
    return resolved === DEFAULT_LOCALE && !/^en\b/i.test(declared.trim())
      ? null
      : resolved;
  }

  /**
   * Resolve a locale from an explicitly declared tag — rung 1 — falling back to
   * the page-wide answer when the tag is absent or unrecognised.
   *
   * The caller supplies the tag rather than the element, because the widget
   * base class has to distinguish a `lang` a *page author* set (an input, and
   * the highest-priority rung) from one the base class itself reflected onto the
   * host for accessibility (an output, which must never be read back as input —
   * doing so would pin a widget to the first locale it ever rendered). See
   * `declaredLang()` in `shared/base-widget.ts`.
   */
  localeForDeclared(declared: string | null | undefined): LocaleCode {
    if (declared) {
      const trimmed = declared.trim();
      const resolved = resolveLocale(trimmed);
      // `resolveLocale` answers `en` both for a real English tag and for
      // anything it does not recognise; only the former is a declaration.
      if (resolved !== DEFAULT_LOCALE || /^en\b/i.test(trimmed)) {
        return resolved;
      }
    }
    return this.locale;
  }

  /**
   * Resolve the locale for one element by walking up to the nearest `[lang]`.
   *
   * Convenience for callers with no reflection concerns (the locale selector,
   * tests). `<html lang>` is deliberately excluded: it is rung 4, and reaching
   * it through `closest()` here would let it outrank the visitor's own stored
   * choice at rung 3.
   */
  localeFor(element: Element | null | undefined): LocaleCode {
    if (element) {
      try {
        const tagged = element.closest?.("[lang]");
        if (tagged && tagged !== document.documentElement) {
          return this.localeForDeclared(tagged.getAttribute("lang"));
        }
      } catch {
        /* detached node or no closest() — fall through to page-wide */
      }
    }
    return this.locale;
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  /**
   * Mirrors `AuthSession`: `sessionStorage` when any widget on the page asked
   * for tab scope, `localStorage` otherwise. A blocked store degrades to
   * in-memory rather than throwing inside a render path.
   */
  private storage(): Storage | null {
    try {
      if (typeof window === "undefined") return null;
      return this.scope === "tab" ? window.sessionStorage : window.localStorage;
    } catch {
      return null;
    }
  }

  private readStored(): LocaleCode | null {
    for (const get of [
      () => this.storage(),
      () => (typeof window !== "undefined" ? window.localStorage : null),
      () => (typeof window !== "undefined" ? window.sessionStorage : null),
    ]) {
      try {
        const store = get();
        let value = store?.getItem(LOCALE_KEY);
        if (!value) {
          // Transitional: adopt a choice stored under the pre-rename key.
          const legacy = store?.getItem(LEGACY_LOCALE_KEY);
          if (legacy) {
            value = legacy;
            try {
              store?.setItem(LOCALE_KEY, legacy);
              store?.removeItem(LEGACY_LOCALE_KEY);
            } catch {
              /* read-only store — the value below still applies for this page */
            }
          }
        }
        if (value) {
          const resolved = resolveLocale(value);
          if (resolved !== DEFAULT_LOCALE || value.startsWith("en")) {
            return resolved;
          }
        }
      } catch {
        /* storage blocked */
      }
    }
    return null;
  }

  setScope(scope: "tab" | "page"): void {
    this.scope = scope;
  }

  // ── Catalogue loading ────────────────────────────────────────────────────

  /**
   * Load a locale's catalogue.
   *
   * English resolves synchronously — it is inlined in the bundle — so an
   * English page never awaits anything and pays no extra request. Anything else
   * is a single dynamic `import()` that rolldown has split into its own
   * content-hashed chunk, shared by every widget on the page.
   *
   * A failed load is **not** fatal: the locale stays selected and `t()` falls
   * through to English, which is strictly better than a blank widget. It is
   * reported once so a misconfigured deploy (a missing `vercel.json` CORS entry
   * for the chunk, say) is visible rather than silent.
   */
  private load(locale: LocaleCode): Promise<void> {
    if (this.catalogues.has(locale)) return Promise.resolve();

    const inFlight = this.loading.get(locale);
    if (inFlight) return inFlight;

    const loader = SUPPORTED_LOCALES[locale]?.load;
    if (!loader) return Promise.resolve();

    const promise = loader()
      .then(({ messages }) => {
        this.catalogues.set(locale, messages);
      })
      .catch((err: unknown) => {
        console.error(
          `[mpnext-i18n] Could not load the "${locale}" catalogue; widgets will render in English.`,
          err,
        );
      })
      .finally(() => {
        this.loading.delete(locale);
      });

    this.loading.set(locale, promise);
    return promise;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  getLocale(): LocaleCode {
    return this.locale;
  }

  getDirection(locale: LocaleCode = this.locale): "ltr" | "rtl" {
    return SUPPORTED_LOCALES[locale]?.dir ?? "ltr";
  }

  /**
   * Switch the page-wide locale and persist the choice.
   *
   * Awaits the catalogue before notifying, so widgets re-render once, into the
   * new language — rather than twice, flashing English in between.
   */
  async setLocale(requested: string): Promise<void> {
    const next = resolveLocale(requested);
    this.explicit = next;

    try {
      this.storage()?.setItem(LOCALE_KEY, next);
    } catch {
      /* storage blocked — the in-memory choice still holds for this page */
    }

    if (next === this.locale) return;

    this.locale = next;
    this.ready = this.load(next);
    await this.ready;
    this.notify();
  }

  /** The catalogue for `locale`, or English while its own load is in flight. */
  private catalogueFor(locale: LocaleCode): Messages | typeof en {
    return this.catalogues.get(locale) ?? en;
  }

  /** A translator for a resolved locale. */
  translator(locale: LocaleCode = this.locale): Translator {
    void this.load(locale);
    return createTranslator(locale, this.catalogueFor(locale));
  }

  /** Formatters for a resolved locale. */
  formatters(locale: LocaleCode = this.locale): Formatters {
    return getFormatters(locale);
  }

  /**
   * Await a locale's catalogue. The widget base class calls this before first
   * paint, so a visitor never sees English swap to Spanish — and because every
   * widget already paints a spinner while fetching its own data, the wait lands
   * inside a window that already exists.
   */
  async readyForLocale(locale: LocaleCode = this.locale): Promise<void> {
    await this.load(locale);
  }

  // ── Change notification ──────────────────────────────────────────────────

  private storageListener = (e: StorageEvent) => {
    if (e.key === LOCALE_KEY || e.key === LEGACY_LOCALE_KEY) {
      const next = this.readStored();
      if (next && next !== this.locale) {
        this.locale = next;
        this.ready = this.load(next);
        void this.ready.then(() => this.notify());
      }
    }
  };

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    if (!this.storageListenerAttached && typeof window !== "undefined") {
      try {
        window.addEventListener("storage", this.storageListener);
        this.storageListenerAttached = true;
      } catch {
        /* no storage events available */
      }
    }
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    for (const cb of [...this.listeners]) {
      try {
        cb();
      } catch (err) {
        // One widget throwing in its re-render must not stop the others.
        console.error("[mpnext-i18n] locale change listener failed", err);
      }
    }
  }
}

declare global {
  interface Window {
    __nextLocaleSession?: LocaleSession;
  }
}

/**
 * The page-wide instance. Parked on `window` for the same reason
 * `getAuthSession` is: several widgets, possibly from separate bundle
 * evaluations, must share one locale and one catalogue fetch.
 */
export function getLocaleSession(): LocaleSession {
  if (typeof window === "undefined") return new LocaleSession();
  let session = window.__nextLocaleSession;
  if (!session) {
    session = new LocaleSession();
    window.__nextLocaleSession = session;
  }
  return session;
}

/** Test seam: drop the singleton so the next call re-resolves from scratch. */
export function __resetLocaleSession(): void {
  if (typeof window !== "undefined") {
    delete window.__nextLocaleSession;
  }
}
