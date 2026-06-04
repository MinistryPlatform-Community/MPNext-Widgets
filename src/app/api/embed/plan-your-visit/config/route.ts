/**
 * Configuration for the next-plan-your-visit widget.
 * GET /api/embed/plan-your-visit/config
 *   -> { congregations, genders, countries, phoneMask }
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

    const service = await PlanYourVisitService.getInstance();
    const config = await service.getConfigurations();

    return NextResponse.json(config, {
      status: 200,
      headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=600" },
    });
  } catch (error) {
    console.error("Error loading plan-your-visit configuration:", error);
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
