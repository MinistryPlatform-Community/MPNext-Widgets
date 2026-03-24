import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    accessToken: session.accessToken,
    idToken: session.idToken ?? null,
    refreshToken: session.refreshToken ?? null,
    expiresAt: session.expiresAt ?? null,
    firstName: session.firstName ?? "",
    lastName: session.lastName ?? "",
    email: session.email ?? "",
    imageGuid: session.userProfile?.Image_GUID ?? null,
  });
}
