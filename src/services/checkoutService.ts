import crypto from "node:crypto";
import { getSessionStore } from "@/lib/embed/session-store";
import type { PaymentRequestToken, PaymentResponseToken } from "@mpnext/types";

/**
 * Payment hand-off token signing/verification (HS256), mirroring the legacy
 * JwtHelper. The request token (checkout → gateway) and response token
 * (gateway → checkout) are signed with the same shared secret
 * (PAYMENT_JWT_SIGNING_KEY) so a real vendor can be swapped in by sharing the
 * key and pointing the checkout at the vendor's hosted page.
 */

const ISSUER = "ministryplatform.com";
const TTL_SECONDS = 15 * 60;
/** The ledger entry outlives the token slightly, so expiry decides first. */
const REQUEST_KEY_SLACK_SECONDS = 60;

/** `nw:kv:pay:req:<jti>` — present while the request token is unspent. */
function requestKey(jti: string): string {
  return `pay:req:${jti}`;
}

function getSigningKey(): string {
  const key = process.env.PAYMENT_JWT_SIGNING_KEY;
  if (!key && process.env.NODE_ENV === "production") {
    throw new Error("PAYMENT_JWT_SIGNING_KEY is required in production");
  }
  if (key && key.length < 16) {
    throw new Error("PAYMENT_JWT_SIGNING_KEY must be at least 16 characters");
  }
  return key || "development-payment-signing-key-change-me";
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlJson(obj: unknown): string {
  return base64url(JSON.stringify(obj));
}

function sign(data: string, key: string): string {
  return base64url(crypto.createHmac("sha256", key).update(data).digest());
}

/**
 * A payment hand-off token that failed verification. Routes branch on
 * `reason` (never on the message): `expired` and `invalid` map to the
 * `verification_expired` / `verification_invalid` wire codes.
 */
export class PaymentTokenError extends Error {
  constructor(public readonly reason: "expired" | "invalid", message: string) {
    super(message);
    this.name = "PaymentTokenError";
  }
}

export class CheckoutService {
  private static instance: CheckoutService;

  public static getInstance(): CheckoutService {
    if (!CheckoutService.instance) {
      CheckoutService.instance = new CheckoutService();
    }
    return CheckoutService.instance;
  }

  /** Sign an HS256 JWT with the shared payment key. */
  private encode(payload: Record<string, unknown>): string {
    const key = getSigningKey();
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const body = { iss: ISSUER, iat: now, nbf: now, exp: now + TTL_SECONDS, ...payload };
    const encodedHeader = base64urlJson(header);
    const encodedPayload = base64urlJson(body);
    const signature = sign(`${encodedHeader}.${encodedPayload}`, key);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  /** Verify signature + expiry and return the payload. Throws on failure. */
  public decode<T = Record<string, unknown>>(token: string): T {
    const key = getSigningKey();
    const parts = token.split(".");
    if (parts.length !== 3) throw new PaymentTokenError("invalid", "Invalid token format");
    const [encodedHeader, encodedPayload, signature] = parts;

    const expected = sign(`${encodedHeader}.${encodedPayload}`, key);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new PaymentTokenError("invalid", "Invalid token signature");
    }

    let payload: { exp?: number };
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
      ) as { exp?: number };
    } catch {
      throw new PaymentTokenError("invalid", "Invalid token payload");
    }
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new PaymentTokenError("expired", "Token expired");
    }
    return payload as T;
  }

  // ── Single-use request tokens (C43) ──────────────────────────────────────
  //
  // A request token used to be good for its whole 15 minutes: Back from the
  // pay page and Forward again re-unpacked it, and every submit minted a fresh
  // transaction code, so the `Transaction_Code` guard saw two distinct
  // payments. Each token now carries a `jti` that is *open* in the KV store
  // until the first successful submit spends it. A declined submit does not
  // spend it, so the payer can try another card on the same page.

  /**
   * Sign a request token with a fresh `jti` and record it as open. Throws if
   * the store is unreachable: an unrecorded token could never be spent, so it
   * must not be issued.
   */
  public async issueRequestToken(
    payload: Omit<PaymentRequestToken, "jti">
  ): Promise<string> {
    const jti = crypto.randomUUID();
    await getSessionStore().kvSet(
      requestKey(jti),
      "open",
      TTL_SECONDS + REQUEST_KEY_SLACK_SECONDS
    );
    const full: PaymentRequestToken = { ...payload, jti };
    return this.encode(full as unknown as Record<string, unknown>);
  }

  /** Whether a request token can still be paid (issued and not yet spent). */
  public async isRequestOpen(request: Pick<PaymentRequestToken, "jti">): Promise<boolean> {
    if (!request.jti) return false;
    return (await getSessionStore().kvGet(requestKey(request.jti))) !== null;
  }

  /**
   * Spend a request token, atomically. True for exactly one caller per `jti`;
   * every later (or concurrent) caller gets false.
   */
  public async spendRequest(request: Pick<PaymentRequestToken, "jti">): Promise<boolean> {
    if (!request.jti) return false;
    return (await getSessionStore().kvGetDelete(requestKey(request.jti))) !== null;
  }

  public buildResponseToken(payload: PaymentResponseToken): string {
    return this.encode(payload as unknown as Record<string, unknown>);
  }

  public decodeRequestToken(token: string): PaymentRequestToken {
    return this.decode<PaymentRequestToken>(token);
  }

  public decodeResponseToken(token: string): PaymentResponseToken {
    return this.decode<PaymentResponseToken>(token);
  }
}
