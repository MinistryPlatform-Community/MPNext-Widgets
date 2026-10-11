/**
 * Sandbox payment gateway: validate the (fake) card and build a signed
 * payment response token. Mirrors a real vendor's hosted-page callback.
 * POST /api/embed/pay/response  body: { token, cardNumber, ... }
 *
 * SANDBOX RULE: a transaction succeeds only when the card number (digits only)
 * is the Visa test PAN 4111 1111 1111 1111. Everything else is declined.
 *
 * ## Single use (C43)
 *
 * The request token's `jti` is **spent by the first successful submit**,
 * atomically, so one request token yields at most one successful response
 * token — and so at most one `Payments` row, since every response token has a
 * fresh transaction code. A declined submit does not spend it: the payer can
 * try another card from the same page. A spent token answers
 * `409 verification_used`.
 */

import crypto from "node:crypto";
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
import type { PaymentResponseToken } from "@mpnext/types";

const SANDBOX_SUCCESS_PAN = "4111111111111111";

export async function POST(req: NextRequest) {
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

  const checkout = CheckoutService.getInstance();
  let request;
  try {
    // Decode the request token to copy invoice + payor fields.
    request = checkout.decodeRequestToken(tokenInput);
  } catch (error) {
    if (error instanceof PaymentTokenError && error.reason === "expired") {
      return errorResponse("verification_expired", "Payment request token expired", 400, cors);
    }
    return errorResponse("verification_invalid", "Payment request token failed verification", 400, cors);
  }

  const cardNumber = String(body.cardNumber ?? "").replace(/\s+/g, "");
  const transactionSuccess = cardNumber === SANDBOX_SUCCESS_PAN;
  const type =
    typeof body.type === "string" && body.type ? body.type : "CREDIT_DEBIT";

  try {
    // Success spends the token (atomically); a decline only checks it is
    // still open, so it can be retried with another card.
    const usable = transactionSuccess
      ? await checkout.spendRequest(request)
      : await checkout.isRequestOpen(request);
    if (!usable) {
      return errorResponse("verification_used", "Payment request token already used", 409, cors);
    }
  } catch (error) {
    console.error("[pay/response] request ledger unavailable:", error);
    return errorResponse("mp_unavailable", "Payment request ledger unavailable", 503, cors);
  }

  const responseToken: PaymentResponseToken = {
    invoiceId: request.invoiceId,
    amount: request.amount,
    transactionSuccess,
    transactionCode: crypto.randomUUID(),
    type,
    itemNumber: typeof body.itemNumber === "string" ? body.itemNumber : null,
    firstName: request.firstName,
    lastName: request.lastName,
    email: request.email,
    mobilePhone: request.mobilePhone,
    addressStreet: request.addressStreet,
    addressStreet2: request.addressStreet2,
    addressCity: request.addressCity,
    addressState: request.addressState,
    addressZip: request.addressZip,
  };

  const token = checkout.buildResponseToken(responseToken);
  return NextResponse.json({ token }, { status: 200, headers: cors });
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
