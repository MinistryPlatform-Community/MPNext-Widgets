/**
 * Existing invoice / participants endpoint for the next-event-details widget.
 * GET /api/embed/event-details/participants/:invoiceGuid
 *
 * Returns the ExistingInvoice payload (re-population data) for an in-progress or
 * completed registration. Public-allowed: an anonymous registrant holding the
 * GUID may read it. A signed-in caller may read only an invoice they purchased;
 * anything else is a 404 (C80 / C01).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { errorResponse } from "@/lib/embed/anonymous-write";
import { EventDetailsService } from "@/services/eventDetailsService";
import { resolveInvoiceOwner } from "@/services/invoiceService";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceGuid: string }> }
) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    claims = await requireWidgetAuth(req, {
      widget: ["event-details", "user-menu", "*"],
    });
  } catch {
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const headers: HeadersInit = {
    ...getCorsHeaders(origin),
    "Cache-Control": "private, no-store",
  };

  const { invoiceGuid } = await params;
  if (!invoiceGuid || invoiceGuid.trim() === "") {
    return errorResponse("invalid_request", "Invalid invoice GUID", 400, headers);
  }

  try {
    const service = await EventDetailsService.getInstance();
    const owner = await resolveInvoiceOwner(service, claims.sub);
    const invoice = await service.getEventParticipantsByInvoice(invoiceGuid, owner);
    if (!invoice) {
      return errorResponse("invoice_not_found", "Invoice not found", 404, headers);
    }

    return NextResponse.json(invoice, { status: 200, headers });
  } catch (error) {
    console.error("[event-details/participants] MP read failed:", error);
    return errorResponse("mp_unavailable", "MP did not respond", 503, headers);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
