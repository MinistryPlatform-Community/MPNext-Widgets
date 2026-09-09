/**
 * Unpack a signed payment request token for the next-pay sandbox gateway.
 * GET /api/embed/pay/unpack?token=<jwt>
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { CheckoutService } from "@/services/checkoutService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["pay", "*"] });

    const token = req.nextUrl.searchParams.get("token")?.trim();
    if (!token) {
      return NextResponse.json(
        { error: "invalid_request", message: "Missing token" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const request = CheckoutService.getInstance().decodeRequestToken(token);

    return NextResponse.json(
      { request },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error unpacking payment request token:", error);
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
