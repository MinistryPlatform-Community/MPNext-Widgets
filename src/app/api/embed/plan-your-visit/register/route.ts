/**
 * Step 2b of Plan Your Visit: create the household + members.
 * POST /api/embed/plan-your-visit/register  (body: PyvRegisterRequest)
 *   -> { success, message? }
 *
 * Gated by a valid verify token. The head-of-household email is taken from the
 * token (not trusted from the body). Creates the household, address, head /
 * spouse / children contacts + participants, milestone assignments and pending
 * age/grade group memberships, then sends the user + church notification emails.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireWidgetAuth,
  getCorsHeaders,
  resolveRequestOrigin,
  buildOptionsResponse,
  buildFallbackCorsHeaders,
} from "@/lib/embed/auth";
import { PlanYourVisitService } from "@/services/planYourVisitService";
import { verifyVerifyToken } from "@/lib/embed/verify-token";
import type { PyvRegisterRequest } from "@mpnext/types";

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    await requireWidgetAuth(req, { widget: ["plan-your-visit", "user-menu", "*"] });

    let body: PyvRegisterRequest;
    try {
      body = (await req.json()) as PyvRegisterRequest;
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }

    const payload = await verifyVerifyToken(body.token || "");
    if (!payload) {
      return NextResponse.json(
        { success: false, message: "Your verification link is invalid or has expired." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    if (!body.congregationId || body.congregationId <= 0) {
      return NextResponse.json(
        { success: false, message: "Please choose a congregation." },
        { status: 422, headers: getCorsHeaders(origin) }
      );
    }
    if (!body.headOfHousehold?.firstName || !body.headOfHousehold?.lastName) {
      return NextResponse.json(
        { success: false, message: "Your name is required." },
        { status: 422, headers: getCorsHeaders(origin) }
      );
    }

    // Trust the token's email, not the body's.
    body.email = payload.email;

    const service = await PlanYourVisitService.getInstance();
    await service.saveVisitDetails(body);

    return NextResponse.json(
      { success: true },
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("Error saving plan-your-visit details:", error);
    return NextResponse.json(
      { success: false, message },
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
