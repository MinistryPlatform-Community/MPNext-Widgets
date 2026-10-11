/**
 * Invoice list endpoint for embed widgets
 * GET /api/embed/invoices?congregationId=&monthId=&invoiceStatusId= - user's invoices
 *
 * The optional query parameters are `next-my-invoices`' filter attributes
 * (C60), applied in MP. `invoiceStatusId` uses legacy's vocabulary (1 balance
 * due, 2 paid in full, 0 all), not MP status ids. A non-integer value is
 * ignored rather than refused.
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
import { getMpUserAccessToken } from "@/lib/embed/embed-session";
import { InvoiceService, type InvoiceListFilters } from "@/services/invoiceService";

function intParam(raw: string | null): number | undefined {
  if (raw === null || !/^\d+$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
}

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    // The invoices tab is rendered inside the next-user-menu modal on any page,
    // so it rides on whatever page-level token the host issues. Accept any
    // authenticated widget for the read (still enforces non-public sub).
    claims = await requireWidgetAuth(req, { widget: "*" });
  } catch {
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);
  if (claims.sub === "public") {
    // The widget's cue for its sign-in prompt (C46).
    return errorResponse("auth_required", "Authentication required. Please sign in.", 401, cors);
  }

  const q = req.nextUrl.searchParams;
  const filters: InvoiceListFilters = {
    congregationId: intParam(q.get("congregationId")),
    monthId: intParam(q.get("monthId")),
    invoiceStatus: intParam(q.get("invoiceStatusId")),
  };

  try {
    const service = await InvoiceService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return errorResponse("user_not_found", "User not found", 404, cors);
    }

    const invoices = await service.getInvoices(
      user.Contact_ID,
      (await getMpUserAccessToken(claims)) ?? undefined,
      filters
    );

    return NextResponse.json({ invoices }, { status: 200, headers: cors });
  } catch (error) {
    console.error("[invoices] MP read failed:", error);
    return errorResponse("mp_unavailable", "MP did not respond", 503, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
