/**
 * Crypto helpers for embed sessions (WebCrypto only, no Node-specific APIs
 * beyond Buffer for base64url).
 *
 * MP tokens are sealed at rest with AES-256-GCM. The key comes from
 * `EMBED_SESSION_ENC_KEY` (base64url, 32 bytes). Outside production, when that
 * is unset, the key is derived as SHA-256(EMBED_JWT_SECRET) so local dev and
 * tests work with no extra config. In production an unset key is a hard error
 * raised when `seal`/`open` is first called (not at module load).
 */

import { getJwtSecret } from "./jwt";

const SEAL_VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(u8).toString("base64url");
}

export function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  // Normalize to the global-realm Uint8Array so WebCrypto / instanceof checks agree.
  return new Uint8Array(Buffer.from(input, "base64url"));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let cachedKeySource: string | null = null;
let cachedKey: Promise<CryptoKey> | null = null;

async function deriveKeyBytes(): Promise<{ source: string; bytes: Uint8Array<ArrayBuffer> }> {
  const configured = process.env.EMBED_SESSION_ENC_KEY;
  if (configured) {
    const bytes = fromBase64Url(configured);
    if (bytes.byteLength !== KEY_BYTES) {
      throw new Error(
        `EMBED_SESSION_ENC_KEY must decode to exactly ${KEY_BYTES} bytes (base64url); got ${bytes.byteLength}`,
      );
    }
    return { source: `env:${configured}`, bytes };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "EMBED_SESSION_ENC_KEY is required in production when EMBED_AUTH_MODE is not \"legacy\". " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }

  const secret = getJwtSecret();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return { source: `derived:${secret}`, bytes: new Uint8Array(digest) };
}

async function getKey(): Promise<CryptoKey> {
  const { source, bytes } = await deriveKeyBytes();
  if (cachedKey && cachedKeySource === source) return cachedKey;
  cachedKeySource = source;
  cachedKey = crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

/** Encrypt a UTF-8 string → `"v1.<base64url iv>.<base64url ciphertext+tag>"`. */
export async function seal(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return `${SEAL_VERSION}.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

/** Decrypt a value produced by `seal`. Throws on tamper/format/key mismatch. */
export async function open(sealed: string): Promise<string> {
  const parts = typeof sealed === "string" ? sealed.split(".") : [];
  if (parts.length !== 3 || parts[0] !== SEAL_VERSION) {
    throw new Error("Invalid sealed value format");
  }
  const iv = fromBase64Url(parts[1]);
  const ciphertext = fromBase64Url(parts[2]);
  if (iv.byteLength !== IV_BYTES) {
    throw new Error("Invalid sealed value format");
  }
  const key = await getKey();
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return decoder.decode(plaintext);
  } catch {
    throw new Error("Failed to open sealed value");
  }
}

/** Cryptographically random base64url token (no padding). Default 32 bytes = 256 bits. */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64Url(buf);
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

/**
 * Constant-time string comparison. Length mismatch returns false, but the loop
 * still runs over the longer input so timing does not leak the match prefix.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

/** Test hook: forget the cached AES key so a re-stubbed env takes effect. */
export function __resetCryptoKeyForTests(): void {
  cachedKeySource = null;
  cachedKey = null;
}
