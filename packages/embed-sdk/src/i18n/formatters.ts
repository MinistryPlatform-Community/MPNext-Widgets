/**
 * Locale-aware date, number and list formatting.
 *
 * Replaces the 43 `"en-US"`-pinned `Intl.*` / `toLocale*` call sites that were
 * scattered across the widgets, and collapses six near-identical
 * `formatDateRange` implementations into one.
 *
 * ## What this deliberately does NOT do
 *
 * **No `timeZone` option, anywhere, by design.** MP returns datetimes as
 * wall-clock strings in the domain's zone, and the widgets already handle that
 * correctly: they parse the `YYYY-MM-DD` parts and build a *local* `Date`, then
 * format with no `timeZone`, so the two cancel out and the wall clock survives
 * (see the comments on `my-groups.ts` `parseDateParts`, and the same pattern in
 * `my-pledges`, `my-household` and `my-giving`). Passing the domain zone into
 * these formatters would re-introduce precisely the day-shift that parsing
 * exists to avoid. This module changes the **locale only** and leaves the
 * wall-clock semantics byte-for-byte as they were.
 *
 * ## Memoisation
 *
 * `Intl` constructors are expensive and these are called once per table row, so
 * every formatter is cached by `locale + style`. `shared/calendar-links.ts`
 * already does this for its offset formatter; same approach, one cache per
 * `Intl` class.
 */

import type { LocaleCode } from "./registry";
import { SUPPORTED_LOCALES } from "./registry";

/**
 * The date shapes the widgets actually use, named by intent rather than by
 * option bag. Derived from the pre-i18n call sites, so converting a widget is a
 * lookup rather than a judgement call.
 */
export type DateStyle =
  /** Thursday, September 10, 2026 */
  | "full"
  /** September 10, 2026 */
  | "long"
  /** Sep 10, 2026 */
  | "medium"
  /** Thu, Sep 10 — event cards, where the year is implied */
  | "weekdayShort"
  /** Sun, Apr 5, 2026 — weekday *and* year, for a single dated summary line */
  | "weekdayMedium"
  /** Sep 10 */
  | "monthDay"
  /** September 2026 — calendar headers */
  | "monthYear"
  /** 09/10/2026 */
  | "numeric"
  /** Thursday */
  | "weekdayLong"
  /** Sep */
  | "monthShort";

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  full: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  long: { month: "long", day: "numeric", year: "numeric" },
  medium: { month: "short", day: "numeric", year: "numeric" },
  weekdayShort: { weekday: "short", month: "short", day: "numeric" },
  weekdayMedium: {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  },
  monthDay: { month: "short", day: "numeric" },
  monthYear: { month: "long", year: "numeric" },
  numeric: { year: "numeric", month: "2-digit", day: "2-digit" },
  weekdayLong: { weekday: "long" },
  monthShort: { month: "short" },
};

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

// ── Memoised Intl instances ────────────────────────────────────────────────

const dateCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const pluralCache = new Map<string, Intl.PluralRules>();
const listCache = new Map<string, Intl.ListFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function dateFormatter(
  locale: LocaleCode,
  key: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${key}`;
  let fmt = dateCache.get(cacheKey);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    dateCache.set(cacheKey, fmt);
  }
  return fmt;
}

export function pluralRules(locale: LocaleCode): Intl.PluralRules {
  let rules = pluralCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralCache.set(locale, rules);
  }
  return rules;
}

/**
 * `Intl.ListFormat` where available, degrading to a comma join.
 *
 * Widely supported since 2021, but these widgets run on whatever browser a
 * congregant brings to a church website, so the fallback stays.
 */
export function listFormatter(locale: LocaleCode): {
  format: (items: readonly string[]) => string;
} {
  if (typeof Intl.ListFormat !== "function") {
    return { format: (items) => items.join(", ") };
  }
  let fmt = listCache.get(locale);
  if (!fmt) {
    fmt = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    listCache.set(locale, fmt);
  }
  return fmt;
}

// ── The public surface ─────────────────────────────────────────────────────

export interface Formatters {
  /** Format a `Date` (or an MP wall-clock string) in one of the named styles. */
  date(value: Date | string | null | undefined, style?: DateStyle): string;
  /** 7:30 PM */
  time(value: Date | string | null | undefined): string;
  /**
   * A start–end range, collapsing the shared date when both fall on one day:
   * "Thu, Sep 10, 7:00 PM – 9:00 PM" vs "Thu, Sep 10, 7:00 PM – Fri, Sep 11, 1:00 AM".
   * Replaces six subtly different implementations.
   */
  dateRange(
    start: Date | string | null | undefined,
    end: Date | string | null | undefined,
    style?: DateStyle,
  ): string;
  /**
   * A date-only range with the shared parts written once:
   * "Sep 6 – 12, 2026", "6–12 sept 2026", "6 – 12 de set. de 2026".
   *
   * Uses `Intl.DateTimeFormat.formatRange`, which knows per locale which
   * components are shared and where the separator goes. Doing this by hand only
   * works in month-first locales — Spanish and Portuguese lead with the day, so
   * a hand-collapsed "Sep 6 – 12, 2026" becomes "6 sept – 12, 2026", where the
   * trailing 12 reads as a second month.
   */
  dateRangeCompact(
    start: Date | string | null | undefined,
    end: Date | string | null | undefined,
    style?: DateStyle,
  ): string;
  /** Currency, with the record's own code when it has one. */
  currency(amount: number | null | undefined, code?: string | null): string;
  number(value: number | null | undefined, decimals?: number): string;
  percent(value: number | null | undefined, decimals?: number): string;
  /** "in 3 days", "2 weeks ago" — falls back to an absolute date if unsupported. */
  relative(value: Date | string | null | undefined): string;
  /** "Mon, Wed and Fri" / "lun, mié y vie" */
  list(items: readonly string[]): string;
  /** Localised month names, index 0 = January. Replaces hardcoded MONTHS arrays. */
  monthNames(style?: "long" | "short"): string[];
  /** Localised weekday names, index 0 = Sunday. */
  weekdayNames(style?: "long" | "short" | "narrow"): string[];
  /** The locale's default currency code, for records that carry none. */
  defaultCurrency: string;
}

/**
 * Parse an MP wall-clock datetime string without a timezone shift.
 *
 * Mirrors the defensive parsing the widgets already do individually: read the
 * calendar parts out of the string and build a local `Date` from them, so no
 * offset maths is ever applied. A `Date` passes through untouched.
 */
export function parseWallClock(
  value: Date | string | null | undefined,
): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0,
      m[6] ? Number(m[6]) : 0,
    );
  }

  const fallback = new Date(value);
  return isNaN(fallback.getTime()) ? null : fallback;
}

const formattersByLocale = new Map<LocaleCode, Formatters>();

export function getFormatters(locale: LocaleCode): Formatters {
  const cached = formattersByLocale.get(locale);
  if (cached) return cached;

  const defaultCurrency = SUPPORTED_LOCALES[locale].currency;

  const fmt: Formatters = {
    date(value, style = "medium") {
      const d = parseWallClock(value);
      if (!d) return "";
      return dateFormatter(locale, style, DATE_STYLES[style]).format(d);
    },

    time(value) {
      const d = parseWallClock(value);
      if (!d) return "";
      return dateFormatter(locale, "__time", TIME_OPTIONS).format(d);
    },

    dateRange(start, end, style = "weekdayShort") {
      const s = parseWallClock(start);
      if (!s) return "";
      const sDate = fmt.date(s, style);
      const sTime = fmt.time(s);

      const e = parseWallClock(end);
      if (!e) return `${sDate}, ${sTime}`;

      const sameDay =
        s.getFullYear() === e.getFullYear() &&
        s.getMonth() === e.getMonth() &&
        s.getDate() === e.getDate();

      const eTime = fmt.time(e);
      if (sameDay) return `${sDate}, ${sTime} – ${eTime}`;
      return `${sDate}, ${sTime} – ${fmt.date(e, style)}, ${eTime}`;
    },

    dateRangeCompact(start, end, style = "medium") {
      const s = parseWallClock(start);
      const e = parseWallClock(end);
      if (!s) return "";
      if (!e) return fmt.date(s, style);

      const formatter = dateFormatter(locale, style, DATE_STYLES[style]);
      // `formatRange` is ES2021. Widely available, but these widgets run on
      // whatever browser a congregant brings, so fall back to two full dates
      // rather than throwing inside a render path.
      if (typeof formatter.formatRange !== "function") {
        return `${fmt.date(s, style)} – ${fmt.date(e, style)}`;
      }
      try {
        return formatter.formatRange(s, e);
      } catch {
        return `${fmt.date(s, style)} – ${fmt.date(e, style)}`;
      }
    },

    currency(amount, code) {
      const value = typeof amount === "number" && isFinite(amount) ? amount : 0;
      const currency = code || defaultCurrency;
      const cacheKey = `${locale}|cur|${currency}`;
      let nf = numberCache.get(cacheKey);
      if (!nf) {
        try {
          nf = new Intl.NumberFormat(locale, { style: "currency", currency });
        } catch {
          // An unknown or malformed currency code from MP must not throw
          // inside a render path.
          nf = new Intl.NumberFormat(locale, {
            style: "currency",
            currency: defaultCurrency,
          });
        }
        numberCache.set(cacheKey, nf);
      }
      return nf.format(value);
    },

    number(value, decimals) {
      const n = typeof value === "number" && isFinite(value) ? value : 0;
      const cacheKey = `${locale}|num|${decimals ?? "auto"}`;
      let nf = numberCache.get(cacheKey);
      if (!nf) {
        nf = new Intl.NumberFormat(
          locale,
          decimals === undefined
            ? {}
            : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
        );
        numberCache.set(cacheKey, nf);
      }
      return nf.format(n);
    },

    percent(value, decimals = 0) {
      const n = typeof value === "number" && isFinite(value) ? value : 0;
      const cacheKey = `${locale}|pct|${decimals}`;
      let nf = numberCache.get(cacheKey);
      if (!nf) {
        nf = new Intl.NumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
        numberCache.set(cacheKey, nf);
      }
      // Callers hold percentages as 0-100, not 0-1.
      return nf.format(n / 100);
    },

    relative(value) {
      const d = parseWallClock(value);
      if (!d) return "";
      if (typeof Intl.RelativeTimeFormat !== "function") {
        return fmt.date(d, "medium");
      }
      let rtf = relativeCache.get(locale);
      if (!rtf) {
        rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
        relativeCache.set(locale, rtf);
      }
      const diffMs = d.getTime() - Date.now();
      const days = Math.round(diffMs / 86_400_000);
      if (Math.abs(days) < 1) {
        const hours = Math.round(diffMs / 3_600_000);
        if (Math.abs(hours) < 1) {
          return rtf.format(Math.round(diffMs / 60_000), "minute");
        }
        return rtf.format(hours, "hour");
      }
      if (Math.abs(days) < 31) return rtf.format(days, "day");
      if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), "month");
      return rtf.format(Math.round(days / 365), "year");
    },

    list(items) {
      return listFormatter(locale).format(items);
    },

    monthNames(style = "long") {
      const key = style === "long" ? "monthYear__monthOnly" : "monthShort";
      const options: Intl.DateTimeFormatOptions = { month: style };
      const f = dateFormatter(locale, key, options);
      // Day 15 avoids any month-length edge case; the year is irrelevant.
      return Array.from({ length: 12 }, (_, i) =>
        f.format(new Date(2000, i, 15)),
      );
    },

    weekdayNames(style = "long") {
      const options: Intl.DateTimeFormatOptions = { weekday: style };
      const f = dateFormatter(locale, `wd_${style}`, options);
      // 2024-01-07 was a Sunday, so index 0 = Sunday.
      return Array.from({ length: 7 }, (_, i) =>
        f.format(new Date(2024, 0, 7 + i)),
      );
    },

    defaultCurrency,
  };

  formattersByLocale.set(locale, fmt);
  return fmt;
}

/** Test seam: drop every memoised `Intl` instance. */
export function __resetFormatterCaches(): void {
  dateCache.clear();
  numberCache.clear();
  pluralCache.clear();
  listCache.clear();
  relativeCache.clear();
  formattersByLocale.clear();
}
