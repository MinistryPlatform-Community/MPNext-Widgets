/**
 * Signed, self-describing tokens that authorise one anonymous action.
 *
 * Several widgets need to identify a person who has no login and no session:
 * a visitor confirming an email address, a recipient unsubscribing from a link
 * in a bulk email. The shape is always the same — a value we minted, handed to
 * exactly one mailbox, and later presented back to us — so it is one primitive
 * rather than one per widget.
 *
 * This generalises `verify-token.ts`, which hardcoded `typ: "pyv-verify"` and
 * carried its whole payload in the JWT. That file **stays** and is now a thin
 * wrapper over this one, because Plan Your Visit links already sitting in
 * people's inboxes must keep verifying.
 *
 * ## `typ` is an input, never a fact read off the token
 *
 * `verifyActionToken` takes the type the *caller* expects and compares it to
 * the token's. It never returns the type it found and let the caller branch on
 * it. This is the whole security property of the field: without the comparison,
 * a token minted to confirm an email address could be replayed at the
 * unsubscribe route, and every flow's tokens become interchangeable capability
 * for every other flow. The signature proves we minted it; only the `typ` check
 * proves we minted it *for this*.
 *
 * ## Expiry is per-flow, and longer is sometimes the safer choice
 *
 * An email-confirmation link should die in a day. An **unsubscribe** link must
 * not: it lives in a mail archive and has to work whenever the recipient gets
 * around to it, and an unsubscribe that has expired is itself a compliance
 * regression — the recipient's only remaining move is to report the message as
 * spam. So expiry is a required argument at the call site, with the per-flow
 * defaults in `ACTION_TOKEN_EXPIRY` rather than one constant here.
 *
 * ## What this is not
 *
 * These tokens are **stateless and therefore replayable** until they expire.
 * That is correct for an unsubscribe (idempotent, and re-clicking the link in
 * an old email should still work) and wrong for anything that writes a new row.
 * For single-use, use `pending-action.ts`, which wraps this with a
 * store-backed one-time burn.
 */

import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret, JWT_ALGORITHM } from "./jwt";

/**
 * Every anonymous action a token can authorise.
 *
 * A closed union on purpose: adding a flow is a deliberate edit here, and a
 * typo in a `typ` string becomes a compile error rather than a token that
 * verifies against nothing at runtime.
 */
export type ActionTokenType =
  /** Plan Your Visit's email confirmation. Legacy spelling — do not rename. */
  | "pyv-verify"
  /** `next-prayer-feedback` — confirm an email before writing a Feedback_Entry. */
  | "prayer-feedback"
  /** `next-subscribe-to-publication` — confirm an email before subscribing. */
  | "publication-verify"
  /** `next-unsubscribe` — a capability to leave one publication, or bulk email. */
  | "unsubscribe";

/** Default lifetimes, per flow. See the note on expiry above. */
export const ACTION_TOKEN_EXPIRY: Record<ActionTokenType, number> = {
  "pyv-verify": 60 * 60 * 24, // 24h — matches verify-token.ts's original
  "prayer-feedback": 60 * 60 * 24, // 24h — confirm today or resubmit
  "publication-verify": 60 * 60 * 24 * 3, // 3 days — newsletter sign-ups sit in inboxes
  unsubscribe: 60 * 60 * 24 * 180, // 180 days — see "Expiry is per-flow"
};

/** Why a token did not verify. Never says *which* flow it was minted for. */
export type ActionTokenFailure = "invalid" | "expired" | "wrong-type";

export type ActionTokenResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ActionTokenFailure };

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}

/**
 * Mint a token authorising `typ`, carrying `data`.
 *
 * `data` is signed, **not encrypted** — anyone holding the token can read it.
 * Put identifiers in it, never anything the holder should not see. It is also
 * part of the URL, so keep it small; a payload over a few hundred bytes belongs
 * in `pending-action.ts` instead, where the URL carries only a handle.
 */
export async function createActionToken<T extends Record<string, unknown>>(
  typ: ActionTokenType,
  data: T,
  expirySeconds: number = ACTION_TOKEN_EXPIRY[typ]
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...data, typ })
    .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + expirySeconds)
    .sign(getSecretKey());
}

/**
 * Verify a token minted for `expectedTyp` and return its payload.
 *
 * `guard` narrows the decoded payload to `T`. It runs *after* the signature and
 * `typ` checks, and a payload the guard rejects is reported as `invalid` — a
 * token we signed but whose shape we no longer recognise is a deploy-skew
 * artefact, not something to half-trust.
 *
 * No `iss`/`aud` is required, deliberately: these tokens are emailed and may be
 * redeemed long after the issuer or audience configuration changed, and the
 * shared secret plus `typ` already establish provenance.
 */
export async function verifyActionToken<T>(
  expectedTyp: ActionTokenType,
  token: string,
  guard: (payload: Record<string, unknown>) => T | null
): Promise<ActionTokenResult<T>> {
  if (!token || typeof token !== "string") return { ok: false, reason: "invalid" };

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, getSecretKey(), { algorithms: [JWT_ALGORITHM] });
    payload = result.payload;
  } catch (error) {
    // jose reports an expired-but-otherwise-valid token distinctly, and the
    // difference is worth surfacing: "this link has expired, here is a new one"
    // is actionable, where "invalid link" reads like our bug.
    const code = (error as { code?: string } | null)?.code;
    return { ok: false, reason: code === "ERR_JWT_EXPIRED" ? "expired" : "invalid" };
  }

  if (payload.typ !== expectedTyp) return { ok: false, reason: "wrong-type" };
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
    return { ok: false, reason: "invalid" };
  }

  const data = guard(payload);
  if (data === null) return { ok: false, reason: "invalid" };

  return { ok: true, data };
}
