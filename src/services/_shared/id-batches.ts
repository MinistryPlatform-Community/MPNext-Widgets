/**
 * Reads keyed by a data-driven list of ids, kept under IIS's query limit.
 *
 * MP sits behind IIS, whose default `maxQueryString` is 2048 characters. A
 * request over it is refused with an HTML 404 before MP sees it, and `MPHelper`
 * surfaces that as a bare `404 Not Found` (C50). A filter written as one
 * `X_ID = n OR X_ID = m OR ...` term per id costs ~26 encoded characters an id,
 * so it crosses that line at roughly 75 ids -- a purchaser's lifetime invoices,
 * the distinct programs on a busy calendar month. Every such read used to sit
 * inside a `catch` that only warned, so the overflow showed up as a blank field
 * rather than an error.
 *
 * `idBatches` splits the list; `inFilter` writes one batch as `X IN (...)`
 * (`.claude/references/ministryplatform.query-syntax.md`: "IN lists"), which
 * costs the digits plus one encoded comma (3 chars) an id. At `MP_ID_BATCH`
 * ids of MP's widest id (a 10-digit `int`) that is 1,300 characters, leaving
 * the rest of the 2048 for `$select` and the other parameters.
 * `src/services/mp-url-length.test.ts` pins the end-to-end length.
 *
 * Only finite integers survive: the values are inlined into SQL, so anything
 * else is dropped rather than escaped.
 */

/** Ids per `IN (...)` list. Matches `missionTripService`'s `ID_BATCH`. */
export const MP_ID_BATCH = 100;

/** De-duplicate, keep only integers, and split into batches of `size`. */
export function idBatches(
  ids: Iterable<number | string | null | undefined>,
  size: number = MP_ID_BATCH
): number[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`idBatches: size must be a positive integer, got ${size}`);
  }
  const unique = [
    ...new Set(
      [...ids]
        .filter((v) => v !== null && v !== undefined && v !== "")
        .map(Number)
        .filter(Number.isInteger)
    ),
  ];
  const batches: number[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    batches.push(unique.slice(i, i + size));
  }
  return batches;
}

/** `column IN (1,2,3)` for one batch from `idBatches`. */
export function inFilter(column: string, batch: readonly number[]): string {
  return `${column} IN (${batch.join(",")})`;
}

/**
 * Run `read` once per batch of ids and concatenate the rows.
 *
 * Batches run concurrently. A failed batch rejects the whole call: a caller
 * that degrades on failure already wraps its read in a `catch`, and a partial
 * result that silently drops one batch's rows is the defect this module exists
 * to remove.
 */
export async function readByIdBatches<T>(
  ids: Iterable<number | string | null | undefined>,
  read: (batch: number[]) => Promise<T[]>,
  size: number = MP_ID_BATCH
): Promise<T[]> {
  const batches = idBatches(ids, size);
  if (batches.length === 0) return [];
  const results = await Promise.all(batches.map((batch) => read(batch)));
  return results.flat();
}
