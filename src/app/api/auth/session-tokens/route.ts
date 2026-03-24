import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.session?.accessToken) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    accessToken: session.session.accessToken,
    idToken: session.session.idToken ?? null,
    refreshToken: session.session.refreshToken ?? null,
    expiresAt: session.session.expiresAt ?? null,
    firstName: session.user.firstName ?? "",
    lastName: session.user.lastName ?? "",
    email: session.user.email ?? "",
    imageGuid: session.user.imageGuid ?? null,
  });
}
