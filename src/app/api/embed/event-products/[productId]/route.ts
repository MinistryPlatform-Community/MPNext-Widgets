/**
 * Product (option groups / prices) endpoint for the next-event-details widget.
 * GET /api/embed/event-products/:productId?eventId=&eventParticipantId=&formId=&excludeInvoiceId=
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { ProductsService } from "@/services/productsService";

function optionalIntParam(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, {
      widget: ["event-details", "user-menu", "*"],
    });

    const { productId: productIdParam } = await params;
    const productId = parseInt(productIdParam, 10);
    if (isNaN(productId) || productId <= 0) {
      return NextResponse.json(
        { error: "invalid_request", message: "Invalid productId: must be a positive integer" },
        { status: 400, headers: buildFallbackCorsHeaders(origin) }
      );
    }

    const sp = req.nextUrl.searchParams;
    const eventId = optionalIntParam(sp.get("eventId")) ?? 0;
    const eventParticipantId = optionalIntParam(sp.get("eventParticipantId"));
    const formId = optionalIntParam(sp.get("formId"));
    const excludeInvoiceId = optionalIntParam(sp.get("excludeInvoiceId"));

    const service = await ProductsService.getInstance();
    const product = await service.getProduct(
      productId,
      eventId,
      eventParticipantId,
      formId,
      excludeInvoiceId
    );

    const headers: HeadersInit = {
      ...getCorsHeaders(origin),
      "Cache-Control": "private, max-age=30",
    };

    return NextResponse.json({ product }, { status: 200, headers });
  } catch (error) {
    console.error("Error loading product:", error);

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
