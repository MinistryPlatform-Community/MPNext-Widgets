/**
 * Subscriptions endpoint for embed widgets
 * GET  /api/embed/subscriptions - list publications + user's subscription state
 * PUT  /api/embed/subscriptions - update user's subscriptions
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { getTenantConfig } from "@/lib/embed/config";
import { SubscriptionService } from "@/services/subscriptionService";
import { SubscriptionUpdateSchema } from "@mpnext/types";

function fallbackCors(origin: string): HeadersInit {
  return buildFallbackCorsHeaders(origin);
}

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, {
      widget: ["subscriptions", "user-menu"],
    });

    const tenant = await getTenantConfig(claims.tid);
    const headers = tenant
      ? getCorsHeaders(origin, tenant.allowedOrigins)
      : fallbackCors(origin);

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers }
      );
    }

    const service = await SubscriptionService.getInstance();
    const contactId = await service.getContactIdByUserGuid(claims.sub);

    if (!contactId) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404, headers }
      );
    }

    const subscriptions = await service.getSubscriptions(contactId);

    return NextResponse.json({ subscriptions }, { status: 200, headers });
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

    const tenant = await getTenantConfig(claims.tid);
    const headers = tenant
      ? getCorsHeaders(origin, tenant.allowedOrigins)
      : fallbackCors(origin);

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers }
      );
    }

    const body = await req.json();
    const parsed = SubscriptionUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400, headers }
      );
    }

    const service = await SubscriptionService.getInstance();
    const contactId = await service.getContactIdByUserGuid(claims.sub);

    if (!contactId) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404, headers }
      );
    }

    const result = await service.updateSubscriptions(contactId, parsed.data.subscribedIds);

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
