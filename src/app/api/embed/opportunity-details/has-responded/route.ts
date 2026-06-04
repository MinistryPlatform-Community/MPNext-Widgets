/**
 * Response-check endpoint for the next-opportunity-details widget.
 * GET /api/embed/opportunity-details/has-responded?opportunityId=&contactId=
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { OpportunityDetailsService } from "@/services/opportunityDetailsService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, {
      widget: ["opportunity-details", "user-menu", "*"],
    });

    const sp = req.nextUrl.searchParams;
    const opportunityId = parseInt(sp.get("opportunityId") ?? "", 10);
    const contactId = parseInt(sp.get("contactId") ?? "", 10);

    if (isNaN(opportunityId) || opportunityId <= 0 || isNaN(contactId) || contactId <= 0) {
      return NextResponse.json(
        { error: "opportunityId and contactId must be positive integers" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await OpportunityDetailsService.getInstance();
    const hasResponded = await service.hasResponded(opportunityId, contactId);

    return NextResponse.json(
      { hasResponded },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error checking opportunity response:", error);
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
