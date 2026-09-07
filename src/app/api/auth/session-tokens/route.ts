import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAuthoritativeSession } from "@/lib/auth-session";

export async function GET() {
  // Authoritative: this route hands the caller live MP access / refresh / id
  // tokens. A session that has been signed out or revoked must not be able to
  // collect credentials from the cookie cache on its way out.
  const session = await getAuthoritativeSession(await headers());

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
