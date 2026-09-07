/**
 * Server-to-server payment webhook (gateway → MP). Records the payment from a
 * signed response token, mirroring /checkout/payment-response. There is no
 * widget Bearer-token requirement here (a real vendor calls this directly), but
 * the token's HS256 signature is verified — decode throws on a bad/forged token.
 * POST /api/embed/payment/notify  body: form-encoded or JSON { token }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { CheckoutService } from "@/services/checkoutService";
import { PaymentService } from "@/services/paymentService";

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

  try {
    let token = "";
    try {
      token = (await readToken(req)).trim();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    if (!token) {
      return NextResponse.json(
        { error: "Missing token" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    // Verify signature + expiry (throws on a forged/expired token).
    const response = CheckoutService.getInstance().decodeResponseToken(token);

    const service = await PaymentService.getInstance();
    const result = await service.createPaymentFromResponse(response);

    return NextResponse.json(
      {
        invoiceId: result.invoiceId,
        success: result.success,
        paymentReceived: result.paymentReceived,
        ...(result.message ? { message: result.message } : {}),
      },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error processing payment notify webhook:", error);
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
