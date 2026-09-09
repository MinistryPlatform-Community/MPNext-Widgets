/**
 * `GET /api/embed/pre-check` — a household's check-in events for one day (C78).
 *
 * ## Auth-required, and deliberately **not** `withAnonymousWrite`
 *
 * Its three Tier 1 siblings (`unsubscribe`, `prayer-feedback`,
 * `subscribe-to-publication`) are anonymous-write and ride that wrapper. This
 * one must not: `withAnonymousWrite` accepts `claims.sub === "public"`, which is
 * exactly wrong for an endpoint that reads and writes a household's attendance.
 * So it uses `requireWidgetAuth` directly and rejects the public subject
 * outright, the way `src/app/api/embed/household/` and `event-details/` do.
 *
 * `errorResponse` is still borrowed from that module — it is a plain
 * `{ error, message }` JSON builder with no auth semantics of its own, and C69
 * and C70 already call it from GET routes. The English `message` is written as
 * a **string literal at the call site** on purpose: `i18n/error-codes.test.ts`
 * reads these sources textually, and a message held in a variable is invisible
 * to it.
 *
 * ## Identity comes only from the JWT
 *
 * No `householdId`, `contactId` or `participantId` is read from the request,
 * here or in the POST next door. `claims.sub` is an MP `User_GUID`;
 * `HouseholdService.resolveUser` turns it into a household. That is the entire
 * input to the authorisation decision.
 *
 * ## An empty day is a 200, not a 404
 *
 * A Tuesday has no Sunday classes, and MP's own `Search_Results = 3` visibility
 * rule legitimately hides every member of a household whose groups do not
 * intersect the event's. Both are ordinary, so both answer 200 with an empty
 * `members` and let the widget say "there are no check-in events on {date}".
 * Reporting either as an error would train churches to ignore the error state.
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
import { checkRateLimit } from "@/lib/embed/rate-limit";
import { HouseholdService } from "@/services/householdService";
import { PreCheckService, groupByMember } from "@/services/preCheckService";
import { EventDateSchema, type PreCheckResponse } from "@mpnext/types";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    claims = await requireWidgetAuth(req, { widget: "pre-check" });
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

  if (claims.sub === "public") {
    return errorResponse(
      "auth_required",
      "Authentication required. Please sign in.",
      401,
      cors
    );
  }

  // Per user rather than per IP: a household shares one IP with itself, and a
  // parent reloading the page on a phone and a laptop is not abuse. Fail-open,
  // because this route neither writes nor sends — a session-store outage should
  // degrade to unlimited reads, not to a blank widget on Sunday morning.
  const limit = await checkRateLimit(`precheck:read:${claims.sub}`, 120);
  if (!limit.ok) {
    return errorResponse("rate_limited", "Too many requests.", 429, cors);
  }

  try {
    const service = await PreCheckService.getInstance();

    if (!(await service.isAvailable())) {
      return errorResponse(
        "precheck_unavailable",
        "api_MPPW_GetPreCheckEvents is not installed on this MP domain.",
        503,
        cors
      );
    }

    const raw = req.nextUrl.searchParams.get("eventDate");
    let eventDate: string;
    if (raw === null || raw === "") {
      // The default is resolved **on the server, in the domain's zone**. The
      // browser's idea of today is what legacy used and it is wrong for every
      // visitor whose zone differs from the church's.
      eventDate = await service.resolveDefaultEventDate();
    } else {
      const parsed = EventDateSchema.safeParse(raw);
      if (!parsed.success) {
        return errorResponse(
          "invalid_request",
          "eventDate must be YYYY-MM-DD.",
          400,
          cors
        );
      }
      eventDate = parsed.data;
    }

    const household = await HouseholdService.getInstance();
    const user = await household.resolveUser(claims.sub);

    if (!user || user.householdId == null) {
      return errorResponse(
        "household_not_found",
        "No household is linked to this account.",
        404,
        cors
      );
    }

    const [rows, timeZone] = await Promise.all([
      service.getPreCheckRows(user.householdId, eventDate),
      service.getTimeZone(),
    ]);

    const body: PreCheckResponse = {
      eventDate,
      timeZone,
      householdId: user.householdId,
      members: groupByMember(rows),
    };

    // No `Cache-Control`: the answer is per-household and changes the moment
    // anyone in the family — or a check-in station — touches a row.
    return NextResponse.json(body, { status: 200, headers: cors });
  } catch (error) {
    console.error("[pre-check] read failed:", error);
    // 500 for an upstream MP failure, never 502: the machine code carries the
    // meaning and a second overlapping signal is drift.
    return errorResponse("internal_error", "Internal server error", 500, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
