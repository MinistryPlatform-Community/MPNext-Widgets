import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { getMpUserAccessToken } from "@/lib/embed/embed-session";
import { ChangePasswordSchema } from "@mpnext/types";
import { z } from "zod";

function corsHeaders(origin: string): HeadersInit {
  return buildFallbackCorsHeaders(origin);
}

export async function POST(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  const headers = corsHeaders(origin);

  try {
    const claims = await requireWidgetAuth(req, { widget: ["profile", "user-menu"] });

    const tenantHeaders = getCorsHeaders(origin);

    if (claims.sub === "public") {
      return NextResponse.json(
        { error: "auth_required", message: "Authentication required" },
        { status: 401, headers: tenantHeaders }
      );
    }

    const body = await req.json();
    const parsed = ChangePasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", message: "Validation failed", details: z.flattenError(parsed.error).fieldErrors },
        { status: 400, headers: tenantHeaders }
      );
    }

    // Resolve the MP token to act as the user (v1: carried in the JWT; v2: from
    // the server-side session, refreshed on demand).
    const mpAccessToken = await getMpUserAccessToken(claims);
    if (!mpAccessToken) {
      return NextResponse.json(
        { error: "session_expired", message: "Session expired. Please sign in again." },
        { status: 401, headers: tenantHeaders }
      );
    }

    const mpBaseUrl = process.env.MINISTRY_PLATFORM_BASE_URL;
    if (!mpBaseUrl) {
      throw new Error("MINISTRY_PLATFORM_BASE_URL not configured");
    }

    const mpRes = await fetch(
      `${mpBaseUrl}/oauth/account/change-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mpAccessToken}`,
        },
        body: JSON.stringify({
          OldPassword: parsed.data.oldPassword,
          NewPassword: parsed.data.newPassword,
        }),
      }
    );

    if (!mpRes.ok) {
      let errorMessage = "Failed to change password";
      try {
        const errorBody = await mpRes.json();
        errorMessage = errorBody.errors?.[0]?.description || errorBody.message || errorMessage;
      } catch {
        // Use default error message
      }
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: mpRes.status, headers: tenantHeaders }
      );
    }

    return NextResponse.json({ success: true }, { status: 200, headers: tenantHeaders });
  } catch (error) {
    console.error("Error changing password:", error);

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
