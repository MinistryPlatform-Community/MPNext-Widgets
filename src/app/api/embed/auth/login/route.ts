/**
 * Start the MP OpenID Connect login for an embedding site
 * GET /api/embed/auth/login?origin=&return_to=&wid=&scope=
 *
 * Top-level navigation (no CORS). Validates the embedding origin and the
 * return URL, stores signed state in an HttpOnly cookie scoped to
 * /api/embed/auth, and redirects to the MP authorize endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { signStateToken } from "@/lib/embed/jwt";
import { randomToken } from "@/lib/embed/crypto";
import { buildAuthorizeUrl, pkcePair } from "@/lib/embed/mp-oauth";
import {
  DEFAULT_WID,
  STATE_TTL_SECONDS,
  getCallbackUrl,
  getPublicUrl,
  isEmbedOriginAllowed,
  setStateCookie,
  validateReturnTo,
  type OAuthStatePayload,
} from "../_lib/auth-route-helpers";

const MAX_PARAM_LENGTH = 128;

function textError(message: string, status = 400): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function sanitizeParam(value: string | null, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.length > MAX_PARAM_LENGTH) return fallback;
  return trimmed;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const rawOrigin = (params.get("origin") ?? "").trim();

  let origin = "";
  try {
    origin = rawOrigin ? new URL(rawOrigin).origin : "";
  } catch {
    origin = "";
  }

  if (!origin || origin === "null" || !isEmbedOriginAllowed(origin)) {
    return textError("Invalid or disallowed origin");
  }

  const returnTo = validateReturnTo(params.get("return_to"), origin);
  if (!returnTo) {
    return textError("return_to must be an absolute URL on the requesting origin");
  }

  const wid = sanitizeParam(params.get("wid"), DEFAULT_WID);
  const scope = sanitizeParam(params.get("scope"), "");

  try {
    const publicUrl = getPublicUrl(req);
    const state = randomToken(16);
    const nonce = randomToken(16);
    const usePkce = (process.env.EMBED_OAUTH_PKCE ?? "").trim().toLowerCase() === "true";
    const pkce = usePkce ? await pkcePair() : null;

    const payload: OAuthStatePayload = {
      state,
      nonce,
      origin,
      return_to: returnTo,
      wid,
    };
    if (pkce) payload.codeVerifier = pkce.verifier;
    if (scope) payload.scope = scope;

    const stateToken = await signStateToken(
      payload as unknown as Record<string, unknown>,
      STATE_TTL_SECONDS,
    );

    const authorizeUrl = new URL(
      buildAuthorizeUrl({
        redirectUri: getCallbackUrl(publicUrl),
        state,
        nonce,
        codeChallenge: pkce?.challenge,
      }),
    );
    // Matches the Better Auth genericOAuth config (authorizationUrlParams).
    authorizeUrl.searchParams.set("realm", "realm");

    const res = NextResponse.redirect(authorizeUrl.toString(), 302);
    res.headers.set("Cache-Control", "no-store");
    setStateCookie(res, stateToken, publicUrl);
    return res;
  } catch (error) {
    console.error(
      "Error starting embed login:",
      error instanceof Error ? error.message : "unknown error",
    );
    return textError("Unable to start sign-in", 500);
  }
}
