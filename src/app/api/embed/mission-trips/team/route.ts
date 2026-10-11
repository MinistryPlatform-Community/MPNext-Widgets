/**
 * `GET /api/embed/mission-trips/team?campaignId=&campaignTypeId=` — the trip
 * roster and each teammate's fundraising position (C76).
 *
 * ## This route is the security fix
 *
 * `api_MPPW_GetMyMissionTripTeamProgress` has no `Trip_Leader` predicate at all:
 * it returns every pledge on every campaign the caller's household touches,
 * each with the teammate's email, mobile phone and totals. Legacy gated it
 * twice and both gates ran in the browser — the `showteamprogress` attribute is
 * markup a church author controls, and the `tripLeader === true` filter runs
 * over an array the page already holds in full. On a youth mission trip that is
 * a roster of minors' mobile numbers, readable by any participant.
 *
 * The gate is now here, and it is *not* "the caller's own pledge leads the
 * trip": it is "**any** pledge the caller may see on that campaign leads it".
 * A head of household managing a teenager's trip is exactly the person the
 * household rule exists to serve, and the child holds the pledge. See
 * `missionTripService.team`.
 *
 * `403 not_trip_leader` rather than an empty array, because an empty roster is
 * indistinguishable from a solo trip and the widget needs to know whether to
 * render the panel or say nothing at all. The widget hides the panel on that
 * code rather than showing an error — a participant who is not the leader is in
 * a perfectly ordinary state.
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
  NotTripLeaderError,
} from "@/services/missionTripService";
import type { MissionTeamResponse } from "@mpnext/types";

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

    const team = await service.team(
      user.Contact_ID,
      Math.trunc(campaignId),
      Math.trunc(campaignTypeId)
    );
    const body: MissionTeamResponse = { team };
    return NextResponse.json(body, { status: 200, headers: cors });
  } catch (error) {
    if (error instanceof NotTripLeaderError) {
      // Not logged as an error: every non-leader participant on every trip
      // reaches this, and it is the expected answer for them.
      return errorResponse(
        "not_trip_leader",
        "No visible trip-leader pledge on that campaign.",
        403,
        cors
      );
    }
    if (error instanceof MissionTripsUnavailableError) {
      console.warn("[mission-trips/team] procedure missing:", error.procedure);
      return errorResponse(
        "mission_trips_unavailable",
        "A mission-trip stored procedure is not installed on this MP domain.",
        503,
        cors
      );
    }
    // The error only — never the roster, which carries teammates' contact details.
    console.error("[mission-trips/team] read failed:", error);
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
