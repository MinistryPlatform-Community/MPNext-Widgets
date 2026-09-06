/**
 * MinistryPlatform OpenID Connect helpers. Pure HTTP/URL building; no store
 * dependency. Never logs token material.
 *
 * Endpoints live under `${MINISTRY_PLATFORM_BASE_URL}/oauth/connect/…` (the
 * base URL already includes `/ministryplatformapi`).
 */

import type { EmbedSessionUser } from "./types";
import { randomToken, sha256Hex, toBase64Url } from "./crypto";

export const MP_OAUTH_SCOPE = "openid offline_access http://www.thinkministry.com/dataplatform/scopes/all";

export interface MpUserinfo {
  sub: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  picture?: string;
}

export interface MpTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

const USERINFO_CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

function getMpBaseUrl(): string {
  const raw = process.env.MINISTRY_PLATFORM_BASE_URL;
  if (!raw) {
    throw new Error(
      "MINISTRY_PLATFORM_BASE_URL is not configured. Set it to your MinistryPlatform API base (e.g. https://my.example.church/ministryplatformapi).",
    );
  }
  return raw.replace(/\/+$/, "");
}

export function getMpOAuthEndpoints(): {
  authorize: string;
  token: string;
  userinfo: string;
  endsession: string;
} {
  const base = `${getMpBaseUrl()}/oauth/connect`;
  return {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    userinfo: `${base}/userinfo`,
    endsession: `${base}/endsession`,
  };
}

/** OAuth client credentials: `OIDC_*` with `MINISTRY_PLATFORM_*` fallback. */
export function getMpOAuthClient(): { clientId: string; clientSecret: string } {
  const clientId = process.env.OIDC_CLIENT_ID || process.env.MINISTRY_PLATFORM_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET || process.env.MINISTRY_PLATFORM_CLIENT_SECRET;
  if (!clientId) {
    throw new Error("OIDC_CLIENT_ID (or MINISTRY_PLATFORM_CLIENT_ID) is not configured.");
  }
  if (!clientSecret) {
    throw new Error("OIDC_CLIENT_SECRET (or MINISTRY_PLATFORM_CLIENT_SECRET) is not configured.");
  }
  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// userinfo (60s cache keyed by sha256(token); never stores the token itself)
// ---------------------------------------------------------------------------

interface UserinfoCacheEntry {
  value: MpUserinfo | null;
  expiresAt: number;
}
const userinfoCache = new Map<string, UserinfoCacheEntry>();

function pruneUserinfoCache(now: number): void {
  if (userinfoCache.size < 1000) return;
  for (const [k, v] of userinfoCache) {
    if (v.expiresAt <= now) userinfoCache.delete(k);
  }
}

/**
 * Validate an MP access token via the userinfo endpoint. Returns null on any
 * non-2xx or malformed response. Results (including null) are cached for 60s
 * so a stale token replayed on every widget request does not hammer MP.
 */
export async function fetchMpUserinfo(accessToken: string): Promise<MpUserinfo | null> {
  if (!accessToken) return null;

  const cacheKey = await sha256Hex(accessToken);
  const now = Date.now();
  const cached = userinfoCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;

  let value: MpUserinfo | null = null;
  try {
    const res = await fetch(getMpOAuthEndpoints().userinfo, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && typeof (body as MpUserinfo).sub === "string") {
        const b = body as Record<string, unknown>;
        value = {
          sub: b.sub as string,
          given_name: typeof b.given_name === "string" ? b.given_name : undefined,
          family_name: typeof b.family_name === "string" ? b.family_name : undefined,
          email: typeof b.email === "string" ? b.email : undefined,
          picture: typeof b.picture === "string" ? b.picture : undefined,
        };
      }
    }
  } catch {
    value = null;
  }

  pruneUserinfoCache(now);
  userinfoCache.set(cacheKey, { value, expiresAt: now + USERINFO_CACHE_TTL_MS });
  return value;
}

/** Test hook: clear the userinfo cache. */
export function __resetUserinfoCacheForTests(): void {
  userinfoCache.clear();
}

export function mapUserinfoToSessionUser(ui: MpUserinfo | null): EmbedSessionUser {
  if (!ui || !ui.sub) {
    throw new Error("Cannot map empty userinfo to a session user");
  }
  return {
    userGuid: ui.sub,
    firstName: ui.given_name ?? "",
    lastName: ui.family_name ?? "",
    email: ui.email ?? "",
    imageGuid: null,
  };
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

async function postTokenEndpoint(params: URLSearchParams, what: string): Promise<MpTokenResponse> {
  const { clientId, clientSecret } = getMpOAuthClient();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);

  const res = await fetch(getMpOAuthEndpoints().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    // Do not include the body: it may echo request parameters.
    throw new Error(`MP ${what} failed (${res.status})`);
  }

  const body: unknown = await res.json();
  if (!body || typeof body !== "object" || typeof (body as MpTokenResponse).access_token !== "string") {
    throw new Error(`MP ${what} returned no access_token`);
  }
  return body as MpTokenResponse;
}

export async function exchangeAuthorizationCode(args: {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<MpTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
  });
  if (args.codeVerifier) params.set("code_verifier", args.codeVerifier);
  return postTokenEndpoint(params, "token exchange");
}

export async function refreshWithRefreshToken(refreshToken: string): Promise<MpTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return postTokenEndpoint(params, "token refresh");
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

export function buildAuthorizeUrl(args: {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge?: string;
}): string {
  const { clientId } = getMpOAuthClient();
  const url = new URL(getMpOAuthEndpoints().authorize);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", MP_OAUTH_SCOPE);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("state", args.state);
  url.searchParams.set("nonce", args.nonce);
  if (args.codeChallenge) {
    url.searchParams.set("code_challenge", args.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export function buildEndSessionUrl(args: {
  idToken?: string | null;
  postLogoutRedirectUri?: string;
}): string {
  const url = new URL(getMpOAuthEndpoints().endsession);
  if (args.idToken) url.searchParams.set("id_token_hint", args.idToken);
  if (args.postLogoutRedirectUri) {
    url.searchParams.set("post_logout_redirect_uri", args.postLogoutRedirectUri);
  }
  return url.toString();
}

/** PKCE S256 pair. Verifier is 43 base64url chars (32 random bytes). */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(digest) };
}
