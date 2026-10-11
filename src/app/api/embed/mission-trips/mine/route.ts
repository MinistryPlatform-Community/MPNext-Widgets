/**
 * `GET /api/embed/mission-trips/mine?campaignTypeId=` — the caller's (and, for a
 * head of household, their household's) mission trips (C76).
 *
 * Signed in only: a public JWT is rejected outright, the way `pre-check/` and
 * `household/` do it. Identity comes from `claims.sub` — an MP `User_GUID` —
 * and nothing else; no `contactId` is read from the request, here or in the two
 * sibling routes, so a request input can scope a query but can never widen the
 * set of people the caller may see.
 *
 * The household scope itself is legacy parity (head of household sees the
 * household, everyone else sees only themselves) and lives in
 * `missionTripService.visibleContactIds`.
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
} from "@/services/missionTripService";
import type { MyMissionTripsResponse } from "@mpnext/types";

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

  const raw = req.nextUrl.searchParams.get("campaignTypeId");
  const campaignTypeId = raw === null || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(campaignTypeId) || campaignTypeId <= 0) {
    return errorResponse(
      "invalid_request",
      "campaignTypeId is required and must be a positive integer.",
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

    const trips = await service.mine(user.Contact_ID, Math.trunc(campaignTypeId));
    const body: MyMissionTripsResponse = { trips };
    return NextResponse.json(body, { status: 200, headers: cors });
  } catch (error) {
    if (error instanceof MissionTripsUnavailableError) {
      console.warn("[mission-trips/mine] procedure missing:", error.procedure);
      return errorResponse(
        "mission_trips_unavailable",
        "A mission-trip stored procedure is not installed on this MP domain.",
        503,
        cors
      );
    }
    console.error("[mission-trips/mine] read failed:", error);
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
