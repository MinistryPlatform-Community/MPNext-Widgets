/**
 * `GET /api/embed/prayer-feedback/types` — the Feedback Type dropdown (C69).
 *
 * Public: the list is `Feedback_Types`, a lookup table of church-authored option
 * names with nothing personal in it, so any widget token — including a `public`
 * subject — may read it.
 *
 * ## `ids` is part of the cache key, and must stay that way
 *
 * The response is `Cache-Control: public, max-age=600`, which is safe **only**
 * because the allowlist travels in the query string, where every shared cache
 * keys on it. Do not "simplify" this route to ignore `ids` and filter
 * client-side: one church's allowlist would then be served to another from an
 * edge cache, and the dropdown would offer options that church deliberately
 * removed.
 *
 * A malformed `ids` is `invalid_request` rather than a silent fall-back to the
 * default list — a typo'd allowlist must not quietly widen the dropdown to
 * include options the church excluded.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { errorResponse } from "@/lib/embed/anonymous-write";
import { PrayerFeedbackService } from "@/services/prayerFeedbackService";
import { parseFeedbackTypeIds, type PrayerFeedbackTypesResponse } from "@mpnext/types";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["prayer-feedback", "*"] });
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
  const ids = parseFeedbackTypeIds(req.nextUrl.searchParams.get("ids"));
  if (ids === null) {
    return errorResponse(
      "invalid_request",
      "The ids parameter must be a comma-separated list of positive integers.",
      400,
      cors
    );
  }

  try {
    const service = await PrayerFeedbackService.getInstance();
    const body: PrayerFeedbackTypesResponse = {
      types: await service.getFeedbackTypes(ids),
    };

    return NextResponse.json(body, {
      status: 200,
      headers: { ...cors, "Cache-Control": "public, max-age=600" },
    });
  } catch (error) {
    console.error("[prayer-feedback/types] Feedback_Types read failed:", error);
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
