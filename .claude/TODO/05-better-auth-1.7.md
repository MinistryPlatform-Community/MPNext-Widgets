# 5. better-auth 1.6→1.7

**Depends on:** nothing.
**Risk:** medium — touches the sign-in path. **Size:** 1–2 hours + manual auth testing.

## Current state and why it's pinned

Root `package.json` has `"better-auth": "~1.6.30"` — a **tilde, deliberately**, to
hold the minor at 1.6.x. Do not "fix" it to a caret without doing the work below.

1.6.30 was chosen over the then-latest 1.7.3 because 1.7 **removed
`genericOAuthClient`** from the `better-auth/client/plugins` barrel. Verified on
2026-09-07: `genericOAuthClient` does not appear anywhere in the 1.7.3 `dist/`,
while 1.6.30 still exports it from both `dist/client/plugins/index.mjs` and
`dist/plugins/generic-oauth/client.mjs`.

1.6.30 **does** carry both security fixes that drove the bump, so there is no
open vulnerability blocking on this:
- `>=1.6.13` — stored XSS via `javascript:` `redirect_uri` in oidc-provider/mcp (high)
- `>=1.6.22` — account takeover via pre-account hijacking on magic-link / email-OTP (high)

**But** 1.6.x will stop receiving fixes, so this shouldn't sit indefinitely.

## What breaks

`src/lib/auth-client.ts` — the whole file is 10 lines:

```ts
import { createAuthClient } from "better-auth/react";
import { genericOAuthClient, customSessionClient } from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  plugins: [genericOAuthClient(), customSessionClient<typeof auth>()],
});
```

`customSessionClient` is still exported in 1.7.3. Only `genericOAuthClient` is gone.

The **server** side is fine as-is: `src/lib/auth.ts:2` imports `genericOAuth` from
`better-auth/plugins`, and `dist/plugins/generic-oauth/` still exists in 1.7.3.
So this is a client-plugin migration only.

## Steps

1. Read the better-auth 1.7 release notes / migration guide for the removal —
   determine whether the generic-oauth client actions (`signIn.oauth2`, `linkSocial`)
   are now built into the core client, inferred from the server plugin via
   `InferServerPlugin`, or moved to a new subpath. **Do not guess.** The 1.7.3
   `client/plugins` barrel does export `InferServerPlugin`, which is a hint but
   not confirmation.
2. `pnpm update --latest better-auth` and restore a caret range once migrated.
3. Update `src/lib/auth-client.ts` accordingly.
4. Check `src/lib/auth.ts` `genericOAuth({...})` config for renamed options.
5. Cross-check `src/app/api/embed/auth/login/route.ts:93` — the comment there says
   the hand-rolled MP OAuth authorize params intentionally *mirror* the Better Auth
   `genericOAuth` `authorizationUrlParams` config. If 1.7 changed those semantics,
   this comment and possibly the params drift out of sync.

## Testing — do not merge on green CI alone

There are no automated tests over the Better Auth sign-in path. Manually verify:
- Admin/dashboard sign-in via the Better Auth OAuth flow end to end.
- `/signin` page renders and redirects correctly.
- The same-origin Better Auth session branch of `POST /api/embed/session` still
  mints a widget JWT (see `src/app/api/embed/session/route.ts`).
- `e2e/widget/login-hardened.spec.ts` still passes (needs `PLAYWRIGHT_MP_USERNAME` /
  `PLAYWRIGHT_MP_PASSWORD` and `EMBED_AUTH_MODE` != `legacy`).

## Done when

Standard verification gate passes, the manual auth checks above pass, and the
range is back to a caret.
