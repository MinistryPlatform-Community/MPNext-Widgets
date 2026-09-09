/**
 * A single-use anonymous action: signed handle in the URL, payload in the store.
 *
 * Built for the double-opt-in flows. A signed-out visitor submits a prayer
 * request or a newsletter sign-up, we email them a link, and **only when that
 * link is opened** do we write anything to MinistryPlatform. That round-trip is
 * what makes creating a `Contacts` row safe: without it, an unauthenticated
 * POST mints rows in a church's CRM as fast as a script can manage, and MP has
 * no good bulk undo for that.
 *
 * ## Why the payload is not in the token
 *
 * `action-token.ts` alone would do the job if the payload were small. It is
 * not: a prayer request carries up to 2000 characters of description, which
 * signs into roughly a 3KB token and therefore a 3KB URL — through mail
 * clients, link rewriters and Outlook Safe Links, none of which are reliable at
 * that length. Worse, a self-contained token is **replayable for its whole
 * lifetime**, so every click files another Feedback_Entry. The legacy widget
 * tried to paper over exactly that with a content-comparison duplicate guard,
 * and the guard was broken.
 *
 * So the URL carries a signed envelope holding only `{ jti }`, and the payload
 * is sealed in the session store under that id. Redemption is
 * `kvGetDelete` — an atomic read-and-burn — which makes single-use a property
 * of the storage rather than something the caller has to remember to enforce.
 *
 * ## Four outcomes, each with an honest producer
 *
 * | Situation | Reason | Store touched? |
 * |---|---|---|
 * | Signature bad, malformed, or wrong kind | `invalid` | no |
 * | Envelope `exp` in the past | `expired` | **no** |
 * | Envelope good, no record under `jti` | `used` | yes |
 * | Store unreachable | `unavailable` | attempted |
 *
 * Proving expiry from the signature is what makes `expired` distinguishable
 * from `used` at all. A store-only design cannot tell them apart — a missing
 * key means "redeemed" and "timed out" equally — and an expired link then
 * reports "already used", which sends the visitor looking for an email they
 * never opened.
 *
 * **The envelope must expire before the stored record does.** `createPendingAction`
 * gives the store extra TTL for exactly this reason: if the record vanished
 * first, `expired` would become unreachable and `used` would silently absorb
 * every genuinely expired link.
 *
 * ## It fails closed
 *
 * `rate-limit.ts` deliberately fails *open*, so a store outage cannot take
 * public widgets down. This must not: a store error on consume is
 * `unavailable`, never a successful redemption. The failure modes are not
 * symmetric — allowing an extra request is cheap, while writing a row on the
 * strength of a token we could not verify is the thing the round-trip exists to
 * prevent.
 */

import {
  createActionToken,
  verifyActionToken,
  type ActionTokenType,
} from "./action-token";
import { seal, open, randomToken } from "./crypto";
import { getSessionStore } from "./session-store";

/**
 * The flows that use a store-backed single-use action.
 *
 * A subset of `ActionTokenType`: `unsubscribe` is deliberately absent, because
 * an unsubscribe link must stay replayable — re-clicking it in an old email
 * should still work, and it writes nothing new.
 */
export type PendingActionKind = Extract<
  ActionTokenType,
  "prayer-feedback" | "publication-verify"
>;

export type PendingActionFailure = "invalid" | "expired" | "used" | "unavailable";

export type PendingActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: PendingActionFailure };

/**
 * Slack between the envelope's expiry and the stored record's, so the envelope
 * is always the first to go. Five minutes covers clock skew between this
 * process and the store without keeping dead payloads around meaningfully
 * longer.
 */
const STORE_TTL_SLACK_SECONDS = 300;

interface StoredRecord {
  kind: PendingActionKind;
  data: unknown;
}

function storeKey(kind: PendingActionKind, jti: string): string {
  return `pending:${kind}:${jti}`;
}

/**
 * Seal `data` in the store and return the token to put in an emailed link.
 *
 * The token is short — a signed envelope over one random id — regardless of how
 * large `data` is.
 */
export async function createPendingAction<T>(
  kind: PendingActionKind,
  data: T,
  ttlSeconds: number
): Promise<string> {
  const jti = randomToken(32);
  const record: StoredRecord = { kind, data };

  await getSessionStore().kvSet(
    storeKey(kind, jti),
    await seal(JSON.stringify(record)),
    ttlSeconds + STORE_TTL_SLACK_SECONDS
  );

  return createActionToken(kind, { jti }, ttlSeconds);
}

/**
 * Redeem a token exactly once and return its payload.
 *
 * `guard` narrows the stored payload; a payload it rejects is `invalid`, which
 * is the right answer for a record written by an older deploy whose shape we no
 * longer recognise. Note the record is **already burned** by then — a shape we
 * cannot read is not worth keeping redeemable, and leaving it would hand a
 * caller an endlessly retryable failure.
 */
export async function consumePendingAction<T>(
  kind: PendingActionKind,
  token: string,
  guard: (data: unknown) => T | null
): Promise<PendingActionResult<T>> {
  // Envelope first, so an expired or forged link costs no store round-trip.
  const envelope = await verifyActionToken(kind, token, (payload) =>
    typeof payload.jti === "string" && payload.jti ? { jti: payload.jti } : null
  );

  if (!envelope.ok) {
    return {
      ok: false,
      // `wrong-type` is a token minted for another flow: to this route it is
      // simply not a valid link, and saying which flow it belonged to would
      // leak what else the bearer holds.
      reason: envelope.reason === "expired" ? "expired" : "invalid",
    };
  }

  let sealed: string | null;
  try {
    sealed = await getSessionStore().kvGetDelete(storeKey(kind, envelope.data.jti));
  } catch (error) {
    console.error(
      "consumePendingAction: session store unavailable; refusing to redeem",
      error instanceof Error ? error.message : error
    );
    return { ok: false, reason: "unavailable" };
  }

  // Envelope verified and unexpired, but no record: it has been redeemed.
  if (sealed === null) return { ok: false, reason: "used" };

  let record: StoredRecord;
  try {
    record = JSON.parse(await open(sealed)) as StoredRecord;
  } catch (error) {
    console.error(
      "consumePendingAction: stored record could not be opened",
      error instanceof Error ? error.message : error
    );
    return { ok: false, reason: "invalid" };
  }

  // Belt and braces over the key namespace: the kind is in the sealed record
  // too, so neither a swapped envelope nor a swapped store key crosses flows.
  if (record.kind !== kind) return { ok: false, reason: "invalid" };

  const data = guard(record.data);
  if (data === null) return { ok: false, reason: "invalid" };

  return { ok: true, data };
}
