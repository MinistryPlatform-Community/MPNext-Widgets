import { NextRequest, NextResponse } from "next/server";
import { requireWidgetAuth, getCorsHeaders, resolveRequestOrigin, buildOptionsResponse, buildFallbackCorsHeaders } from "@/lib/embed/auth";
import { ProfileService } from "@/services/profileService";

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
    const profile = await profileService.getProfileByUserGuid(claims.sub);

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404, headers: tenantHeaders }
      );
    }

    const photo = await profileService.getProfilePhoto(profile.Contact_ID);

    if (!photo) {
      return NextResponse.json(
        { error: "No profile photo" },
        { status: 404, headers: tenantHeaders }
      );
    }

    // Proxy the image content from MP (thumbnail for avatars, full for other uses)
    const thumbnail = req.nextUrl.searchParams.get("thumbnail") === "true";
    const blob = await profileService.getProfilePhotoContent(photo.uniqueFileId, thumbnail);
    const arrayBuffer = await blob.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        ...tenantHeaders,
        "Content-Type": blob.type || "image/jpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("Error loading profile photo:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      {
        status: error instanceof Error && error.message.includes("Missing") ? 401 : 500,
        headers,
      }
    );
  }
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

    const formData = await req.formData();
    const file = formData.get("photo") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No photo file provided" },
        { status: 400, headers: tenantHeaders }
      );
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image." },
        { status: 400, headers: tenantHeaders }
      );
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
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

    const result = await profileService.uploadProfilePhoto(profile.Contact_ID, file);

    return NextResponse.json(
      { success: true, uniqueFileId: result.UniqueFileId },
      { status: 200, headers: tenantHeaders }
    );
  } catch (error) {
    console.error("Error uploading profile photo:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to upload photo" },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS(req: NextRequest) {
  return buildOptionsResponse(req);
}
