/**
 * Plan Your Visit's email-verification token.
 *
 * Plan Your Visit is a two-step flow: a visitor submits their name + email, we
 * email them a link back to the host page carrying one of these tokens, and the
 * registration form only unlocks (and may create MP records) once the token
 * verifies. The token embeds the name/email the visitor supplied so the
 * registration form can pre-fill and the server can trust those values.
 *
 * **This is now a thin wrapper over `action-token.ts`**, which generalises the
 * same idea for `next-prayer-feedback`, `next-subscribe-to-publication` and
 * `next-unsubscribe`. The wrapper is kept rather than migrating the two call
 * sites because it holds Plan Your Visit's payload shape and its `guard`, and
 * because the wire format must not move: links already sitting in visitors'
 * inboxes have to keep verifying. `createActionToken("pyv-verify", …)` produces
 * a byte-compatible payload with the hand-rolled version this replaced, so
 * tokens minted before and after the change are interchangeable.
 *
 * Signed with HS256 (jose) using EMBED_JWT_SECRET (same secret as the widget
 * session JWT) but with a distinct payload `typ` and a longer expiry, since the
 * visitor may take a while to open the email. No `iss`/`aud` is required on
 * verification so tokens emailed before a deploy keep working.
 */

import {
  ACTION_TOKEN_EXPIRY,
  createActionToken,
  verifyActionToken,
} from "./action-token";

export interface VerifyPayload {
  typ: "pyv-verify";
  firstName: string;
  lastName: string;
  email: string;
  iat: number;
  exp: number;
}

const DEFAULT_EXPIRY_SECONDS = ACTION_TOKEN_EXPIRY["pyv-verify"]; // 24 hours

export async function createVerifyToken(
  data: { firstName: string; lastName: string; email: string },
  expirySeconds: number = DEFAULT_EXPIRY_SECONDS
): Promise<string> {
  return createActionToken(
    "pyv-verify",
    {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
    },
    expirySeconds
  );
}

/**
 * Verify a token and return its payload, or null when invalid/expired.
 *
 * Collapses `action-token.ts`'s richer failure reasons to `null` because the
 * two Plan Your Visit call sites already map every failure onto one
 * `reason: "invalid"` response, and widening that is a change to the widget's
 * wire contract rather than to this helper.
 */
export async function verifyVerifyToken(token: string): Promise<VerifyPayload | null> {
  const result = await verifyActionToken("pyv-verify", token, (payload) => {
    if (
      typeof payload.email !== "string" || !payload.email ||
      typeof payload.firstName !== "string" || !payload.firstName ||
      typeof payload.lastName !== "string" || !payload.lastName ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    return {
      typ: "pyv-verify" as const,
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      iat: payload.iat,
      exp: payload.exp,
    };
  });

  return result.ok ? result.data : null;
}
