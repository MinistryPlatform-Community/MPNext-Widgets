/**
 * Public group search endpoint for the next-group-finder widget.
 * GET /api/embed/group-finder?keyword=&congregationId=&ministryId=&parentGroupId=
 *   &groupFocusId=&lifeStageId=&groupTypeId=&cityPostalCode=&meetsOnline=
 *   &meetingDays=1&meetingDays=2&meetingTimes=morning&showFullGroups=&showFutureGroups=
 *   &countGroupInquiries=
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { GroupsService, type GroupSearchFilters } from "@/services/groupsService";

function parseIntParam(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function parseBool(value: string | null): boolean {
  return value === "true" || value === "1";
}

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // The sign-in widget lives in the shared header, so accept its token too.
    await requireWidgetAuth(req, { widget: ["group-finder", "user-menu", "*"] });

    const sp = req.nextUrl.searchParams;

    const filters: GroupSearchFilters = {
      congregationId: parseIntParam(sp.get("congregationId")),
      ministryId: parseIntParam(sp.get("ministryId")),
      parentGroupId: parseIntParam(sp.get("parentGroupId")),
      groupFocusId: parseIntParam(sp.get("groupFocusId")),
      lifeStageId: parseIntParam(sp.get("lifeStageId")),
      groupTypeId: parseIntParam(sp.get("groupTypeId")),
      cityPostalCode: sp.get("cityPostalCode"),
      keyword: sp.get("keyword"),
      meetingDays: sp
        .getAll("meetingDays")
        .map((v) => parseInt(v, 10))
        .filter((n) => !Number.isNaN(n)),
      meetingTimes: sp.getAll("meetingTimes").filter(Boolean),
      meetsOnline: sp.get("meetsOnline") != null ? parseBool(sp.get("meetsOnline")) : null,
      showFullGroups: parseBool(sp.get("showFullGroups")),
      showFutureGroups: parseBool(sp.get("showFutureGroups")),
      countGroupInquiries: parseBool(sp.get("countGroupInquiries")),
    };

    const service = await GroupsService.getInstance();
    const groups = await service.searchGroups(filters, null);

    return NextResponse.json(
      { groups },
      {
        status: 200,
        headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=120" },
      }
    );
  } catch (error) {
    console.error("Error searching groups:", error);
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
