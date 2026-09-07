/**
 * Filter-dropdown configuration for the next-group-finder widget.
 * GET /api/embed/group-finder/config
 *   -> { congregations, parentGroups, groupFocuses, lifeStages }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { GroupsService } from "@/services/groupsService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["group-finder", "user-menu", "*"] });

    const service = await GroupsService.getInstance();
    const config = await service.getConfigurations();

    return NextResponse.json(config, {
      status: 200,
      headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=600" },
    });
  } catch (error) {
    console.error("Error loading group finder configuration:", error);
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
