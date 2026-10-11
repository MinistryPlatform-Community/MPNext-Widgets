/**
 * Server-to-server payment webhook (gateway → MP). Records the payment from a
 * signed response token, mirroring /checkout/payment-response. There is no
 * widget Bearer-token requirement here (a real vendor calls this directly), but
 * the token's HS256 signature is verified — decode throws on a bad/forged token.
 * POST /api/embed/payment/notify  body: form-encoded or JSON { token }
 *
 * Answers `{ invoiceId, status }` (C41). A recording fault is still a 200
 * with `status: "error"`: a vendor that retries on 5xx would otherwise
 * double-post. The fault is logged at `error` level.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
} from "@/lib/embed/auth";
import { errorResponse } from "@/lib/embed/anonymous-write";
import { CheckoutService, PaymentTokenError } from "@/services/checkoutService";
import { PaymentService } from "@/services/paymentService";
import type { PaymentOutcome } from "@mpnext/types";

async function readToken(req: NextRequest): Promise<string> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json()) as Record<string, unknown>;
    return typeof body.token === "string" ? body.token : "";
  }
  // form-encoded or multipart
  const form = await req.formData();
  const token = form.get("token");
  return typeof token === "string" ? token : "";
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  const cors = getCorsHeaders(origin);

  let token = "";
  try {
    token = (await readToken(req)).trim();
  } catch {
    return errorResponse("invalid_body", "Invalid request body", 400, cors);
  }
  if (!token) {
    return errorResponse("invalid_request", "Missing token", 400, cors);
  }

  let response;
  try {
    response = CheckoutService.getInstance().decodeResponseToken(token);
  } catch (error) {
    if (error instanceof PaymentTokenError && error.reason === "expired") {
      return errorResponse("verification_expired", "Payment response token expired", 400, cors);
    }
    return errorResponse("verification_invalid", "Payment response token failed verification", 400, cors);
  }

  try {
    const service = await PaymentService.getInstance();
    const result = await service.createPaymentFromResponse(response);
    const outcome: PaymentOutcome = {
      invoiceId: result.invoiceId,
      status: result.status,
    };
    return NextResponse.json(outcome, { status: 200, headers: cors });
  } catch (error) {
    console.error("[payment/notify] failed:", error);
    return errorResponse("mp_unavailable", "MP did not respond", 503, cors);
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
