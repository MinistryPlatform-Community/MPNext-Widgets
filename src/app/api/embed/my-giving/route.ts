/**
 * My Giving history endpoint for embed widgets
 * GET /api/embed/my-giving - user's donation history for a given year
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { MyGivingService } from "@/services/myGivingService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // The my-giving widget can be embedded as a secondary widget on any page,
    // so it rides on whatever page-level token the host issues. Accept any
    // authenticated widget for the read (still enforces non-public sub).
    const claims = await requireWidgetAuth(req, { widget: "*" });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    // ── Year (defaults to current year; constrained to [currentYear - 4, currentYear]) ──
    const currentYear = new Date().getFullYear();
    const yearParam = req.nextUrl.searchParams.get("year");
    const parsedYear = yearParam ? parseInt(yearParam, 10) : NaN;
    const year = Number.isNaN(parsedYear) ? currentYear : parsedYear;

    const minYear = currentYear - 4;
    if (year < minYear || year > currentYear) {
      return NextResponse.json(
        {
          error: `Year must be between ${minYear} and ${currentYear}.`,
        },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // ── Month (optional; only passed if a valid 1-12 integer) ──
    const monthParam = req.nextUrl.searchParams.get("month");
    const parsedMonth = monthParam ? parseInt(monthParam, 10) : NaN;
    const month =
      !Number.isNaN(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
        ? parsedMonth
        : undefined;

    const service = await MyGivingService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const donations = await service.getDonations(user.Contact_ID, year, month);

    const headers = getCorsHeaders(origin);

    return NextResponse.json(
      { donations },
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Error loading my giving history:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
