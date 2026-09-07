import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { runWithMpProfileCapture } from "@/lib/auth-profile-capture";
import { forceAuthoritativeSessionRead } from "@/lib/auth-session";

const handlers = toNextJsHandler(auth);

// Every Better Auth request runs inside a request-scoped slot that the MP
// OAuth callback uses to carry `userGuid`/`imageGuid` from `mapProfileToUser`
// to the `databaseHooks.user.create/update.before` hooks. See
// `src/lib/auth-profile-capture.ts`.
//
// `forceAuthoritativeSessionRead` makes `GET /get-session` bypass the cookie
// cache. It is the one Better Auth endpoint this app turns into a credential
// hand-off (`customSession` attaches the MP tokens), so a revoked session must
// not be able to answer it from a cookie -- see `src/lib/auth-session.ts`.
export const GET = (request: Request) =>
  runWithMpProfileCapture(() =>
    handlers.GET(forceAuthoritativeSessionRead(request)),
  );

export const POST = (request: Request) =>
  runWithMpProfileCapture(() => handlers.POST(request));
