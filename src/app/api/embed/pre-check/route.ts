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
import {
  PreCheckService,
  PreCheckSelectionError,
  groupByMember,
} from "@/services/preCheckService";
import {
  EventDateSchema,
  PRE_CHECK_WINDOW_DAYS_FUTURE,
  PRE_CHECK_WINDOW_DAYS_PAST,
  PreCheckSaveRequestSchema,
  type PreCheckResponse,
  type PreCheckSaveResponse,
} from "@mpnext/types";
import { z } from "zod";

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

/**
 * `POST /api/embed/pre-check` — apply the household's selection for one day.
 *
 * The body is `{ eventDate, selected }` and **nothing else**. Not a `FormData`
 * of encoded ids, which is what legacy posted and parsed unchecked. The
 * authorisation itself lives in `PreCheckService.savePreCheck`, which
 * re-derives the whole legal row set from the session's household before it
 * looks at a single submitted string; this handler's job is the request
 * envelope: shape, window, rate, and mapping the one domain error to a code.
 */
export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    claims = await requireWidgetAuth(req, { widget: "pre-check" });
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

  // Per **user**, not per IP: a household shares one IP with itself, so an IP
  // bucket would throttle a family of five faster than a family of one. Fails
  // closed — unlike the GET above — because this one writes MP records.
  const limit = await checkRateLimit(`precheck:save:${claims.sub}`, 20, {
    failClosed: true,
  });
  if (!limit.ok) {
    return errorResponse("rate_limited", "Too many requests.", 429, cors);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = PreCheckSaveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "validation_failed",
      `Invalid pre-check body: ${JSON.stringify(z.flattenError(parsed.error).fieldErrors)}`,
      400,
      cors
    );
  }

  const { eventDate, selected } = parsed.data;

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

    // The window check, against the **domain's** today rather than the
    // server's. Not a business rule so much as a shape removal: without it,
    // "walk the calendar backwards writing Cancelled over a year of
    // attendance" is something one authenticated caller can do in a loop.
    const today = await service.resolveDefaultEventDate();
    if (!isWithinWindow(eventDate, today)) {
      return errorResponse(
        "pre_check_closed",
        "eventDate is outside the pre-check window.",
        409,
        cors
      );
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

    const result: PreCheckSaveResponse = await service.savePreCheck({
      householdId: user.householdId,
      // Audit only. MP records the write against the parent rather than the
      // API service account; it is never consulted for authorisation.
      userId: user.userId,
      eventDate,
      selected,
    });

    return NextResponse.json(result, { status: 200, headers: cors });
  } catch (error) {
    if (error instanceof PreCheckSelectionError) {
      // Nothing was written — `savePreCheck` fails the whole request before it
      // writes anything. The count is logged; the offending keys are not
      // echoed, so a prober learns nothing about which guesses were shaped
      // right.
      console.warn(
        "[pre-check] rejected selection:",
        error.unknownCount,
        "unrecognised row(s)"
      );
      return errorResponse(
        "invalid_pre_check_selection",
        "One or more selected rows are not part of this household's events for that date.",
        403,
        cors
      );
    }

    console.error("[pre-check] save failed:", error);
    // 500 for an upstream MP failure, never 502.
    return errorResponse("save_failed", "Could not save the pre-check.", 500, cors);
  }
}

/**
 * Is `eventDate` inside the accepted window around the domain's today?
 *
 * Plain calendar-day arithmetic on `YYYY-MM-DD` via `Date.UTC`, which is safe
 * precisely because **both** sides are wall-clock dates with no time and no
 * zone: parsing them as UTC midnight applies the same fiction to both, so the
 * difference is exact and no DST transition can move it. This is *not* the
 * anti-pattern `ministryplatform.datetimehandling.md` warns about — nothing
 * here crosses the MP boundary or is rendered; it is a difference of two
 * day-numbers.
 */
function isWithinWindow(eventDate: string, today: string): boolean {
  const day = (value: string): number => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y as number, (m as number) - 1, d as number);
  };

  const deltaDays = Math.round((day(eventDate) - day(today)) / 86_400_000);
  return deltaDays >= -PRE_CHECK_WINDOW_DAYS_PAST && deltaDays <= PRE_CHECK_WINDOW_DAYS_FUTURE;
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
