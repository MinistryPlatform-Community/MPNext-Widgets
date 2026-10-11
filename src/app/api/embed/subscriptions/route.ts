/**
 * Subscriptions endpoint for embed widgets
 * GET  /api/embed/subscriptions - list publications + user's subscription state
 * PUT  /api/embed/subscriptions - update user's subscriptions and/or bulk-email opt-out
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { SubscriptionService } from "@/services/subscriptionService";
import { SubscriptionUpdateSchema } from "@mpnext/types";
import { z } from "zod";

function fallbackCors(origin: string): HeadersInit {
  return buildFallbackCorsHeaders(origin);
}

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // The subscriptions tab is rendered inside the next-user-menu modal on any
    // page, so it rides on whatever page-level token the host issues. Accept any
    // authenticated widget for the read (still enforces non-public sub).
    const claims = await requireWidgetAuth(req, { widget: "*" });

    const headers = getCorsHeaders(origin);

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "auth_required", message: "Authentication required" },
        { status: 401, headers }
      );
    }

    const service = await SubscriptionService.getInstance();
    const contactId = await service.getContactIdByUserGuid(claims.sub);

    if (!contactId) {
      return NextResponse.json(
        { error: "user_not_found", message: "User not found" },
        { status: 404, headers }
      );
    }

    const [subscriptions, bulkEmailOptOut] = await Promise.all([
      service.getSubscriptions(contactId),
      service.getBulkEmailOptOut(contactId),
    ]);

    return NextResponse.json({ subscriptions, bulkEmailOptOut }, { status: 200, headers });
  } catch (error) {
    console.error("Error loading subscriptions:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Missing") ? 401 : 500,
        headers: fallbackCors(origin),
      }
    );
  }
}

export async function PUT(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["subscriptions", "user-menu"],
    });

    const headers = getCorsHeaders(origin);

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "auth_required", message: "Authentication required" },
        { status: 401, headers }
      );
    }

    const body = await req.json();
    const parsed = SubscriptionUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", message: "Validation failed", details: z.flattenError(parsed.error).fieldErrors },
        { status: 400, headers }
      );
    }

    const service = await SubscriptionService.getInstance();
    const contactId = await service.getContactIdByUserGuid(claims.sub);

    if (!contactId) {
      return NextResponse.json(
        { error: "user_not_found", message: "User not found" },
        { status: 404, headers }
      );
    }

    const { subscribedIds, bulkEmailOptOut } = parsed.data;
    let result: { success: boolean; error?: string; bulkEmailOptOut?: boolean } = { success: true };

    if (subscribedIds !== undefined) {
      result = await service.updateSubscriptions(contactId, subscribedIds);
    }
    if (result.success && bulkEmailOptOut !== undefined) {
      result = await service.setBulkEmailOptOutForContact(contactId, bulkEmailOptOut);
      if (result.success) result = { ...result, bulkEmailOptOut };
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 500,
      headers,
    });
  } catch (error) {
    console.error("Error updating subscriptions:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500, headers: fallbackCors(origin) }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
