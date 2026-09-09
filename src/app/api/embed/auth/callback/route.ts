/**
 * MP OpenID Connect redirect target for embed logins
 * GET /api/embed/auth/callback?code=&state=
 *
 * Top-level navigation. Verifies the state cookie, exchanges the code, creates
 * a server-side embed session and hands a single-use 60s code back to the
 * embedding page via the URL fragment (`#nextwidgets_auth=<code>`), which the SDK
 * redeems at POST /api/embed/auth/exchange. Errors go back to the page as
 * `#nextwidgets_auth_error=<code>` when the return URL is known.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyStateToken } from "@/lib/embed/jwt";
import { timingSafeEqualStr } from "@/lib/embed/crypto";
import {
  exchangeAuthorizationCode,
  fetchMpUserinfo,
  mapUserinfoToSessionUser,
} from "@/lib/embed/mp-oauth";
import { createEmbedSession, createHandoffCode } from "@/lib/embed/embed-session";
import {
  DEFAULT_WID,
  STATE_COOKIE_NAME,
  appendFragmentParam,
  clearStateCookie,
  getCallbackUrl,
  getPublicUrl,
  isEmbedOriginAllowed,
  lookupImageGuid,
  validateReturnTo,
  type OAuthStatePayload,
} from "../_lib/auth-route-helpers";

type CallbackErrorCode = "state_mismatch" | "exchange_failed" | "userinfo_failed" | "server_error";

class CallbackError extends Error {
  constructor(public readonly code: CallbackErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = "CallbackError";
  }
}

function textError(message: string, publicUrl: string, status = 400): NextResponse {
  const res = new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
  clearStateCookie(res, publicUrl);
  return res;
}

function redirectWithFragment(
  returnTo: string,
  key: "nextwidgets_auth" | "nextwidgets_auth_error",
  value: string,
  publicUrl: string,
): NextResponse {
  const res = NextResponse.redirect(appendFragmentParam(returnTo, key, value), 302);
  res.headers.set("Cache-Control", "no-store");
  clearStateCookie(res, publicUrl);
  return res;
}

function isStatePayload(value: unknown): value is OAuthStatePayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.state === "string" &&
    typeof v.origin === "string" &&
    typeof v.return_to === "string"
  );
}

export async function GET(req: NextRequest) {
  const publicUrl = getPublicUrl(req);
  const params = req.nextUrl.searchParams;

  // 1. Recover and verify the signed state from the cookie.
  const cookie = req.cookies.get(STATE_COOKIE_NAME)?.value;
  if (!cookie) {
    return textError("Sign-in state is missing or expired. Please try signing in again.", publicUrl);
  }

  let stateData: OAuthStatePayload;
  try {
    const payload = await verifyStateToken<unknown>(cookie);
    if (!isStatePayload(payload)) throw new Error("malformed state payload");
    stateData = payload;
  } catch {
    return textError("Sign-in state is invalid or expired. Please try signing in again.", publicUrl);
  }

  // The payload is ours (signed), but re-check the pair so a stale cookie from a
  // since-removed origin cannot bounce the browser to it.
  const origin = stateData.origin;
  const returnTo =
    isEmbedOriginAllowed(origin) ? validateReturnTo(stateData.return_to, origin) : null;
  if (!returnTo) {
    return textError("Sign-in state references a disallowed return URL.", publicUrl);
  }

  const wid = stateData.wid || DEFAULT_WID;

  try {
    // 2. CSRF: the state echoed by MP must match the one in our cookie.
    const echoedState = params.get("state") ?? "";
    if (!echoedState || !timingSafeEqualStr(echoedState, stateData.state)) {
      throw new CallbackError("state_mismatch");
    }

    // 3. Authorization code (MP may instead report an error).
    const code = params.get("code");
    if (!code) {
      const providerError = params.get("error") ?? "missing code";
      throw new CallbackError("exchange_failed", `authorize returned: ${providerError}`);
    }

    // 4. Exchange the code for tokens.
    let tokens: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
    try {
      tokens = await exchangeAuthorizationCode({
        code,
        redirectUri: getCallbackUrl(publicUrl),
        codeVerifier: stateData.codeVerifier,
      });
    } catch (error) {
      throw new CallbackError(
        "exchange_failed",
        error instanceof Error ? error.message : "token exchange failed",
      );
    }

    // 5. Identity.
    const userinfo = await fetchMpUserinfo(tokens.access_token);
    if (!userinfo) throw new CallbackError("userinfo_failed");
    const user = mapUserinfoToSessionUser(userinfo);
    user.imageGuid = await lookupImageGuid(user.userGuid);

    // 6. Server-side session + one-time handoff code for the SDK.
    const { sid } = await createEmbedSession({
      origin,
      user,
      mpAccessToken: tokens.access_token,
      mpRefreshToken: tokens.refresh_token ?? null,
      mpIdToken: tokens.id_token ?? null,
      mpExpiresIn: tokens.expires_in,
    });
    const handoff = await createHandoffCode(sid, origin, wid);

    return redirectWithFragment(returnTo, "nextwidgets_auth", handoff, publicUrl);
  } catch (error) {
    const code: CallbackErrorCode = error instanceof CallbackError ? error.code : "server_error";
    // Log the category only; details may reference request parameters.
    console.warn(
      `Embed login callback failed (${code})`,
      error instanceof Error && code !== "server_error" ? error.message : "",
    );
    if (code === "server_error") {
      console.error("Embed login callback error:", error instanceof Error ? error.message : error);
    }
    return redirectWithFragment(returnTo, "nextwidgets_auth_error", code, publicUrl);
  }
}
