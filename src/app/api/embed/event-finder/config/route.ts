/**
 * Filter-dropdown configuration for the next-event-finder widget.
 * GET /api/embed/event-finder/config -> { congregations, ministries }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { EventFinderService } from "@/services/eventFinderService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: "event-finder" });

    const service = await EventFinderService.getInstance();
    const config = await service.getConfigurations();

    return NextResponse.json(config, {
      status: 200,
      headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=600" },
    });
  } catch (error) {
    console.error("Error loading event finder configuration:", error);
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
