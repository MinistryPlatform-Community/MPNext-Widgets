import crypto from "node:crypto";
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
    if (parts.length !== 3) throw new Error("Invalid token format");
    const [encodedHeader, encodedPayload, signature] = parts;

    const expected = sign(`${encodedHeader}.${encodedPayload}`, key);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("Invalid token signature");
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    ) as { exp?: number };
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token expired");
    }
    return payload as T;
  }

  public buildRequestToken(payload: PaymentRequestToken): string {
    return this.encode(payload as unknown as Record<string, unknown>);
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
