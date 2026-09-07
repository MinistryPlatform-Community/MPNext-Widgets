import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { runWithMpProfileCapture } from "@/lib/auth-profile-capture";

const handlers = toNextJsHandler(auth);

// Every Better Auth request runs inside a request-scoped slot that the MP
// OAuth callback uses to carry `userGuid`/`imageGuid` from `mapProfileToUser`
// to the `databaseHooks.user.create/update.before` hooks. See
// `src/lib/auth-profile-capture.ts`.
export const GET = (request: Request) =>
  runWithMpProfileCapture(() => handlers.GET(request));

export const POST = (request: Request) =>
  runWithMpProfileCapture(() => handlers.POST(request));
