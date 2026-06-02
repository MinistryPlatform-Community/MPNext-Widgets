/**
 * Public event search endpoint for the next-event-finder widget.
 * GET /api/embed/event-finder?keyword=&congregationId=&ministryId=&monthId=&signupType=&eventTypeId=&programId=&isFeatured=&reduceSeriesTo=
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { EventFinderService, type EventSearchFilters } from "@/services/eventFinderService";

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
    await requireWidgetAuth(req, { widget: ["event-finder", "user-menu"] });

    const sp = req.nextUrl.searchParams;
    const month = parseIntParam(sp.get("monthId"));

    const filters: EventSearchFilters = {
      congregationId: parseIntParam(sp.get("congregationId")),
      ministryId: parseIntParam(sp.get("ministryId")),
      programId: parseIntParam(sp.get("programId")),
      eventTypeId: parseIntParam(sp.get("eventTypeId")),
      monthId: month && month >= 1 && month <= 12 ? month : null,
      signupType: parseIntParam(sp.get("signupType")) ?? 0,
      isFeatured: sp.get("isFeatured") === "true",
      keyword: sp.get("keyword") ?? "",
      reduceSeriesTo: parseIntParam(sp.get("reduceSeriesTo")) ?? 0,
    };

    const service = await EventFinderService.getInstance();
    const events = await service.searchEvents(filters);

    return NextResponse.json(
      { events },
      {
        status: 200,
        headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=120" },
      }
    );
  } catch (error) {
    console.error("Error searching events:", error);
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
