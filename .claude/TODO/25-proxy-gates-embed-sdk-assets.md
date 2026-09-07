# 25. `src/proxy.ts` gates `/embed-sdk/*`, so external sites cannot load the SDK

**Depends on:** nothing. Found while browser-verifying item 22 on 2026-09-07.
**Risk:** high if any host site is (or ever will be) served from another origin —
the embed SDK is unreachable for every visitor who is not signed in to *this*
app.
**Size:** ~20 minutes plus a production check.

> **Pre-existing** — `src/proxy.ts` has always been shaped this way; item 22
> only exposed it, because fixing the demo's script URL made the next question
> "does the URL we hand to customers actually resolve for them?"

## The problem

`src/proxy.ts` lets three prefixes through unauthenticated and redirects
everything else to `/signin`:

```ts
if (pathname.startsWith('/api') || pathname === '/signin' || pathname.startsWith('/demo')) {
  return NextResponse.next();
}
// ...
if (!sessionCookie) return NextResponse.redirect(new URL('/signin', request.url));
```

with

```ts
matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)']
```

`/embed-sdk/*` is not excluded from the matcher and is not one of the public
prefixes, so **the SDK bundle is behind the app's login**. Measured against a
clean `pnpm build` + `pnpm start`, with no cookies:

```
/embed-sdk/next-embed.js                    307 -> /signin
/embed-sdk/next-embed.<hash>.es.js          307 -> /signin
/embed-sdk/mp-widget-overrides.<hash>.css   307 -> /signin
/embed-sdk/mp-widget-overrides.css          307 -> /signin
```

A host site that pastes the Universal Setup snippet
(`<script type="module" src="https://your-host.com/embed-sdk/next-embed.js">`)
gets a redirect to an HTML page instead of a module, so the script fails to
parse and no `<next-*>` element ever upgrades. The cross-site request would not
carry the Better Auth cookie anyway (`SameSite=Lax`), so there is no
configuration in which an external embed succeeds.

It is invisible today because the only pages exercising the SDK are
`/demo/<slug>` (same origin, signed in) and the Vite demos (which import
`src/index.ts` directly, never the built bundle).

Note the `vercel.json` headers block already treats these files as public
assets — `Access-Control-Allow-Origin: *` and long-lived immutable caching —
which is exactly the intent the proxy contradicts.

## Steps

1. Let `/embed-sdk/` through unauthenticated: add it to the public-prefix early
   return in `proxy()` **and** to the matcher's negative lookahead (the matcher
   is the cheaper of the two — a matcher exclusion means the middleware never
   runs for these paths at all).
2. While there: `assets/` is excluded but `public/`'s other top-level files are
   not. Decide whether the allowlist should be "known app routes require a
   session" rather than "everything except four things does".
3. Verify with a clean build (`pnpm build && pnpm start`) that all four
   `/embed-sdk/*` URLs return **200 with no cookies**, and that `/demo` still
   redirects an unauthenticated visitor to `/signin`.
4. Confirm on a Vercel preview deploy, not just locally — routing order for
   `public/` files versus middleware is worth seeing in the real environment.

## Done when

`curl -I` with no cookies returns 200 for `/embed-sdk/next-embed.js`, the hashed
bundle, and both CSS files; `/demo` still requires a session; and the standard
verification gate passes.
