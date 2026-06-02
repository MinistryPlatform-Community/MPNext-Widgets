/**
 * Custom-form definition (header + fields) for the next-custom-form widget and
 * the embedded form in next-event-details.
 * GET /api/embed/custom-form?formId=<n>  or  ?formGuid=<guid>  -> { header, fields }
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
    await requireWidgetAuth(req, {
      widget: ["custom-form", "event-details", "user-menu", "*"],
    });

    const sp = req.nextUrl.searchParams;
    const formIdParam = sp.get("formId");
    const formGuid = sp.get("formGuid") || undefined;
    const formId = formIdParam ? Number(formIdParam) : undefined;

    if (!formId && !formGuid) {
      return NextResponse.json(
        { error: "Missing formId or formGuid" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const service = await CustomFormService.getInstance();
    const definition = await service.getDefinition({ formId, formGuid });
    if (!definition) {
      return NextResponse.json(
        { error: "Form not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    return NextResponse.json(definition, {
      status: 200,
      headers: { ...getCorsHeaders(origin), "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    console.error("Error loading custom form:", error);
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
