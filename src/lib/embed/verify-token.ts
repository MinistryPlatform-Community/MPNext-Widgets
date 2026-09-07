/**
 * Short-lived, signed verification tokens for the next-plan-your-visit widget.
 *
 * Plan Your Visit is a two-step flow: a visitor submits their name + email, we
 * email them a link back to the host page carrying one of these tokens, and the
 * registration form only unlocks (and may create MP records) once the token
 * verifies. The token embeds the name/email the visitor supplied so the
 * registration form can pre-fill and the server can trust those values.
 *
 * Signed with HS256 (jose) using EMBED_JWT_SECRET (same secret as the widget
 * session JWT) but with a distinct payload `typ` and a longer expiry, since the
 * visitor may take a while to open the email. No `iss`/`aud` is required on
 * verification so tokens emailed before a deploy keep working.
 */

import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret, JWT_ALGORITHM } from "./jwt";

export interface VerifyPayload {
  typ: "pyv-verify";
  firstName: string;
  lastName: string;
  email: string;
  iat: number;
  exp: number;
}

const DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}

export async function createVerifyToken(
  data: { firstName: string; lastName: string; email: string },
  expirySeconds: number = DEFAULT_EXPIRY_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    typ: "pyv-verify",
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
  })
    .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + expirySeconds)
    .sign(getSecretKey());
}

/** Verify a token and return its payload, or null when invalid/expired. */
export async function verifyVerifyToken(token: string): Promise<VerifyPayload | null> {
  if (!token || typeof token !== "string") return null;

  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, getSecretKey(), {
      algorithms: [JWT_ALGORITHM],
    });
    payload = result.payload;
  } catch {
    return null;
  }

  if (payload.typ !== "pyv-verify") return null;
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
  if (
    typeof payload.email !== "string" || !payload.email ||
    typeof payload.firstName !== "string" || !payload.firstName ||
    typeof payload.lastName !== "string" || !payload.lastName
  ) {
    return null;
  }

  return {
    typ: "pyv-verify",
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    iat: payload.iat,
    exp: payload.exp,
  };
}
