/**
 * The four helpers every MP-writing service had its own copy of.
 *
 * `sqlLiteral`, `clean` and `toNumberOrNull` were **byte-identical** in
 * `planYourVisitService.ts` and `prayerFeedbackService.ts` (and `clean` in
 * `groupsService.ts` as well), and `subscribeEmailToPublication` would have
 * made a fourth. A SQL-escaping helper duplicated four ways is precisely the
 * wrong thing to have: it is the one function in the set where a divergence is
 * a security bug rather than a style inconsistency, and nothing would have
 * flagged three copies drifting apart.
 *
 * `getIdByValue` comes with them because it is the only *caller* of
 * `sqlLiteral` that matters — resolving a lookup-table id by its human-readable
 * value, which is how these services avoid hard-coding `Contact_Status_ID = 1`.
 * Its cache and its `MPHelper` stay owned by the service (one cache per
 * singleton, so a test that resets a service resets its lookups too); this
 * module owns only the query and the caching *rule*.
 *
 * Deliberately not here: a service's genuinely local helpers.
 * `prayerFeedbackService`'s `cap` and `planYourVisitService`'s `toNumber` each
 * exist in one place, and moving a one-caller function into a shared module
 * makes it harder to find, not easier.
 *
 * This module performs **reads only**. It is imported by services that write,
 * but nothing here creates, updates or deletes.
 */

import type { MPHelper } from "@/lib/providers/ministry-platform";

/**
 * Escape a value for inclusion inside an MP filter's `'...'` literal.
 *
 * MP's REST layer takes a SQL `WHERE` fragment, so a single quote in a value
 * ends the literal and everything after it is parsed as SQL. Doubling it is the
 * SQL-standard escape and is what every caller in this repo relies on.
 *
 * **This is not a substitute for validating a value's shape.** A capability
 * pasted out of a URL — a `Contact_GUID`, say — goes through a whitelist
 * (`isContactGuid`) as well, because "escaped" and "the sort of thing that
 * belongs in this filter" are different questions.
 */
export function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Trim a value and collapse "" to `null`.
 *
 * MP treats an empty string and a NULL differently in several places, and a
 * form posts `""` for every field the visitor left alone — so the two have to
 * be reconciled somewhere, and doing it once on the way in beats a `|| null`
 * at every write site.
 */
export function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str === "" ? null : str;
}

/**
 * Coerce an MP scalar to a number, or `null`.
 *
 * MP's REST layer returns integer columns as numbers in some responses and as
 * strings in others (it depends on the procedure and on the column's provider
 * type), so a freshly-created record's id has to survive both.
 */
export function toNumberOrNull(
  value: number | string | null | undefined
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** What `getIdByValue` needs from the service that calls it. */
export interface IdLookupSource {
  /** The service's own `MPHelper`. */
  mp: MPHelper;
  /**
   * The service's own id cache, so a reset service starts with cold lookups.
   * Keyed `table:column:value` — shared across every lookup a service makes.
   */
  cache: Map<string, number | null>;
  /** Service name, for the one warning line this module can emit. */
  label: string;
}

/**
 * Resolve a lookup-table row's numeric id from one of its column values.
 *
 * Lookup ids like `Contact_Statuses.Contact_Status_ID` are stable on a stock
 * MP instance and **not guaranteed** on one that has been through a data
 * conversion, so every write resolves them by name rather than hard-coding a
 * number.
 *
 * Cached, including the misses: a domain that genuinely has no `'Website'`
 * household source should not pay a round-trip per submission to rediscover
 * that. A failed read caches `null` for the same reason — callers treat `null`
 * as "omit the column" or "fail this write", and both are better than retrying
 * a broken query on every request.
 */
export async function getIdByValue(
  source: IdLookupSource,
  table: string,
  columnName: string,
  value: string,
  idColumn: string
): Promise<number | null> {
  const cacheKey = `${table}:${columnName}:${value}`;
  const cached = source.cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let id: number | null = null;
  try {
    const rows = await source.mp.getTableRecords<Record<string, number | string | null>>({
      table,
      select: `${idColumn} AS Id`,
      filter: `${columnName} = '${sqlLiteral(value)}'`,
      top: 1,
    });
    id = toNumberOrNull(rows[0]?.Id ?? null);
  } catch (error) {
    console.warn(
      `${source.label}: getIdByValue ${table}.${columnName} failed:`,
      error instanceof Error ? error.message : error
    );
  }
  source.cache.set(cacheKey, id);
  return id;
}
