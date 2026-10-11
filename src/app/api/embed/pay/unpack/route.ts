/**
 * Unpack a signed payment request token for the next-pay sandbox gateway.
 * GET /api/embed/pay/unpack?token=<jwt>
 *
 * Refuses a token whose `jti` has been spent (C43): Back from the pay page and
 * Forward again used to repaint a live card form for an invoice already paid.
 * `verification_used` is the widget's cue for its designed "already used"
 * state; `verification_expired` / `verification_invalid` likewise.
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

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["pay", "*"] });
  } catch {
    return errorResponse(
      "auth_required",
      "A valid widget token is required.",
      401,
      buildFallbackCorsHeaders(origin)
    );
  }

  const cors = getCorsHeaders(origin);
  const token = req.nextUrl.searchParams.get("token")?.trim();
  if (!token) {
    return errorResponse("invalid_request", "Missing token", 400, cors);
  }

  const checkout = CheckoutService.getInstance();
  let request;
  try {
    request = checkout.decodeRequestToken(token);
  } catch (error) {
    if (error instanceof PaymentTokenError && error.reason === "expired") {
      return errorResponse("verification_expired", "Payment request token expired", 400, cors);
    }
    return errorResponse("verification_invalid", "Payment request token failed verification", 400, cors);
  }

  try {
    if (!(await checkout.isRequestOpen(request))) {
      return errorResponse("verification_used", "Payment request token already used", 409, cors);
    }
  } catch (error) {
    console.error("[pay/unpack] request ledger unavailable:", error);
    return errorResponse("mp_unavailable", "Payment request ledger unavailable", 503, cors);
  }

  return NextResponse.json({ request }, { status: 200, headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
