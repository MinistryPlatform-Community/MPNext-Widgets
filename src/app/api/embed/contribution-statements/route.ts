/**
 * Contribution statement list endpoint for embed widgets
 * GET /api/embed/contribution-statements - user's contribution statements
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { ContributionStatementService } from "@/services/contributionStatementService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // The contribution-statement widget can be embedded as a secondary widget
    // on any page, so it rides on whatever page-level token the host issues.
    // Accept any authenticated widget for the read (still enforces non-public sub).
    const claims = await requireWidgetAuth(req, { widget: "*" });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await ContributionStatementService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const groups = await service.getStatements(user.Contact_ID);

    const headers = getCorsHeaders(origin);

    return NextResponse.json(
      { groups },
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Error loading contribution statements:", error);

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
