import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { ChangePasswordSchema } from "@mpnext/types";

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
        { error: "Authentication required" },
        { status: 401, headers: tenantHeaders }
      );
    }

    const body = await req.json();
    const parsed = ChangePasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400, headers: tenantHeaders }
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
          Authorization: `Bearer ${claims.mpAccessToken}`,
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
