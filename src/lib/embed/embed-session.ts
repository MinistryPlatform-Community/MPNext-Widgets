/**
 * Embed session service layer: create/read/delete server-side sessions that
 * hold MP tokens (sealed), plus the single helper routes use to obtain a
 * user's MP access token (`getMpUserAccessToken`) with refresh-on-demand.
 *
 * Invariants:
 * - The raw `sid` is returned to the caller once and stored only as sha256.
 * - MP tokens never leave this module unencrypted except via the explicit
 *   accessors below; nothing here logs token material.
 * - Absolute expiry is enforced on read; idle (sliding) expiry is the store TTL,
 *   bumped at most once per 60s to avoid write amplification.
 */

import type { EmbedSessionRecord, EmbedSessionUser, WidgetClaims } from "./types";
import { getSessionStore } from "./session-store";
import { open, randomToken, seal, sha256Hex } from "./crypto";
import { refreshWithRefreshToken } from "./mp-oauth";

const DEFAULT_IDLE_TTL_SECONDS = 2_592_000; // 30d
const DEFAULT_ABSOLUTE_TTL_SECONDS = 7_776_000; // 90d
const DEFAULT_MP_EXPIRES_IN_SECONDS = 3600;
const TOUCH_INTERVAL_SECONDS = 60;
const REFRESH_SKEW_SECONDS = 60;
const HANDOFF_TTL_SECONDS = 60;
const REFRESH_LOCK_TTL_SECONDS = 10;
const REFRESH_WAIT_MS = 2000;
const REFRESH_POLL_MS = 200;

export interface CreateSessionInput {
  origin: string;
  user: EmbedSessionUser;
  mpAccessToken: string;
  mpRefreshToken?: string | null;
  mpIdToken?: string | null;
  /** Seconds until the MP access token expires; defaults to 3600 when unknown. */
  mpExpiresIn?: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSessionTtls(): { idle: number; absolute: number } {
  return {
    idle: envInt("EMBED_SESSION_IDLE_TTL", DEFAULT_IDLE_TTL_SECONDS),
    absolute: envInt("EMBED_SESSION_ABSOLUTE_TTL", DEFAULT_ABSOLUTE_TTL_SECONDS),
  };
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Store TTL for a record: sliding idle window, capped by the absolute expiry. */
function storeTtl(record: EmbedSessionRecord, now: number): number {
  const { idle } = getSessionTtls();
  const untilAbsolute = record.absoluteExpiresAt - now;
  return Math.max(1, Math.min(idle, untilAbsolute));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createEmbedSession(
  input: CreateSessionInput,
): Promise<{ sid: string; record: EmbedSessionRecord }> {
  if (!input.origin) throw new Error("createEmbedSession: origin is required");
  if (!input.mpAccessToken) throw new Error("createEmbedSession: mpAccessToken is required");
  if (!input.user?.userGuid) throw new Error("createEmbedSession: user.userGuid is required");

  const now = nowSeconds();
  const { absolute } = getSessionTtls();
  const sid = randomToken(32);
  const sidHash = await sha256Hex(sid);

  const expiresIn =
    typeof input.mpExpiresIn === "number" && input.mpExpiresIn > 0
      ? Math.floor(input.mpExpiresIn)
      : DEFAULT_MP_EXPIRES_IN_SECONDS;

  const record: EmbedSessionRecord = {
    sidHash,
    origin: input.origin,
    user: {
      userGuid: input.user.userGuid,
      firstName: input.user.firstName ?? "",
      lastName: input.user.lastName ?? "",
      email: input.user.email ?? "",
      imageGuid: input.user.imageGuid ?? null,
    },
    mpAccessTokenEnc: await seal(input.mpAccessToken),
    mpRefreshTokenEnc: input.mpRefreshToken ? await seal(input.mpRefreshToken) : null,
    mpIdTokenEnc: input.mpIdToken ? await seal(input.mpIdToken) : null,
    mpExpiresAt: now + expiresIn,
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + absolute,
  };

  await getSessionStore().set(record, storeTtl(record, now));
  return { sid, record };
}

/**
 * Load a session by raw sid. Returns null when missing, past absolute expiry
 * (deleted), or bound to a different origin. Bumps `lastSeenAt` (and the
 * sliding TTL) at most once per 60s.
 */
export async function getEmbedSession(
  sid: string,
  origin: string,
): Promise<EmbedSessionRecord | null> {
  if (!sid || typeof sid !== "string") return null;

  const store = getSessionStore();
  const sidHash = await sha256Hex(sid);
  const record = await store.get(sidHash);
  if (!record) return null;

  const now = nowSeconds();
  if (record.absoluteExpiresAt <= now) {
    await store.delete(sidHash);
    return null;
  }

  if (record.origin !== origin) {
    console.warn("embed session origin mismatch", { expected: record.origin, got: origin });
    return null;
  }

  if (now - record.lastSeenAt >= TOUCH_INTERVAL_SECONDS) {
    record.lastSeenAt = now;
    await store.set(record, storeTtl(record, now));
  }

  return record;
}

/** Delete a session (idempotent). Returns the decrypted id token for an endsession hint. */
export async function deleteEmbedSession(sid: string): Promise<{ idToken: string | null }> {
  if (!sid || typeof sid !== "string") return { idToken: null };

  const store = getSessionStore();
  const sidHash = await sha256Hex(sid);
  const record = await store.get(sidHash);

  let idToken: string | null = null;
  if (record?.mpIdTokenEnc) {
    try {
      idToken = await open(record.mpIdTokenEnc);
    } catch {
      idToken = null;
    }
  }

  await store.delete(sidHash);
  return { idToken };
}

// ---------------------------------------------------------------------------
// MP token access + refresh
// ---------------------------------------------------------------------------

/**
 * Refresh the MP tokens for a session record via `grant_type=refresh_token`,
 * re-seal, persist, and return the updated record. Throws when the record has
 * no refresh token or MP rejects the refresh.
 */
export async function refreshMpTokens(record: EmbedSessionRecord): Promise<EmbedSessionRecord> {
  if (!record.mpRefreshTokenEnc) {
    throw new Error("Session has no refresh token");
  }
  const refreshToken = await open(record.mpRefreshTokenEnc);
  const tokens = await refreshWithRefreshToken(refreshToken);

  const now = nowSeconds();
  const expiresIn =
    typeof tokens.expires_in === "number" && tokens.expires_in > 0
      ? Math.floor(tokens.expires_in)
      : DEFAULT_MP_EXPIRES_IN_SECONDS;

  const updated: EmbedSessionRecord = {
    ...record,
    mpAccessTokenEnc: await seal(tokens.access_token),
    mpRefreshTokenEnc: tokens.refresh_token ? await seal(tokens.refresh_token) : record.mpRefreshTokenEnc,
    mpIdTokenEnc: tokens.id_token ? await seal(tokens.id_token) : record.mpIdTokenEnc,
    mpExpiresAt: now + expiresIn,
    lastSeenAt: now,
  };

  await getSessionStore().set(updated, storeTtl(updated, now));
  return updated;
}

async function accessTokenIfLive(record: EmbedSessionRecord, now: number): Promise<string | null> {
  if (record.mpExpiresAt <= now) return null;
  try {
    return await open(record.mpAccessTokenEnc);
  } catch {
    return null;
  }
}

/**
 * Resolve the MP access token to act as the user.
 *
 * - v2 (`claims.sid`): load the session (origin-bound); refresh when within 60s
 *   of expiry and a refresh token exists, under a store lock so concurrent
 *   requests do not stampede MP. Expired with no refresh token → null.
 * - v1: `claims.mpAccessToken` (empty → null).
 */
export async function getMpUserAccessToken(claims: WidgetClaims): Promise<string | null> {
  if (!claims.sid) {
    return claims.mpAccessToken || null;
  }

  const record = await getEmbedSession(claims.sid, claims.origin);
  if (!record) return null;

  const now = nowSeconds();
  const needsRefresh = record.mpExpiresAt - now < REFRESH_SKEW_SECONDS;
  if (!needsRefresh) return accessTokenIfLive(record, now);

  if (!record.mpRefreshTokenEnc) {
    // Nothing we can do: hand back the current token while it is still valid.
    return accessTokenIfLive(record, now);
  }

  const store = getSessionStore();
  const lockKey = `refresh:${record.sidHash}`;
  const previousExpiry = record.mpExpiresAt;

  if (await store.acquireLock(lockKey, REFRESH_LOCK_TTL_SECONDS)) {
    try {
      // Re-read: another instance may have refreshed between our read and lock.
      const fresh = (await store.get(record.sidHash)) ?? record;
      if (fresh.mpExpiresAt > previousExpiry) {
        return accessTokenIfLive(fresh, nowSeconds());
      }
      const updated = await refreshMpTokens(fresh);
      return accessTokenIfLive(updated, nowSeconds());
    } catch (error) {
      console.warn(
        "MP token refresh failed",
        error instanceof Error ? error.message : "unknown error",
      );
      return accessTokenIfLive(record, nowSeconds());
    } finally {
      await store.releaseLock(lockKey).catch(() => undefined);
    }
  }

  // Someone else holds the lock: wait briefly for their refresh to land.
  const deadline = Date.now() + REFRESH_WAIT_MS;
  let latest: EmbedSessionRecord | null = record;
  while (Date.now() < deadline) {
    await sleep(REFRESH_POLL_MS);
    latest = await store.get(record.sidHash);
    if (!latest) return null;
    if (latest.mpExpiresAt > previousExpiry) break;
  }
  return latest ? accessTokenIfLive(latest, nowSeconds()) : null;
}

// ---------------------------------------------------------------------------
// One-time handoff codes (OAuth callback → SDK exchange)
// ---------------------------------------------------------------------------

/** Mint a single-use, origin-bound handoff code (60s TTL) for a session. */
export async function createHandoffCode(sid: string, origin: string, wid: string): Promise<string> {
  const code = randomToken(32);
  const codeHash = await sha256Hex(code);
  await getSessionStore().setHandoff(codeHash, { sid, origin, wid }, HANDOFF_TTL_SECONDS);
  return code;
}

/** Redeem a handoff code exactly once. Null when unknown, used, expired, or wrong origin. */
export async function redeemHandoffCode(
  code: string,
  origin: string,
): Promise<{ sid: string; wid: string } | null> {
  if (!code || typeof code !== "string") return null;
  const codeHash = await sha256Hex(code);
  const value = await getSessionStore().takeHandoff(codeHash);
  if (!value) return null;
  if (value.origin !== origin) {
    console.warn("handoff code origin mismatch", { expected: value.origin, got: origin });
    return null;
  }
  return { sid: value.sid, wid: value.wid };
}
