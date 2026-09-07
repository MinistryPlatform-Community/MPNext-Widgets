import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCachedSession } from "@/lib/auth-session";
import { getEnv } from "@/lib/env";

export async function POST(req: NextRequest) {
  const hdrs = await headers();
  // Deliberately the cached read. This is a de-escalation: the session is
  // only consulted for the `id_token` that becomes MP's `id_token_hint`, and
  // `signOut` below is what actually revokes. Forcing a store round trip here
  // would only make logout slower, and would drop the hint in the one case
  // (already-revoked session) where nothing is at stake.
  const session = await getCachedSession(hdrs);
  const idToken = session?.session?.idToken;

  const body = await req.json().catch(() => ({})) as { postLogoutRedirectUri?: string };
  const postLogoutRedirectUri =
    body.postLogoutRedirectUri || `${process.env.BETTER_AUTH_URL}/signin`;

  await auth.api.signOut({ headers: hdrs });

  const baseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL");
  const endSessionUrl = new URL(`${baseUrl}/oauth/connect/endsession`);
  if (idToken) {
    endSessionUrl.searchParams.set("id_token_hint", idToken);
  }
  endSessionUrl.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);

  return NextResponse.json({ redirectUrl: endSessionUrl.toString() });
}
