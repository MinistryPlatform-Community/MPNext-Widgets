/**
 * Age-or-grade group options for a congregation (used to place children).
 * GET /api/embed/plan-your-visit/age-groups?congregationId= -> { ageOrGradeGroups }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { PlanYourVisitService } from "@/services/planYourVisitService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["plan-your-visit", "user-menu", "*"] });

    const congregationId = parseInt(req.nextUrl.searchParams.get("congregationId") || "0", 10);

    const service = await PlanYourVisitService.getInstance();
    const ageOrGradeGroups = await service.getAgeOrGradeGroups(
      Number.isNaN(congregationId) ? 0 : congregationId
    );

    return NextResponse.json(
      { ageOrGradeGroups },
      { status: 200, headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=120" } }
    );
  } catch (error) {
    console.error("Error loading age/grade groups:", error);
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
