/**
 * Public opportunity search endpoint for the next-opportunity-finder widget.
 * GET /api/embed/opportunity-finder?keyword=&congregationId=&ministryId=&genderId=&minimumAge=&frequency=&programId=&eventId=&attributeIds=
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import {
  OpportunityFinderService,
  type OpportunitySearchFilters,
} from "@/services/opportunityFinderService";

function parseIntParam(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // Accept the page's user-menu token too: the sign-in widget lives in the
    // shared header on every page, so the page session is scoped to user-menu.
    await requireWidgetAuth(req, { widget: ["opportunity-finder", "user-menu"] });

    const sp = req.nextUrl.searchParams;
    const frequency = parseIntParam(sp.get("frequency"));

    const filters: OpportunitySearchFilters = {
      congregationId: parseIntParam(sp.get("congregationId")),
      ministryId: parseIntParam(sp.get("ministryId")),
      programId: parseIntParam(sp.get("programId")),
      eventId: parseIntParam(sp.get("eventId")),
      genderId: parseIntParam(sp.get("genderId")),
      minimumAge: parseIntParam(sp.get("minimumAge")),
      frequency: frequency === 1 || frequency === 2 ? frequency : null,
      keyword: sp.get("keyword") ?? "",
      attributeIds: sp.get("attributeIds") ?? "",
    };

    const service = await OpportunityFinderService.getInstance();
    const opportunities = await service.searchOpportunities(filters);

    return NextResponse.json(
      { opportunities },
      {
        status: 200,
        headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=120" },
      }
    );
  } catch (error) {
    console.error("Error searching opportunities:", error);
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
