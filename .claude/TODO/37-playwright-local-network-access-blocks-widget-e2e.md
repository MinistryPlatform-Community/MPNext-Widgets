# 37. Widget E2E specs passed while the SDK was silently de-authenticated

**Status: done (2026-09-08).** The original diagnosis in this file — that
Chromium's Local Network Access checks blocked `localhost:5173 →
localhost:3000` — **did not reproduce and is not the cause.** Do not add the
`--disable-features=LocalNetworkAccess...` launch flag. The real defect was the
one the fix sketch listed second: the specs could not tell a working widget from
a de-authenticated one, so they passed either way.

**Depends on:** nothing.
**Risk:** none in prod — the SDK and the API were always fine. This was a
harness defect.

## The LNA diagnosis was wrong

Measured on 2026-09-08 with Playwright 1.63.0's bundled Chromium
(**153.0.8010.12**, far past the Chrome 140 cutoff the original note cited),
using a synthetic two-origin page so nothing app-specific was involved — a page
on `:5199` fetching `:5198` with correct CORS headers:

```
bundled Chromium, default      : OK   ← the configuration playwright.config.ts uses
bundled Chromium, LNA forced on: OK   ← --enable-features=LocalNetworkAccessChecks
bundled Chromium, LNA off flag : OK
real Chrome, default           : OK
real Chrome, LNA off flag      : OK
```

Loopback → loopback is not gated even with the feature explicitly forced on,
which matches the spec: LNA gates a request whose *initiator* sits in a
less-private address space than its target. A page on `http://localhost:5173`
is itself in the loopback address space, so `→ localhost:3000` is not a
cross-address-space request at all.

Loading the real demo page agreed. Vite's HMR WebSocket — reported in the
original note as blocked by LNA — connects normally:

```
console> [vite] connecting...
console> [vite] connected.
failed>  http://localhost:3000/api/embed/auth/config :: net::ERR_CONNECTION_REFUSED
pill: "legacy (config unavailable)"
```

The banner text is identical to what the original investigation saw, but here
the cause is simply that `:3000` was not running. That is the trap: the demo
pill and `AuthSession` collapse *every* failure — dead server, origin missing
from `EMBED_ALLOWED_ORIGINS`, CORS rejection, browser policy block — into the
same `legacy` fallback, so the symptom cannot identify its own cause. The
proxy hypothesis (a proxy makes Chromium classify address spaces as `unknown`,
which *would* gate loopback requests and *would* also block the Vite socket)
was checked and ruled out: `ProxyEnable=0`, no `AutoConfigURL`, and no
`HTTP_PROXY`/`HTTPS_PROXY` at shell, user or machine scope.

Whatever the original run hit, it was environmental and is not reproducible.
Had the flag been added, it would have "fixed" nothing and permanently weakened
the harness against a real class of browser-policy bug.

## What was actually wrong

Four defects, all of which let a run look green while proving nothing:

1. **`user-menu.spec.ts` was vacuous by construction.** Its whole body was
   `expect(page.locator("next-user-menu")).toBeAttached()`, which
   `customElements.define` satisfies before any auth or data happens. It passed
   with the API down, in any mode, and on a public token.
2. **`login-hardened.spec.ts` asked the wrong source whether to skip.** It read
   `process.env.EMBED_AUTH_MODE` from the shell, but the mode is a *server*,
   *per-origin* decision (`resolveAuthMode`, where `EMBED_AUTH_MODE_ORIGINS`
   overrides the deployment-wide value). Following this repo's own documented
   recipe — set only `EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual` —
   made the spec skip itself while the server was correctly in `dual`.
3. **`.env.local` never reached the Playwright process.** `next dev` loads it;
   Playwright does not, and `playwright.config.ts` loaded no dotenv. So
   `PLAYWRIGHT_MP_USERNAME` / `PLAYWRIGHT_MP_PASSWORD` — documented in CLAUDE.md
   and in the spec's own preconditions as living in `.env.local` — were always
   undefined, and `login-hardened.spec.ts` skipped on `HAS_CREDS` on **every**
   run regardless of mode. The documented setup could never have worked.
4. **`playwright.config.ts` started Vite twice.** `webServer[0]` ran `pnpm dev`,
   which is `concurrently "next dev" "pnpm --filter @mpnext/embed-sdk demo"` and
   therefore already started the demo that `webServer[1]` starts again. Under
   CI's `reuseExistingServer: false` the duplicate finds `:5173` taken and moves
   to `:5174` while the `url` check passes against the first.

## What was done

- **`e2e/widget/fixtures.ts`** (new): worker-scoped `embedConfig` fixture that
  resolves the auth mode once per worker and fails the run when the answer is
  anything but a real mode. The probe runs **inside the browser, from the demo
  origin** — a Node-side fetch would skip CORS and browser network policy, i.e.
  exactly the failures worth catching, and would report success while every
  widget on the page was starved of a token. It captures `net::ERR_*` from
  `requestfailed`, because the in-page fetch sees only an opaque "Failed to
  fetch" for a refused connection, a CORS rejection and a policy block alike —
  not distinguishing those is what sent this file's first draft after the wrong
  cause. `skipUnlessMode()` replaces shell-variable guards.
- **`EMBED_EXPECTED_AUTH_MODE`** (optional): pin the expected mode so a
  misconfigured server fails loudly instead of quietly running the legacy subset.
- **`user-menu.spec.ts`**: now asserts a server-minted JWT obtained through the
  SDK's own `AuthSession.getToken()` — checking `origin`, `wid`, `sub`, `iss`,
  `aud` and a future `exp`, since a public token is also a real signed JWT and
  only the claims distinguish a working ladder from a fallback — plus the pill
  matching the server's mode and the signed-out control belonging to that mode.
  A second test asserts no `mpp-widgets_*` key is written outside `legacy`.
- **`login-hardened.spec.ts`**: guards on `embedConfig.mode` instead of the
  shell; its redundant banner block is now a pill-vs-server agreement check.
- **`playwright.config.ts`**: loads `.env.local` via `dotenv` (already a direct
  dependency; it does not override real environment variables, so a shell export
  still wins), and `webServer[0]` is `pnpm dev:next`.

## Verification performed

- **Fail-loud proved:** with `:3000` down, the suite fails with
  `embedConfig: http://localhost:5173 could not read .../auth/config -- Failed to
  fetch` and `transport: net::ERR_CONNECTION_REFUSED`. The old
  `user-menu.spec.ts` **passed** in this exact state; that is the regression this
  item exists to prevent.
- **Pass path, `legacy`:** 1 passed, 2 correctly skipped on the server-resolved
  mode.
- **Pass path, `dual`** (`EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual`):
  both `user-menu` tests pass, exercising the `.nw-login-btn` branch, the
  `pill == dual` assertion and the token-claim assertions.
- **Mode pin proved:** `EMBED_EXPECTED_AUTH_MODE=hardened` against a `dual`
  server fails with the per-origin remediation spelled out.
- `pnpm lint`, `tsc --noEmit` and the full Vitest suite are green.

## What running `login-hardened.spec.ts` revealed (2026-09-08)

It was run against the live tenant, and it **fails — on tenant configuration,
not on code.** MP rejects the authorize request:

```
Provided redirect URI is not registered for the client.
client_id=TM.Widgets
redirect_uri=http://localhost:3000/api/embed/auth/callback
```

This is the precondition CLAUDE.md and the spec header both state, and it has
evidently never been satisfied for local dev. Nobody could have known: before
defect 3 above was fixed, the spec skipped on missing creds on every run, so it
never reached MP. **To finish the sign-in path, register
`http://localhost:3000/api/embed/auth/callback` as a redirect URI on the
`TM.Widgets` OAuth client** (`EMBED_PUBLIC_URL` overrides the host half when set
— `getPublicUrl`, `src/app/api/embed/auth/_lib/auth-route-helpers.ts`). That is
an MP admin change and is deliberately left undone here.

The first run reported this as a blank 30s timeout waiting for a username field
— the same "symptom cannot identify its own cause" trap this whole item is
about. `completeMpLogin()` now races the login form against MP's error page and
reports MP's own message, the full authorize URL and the Request Id, in under a
second. MP's error page is Angular-bound, so it waits for the populated
`Request Id` before reading; waiting only for `{{…}}` to disappear races the
binding to a briefly-empty render and captures nothing.

Re-run after registering the URI:

```bash
EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual pnpm dev:next   # one shell
EMBED_EXPECTED_AUTH_MODE=dual pnpm test:e2e:widget                 # another
```
