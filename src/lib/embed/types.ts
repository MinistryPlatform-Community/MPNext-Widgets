/**
 * Types for embed widget authentication and configuration
 */

/**
 * Server-side authentication mode for a given embedding origin.
 *
 * - `legacy`   — session route accepts an MP access token from the host page
 *                (`mpUserToken`) and mints a v1 JWT that carries it.
 * - `dual`     — accepts `sid` OR `mpUserToken`; a valid `mpUserToken` is
 *                silently upgraded to a server-side session (`sid`).
 * - `hardened` — accepts `sid` only; `mpUserToken` is ignored.
 */
export type EmbedAuthMode = "legacy" | "dual" | "hardened";

export interface WidgetClaims {
  sub: string;             // User GUID or "public" for anonymous
  wid: string;             // Widget ID (user-menu, add-to-calendar, etc.)
  origin: string;          // Allowed embedding origin
  /**
   * Token version. 1 = legacy (carries `mpAccessToken`); 2 = session-backed
   * (carries `sid`). Missing = 1.
   */
  ver?: 1 | 2;
  /** v2 only: opaque session id (raw; the server hashes it for lookup). */
  sid?: string;
  /** v1 only: Ministry Platform OAuth access token. */
  mpAccessToken?: string;
  iat?: number;            // Issued at
  exp?: number;            // Expiry
  jti?: string;            // JWT ID for revocation
  iss?: string;            // Issuer
  aud?: string;            // Audience
}

export interface SessionRequest {
  wid: string;
  /** Opaque server-side session id issued by the auth flow (v2). */
  sid?: string;
  /** MP OAuth access token from mpp-user-login widget; used to derive user GUID (v1). */
  mpUserToken?: string;
}

export interface SessionResponse {
  token: string;
  expiresIn: number;
  /** Present when a server-side session was created or referenced. */
  sid?: string;
  /** Auth mode resolved for the caller's origin. */
  mode: EmbedAuthMode;
}

/** Minimal user identity kept alongside a server-side embed session. */
export interface EmbedSessionUser {
  userGuid: string;
  firstName: string;
  lastName: string;
  email: string;
  imageGuid?: string | null;
}

/**
 * Persisted embed session. MP tokens are stored sealed (AES-256-GCM) and the
 * record is keyed by `sha256(sid)`; the raw `sid` never touches the store.
 * All timestamps are epoch seconds.
 */
export interface EmbedSessionRecord {
  sidHash: string;
  origin: string;
  user: EmbedSessionUser;
  mpAccessTokenEnc: string;
  mpRefreshTokenEnc: string | null;
  mpIdTokenEnc: string | null;
  mpExpiresAt: number;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
}
