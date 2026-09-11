/**
 * `GET /api/embed/mission-trips` — the mission-trip finder (C76).
 *
 * ## The one anonymous surface in this domain
 *
 * A trip finder lives on a church home page, so this route accepts a **public**
 * JWT: `claims.sub === "public"` is fine here, unlike its three signed-in
 * siblings under `mission-trips/`. It reads nothing contact-scoped — only
 * campaigns the church has already published with `Allow_Online_Pledge = 1`.
 *
 * ## A GET, not legacy's form post
 *
 * `MissionTripApiController.GetMissionTrips` is `[HttpPost]` with `[FromForm]`.
 * Ours is a GET with query parameters, so a filtered finder is cacheable and
 * linkable — the same shape as `next-opportunity-finder`.
 *
 * ## `show-full-trips=false` is honoured here, not in SQL
 *
 * The procedure's own `@ShowFullTrips = 0` branch is inverted (it keeps exactly
 * the *full* trips), so the service always asks for everything and filters in
 * TypeScript. See `missionTripService.search`.
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
import {
  MissionTripSearchSchema,
  type MissionTripSearchResponse,
} from "@mpnext/types";

/** `?flag=` → boolean, with `null` for "not supplied". */
function boolParam(raw: string | null): boolean | undefined {
  if (raw === null || raw === "") return undefined;
  return raw === "true" || raw === "1";
}

/** `?id=` → a positive integer, or `null` for absent/blank/non-numeric. */
function intParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

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
      widget: ["mission-trip-finder", "user-menu"],
    });
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
  // Deliberately no `claims.sub === "public"` rejection — see the header.
  void claims;

  const cors = getCorsHeaders(origin);
  const q = req.nextUrl.searchParams;

  const campaignTypeId = intParam(q.get("campaignTypeId"));
  if (campaignTypeId === null || campaignTypeId <= 0) {
    return errorResponse(
      "invalid_request",
      "campaignTypeId is required and must be a positive integer.",
      400,
      cors
    );
  }

  const parsed = MissionTripSearchSchema.safeParse({
    campaignTypeId,
    congregationId: intParam(q.get("congregationId")),
    ministryId: intParam(q.get("ministryId")),
    programId: intParam(q.get("programId")),
    keyword: q.get("keyword"),
    showFullTrips: boolParam(q.get("showFullTrips")),
    maxResults: intParam(q.get("maxResults")) ?? undefined,
  });
  if (!parsed.success) {
    return errorResponse(
      "invalid_request",
      "One or more finder filters are not valid.",
      400,
      cors
    );
  }

  try {
    const service = await MissionTripService.getInstance();
    const trips = await service.search(parsed.data);
    const body: MissionTripSearchResponse = { trips };
    return NextResponse.json(body, { status: 200, headers: cors });
  } catch (error) {
    if (error instanceof MissionTripsUnavailableError) {
      // 503 and nothing else: the widget renders "not set up for this site yet"
      // and does not invite a retry a congregant cannot act on. The missing
      // procedure's name goes to the log rather than into `message`, which is a
      // **string literal at the call site** on purpose — `i18n/error-codes.test.ts`
      // reads these sources textually and an interpolated message is invisible
      // to it.
      console.warn("[mission-trips] procedure missing:", error.procedure);
      return errorResponse(
        "mission_trips_unavailable",
        "A mission-trip stored procedure is not installed on this MP domain.",
        503,
        cors
      );
    }
    console.error("[mission-trips] search failed:", error);
    // 500 for an upstream MP failure, never 502: the machine code carries the
    // meaning and a second overlapping signal is drift.
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
