/**
 * End an embed session
 * POST /api/embed/auth/logout   body { sid, postLogoutRedirectUri? }
 * GET  /api/embed/auth/logout?t=<ticket>
 *
 * POST deletes the server-side session (idempotent) and hands back the URL the
 * SDK should navigate to so MP's SSO cookie is cleared as well.
 *
 * That URL is **not** MP's end-session endpoint whenever the caller asked to
 * come back to its own page. MP only honours a registered
 * `post_logout_redirect_uri`, and an embed SDK's host pages can never all be
 * registered, so the host page is returned to by this route's own bounce
 * instead: POST seals it into a ticket, GET turns the ticket into a cookie and
 * forwards to MP, and `src/proxy.ts` spends the cookie when MP lands back on
 * the registered URI. See `src/lib/embed/logout-return.ts` for the whole path.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { deleteEmbedSession } from "@/lib/embed/embed-session";
import { buildEndSessionUrl } from "@/lib/embed/mp-oauth";
import {
  LOGOUT_RETURN_COOKIE,
  LOGOUT_RETURN_TTL_SECONDS,
  openLogoutReturn,
  sealLogoutReturn,
} from "@/lib/embed/logout-return";
import {
  getPublicUrl,
  isEmbedOriginAllowed,
  isSecureCookieContext,
  validateReturnTo,
} from "../_lib/auth-route-helpers";

interface LogoutRequest {
  sid?: string;
  postLogoutRedirectUri?: string;
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  const fallbackCors = buildFallbackCorsHeaders(origin);

  try {
    let body: LogoutRequest;
    try {
      body = ((await req.json()) ?? {}) as LogoutRequest;
    } catch {
      return NextResponse.json(
        { error: "invalid_body", message: "Invalid or empty JSON body" },
        { status: 400, headers: fallbackCors },
      );
    }

    if (!isEmbedOriginAllowed(origin)) {
      return NextResponse.json(
        { error: `Origin ${origin} not allowed` },
        { status: 403, headers: fallbackCors },
      );
    }

    const corsHeaders = getCorsHeaders(origin);

    const sid = typeof body.sid === "string" ? body.sid : "";
    const { idToken } = sid ? await deleteEmbedSession(sid) : { idToken: null };

    // Only bounce back to the embedding site itself.
    const returnTo = validateReturnTo(
      typeof body.postLogoutRedirectUri === "string" ? body.postLogoutRedirectUri : null,
      origin,
    );

    // With a return target the SDK goes to this route's GET, which sets the
    // cookie and forwards to MP. Without one it goes straight to MP.
    const ticket = returnTo ? await sealLogoutReturn({ returnTo, idToken }) : null;
    const endSessionUrl = ticket
      ? `${getPublicUrl(req)}/api/embed/auth/logout?t=${encodeURIComponent(ticket)}`
      : buildEndSessionUrl({ idToken });

    return NextResponse.json({ endSessionUrl }, { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("Error ending embed session:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "internal_error", message: "Internal server error" },
      { status: 500, headers: fallbackCors },
    );
  }
}

/**
 * Second leg of the bounce: a top-level navigation carrying the sealed ticket.
 * Remembers where the visitor came from in a `SameSite=Lax` cookie, then sends
 * them to MP to actually end the SSO session.
 *
 * An absent or unusable ticket is not an error worth showing a church member —
 * ending the MP session still matters more than the return trip, so this falls
 * through to MP with no hint rather than rendering a failure page.
 */
export async function GET(req: NextRequest) {
  const publicUrl = getPublicUrl(req);
  const ticket = await openLogoutReturn(req.nextUrl.searchParams.get("t"));

  const res = NextResponse.redirect(buildEndSessionUrl({ idToken: ticket?.idToken }), 302);
  res.headers.set("Cache-Control", "no-store");

  if (ticket) {
    res.cookies.set(LOGOUT_RETURN_COOKIE, ticket.returnTo, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureCookieContext(publicUrl),
      path: "/",
      maxAge: LOGOUT_RETURN_TTL_SECONDS,
    });
  }

  return res;
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
