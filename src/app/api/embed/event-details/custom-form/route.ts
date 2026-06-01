/**
 * Custom-form field definitions for rendering an event registration form.
 * GET /api/embed/event-details/custom-form?formId=<number> -> { fields }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { CustomFormService } from "@/services/customFormService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["event-details", "user-menu", "*"] });

    const formId = Number(req.nextUrl.searchParams.get("formId"));
    if (!formId) {
      return NextResponse.json(
        { error: "Missing formId" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const service = await CustomFormService.getInstance();
    const fields = await service.getFormFields(formId);

    return NextResponse.json(
      { fields },
      { status: 200, headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=300" } }
    );
  } catch (error) {
    console.error("Error loading custom form fields:", error);
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
