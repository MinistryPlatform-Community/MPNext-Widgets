import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export async function POST(req: NextRequest) {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
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
