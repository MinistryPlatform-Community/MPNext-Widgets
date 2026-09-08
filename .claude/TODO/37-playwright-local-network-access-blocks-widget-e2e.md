# 37. Chromium's Local Network Access checks block every widget E2E run

**Depends on:** nothing.
**Risk:** none in prod — the SDK and the API are fine. It is the Playwright
harness: in the bundled Chromium, `http://localhost:5173` cannot reach
`http://localhost:3000/api/embed/*` at all, so `e2e/widget/*` exercises a widget
that has silently fallen back to `legacy` / public. `login-hardened.spec.ts`
aborts on its own banner guard, and any spec that asserts rendered MP data is
asserting against a widget that never got a token.
**Size:** ~20 minutes (one `launchOptions.args` line, then re-run the suite).

> Found on 2026-09-08 while browser-verifying item 36 with a local Playwright
> script (`playwright` 1.63.0, the same bundled Chromium `playwright.config.ts`
> uses via `devices["Desktop Chrome"]`).

## The problem

The first run of the item-36 check, with no launch flags, produced this in the
page console and nothing else:

```
Access to fetch at 'http://localhost:3000/api/embed/auth/config' from origin
'http://localhost:5173' has been blocked by CORS policy: Permission was denied
for this request to access the `loopback` address space.
net::ERR_FAILED
```

The demo banner then read **"legacy (config unavailable)"** even though the
server was running with `EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual`,
because `AuthSession` treats any config failure as `legacy` by design. Vite's
own HMR WebSocket was blocked the same way
(`net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`).

This is not a CORS-header or `EMBED_ALLOWED_ORIGINS` problem — the request never
leaves the browser. Chrome 140+ gates requests that *target* the loopback
address space behind Local Network Access permission, which headless Chromium
denies with no prompt. Adding

```ts
launchOptions: {
  args: ["--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessPermissionPrompt,BlockInsecurePrivateNetworkRequests"],
}
```

made the same page resolve `mode: dual` and 200 on
`/api/embed/auth/config` on every subsequent run.

## Why the suite looks like it passes

`e2e/widget/login-hardened.spec.ts` skips unless `EMBED_AUTH_MODE` is non-legacy
in the *shell* and then fails its banner assertion, which reads like a server
misconfiguration ("the dev server is not running in dual/hardened for
http://localhost:5173") rather than a browser-policy block. Data-rendering specs
are worse: a public token still mints, so the widget renders its signed-out or
empty state and any assertion loose enough to accept that passes.

## Fix sketch

1. Add the `launchOptions.args` above to the `widget` project in
   `playwright.config.ts` (project-level, not `use` at the top, so a future
   non-localhost project is unaffected).
2. Re-run `pnpm test:e2e:widget` and confirm each spec still means what it
   claims — expect some to have been passing vacuously.
3. Consider asserting the resolved mode once in a shared fixture so a future
   silent fallback fails loudly instead of degrading assertions.

An alternative is serving both the demo and the API from one origin in E2E, but
that changes what is under test (cross-origin embedding is the product), so the
flag is the right fix.

## Testing

- `pnpm test:e2e:widget` with the flag, then without: the same spec must go from
  passing to failing on the config fetch, which is the proof the flag is what
  matters.
- Confirm `/api/embed/auth/config` returns 200 in the trace's network panel.
- Standard verification gate (the config change touches no shipped code).

## Done when

A widget E2E run reaches `/api/embed/auth/config` and resolves the server's real
auth mode, and no spec can pass while the SDK has silently fallen back to a
public token.
