/**
 * Email-a-member endpoint for the next-online-directory widget.
 * POST /api/embed/online-directory/email  body: { toContactId, subject, body }
 *
 * Authentication + directory access required. The recipient is referenced by
 * contact id only — their email address is resolved server-side by MP, never
 * exposed to the browser. Sends an MP communication from the signed-in user.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { OnlineDirectoryService } from "@/services/onlineDirectoryService";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: "*" });
    if (claims.sub === "public") {
      return NextResponse.json(
        { success: false, error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    let payload: { toContactId?: number; subject?: string; body?: string };
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const toContactId = Number(payload.toContactId);
    const subject = (payload.subject ?? "").trim();
    const body = (payload.body ?? "").trim();
    if (!toContactId || Number.isNaN(toContactId) || !subject || !body) {
      return NextResponse.json(
        { success: false, error: "toContactId, subject, and body are required." },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const service = await OnlineDirectoryService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user || !(await service.canAccessDirectory(user.Contact_ID))) {
      return NextResponse.json(
        { success: false, error: "You do not have access to the directory." },
        { status: 403, headers: getCorsHeaders(origin) }
      );
    }

    await service.sendEmail({
      fromUserId: user.User_ID,
      fromContactId: user.Contact_ID,
      toContactId,
      subject,
      body,
    });

    return NextResponse.json(
      { success: true },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error emailing directory member:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { success: false, message, error: message },
      {
        status: message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
