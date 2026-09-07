/**
 * Single opportunity detail endpoint for the next-opportunity-details widget.
 * GET /api/embed/opportunity-details/:id
 *
 * Public-allowed: returns the opportunity for anonymous viewers.
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, {
      widget: ["opportunity-details", "user-menu", "*"],
    });

    const { id } = await params;
    const opportunityId = parseInt(id, 10);
    if (isNaN(opportunityId) || opportunityId <= 0) {
      return NextResponse.json(
        { error: "Invalid opportunityId: must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const service = await OpportunityDetailsService.getInstance();
    const opportunity = await service.getOpportunityById(opportunityId);

    return NextResponse.json(
      { opportunity },
      {
        status: 200,
        headers: { ...getCorsHeaders(origin), "Cache-Control": "private, max-age=60" },
      }
    );
  } catch (error) {
    console.error("Error loading opportunity detail:", error);

    const status =
      error instanceof Error && error.message === "Opportunity not found"
        ? 404
        : error instanceof Error && error.message.includes("Token")
          ? 403
          : 500;

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status, headers: buildFallbackCorsHeaders(origin) }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
