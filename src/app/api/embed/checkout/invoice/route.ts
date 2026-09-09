/**
 * Load a single invoice for the checkout / payment flow.
 * GET /api/embed/checkout/invoice?guid=<Invoice_GUID>
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { InvoiceService } from "@/services/invoiceService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["checkout", "my-invoices", "user-menu", "*"],
    });

    const guid = req.nextUrl.searchParams.get("guid")?.trim();
    if (!guid) {
      return NextResponse.json(
        { error: "invalid_request", message: "Missing guid" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const service = await InvoiceService.getInstance();

    // Authenticated payor → scope the proc to their contact; public → unscoped.
    let mpContactId: number | undefined;
    if (claims.sub !== "public") {
      const user = await service.getUserByGuid(claims.sub);
      mpContactId = user?.Contact_ID;
    }

    const invoice = await service.getCheckoutInvoiceByGuid(guid, mpContactId);
    if (!invoice) {
      return NextResponse.json(
        { error: "invoice_not_found", message: "Invoice not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    return NextResponse.json(
      { invoice },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error loading checkout invoice:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
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
