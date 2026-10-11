/**
 * Process a signed payment response token and record the payment in MP.
 * POST /api/embed/checkout/payment-response  body: { token }
 *
 * Answers `{ invoiceId, status }` — one discriminant, `received` | `pending` |
 * `declined` | `error` (C41). A recording fault is a 200 with `status: "error"`
 * rather than a 5xx, so the widget renders "we could not record it" instead of
 * a retry loop that could re-post; it is logged at `error` level server-side.
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
import { CheckoutService, PaymentTokenError } from "@/services/checkoutService";
import { PaymentService } from "@/services/paymentService";
import { InvoiceService } from "@/services/invoiceService";
import type { PaymentOutcome } from "@mpnext/types";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  let claims;
  try {
    claims = await requireWidgetAuth(req, { widget: ["checkout", "*"] });
  } catch {
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("invalid_body", "Invalid JSON body", 400, cors);
  }

  const tokenInput = typeof body.token === "string" ? body.token : "";
  if (!tokenInput) {
    return errorResponse("invalid_request", "Missing token", 400, cors);
  }

  let response;
  try {
    response = CheckoutService.getInstance().decodeResponseToken(tokenInput);
  } catch (error) {
    if (error instanceof PaymentTokenError && error.reason === "expired") {
      return errorResponse("verification_expired", "Payment response token expired", 400, cors);
    }
    return errorResponse("verification_invalid", "Payment response token failed verification", 400, cors);
  }

  try {
    // The audit contact for a signed-in payor, used only when the invoice has
    // no purchaser of its own.
    let mpContactId: number | undefined;
    if (claims.sub !== "public") {
      const invoiceSvc = await InvoiceService.getInstance();
      const user = await invoiceSvc.getUserByGuid(claims.sub);
      mpContactId = user?.Contact_ID;
    }

    const service = await PaymentService.getInstance();
    const result = await service.createPaymentFromResponse(response, mpContactId);
    const outcome: PaymentOutcome = {
      invoiceId: result.invoiceId,
      status: result.status,
    };
    return NextResponse.json(outcome, { status: 200, headers: cors });
  } catch (error) {
    console.error("[checkout/payment-response] failed:", error);
    return errorResponse("mp_unavailable", "MP did not respond", 503, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
