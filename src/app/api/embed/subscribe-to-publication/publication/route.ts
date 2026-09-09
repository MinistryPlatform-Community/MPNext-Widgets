/**
 * `GET /api/embed/subscribe-to-publication/publication` — name the newsletter
 * a visitor is about to join (C70).
 *
 * Public, because the whole point of this widget is that the visitor has no MP
 * login. What the response carries is one publication's title and description —
 * church-authored marketing copy that is already on the page that embeds the
 * widget — and nothing else.
 *
 * ## `Available_Online` is in the filter, not in a branch
 *
 * A publication that does not exist and one that is not published online
 * produce the **same** `publication_not_found`, because the service puts the
 * flag in the MP filter and returns `null` for both. Two codes would let anyone
 * with an allowlisted origin walk the id space and learn which internal
 * publications a church has.
 *
 * Legacy did neither: `SubscriptionsManager.GetPublication` is a bare
 * primary-key fetch (`SubscriptionsManager.cs:67`) with no flag check at all,
 * so it would render a subscribe form for a staff-only mailing list. Legacy's
 * own *signed-in* list proc requires the flag
 * (`api_MPPW_SearchSubscriptions.sql:38`) — the widget was the outlier.
 *
 * ## Not `withAnonymousWrite`, and not by oversight
 *
 * That wrapper is POST-only by design, and this is a read. It keeps the plain
 * `requireWidgetAuth` + `getCorsHeaders` shape, and it rate-limits
 * **fail-open**: a session-store outage must not blank a church's sign-up form.
 * The two POST routes next door do the opposite, because they send email and
 * write records.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
  getClientIp,
} from "@/lib/embed/auth";
import { errorResponse } from "@/lib/embed/anonymous-write";
import { checkRateLimit } from "@/lib/embed/rate-limit";
import { SubscriptionService } from "@/services/subscriptionService";
import type { SubscribePublicationResponse } from "@mpnext/types";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["subscribe-to-publication", "*"] });
  } catch {
    // Never echo the auth failure's detail: it distinguishes "bad token" from
    // "wrong origin" from "wrong widget" for an unauthenticated caller.
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);

  // Fail-open (the helper's default), unlike both POST routes here: this one
  // neither writes nor sends, so a store outage should degrade to "unlimited
  // reads" rather than to "the church's newsletter form does not render".
  const limit = await checkRateLimit(`subpub:pub:${getClientIp(req)}`, 60);
  if (!limit.ok) {
    return errorResponse("rate_limited", "Too many requests.", 429, cors);
  }

  const raw = req.nextUrl.searchParams.get("publicationId");
  const publicationId = Number(raw);
  if (!raw || !Number.isInteger(publicationId) || publicationId <= 0) {
    return errorResponse(
      "invalid_request",
      "publicationId must be a positive integer.",
      400,
      cors
    );
  }

  try {
    const service = await SubscriptionService.getInstance();
    const publication = await service.getOnlinePublication(publicationId);

    if (!publication) {
      return errorResponse(
        "publication_not_found",
        "No Available_Online publication has that id.",
        404,
        cors
      );
    }

    // `Congregation_ID` is on the service's shape and deliberately not on this
    // one: a created household's congregation is seeded from it server-side,
    // and a public endpoint has no business reporting a church's internal
    // structure to answer "what is this newsletter called".
    const body: SubscribePublicationResponse = {
      publication: {
        Publication_ID: publication.Publication_ID,
        Title: publication.Title,
        Description: publication.Description,
      },
    };

    // No `Cache-Control`: the flag can be turned off at any moment, and a
    // shared cache serving a stale "yes, this is online" is the one caching
    // failure that matters here. The read is a single indexed row.
    return NextResponse.json(body, { status: 200, headers: cors });
  } catch (error) {
    console.error("[subscribe-to-publication/publication] read failed:", error);
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
