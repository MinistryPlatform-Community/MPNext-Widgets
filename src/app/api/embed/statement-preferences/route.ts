/**
 * Statement preference (Go Paperless) endpoint for embed widgets
 * GET /api/embed/statement-preferences - user's statement method
 * PUT /api/embed/statement-preferences - update statement method
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { StatementPreferencesService } from "@/services/statementPreferencesService";

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    // The statement-preferences widget can be embedded as a secondary widget on
    // any page, so it rides on whatever page-level token the host issues. Accept
    // any authenticated widget for the read (still enforces non-public sub).
    // The PUT below stays restricted.
    const claims = await requireWidgetAuth(req, { widget: "*" });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const service = await StatementPreferencesService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const preference = await service.getPreference(user.Contact_ID);
    if (!preference) {
      return NextResponse.json(
        { error: "Donor record not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    return NextResponse.json(
      preference,
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error loading statement preference:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function PUT(req: NextRequest) {
  const origin = resolveRequestOrigin(req);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["statement-preferences", "user-menu"] });

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "Authentication required. Please sign in." },
        { status: 401, headers: getCorsHeaders(origin) }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.paperless !== "boolean") {
      return NextResponse.json(
        { error: "Invalid request body. 'paperless' must be a boolean." },
        { status: 400, headers: getCorsHeaders(origin) }
      );
    }
    const paperless: boolean = body.paperless;

    const service = await StatementPreferencesService.getInstance();
    const user = await service.getUserByGuid(claims.sub);
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const existing = await service.getPreference(user.Contact_ID);
    if (!existing) {
      return NextResponse.json(
        { error: "Donor record not found" },
        { status: 404, headers: getCorsHeaders(origin) }
      );
    }

    const preference = await service.setPreference(
      user.Contact_ID,
      existing.donorId,
      paperless
    );

    return NextResponse.json(
      preference,
      { status: 200, headers: getCorsHeaders(origin) }
    );
  } catch (error) {
    console.error("Error updating statement preference:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Token") ? 403 : 500,
        headers: buildFallbackCorsHeaders(origin),
      }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
