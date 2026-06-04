/**
 * Short-lived, signed verification tokens for the next-plan-your-visit widget.
 *
 * Plan Your Visit is a two-step flow: a visitor submits their name + email, we
 * email them a link back to the host page carrying one of these tokens, and the
 * registration form only unlocks (and may create MP records) once the token
 * verifies. The token embeds the name/email the visitor supplied so the
 * registration form can pre-fill and the server can trust those values.
 *
 * Signed with HS256 using EMBED_JWT_SECRET (same secret as the widget session
 * JWT) but with a distinct `typ` and a longer expiry, since the visitor may take
 * a while to open the email.
 */

export interface VerifyPayload {
  typ: "pyv-verify";
  firstName: string;
  lastName: string;
  email: string;
  iat: number;
  exp: number;
}

const ALGORITHM = "HS256";
const DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

function getSecret(): string {
  const secret = process.env.EMBED_JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("EMBED_JWT_SECRET environment variable is required in production");
  }
  return secret || "development-secret-do-not-use-in-production";
}

export async function createVerifyToken(
  data: { firstName: string; lastName: string; email: string },
  expirySeconds: number = DEFAULT_EXPIRY_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: VerifyPayload = {
    typ: "pyv-verify",
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    iat: now,
    exp: now + expirySeconds,
  };

  const header = { alg: ALGORITHM, typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(
    await hmac(`${encodedHeader}.${encodedPayload}`, getSecret())
  );
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/** Verify a token and return its payload, or null when invalid/expired. */
export async function verifyVerifyToken(token: string): Promise<VerifyPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts;

  const expected = base64UrlEncode(
    await hmac(`${encodedHeader}.${encodedPayload}`, getSecret())
  );
  if (!timingSafeEqual(signature, expected)) return null;

  let payload: VerifyPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as VerifyPayload;
  } catch {
    return null;
  }

  if (payload.typ !== "pyv-verify") return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!payload.email || !payload.firstName || !payload.lastName) return null;

  return payload;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64UrlDecode(str: string): string {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString();
}

async function hmac(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Buffer.from(signature).toString("base64");
}
