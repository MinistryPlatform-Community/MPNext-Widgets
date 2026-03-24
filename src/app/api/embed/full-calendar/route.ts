/**
 * Full calendar events endpoint for embed widgets
 * GET /api/embed/full-calendar?start=<ISO>&end=<ISO>[&congregationId=<number>]
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { FullCalendarService } from "@/services/fullCalendarService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: "full-calendar" });

    const url = new URL(req.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const congregationIdParam = url.searchParams.get("congregationId");

    // Validate required params
    if (!start || !end) {
      return NextResponse.json(
        { error: "Missing required query parameters: start and end" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    // Validate that start and end are valid ISO date strings
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (isNaN(startDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid 'start' date" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    if (isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid 'end' date" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    if (startDate >= endDate) {
      return NextResponse.json(
        { error: "'start' must be before 'end'" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    // Parse optional congregationId
    let congregationId: number | undefined;
    if (congregationIdParam) {
      const parsed = parseInt(congregationIdParam, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return NextResponse.json(
          { error: "Invalid 'congregationId': must be a positive integer" },
          { status: 400, headers: buildFallbackCorsHeaders(origin) }
        );
      }
      congregationId = parsed;
    }

    // Pass userGuid (claims.sub) for admin check — "public" means unauthenticated
    const userGuid = claims.sub !== "public" ? claims.sub : undefined;

    const service = await FullCalendarService.getInstance();
    const result = await service.getEvents(start, end, congregationId, userGuid);

    const headers: HeadersInit = {
      ...getCorsHeaders(origin),
      "Cache-Control": "public, max-age=300",
    };

    return NextResponse.json(result, { status: 200, headers });
  } catch (error) {
    console.error("Error loading calendar events:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      {
        status:
          error instanceof Error && error.message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
