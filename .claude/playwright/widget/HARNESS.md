# Widget comparison run — test harness

Read `BRIEF.md` first. This file tells you how to drive both sites with Playwright
without re-solving login, shadow DOM, or render-timing. Everything below was
executed on 2026-09-08; the run output is pasted verbatim at the bottom.

**TL;DR**

```bash
cd S:/MP/MPNext-Components
node .claude/playwright/widget/scripts/smoke.mjs      # sanity-check the harness
```

- Helpers: `.claude/playwright/widget/scripts/harness.mjs`
- Worked example: `.claude/playwright/widget/scripts/smoke.mjs`
- Storage state (scratchpad only, never the repo):
  `…/scratchpad/state-new.json`, `…/scratchpad/state-old.json`
- Gateway verdict: [see below](#payment-gateway-verdict) — no real card gateway exists
  in either system; `next-pay` is a labelled sandbox, old `giving.aspx` has no payment
  widget at all.

---

## 1. Using `harness.mjs`

Put your script anywhere — the scratchpad is fine — but import **only** from
`harness.mjs`. Two Windows/ESM traps, both already paid for:

- A bare `import { chromium } from "playwright"` **fails** from a scratchpad script
  (`ERR_MODULE_NOT_FOUND`): bare specifiers resolve from the *importing file's*
  directory, and the scratchpad is outside the repo. `harness.mjs` lives in the repo
  and re-exports `chromium`, `firefox`, `webkit`, `devices`, so import those from it.
- A Windows absolute path is not a legal ESM specifier. Use a `file:///` URL:
  `import … from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs"`.
  (A script that lives next to `harness.mjs` can just use `"./harness.mjs"`.)

`harness.mjs` also loads `.env.local` for you.

### Copy-pasteable example

```js
// C:\Users\ckeha\AppData\Local\Temp\claude\S--MP-MPNext-Components\<session>\scratchpad\my-pledges.mjs
import {
  launch, shot, shotMobile, newDemoUrl, oldPageUrl,
  waitForWidget, shadowText, listShadowHosts, assertAuthenticated,
} from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

// ── NEW, signed in ────────────────────────────────────────────────
{
  const h = await launch({ site: "new", authed: true });   // reuses state-new.json,
                                                           // re-logs in if stale
  await h.page.goto(newDemoUrl("my-pledges"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "new");                // cheap; do it after every goto
  const text = await waitForWidget(h.page, "next-my-pledges", {
    apiPattern: /\/api\/embed\/pledges/,                   // the widget's own call
  });
  console.log(text.slice(0, 300));

  // filters / clicks: Playwright's CSS engine pierces open shadow roots
  await h.page.locator("next-my-pledges button", { hasText: "Cancel" }).first().click();

  await shot(h.page, "my-pledges-new-initial");
  await shotMobile(h.page, "my-pledges-new-mobile");       // 390x844, then restores
  console.log("api failures:", h.log.apiFailures());
  console.log("console errors:", h.log.consoleErrors().map(c => c.text));
  await h.close();
}

// ── OLD, signed in ────────────────────────────────────────────────
{
  const h = await launch({ site: "old", authed: true });   // reuses state-old.json
  await h.page.goto(oldPageUrl("my-pledges"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "old");
  console.log(await listShadowHosts(h.page));              // discover the real mpp-* tag
  console.log(await waitForWidget(h.page, "mpp-my-pledges"));
  await shot(h.page, "my-pledges-old-initial");
  await h.close();
}
```

Run with `cd S:/MP/MPNext-Components && node <path>.mjs`.

### API surface

| Export | What it does |
|---|---|
| `launch({ site, authed, viewport, headless, verify, extraContextOptions })` | `{ browser, ctx, page, log, site, close }`. `site: "new" \| "old"`. `authed: true` loads the saved storage state, **verifies** it, and re-runs the interactive MP login (re-saving the state) if it went stale. `verify: false` skips the probe load. |
| `log` | Live-collected: `console[]`, `errors[]` (pageerror), `failed[]` (requestfailed), `responses[]`, `api[]` (only `/api/embed/*`), `sessionPosts[]` (`{wid, hasMpUserToken, hasSid, status}` — presence flags, never token text), plus `consoleErrors()`, `apiFailures()`, `reset()`. |
| `loginNew(page, { from })` | Interactive MP login on the new demos. `from` defaults to `user-menu`; **all 25 demo pages carry `<script id="MPWidgets">` and `<next-user-menu>`**, so you can sign in in place on the page under test. |
| `loginOld(page)` | Interactive MP login on the old site (via `my_household.aspx`). |
| `assertAuthenticated(page, site)` | Throws with a specific message if the session degraded to public/anonymous. See §3. |
| `waitForWidget(page, tag, { minChars, settle, timeout, apiPattern })` | Waits for the element to be defined + shadow root populated + text **settled**, optionally also for a matching response. Returns the settled shadow text. |
| `shadowText(page, tag)` | Whitespace-collapsed shadow-root text. |
| `listShadowHosts(page)` | Every shadow host on the page (recursing into shadow roots) with a text preview. Use it to learn an unfamiliar page's real element names. |
| `deep(page, ...selectors)` | Joined locator for nested shadow roots. Usually unnecessary — see §4. |
| `shot(page, name)` / `shotMobile(page, name)` | PNG into `.claude/playwright/widget/screenshots/`, name normalised to lowercase kebab. |
| `newDemoUrl(w)` / `oldPageUrl(p)` / `OLD_PAGES` | URL helpers. `newDemoUrl` accepts `"event-finder"`, `"next-event-finder"` or `"demo-event-finder.html"`. `oldPageUrl` accepts the kebab alias in `OLD_PAGES` or a raw `*.aspx`. |
| `saveState(ctx, site)` / `storedTokenExpiry(site)` / `STATE_FILES` | Storage-state plumbing. |
| `safeUrl(u)` | Redacts credential-looking query/fragment values before logging. |
| `SHOTS`, `SCRATCH`, `NEW_ORIGIN`, `OLD_ORIGIN`, `API_HOST`, `REPO` | Constants. |
| `chromium`, `firefox`, `webkit`, `devices` | Re-exported from `playwright` so scratchpad scripts resolve them. |

---

## 2. The auth flow, and the storage-state files

The resolved auth mode for `http://localhost:5173` is **`legacy`**
(`GET http://localhost:3000/api/embed/auth/config` → `{"mode":"legacy",…}`), so both
sites sign in through the *same* MP element and the *same* MP Identity Server page:

1. `<next-user-menu>` appends `<mpp-user-login>`; MPWidgets.js fetches
   `/widgets/dist/UserLogin.js` and upgrades it. (`watchMpLoginRegistration()` in
   `packages/embed-sdk/src/components/user-menu.ts` re-inserts the tag every 300 ms for
   6 s because MPWidgets.js only loads bundles for tags present during its own
   `DOMContentLoaded` scan. Allow that time — the harness waits up to 30 s.)
2. Clicking its shadow-DOM `#loginButton` is a **top-level navigation** to
   `https://mpi.ministryplatform.com/ministryplatformapi/oauth/login?signin=…`.
3. That page defaults to the username/password flow: `#username`, `#password`, submit
   `#loginButton`. (If MP ever defaults to the one-time-code flow instead, click
   `#loginFlowToggleButton` first — the harness handles both.) There is also a locale
   `<select>` at the top; leave it on English.
4. MP returns to `…?cacheKey=<guid>`, then strips it. MPWidgets.js writes
   `mpp-widgets_AuthToken`, `mpp-widgets_IdToken`, `mpp-widgets_ExpiresAfter` to
   `localStorage`.
5. `AuthSession` sends that token as `mpUserToken` to `POST /api/embed/session` and
   gets back a **`ver: 1`** JWT whose `sub` is the MP user GUID and which carries
   `mpAccessToken`. Widgets then call `/api/embed/*` with `Bearer <that JWT>`.

### Storage state

| Site | File | Contains |
|---|---|---|
| new | `…/scratchpad/state-new.json` | `localhost:5173` localStorage (`mpp-widgets_*`) + MP SSO cookies |
| old | `…/scratchpad/state-old.json` | `mpi.ministryplatform.com` localStorage + MP SSO cookies |

Full paths are in `STATE_FILES` — **never** copy these into the repo, and never paste
their contents anywhere. Both were verified from a *fresh* browser context
(`smoke.mjs` phases 2 and 3) showing real household data.

**Lifetime.** The MP widget access token expires ~**30 minutes** after login
(`mpp-widgets_ExpiresAfter`, observed 21:53:55 → 22:23:55 local). The widget JWT itself
is 5 minutes and `AuthSession` refreshes it silently. The MP **SSO cookie** lasts much
longer, which is why a re-login usually skips the credential form entirely and takes a
couple of seconds.

**Staleness handling.** `launch({ authed: true })` does it for you: it loads a probe
page, runs `assertAuthenticated`, and on failure throws the context away, runs the
interactive login in a clean context, re-asserts, and re-saves the state file (written
to a temp name then renamed, so a sibling never reads a half-written file). If you
build contexts by hand, call `assertAuthenticated` yourself and fall back to
`loginNew` / `loginOld` + `saveState`. To force a refresh for everyone:

```js
const h = await launch({ site: "new", authed: false });
await loginNew(h.page); await assertAuthenticated(h.page, "new");
await saveState(h.ctx, "new"); await h.close();
```

Both state files were refreshed at the end of the scout run (fresh 30-minute window),
so the first sibling to start should not need an interactive login.

---

## 3. Proving you are *genuinely* signed in

This is the point of TODO 37. `AuthSession` degrades to a **public** token on any
failure, and `POST /api/embed/session` answers **200** for a stale `mpUserToken` — it
just returns `sub: "public"` (`src/app/api/embed/session/route.ts`, step 2: *"Ignoring
invalid/expired mpUserToken; issuing public session"*). A widget then renders a
perfectly plausible empty state. A 200 on `/api/embed/session` proves nothing.

`assertAuthenticated(page, "new")` therefore mints a token through the page's own
`AuthSession`, decodes the JWT payload in-page, and requires:

- `mpp-widgets_AuthToken` present in `localStorage`, and
- `claims.sub !== "public"` (in legacy mode: `{ sub: <MP user GUID>, ver: 1,
  mpAccessToken: … }`).

It logs only `ver`, a masked `sub`, and a boolean — no token material.

> **Do not use `GET /api/embed/auth/me` to check this.** For a `ver: 1` token that route
> answers **200 `{ "authenticated": false }` by design** — in legacy mode identity lives
> on the host page (`src/app/api/embed/auth/me/route.ts`). It is only meaningful in
> `dual`/`hardened`.

`assertAuthenticated(page, "old")` polls `<mpp-user-login>`'s shadow root until
`#userNameContainer` is displayed and `#userDisplayName` reads a real name (it starts
`display:none` reading `"Login"`), then asserts on that.

Both directions are proven:

```
PASS negative-new: [assertAuthenticated new] no mpp-widgets_AuthToken in localStorage — not signed in (run loginNew).
anon shadow text: My Household Authentication required. Please sign in. Try Again
PASS negative-old: [assertAuthenticated old] not signed in (token=false, userNameContainer display=none, name="Login").
```

Also worth asserting in your own tests: `log.sessionPosts` should show
`hasMpUserToken: true` with `status: 200`, and the widget's own call
(e.g. `GET /api/embed/household`) should be 200, not 401.

---

## 4. Piercing shadow DOM

Both systems render into **open** shadow roots.

- **Playwright locators pierce open shadow roots automatically.** So
  `page.locator("next-my-household button")`,
  `page.locator("mpp-household input#firstName")`, and
  `page.getByRole("button", { name: "Edit" })` all work across the boundary, including
  through **nested** roots. This is the selector pattern used throughout the harness —
  e.g. the login click is literally
  `page.locator("next-user-menu mpp-user-login #loginButton")`, which crosses two
  boundaries (`next-user-menu`'s light DOM slot into MP's shadow root).
- **`document.querySelector` inside `page.evaluate` does NOT pierce.** Walk
  `.shadowRoot` explicitly. `shadowText(page, tag)` and `listShadowHosts(page)` do that
  for you; for something custom:

  ```js
  await page.evaluate(() => {
    const sr = document.querySelector("next-my-groups").shadowRoot;
    return [...sr.querySelectorAll(".nw-group-card h3")].map(h => h.textContent.trim());
  });
  ```
- **`>>` / `>>>` are unnecessary** and `:host`/`::part` selectors are not needed for
  read-only inspection.
- **Element names on the old site do not match the page names.** "My Household" is
  `<mpp-household>`, not `<mpp-my-household>`. Run
  `listShadowHosts(page)` on every old page before you write selectors. Example output
  from `my_household.aspx`:

  ```
  [{"tag":"mpp-locale-selector",…},{"tag":"mpp-user-login",…},{"tag":"mpp-household",…}]
  ```

---

## 5. Waiting for a render instead of racing it

`waitUntil: "networkidle"` is **not** sufficient on either site:

- ours: SDK boot → `GET /api/embed/auth/config` → `POST /api/embed/session` → widget
  fetch → re-render. The network goes idle between those steps.
- MP's: MPWidgets.js does an awaited CSRF round-trip before it installs its
  `MutationObserver` and before the widget's own fetch.

Use `waitForWidget(page, tag, …)`. It waits for three things, and the combination is
the only signal that proved reliable on both sites:

1. `customElements.get(tag)` — the element is actually upgraded;
2. a shadow root exists with at least `minChars` of text;
3. that text is **settled** — two identical samples `settle` ms (default 600) apart.

Pass `apiPattern` to additionally require the widget's own call, e.g.
`waitForWidget(page, "next-event-finder", { apiPattern: /\/api\/embed\/events/ })`.
There is no `widgetReady` event on `MPNextWidget` to hook, so settling is the
mechanism.

---

## 6. Payment gateway verdict

**Neither system under test is wired to a live card gateway. `next-checkout` →
`next-pay` is an in-repo *simulated* gateway: safe to submit the published test card,
no money can move. Submitting on the old site is OUT OF BOUNDS — `giving.aspx` has no
payment widget at all; it links out to a third-party Realm site we have no account on.**

Evidence:

- **Old `giving.aspx`** (fetched 2026-09-08, 4,610 bytes) contains no payment widget.
  Its only payment affordance is
  `<mpp-smart-link href="https://testing.realm.dev/givechurch/give/default?authenticated={{isAuthenticated}}&user={{userDisplayName}}&email={{userEmail}}&userLocale={{userLocale}}" target="_blank">Click Here to Give</mpp-smart-link>`
  — an outbound link to Realm's **testing** environment, a different product on a
  different domain. Do not submit anything there: it is not the system under test, we
  have no credentials for it, and the smart-link is the only thing worth comparing
  (does the token substitution work?).
- **New `next-pay`** is a self-declared sandbox:
  `packages/embed-sdk/src/components/pay.ts` defines
  `const TEST_CARD = "4111 1111 1111 1111"`, its doc comment reads *"a clearly-labeled
  SANDBOX payment gateway … (fake) card details"*, and it paints a gold banner
  `Sandbox payment — use test card 4111 1111 1111 1111`. It asks
  `POST /api/embed/pay/response` for a **signed response token** and hands it back to
  the checkout page.
- **No card processor is contacted anywhere in the SDK.** No publishable key
  (`pk_test_*` / `pk_live_*`), no gateway SDK, and — per CLAUDE.md — FullCalendar is the
  only remaining CDN dependency. `next-checkout` requires an explicit
  `payment-processor-url` attribute; `demo-checkout.html` points it at `/demo-pay.html`.
- **But a "payment" writes real MP data.** `POST /api/embed/payment/notify` →
  `src/services/paymentService.ts` inserts a `Payments` row, allocates `Payment_Detail`
  rows, updates `Invoices`, and calls a stored procedure. So: use the smallest amount
  the form allows, record the `Payment_ID` / invoice id in your test log, prefix any
  fixture you create with `ZZTEST-`, and clean up.
- **Caveat.** MP's own gateway configuration could not be read — `dp_Configuration_Settings`
  is *"restricted by your organization's administrator"* for our API user. That does not
  change the verdict: no code path in this repo or on `giving.aspx` reaches a card
  processor, so there is nothing for an MP gateway setting to make live.

---

## 7. Gotchas that will waste your time

1. **Imports.** From the scratchpad: `import … from "file:///S:/…/harness.mjs"` (a bare
   `S:/…` path is `ERR_UNSUPPORTED_ESM_URL_SCHEME`), and never
   `import { chromium } from "playwright"` (`ERR_MODULE_NOT_FOUND`) — take `chromium`
   from `harness.mjs`.
2. **A silent public token looks exactly like "no data".** 30 minutes after login your
   state file is stale, `POST /api/embed/session` still returns 200, and every
   auth-gated widget renders its empty/anonymous state. Call `assertAuthenticated`
   after every navigation, or you will file phantom findings. `/api/embed/auth/me` is
   *not* the check (§3).
3. **Text you see in a shadow root may be hidden.** `<mpp-household>`'s shadow root
   permanently contains the string *"Please login to see your Household details"* even
   when signed in with data on screen, and `<mpp-user-login>` always contains the word
   *"Login"*. Assert on computed style / specific nodes, not on substring presence.
4. **Old element names ≠ old page names** — `mpp-household`, not `mpp-my-household`.
   `listShadowHosts(page)` first, always.
5. **Next.js dev cold compile can 500 the first hit.** On the very first smoke run
   `GET /api/embed/event-finder/config` returned **500**; the identical request returned
   200 on every subsequent run. Re-run once before filing a 5xx, and say in the finding
   whether it reproduced.
6. **Shared dev servers, shared IP, real rate limit.** `POST /api/embed/session` (and
   `login`/`exchange`) are rate-limited to **120 requests per 60-second window per IP**
   (`src/lib/embed/rate-limit.ts`), and all ~8 of us are `127.0.0.1`. Each demo page
   load costs 2–4 session POSTs. If you get `429` with `Retry-After: 60`, wait — do not
   retry in a loop. Don't restart the servers on 3000/5173.
7. **Console noise that is not a finding.** Every anonymous MP page load logs
   `[AUTH] No token available when making AJAX request` and `User not authenticated.`
   plus a bare `404` (MPWidgets.js probing). The old site also emits Google Maps
   deprecation warnings and `net::ERR_ABORTED` on `data.pendo.io`. `attachLogging`
   already suppresses the pendo line; ignore the rest.
8. **`next-user-menu` is on every demo page**, so you can sign in on the page under
   test with `loginNew(page, { from: "<widget>" })` instead of bouncing through
   `demo-user-menu.html`.
9. **The demo pages sit on `localhost:5173` but the API is `localhost:3000`.** A CORS
   or origin problem shows up as a 403 from `/api/embed/session` with
   `Origin … not allowed`; that means someone changed `EMBED_ALLOWED_ORIGINS`, not that
   your script is wrong.
10. **Never write tokens anywhere.** Log `log.sessionPosts` (presence flags) rather
    than request bodies, and pass URLs through `safeUrl()` before printing them.

---

## 8. Verified run output (2026-09-08)

`cd S:/MP/MPNext-Components && node .claude/playwright/widget/scripts/smoke.mjs`
(Google Maps warnings filtered):

```
=== 1. NEW / public: demo-event-finder.html ===
api> 200 GET /api/embed/auth/config
api> 200 POST /api/embed/session
api> 200 GET /api/embed/event-finder/config
api> 200 GET /api/embed/event-finder
console> warning [AUTH] No token available when making AJAX request
console> error User not authenticated.
shadow text: Search Advanced Search Congregation All CongregationsFriends & Internet CampusMain Congregation Ministry All Ministries*Temp MinistryAdult Small GroupsChildrenI
session posts: [{"wid":"user-menu","hasMpUserToken":false,"hasSid":false,"status":200}]
api failures: []
[harness] shot smoke-event-finder-new-public.png
[harness] shot smoke-event-finder-new-public-mobile.png

=== 2. NEW / authed: demo-my-household.html ===
stored token expiry: Tue Sep 08 2026 22:17:02 GMT-0400 (Eastern Daylight Time)
api> 200 GET /api/embed/auth/config
api> 200 POST /api/embed/session
[harness] new: authenticated (ver=1, sub=03a109d5…, mpToken=true)
api> 200 POST /api/embed/session
[harness] new: authenticated (ver=1, sub=03a109d5…, mpToken=true)
api> 200 GET /api/embed/profile/photo?thumbnail=true
api> 200 GET /api/embed/household
shadow text: My Household Kehayias CongregationMain Congregation Primary Address 2720 Bradfordt DriveWest Melbourne, FL 32904-7322 Members + Add Household Member Kehayias, Chris Head of Household Nov 25 Edit Kehayias, Sarah Head of Household Sep 19 Edit
session posts: [{"wid":"harness","hasMpUserToken":true,"hasSid":false,"status":200},{"wid":"my-household","hasMpUserToken":true,"hasSid":false,"status":200},…]
[harness] shot smoke-my-household-new-authed.png

=== 3. OLD / authed: my_household.aspx ===
stored token expiry: Tue Sep 08 2026 22:23:55 GMT-0400 (Eastern Daylight Time)
[harness] old: authenticated as "Chris Kehayias"
shadow hosts: [{"tag":"mpp-locale-selector","text":"中文 Español Portugués English"},{"tag":"mpp-user-login","text":"Login Chris Kehayias Log Out My Profile"},{"tag":"mpp-household","text":"My Household Please login to see your Household details Household Name"}]
shadow text: My Household Please login to see your Household details Kehayias Edit Main Congregation Primary Address: 2720 Bradfordt DriveWest Melbourne, FL 32904-7322 Edit Contact InfoSelect CampusFriends & Internet CampusMain Congregation Select Campu
[harness] shot smoke-my-household-old-authed.png

smoke: OK
```

Screenshots from that run (proof the three shapes work, not baselines for any widget):

- `screenshots/smoke-event-finder-new-public.png`
- `screenshots/smoke-event-finder-new-public-mobile.png`
- `screenshots/smoke-my-household-new-authed.png`
- `screenshots/smoke-my-household-old-authed.png`

No harness defect needed filing; the reserved TODO block **C90–C99** is unused.
