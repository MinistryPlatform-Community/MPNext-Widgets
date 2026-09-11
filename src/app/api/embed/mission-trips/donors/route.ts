/**
 * `GET /api/embed/mission-trips/donors?campaignId=&campaignTypeId=` — who has
 * given toward a participant's trip, for writing thank-you notes (C76).
 *
 * ## Why the campaign id is required, and why a stranger gets 403
 *
 * Legacy's endpoint took only the campaign *type* and returned the donors of
 * every trip the caller had ever pledged to, concatenated, for the browser to
 * group (D4). This one takes an explicit `campaignId`.
 *
 * A campaign the caller holds no **visible** pledge on answers `403
 * not_a_participant`, never an empty list. The distinction matters: an empty
 * donor list is an ordinary state for a participant nobody has given to yet, so
 * if it doubled as the answer for "not your trip" the campaign id space would be
 * enumerable through a widget endpoint.
 *
 * ## This endpoint returns postal addresses
 *
 * Decision 4 is legacy parity — name, amount, note, and contact details gated on
 * the church's own unlisted flags — but that makes it deserve a directory's care:
 * no enumeration, and the payload is never logged.
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
import {
  MissionTripService,
  MissionTripsUnavailableError,
  NotAParticipantError,
} from "@/services/missionTripService";
import type { MissionDonorsResponse } from "@mpnext/types";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let claims;
  // `["…", "user-menu"]` for the same reason `my-pledges` does it: the SDK's
  // token provider derives `wid` from `detectFirstWidgetId()`, which returns the
  // first entry of its own map that matches *anything* on the page — and
  // `NEXT-USER-MENU` is that map's first entry. Any page carrying a sign-in menu
  // therefore mints its token as `user-menu`. `wid` is a page hint, not an
  // authorisation scope; the scope is `claims.sub` plus the origin allowlist.
  try {
    claims = await requireWidgetAuth(req, {
      widget: ["my-mission-trips", "user-menu"],
    });
  } catch {
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);

  if (claims.sub === "public") {
    return errorResponse(
      "auth_required",
      "Authentication required. Please sign in.",
      401,
      cors
    );
  }

  const q = req.nextUrl.searchParams;
  const campaignId = Number(q.get("campaignId"));
  const campaignTypeId = Number(q.get("campaignTypeId"));
  if (
    !Number.isFinite(campaignId) ||
    campaignId <= 0 ||
    !Number.isFinite(campaignTypeId) ||
    campaignTypeId <= 0
  ) {
    return errorResponse(
      "invalid_request",
      "campaignId and campaignTypeId are required and must be positive integers.",
      400,
      cors
    );
  }

  try {
    const service = await MissionTripService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return errorResponse(
        "user_not_found",
        "No MP user is linked to this session.",
        404,
        cors
      );
    }

    const donors = await service.donors(
      user.Contact_ID,
      Math.trunc(campaignId),
      Math.trunc(campaignTypeId)
    );
    const body: MissionDonorsResponse = { donors };
    return NextResponse.json(body, { status: 200, headers: cors });
  } catch (error) {
    if (error instanceof NotAParticipantError) {
      // Not logged as an error: a page left open after a pledge was
      // discontinued reaches this legitimately.
      return errorResponse(
        "not_a_participant",
        "No visible pledge on that campaign.",
        403,
        cors
      );
    }
    if (error instanceof MissionTripsUnavailableError) {
      console.warn("[mission-trips/donors] procedure missing:", error.procedure);
      return errorResponse(
        "mission_trips_unavailable",
        "A mission-trip stored procedure is not installed on this MP domain.",
        503,
        cors
      );
    }
    // The error only — never the donor rows, which carry names and addresses.
    console.error("[mission-trips/donors] read failed:", error);
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
