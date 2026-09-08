/**
 * The app's logout endpoint. Ends the Better Auth session and hands the caller
 * MP's end-session URL to navigate to (`src/lib/app-logout.ts`).
 *
 * It takes no destination from the caller. `post_logout_redirect_uri` has to be
 * registered on the MP OAuth client or MP refuses to finish the logout at all
 * (TODO 29), so the value is fixed server-side and built by the one shared
 * helper the embed route uses too — `buildEndSessionUrl` in
 * `src/lib/embed/mp-oauth.ts`.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCachedSession } from "@/lib/auth-session";
import { buildEndSessionUrl } from "@/lib/embed/mp-oauth";

export async function POST() {
  const hdrs = await headers();
  // Deliberately the cached read. This is a de-escalation: the session is
  // only consulted for the `id_token` that becomes MP's `id_token_hint`, and
  // `signOut` below is what actually revokes. Forcing a store round trip here
  // would only make logout slower, and would drop the hint in the one case
  // (already-revoked session) where nothing is at stake.
  const session = await getCachedSession(hdrs);
  const idToken = session?.session?.idToken;

  await auth.api.signOut({ headers: hdrs });

  return NextResponse.json({ redirectUrl: buildEndSessionUrl({ idToken }) });
}
