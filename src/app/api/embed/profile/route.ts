import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { ProfileService } from "@/services/profileService";
import { ProfileUpdateSchema } from "@mpnext/types";

function corsHeaders(origin: string): HeadersInit {
  return buildFallbackCorsHeaders(origin);
}

export async function GET(req: NextRequest) {
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

    const profileService = await ProfileService.getInstance();
    const [profile, lookups] = await Promise.all([
      profileService.getProfileByUserGuid(claims.sub),
      profileService.getLookups(),
    ]);

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404, headers: tenantHeaders }
      );
    }

    return NextResponse.json({ profile, lookups }, { status: 200, headers: tenantHeaders });
  } catch (error) {
    console.error("Error loading profile:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Missing") ? 401 : 500,
        headers,
      }
    );
  }
}

export async function PUT(req: NextRequest) {
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
    const parsed = ProfileUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400, headers: tenantHeaders }
      );
    }

    const profileService = await ProfileService.getInstance();
    const profile = await profileService.getProfileByUserGuid(claims.sub);

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404, headers: tenantHeaders }
      );
    }

    const result = await profileService.updateProfile(profile.Contact_ID, parsed.data);

    return NextResponse.json(result, {
      status: result.success ? 200 : 500,
      headers: tenantHeaders,
    });
  } catch (error) {
    console.error("Error updating profile:", error);

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
