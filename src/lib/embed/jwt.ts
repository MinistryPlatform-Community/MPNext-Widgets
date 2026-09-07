/**
 * JWT utilities for embed widget authentication (jose, HS256).
 *
 * Two token kinds share the same secret:
 * - Widget tokens (`typ: "JWT"`): 5-minute bearer tokens carried by widgets.
 * - State tokens (`typ: "nw-state"`): short-lived OAuth state cookies.
 *
 * Both carry `iss`/`aud` and are verified with `algorithms: ["HS256"]` only,
 * so alg-confusion and cross-purpose replay are rejected at verification.
 * The secret is resolved lazily at call time so tests can stub env vars.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { WidgetClaims } from "./types";

export const JWT_EXPIRY_SECONDS = 300; // 5 minutes
export const JWT_ALGORITHM = "HS256";
const STATE_TOKEN_TYP = "nw-state";
const DEV_SECRET = "development-secret-do-not-use-in-production";
const CLOCK_TOLERANCE_SECONDS = 5;

/** Resolve the shared HS256 secret. Throws in production when unset. */
export function getJwtSecret(): string {
  const secret = process.env.EMBED_JWT_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("EMBED_JWT_SECRET environment variable is required in production");
  }
  return secret || DEV_SECRET;
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(getJwtSecret());
}

export function getJwtIssuer(): string {
  return process.env.EMBED_JWT_ISSUER || "mpnext-embed";
}

export function getJwtAudience(): string {
  return process.env.EMBED_JWT_AUDIENCE || "mpnext-embed-api";
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Drop `undefined` values so they never serialize as `null` claims. */
function compact<T extends object>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Create a JWT for widget authentication.
 */
export async function createWidgetToken(
  claims: Omit<WidgetClaims, "iat" | "exp" | "jti" | "iss" | "aud">,
): Promise<string> {
  const now = nowSeconds();
  return new SignJWT(compact(claims))
    .setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + JWT_EXPIRY_SECONDS)
    .setJti(crypto.randomUUID())
    .setIssuer(getJwtIssuer())
    .setAudience(getJwtAudience())
    .sign(getSecretKey());
}

/**
 * Verify and decode a widget JWT. Rejects wrong alg, wrong header `typ`
 * (state tokens can never pass as widget tokens), wrong iss/aud, bad
 * signature, expiry (with 5s tolerance), and malformed claim shapes.
 */
export async function verifyWidgetToken(token: string): Promise<WidgetClaims> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, getSecretKey(), {
      algorithms: [JWT_ALGORITHM],
      typ: "JWT",
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    payload = result.payload;
  } catch (error) {
    throw new Error(`Invalid token: ${describeError(error)}`);
  }

  if (typeof payload.sub !== "string" || typeof payload.wid !== "string") {
    throw new Error("Invalid token: missing required claims");
  }
  if (payload.ver !== undefined && payload.ver !== 1 && payload.ver !== 2) {
    throw new Error("Invalid token: unsupported version");
  }

  const claims: WidgetClaims = {
    sub: payload.sub,
    wid: payload.wid,
    origin: typeof payload.origin === "string" ? payload.origin : "",
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
    iss: payload.iss,
    aud: Array.isArray(payload.aud) ? payload.aud[0] : payload.aud,
  };
  if (payload.ver === 1 || payload.ver === 2) claims.ver = payload.ver;
  if (typeof payload.sid === "string") claims.sid = payload.sid;
  if (typeof payload.mpAccessToken === "string") claims.mpAccessToken = payload.mpAccessToken;
  return claims;
}

/**
 * Sign a short-lived state token (used for the OAuth state cookie).
 * Header `typ` is `nw-state`, so it can never be presented as a widget token.
 */
export async function signStateToken(
  payload: Record<string, unknown>,
  ttlSeconds: number,
): Promise<string> {
  const now = nowSeconds();
  return new SignJWT(compact(payload))
    .setProtectedHeader({ alg: JWT_ALGORITHM, typ: STATE_TOKEN_TYP })
    .setIssuedAt(now)
    .setExpirationTime(now + Math.max(1, Math.floor(ttlSeconds)))
    .setIssuer(getJwtIssuer())
    .setAudience(getJwtAudience())
    .sign(getSecretKey());
}

/**
 * Verify a state token. Throws on invalid signature, wrong `typ`, wrong
 * iss/aud, or expiry.
 */
export async function verifyStateToken<T = Record<string, unknown>>(token: string): Promise<T> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: [JWT_ALGORITHM],
      typ: STATE_TOKEN_TYP,
      issuer: getJwtIssuer(),
      audience: getJwtAudience(),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    return payload as T;
  } catch (error) {
    throw new Error(`Invalid state token: ${describeError(error)}`);
  }
}
