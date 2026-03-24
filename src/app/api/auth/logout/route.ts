import { NextRequest, NextResponse } from "next/server";
import { auth, signOut } from "@/auth";

export async function POST(req: NextRequest) {
  const session = await auth();
  const idToken = session?.idToken;

  const body = await req.json().catch(() => ({})) as { postLogoutRedirectUri?: string };
  const postLogoutRedirectUri =
    body.postLogoutRedirectUri || `${process.env.NEXTAUTH_URL}/signin`;

  await signOut({ redirect: false });

  const baseUrl = process.env.MINISTRY_PLATFORM_BASE_URL!;
  const endSessionUrl = new URL(`${baseUrl}/oauth/connect/endsession`);
  if (idToken) {
    endSessionUrl.searchParams.set("id_token_hint", idToken);
  }
  endSessionUrl.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri);

  return NextResponse.json({ redirectUrl: endSessionUrl.toString() });
}
