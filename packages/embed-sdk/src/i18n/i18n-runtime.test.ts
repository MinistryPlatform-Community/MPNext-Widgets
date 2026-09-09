/**
 * Unit tests for the localisation runtime: locale resolution, the message
 * formatter, the label-override layer, formatters, and the pseudo-locale.
 *
 * The `LocaleSession` resolution-precedence tests are the ones worth reading
 * carefully — the ladder is the part of this design most likely to be broken by
 * a well-meaning change, and the interaction between the host's reflected `lang`
 * (an output) and a page author's `lang` (an input) is genuinely subtle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  endonym,
  isSupportedLocale,
  resolveLocale,
} from "./registry";
import { createTranslator, __resetMissingKeyReports } from "./t";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { ptBR } from "./locales/pt-BR";
import {
  __clearOverrides,
  getOverride,
  hasOverrides,
  setOverrides,
} from "./overrides";
import {
  __resetFormatterCaches,
  getFormatters,
  parseWallClock,
} from "./formatters";
import {
  LocaleSession,
  LOCALE_KEY,
  getLocaleSession,
  __resetLocaleSession,
} from "./locale-session";
import { flattenEnglish, pseudoize } from "./pseudo";

afterEach(() => {
  __clearOverrides();
  __resetFormatterCaches();
  __resetMissingKeyReports();
  __resetLocaleSession();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* not available */
  }
  document.documentElement.removeAttribute("lang");
  vi.restoreAllMocks();
});

// ── Locale resolution ──────────────────────────────────────────────────────

describe("resolveLocale", () => {
  it("matches a shipped code exactly, case-insensitively", () => {
    expect(resolveLocale("es")).toBe("es");
    expect(resolveLocale("pt-BR")).toBe("pt-BR");
    expect(resolveLocale("PT-br")).toBe("pt-BR");
  });

  it("truncates a regional variant to its base language", () => {
    // The whole US Spanish-speaking diaspora arrives as one of these.
    expect(resolveLocale("es-MX")).toBe("es");
    expect(resolveLocale("es-US")).toBe("es");
    expect(resolveLocale("es-419")).toBe("es");
    expect(resolveLocale("es-CO")).toBe("es");
  });

  it("routes every Portuguese variant to the Brazilian catalogue", () => {
    // `pt` truncation alone would fail: `pt` is not itself a shipped code.
    expect(resolveLocale("pt")).toBe("pt-BR");
    expect(resolveLocale("pt-PT")).toBe("pt-BR");
    expect(resolveLocale("pt-AO")).toBe("pt-BR");
  });

  it("handles extension subtags", () => {
    expect(resolveLocale("es-419-u-nu-latn")).toBe("es");
  });

  it("falls back to English for anything unshipped", () => {
    expect(resolveLocale("zh-Hans-CN")).toBe("en");
    expect(resolveLocale("de")).toBe("en");
    expect(resolveLocale("")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("takes the first usable tag from a list, as navigator.languages gives", () => {
    expect(resolveLocale(["de", "fr", "es-MX", "en"])).toBe("es");
    expect(resolveLocale(["", "  ", "pt"])).toBe("pt-BR");
  });

  it("recognises shipped codes", () => {
    expect(isSupportedLocale("es")).toBe(true);
    expect(isSupportedLocale("es-MX")).toBe(false);
  });
});

describe("endonym", () => {
  it("names each language in its own language", () => {
    // Free from Intl.DisplayNames — the locale selector needs no translated
    // strings of its own.
    expect(endonym("es").toLowerCase()).toContain("espa");
    expect(endonym("pt-BR").toLowerCase()).toContain("portugu");
    expect(endonym("en").toLowerCase()).toContain("english");
  });

  it("capitalises the first letter", () => {
    // Spanish and Portuguese lowercase language names by convention; a
    // <select> option reads better capitalised.
    expect(endonym("es")[0]).toBe(endonym("es")[0]?.toUpperCase());
  });
});

// ── The message formatter ──────────────────────────────────────────────────

describe("createTranslator", () => {
  it("returns the message for a key", () => {
    expect(createTranslator("en", en)("common.save")).toBe("Save");
    expect(createTranslator("es", es)("common.save")).toBe("Guardar");
    expect(createTranslator("pt-BR", ptBR)("common.save")).toBe("Salvar");
  });

  it("substitutes named placeholders", () => {
    const t = createTranslator("en", en);
    expect(t("validation.tooShort", { min: 8 })).toBe(
      "Please use at least 8 characters.",
    );
  });

  it("leaves an unsupplied placeholder visible rather than printing undefined", () => {
    // "{min}" in the UI is a bug someone will notice and file; "undefined" is
    // a bug that reads like a crash.
    const t = createTranslator("en", en);
    expect(t("validation.tooShort")).toContain("{min}");
  });

  it("falls back to English for a key the locale is missing", () => {
    // This is what makes a partial conversion safe to land: a widget converted
    // before its locale namespace exists renders English, not a broken key.
    const partial = { common: { save: "Guardar" } } as unknown as typeof en;
    const t = createTranslator("es", partial);
    expect(t("common.save")).toBe("Guardar");
    expect(t("common.cancel")).toBe("Cancel");
  });

  it("returns the key and reports once when English is missing it too", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = createTranslator("en", en);
    const key = "nope.not.a.key" as never;

    expect(t(key)).toBe("nope.not.a.key");
    expect(t(key)).toBe("nope.not.a.key");
    // Reported once per key, not once per render — widgets re-render on every
    // keystroke.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not treat a namespace as a message", () => {
    const t = createTranslator("en", en);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(t("common" as never)).toBe("common");
  });

  it("joins an array value with the locale's list conjunction", () => {
    const enT = createTranslator("en", {
      ...en,
      common: { ...en.common, save: "{days}" },
    } as typeof en);
    // Note the serial comma: that is what Intl gives for en, and taking it
    // from the platform rather than the catalogue is the point.
    expect(enT("common.save", { days: ["Mon", "Wed", "Fri"] })).toBe(
      "Mon, Wed, and Fri",
    );

    const esT = createTranslator("es", {
      ...es,
      common: { ...es.common, save: "{days}" },
    } as unknown as typeof en);
    // Spanish uses "y", and the catalogue carries no conjunction of its own.
    expect(esT("common.save", { days: ["lun", "mié", "vie"] })).toContain(" y ");
  });
});

describe("plural selection", () => {
  const withPlural = (locale: "en" | "es" | "pt-BR", base: object) =>
    createTranslator(locale, {
      ...base,
      common: {
        ...(base as typeof en).common,
        save: { one: "{count} item", other: "{count} items" },
      },
    } as unknown as typeof en);

  it("selects one/other by Intl.PluralRules, not by count === 1", () => {
    const t = withPlural("en", en);
    expect(t("common.save", { count: 1 })).toBe("1 item");
    expect(t("common.save", { count: 2 })).toBe("2 items");
    expect(t("common.save", { count: 0 })).toBe("0 items");
  });

  it("treats a missing count as zero rather than throwing", () => {
    const t = withPlural("en", en);
    expect(t("common.save")).toBe("{count} items");
  });

  it("selects correctly for Spanish and Portuguese", () => {
    // Both are one/other like English, but routed through the locale's own
    // rules rather than an English assumption.
    expect(withPlural("es", es)("common.save", { count: 1 })).toBe("1 item");
    expect(withPlural("es", es)("common.save", { count: 3 })).toBe("3 items");
    expect(withPlural("pt-BR", ptBR)("common.save", { count: 1 })).toBe("1 item");
  });
});

// ── Label overrides ────────────────────────────────────────────────────────

describe("label overrides", () => {
  it("wins over the locale catalogue", () => {
    setOverrides("es", { "common.save": "Guardar cambios" });
    expect(createTranslator("es", es)("common.save")).toBe("Guardar cambios");
  });

  it("scopes to one locale", () => {
    setOverrides("es", { "common.save": "Guardar cambios" });
    expect(createTranslator("en", en)("common.save")).toBe("Save");
  });

  it('applies to every locale under the "*" scope', () => {
    setOverrides("*", { "common.signIn": "Member Login" });
    expect(createTranslator("en", en)("common.signIn")).toBe("Member Login");
    expect(createTranslator("es", es)("common.signIn")).toBe("Member Login");
  });

  it("prefers a locale-specific override over the all-locales one", () => {
    setOverrides("*", { "common.signIn": "Member Login" });
    setOverrides("es", { "common.signIn": "Acceso de miembros" });
    expect(createTranslator("es", es)("common.signIn")).toBe("Acceso de miembros");
    expect(createTranslator("pt-BR", ptBR)("common.signIn")).toBe("Member Login");
  });

  it("still interpolates placeholders in an override", () => {
    setOverrides("*", { "validation.tooShort": "At least {min}, please." });
    expect(
      createTranslator("en", en)("validation.tooShort", { min: 4 }),
    ).toBe("At least 4, please.");
  });

  it("accumulates across calls and drops a key set to null", () => {
    setOverrides("*", { "common.save": "A", "common.cancel": "B" });
    setOverrides("*", { "common.save": null });
    expect(getOverride("en", "common.save")).toBeUndefined();
    expect(getOverride("en", "common.cancel")).toBe("B");
  });

  it("ignores an override for a key that does not exist", () => {
    // A stale override left behind after a key rename must not blank a label
    // or throw; it is simply never consulted.
    setOverrides("*", { "gone.away": "Whatever" });
    expect(hasOverrides()).toBe(true);
    expect(createTranslator("en", en)("common.save")).toBe("Save");
  });

  it("carries markup through as text, never as elements", () => {
    // Overrides come from a host page. They pass through the same escaping
    // boundary as catalogue strings, so this must stay a plain string.
    setOverrides("*", { "common.save": "<img src=x onerror=alert(1)>" });
    const value = createTranslator("en", en)("common.save");
    expect(typeof value).toBe("string");

    const host = document.createElement("div");
    host.textContent = value;
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img");
  });
});

// ── Formatters ─────────────────────────────────────────────────────────────

describe("parseWallClock", () => {
  it("reads MP wall-clock strings with no timezone shift", () => {
    // The bug this avoids: `new Date("2026-09-10T19:30:00Z")` in a browser
    // west of UTC lands on the 10th at 15:30, or on the 9th.
    const d = parseWallClock("2026-09-10T19:30:00");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(10);
    expect(d?.getHours()).toBe(19);
    expect(d?.getMinutes()).toBe(30);
  });

  it("ignores a trailing Z rather than converting from it", () => {
    // MP labels wall-clock values as UTC even though they are not; honouring
    // the Z is precisely the day-shift the widgets defend against.
    expect(parseWallClock("2026-09-10T00:30:00Z")?.getDate()).toBe(10);
  });

  it("reads a date-only value as local midnight", () => {
    const d = parseWallClock("2026-03-01");
    expect(d?.getDate()).toBe(1);
    expect(d?.getHours()).toBe(0);
  });

  it("passes a Date through and rejects junk", () => {
    const now = new Date();
    expect(parseWallClock(now)).toBe(now);
    expect(parseWallClock("")).toBeNull();
    expect(parseWallClock(null)).toBeNull();
    expect(parseWallClock("not a date")).toBeNull();
    expect(parseWallClock(new Date("nope"))).toBeNull();
  });
});

describe("formatters", () => {
  it("formats dates in the locale, not in en-US", () => {
    const date = "2026-09-10T19:30:00";
    expect(getFormatters("en").date(date, "long")).toBe("September 10, 2026");
    expect(getFormatters("es").date(date, "long")).toContain("septiembre");
    expect(getFormatters("pt-BR").date(date, "long")).toContain("setembro");
  });

  it("formats currency in the locale with the record's own code", () => {
    expect(getFormatters("en").currency(1234.5)).toBe("$1,234.50");
    // Spanish groups and marks decimals differently; the symbol placement and
    // separators both come from the locale.
    const esValue = getFormatters("es").currency(1234.5);
    expect(esValue).toContain("1234,5");
    expect(getFormatters("en").currency(10, "EUR")).toContain("10.00");
  });

  it("falls back to the locale default for a malformed currency code", () => {
    // MP data must never throw inside a render path.
    expect(() => getFormatters("en").currency(5, "NOT_A_CODE")).not.toThrow();
    expect(getFormatters("en").currency(5, "NOT_A_CODE")).toContain("5");
  });

  it("treats a missing or non-finite amount as zero", () => {
    expect(getFormatters("en").currency(null)).toBe("$0.00");
    expect(getFormatters("en").currency(NaN)).toBe("$0.00");
    expect(getFormatters("en").number(Infinity)).toBe("0");
  });

  it("collapses a same-day range and keeps both dates otherwise", () => {
    const f = getFormatters("en");
    const sameDay = f.dateRange("2026-09-10T19:00:00", "2026-09-10T21:00:00");
    expect(sameDay).toBe("Thu, Sep 10, 7:00 PM – 9:00 PM");

    const overnight = f.dateRange("2026-09-10T23:00:00", "2026-09-11T01:00:00");
    expect(overnight).toContain("Sep 11");
  });

  it("renders a start with no end", () => {
    expect(getFormatters("en").dateRange("2026-09-10T19:00:00", null)).toBe(
      "Thu, Sep 10, 7:00 PM",
    );
  });

  it("returns empty string for an unparseable range rather than 'Invalid Date'", () => {
    expect(getFormatters("en").dateRange(null, null)).toBe("");
    expect(getFormatters("en").date(null)).toBe("");
    expect(getFormatters("en").time("")).toBe("");
  });

  it("gives localised month and weekday names", () => {
    expect(getFormatters("en").monthNames()[0]).toBe("January");
    expect(getFormatters("es").monthNames()[0]).toBe("enero");
    expect(getFormatters("pt-BR").monthNames()[0]).toBe("janeiro");
    expect(getFormatters("en").monthNames().length).toBe(12);

    // Index 0 must be Sunday, matching the day-of-week integers MP uses.
    expect(getFormatters("en").weekdayNames()[0]).toBe("Sunday");
    expect(getFormatters("en").weekdayNames()[6]).toBe("Saturday");
  });

  it("treats percentages as 0-100, matching every call site", () => {
    expect(getFormatters("en").percent(45)).toBe("45%");
    expect(getFormatters("en").percent(45.6, 1)).toBe("45.6%");
  });

  it("returns the same memoised instance for repeated calls", () => {
    expect(getFormatters("es")).toBe(getFormatters("es"));
  });

  it("exposes the locale's default currency", () => {
    expect(getFormatters("en").defaultCurrency).toBe("USD");
  });
});

// ── LocaleSession resolution precedence ────────────────────────────────────

describe("LocaleSession resolution precedence", () => {
  beforeEach(() => {
    __resetLocaleSession();
  });

  it("defaults to English with nothing declared anywhere", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
    expect(new LocaleSession().getLocale()).toBe(DEFAULT_LOCALE);
  });

  it("reads <html lang> — the rung a bilingual CMS already sets", () => {
    // The zero-configuration path: a WordPress/Polylang site marks up its own
    // pages, and the widgets follow with no snippet change.
    document.documentElement.setAttribute("lang", "es");
    expect(new LocaleSession().getLocale()).toBe("es");
  });

  it("resolves a regional <html lang> to the shipped catalogue", () => {
    document.documentElement.setAttribute("lang", "es-MX");
    expect(new LocaleSession().getLocale()).toBe("es");
  });

  it("ignores an <html lang> it does not ship, falling through", () => {
    document.documentElement.setAttribute("lang", "de");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR"]);
    expect(new LocaleSession().getLocale()).toBe("pt-BR");
  });

  it("prefers the visitor's stored choice over <html lang>", () => {
    // Rung 3 beats rung 4: a visitor who picked a language on this site keeps
    // it even on a page whose author declared another.
    window.localStorage.setItem(LOCALE_KEY, "pt-BR");
    document.documentElement.setAttribute("lang", "es");
    expect(new LocaleSession().getLocale()).toBe("pt-BR");
  });

  it("falls back to navigator.languages when nothing else is declared", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["es-AR", "en"]);
    expect(new LocaleSession().getLocale()).toBe("es");
  });

  it("lets an explicit element lang outrank everything", () => {
    document.documentElement.setAttribute("lang", "es");
    const session = new LocaleSession();
    expect(session.localeForDeclared("pt-BR")).toBe("pt-BR");
    // An English declaration is a real declaration, not an absence.
    expect(session.localeForDeclared("en")).toBe("en");
    // An absent or unshipped declaration defers to the page-wide answer.
    expect(session.localeForDeclared(null)).toBe("es");
    expect(session.localeForDeclared("de")).toBe("es");
  });

  it("persists a switch and notifies listeners once", async () => {
    const session = new LocaleSession();
    const seen: string[] = [];
    session.onChange(() => seen.push(session.getLocale()));

    await session.setLocale("es");

    expect(session.getLocale()).toBe("es");
    expect(window.localStorage.getItem(LOCALE_KEY)).toBe("es");
    // Notified after the catalogue is in hand, so widgets re-render once into
    // the new language rather than twice through English.
    expect(seen).toEqual(["es"]);
  });

  it("does not notify when the locale is unchanged", async () => {
    const session = new LocaleSession();
    const cb = vi.fn();
    session.onChange(cb);
    await session.setLocale("en");
    expect(cb).not.toHaveBeenCalled();
  });

  it("survives blocked storage", () => {
    // Private browsing, or a site with cookies/storage disabled.
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => new LocaleSession()).not.toThrow();
  });

  it("resolves English synchronously — no fetch, no await", async () => {
    const session = new LocaleSession();
    let resolved = false;
    void session.ready.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(true);
    expect(session.translator()("common.save")).toBe("Save");
  });

  it("loads a non-English catalogue and then translates with it", async () => {
    document.documentElement.setAttribute("lang", "es");
    const session = new LocaleSession();
    await session.ready;
    expect(session.translator()("common.save")).toBe("Guardar");
  });

  it("reports ltr for every shipped locale", () => {
    const session = new LocaleSession();
    expect(session.getDirection("es")).toBe("ltr");
    expect(session.getDirection("pt-BR")).toBe("ltr");
  });

  it("shares one instance per page", () => {
    // Several widgets, possibly from separate bundle evaluations, must share
    // one locale and one catalogue fetch.
    expect(getLocaleSession()).toBe(getLocaleSession());
  });
});

// ── Pseudo-locale ──────────────────────────────────────────────────────────

describe("pseudo-locale", () => {
  it("accents and pads, so untransformed strings stand out", () => {
    const out = pseudoize("Search events");
    expect(out.startsWith("[")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
    expect(out).not.toContain("Search events");
    // Padded, so a container that cannot take longer copy breaks visibly.
    expect(out.length).toBeGreaterThan("Search events".length * 1.3);
  });

  it("leaves placeholders intact", () => {
    // A mangled {count} would render literally and read as a different bug.
    expect(pseudoize("Please use at least {min} characters.")).toContain("{min}");
  });

  it("covers the whole English catalogue", () => {
    const flat = flattenEnglish();
    expect(Object.keys(flat).length).toBeGreaterThan(50);
    for (const value of Object.values(flat)) {
      expect(typeof value).toBe("string");
    }
  });
});
