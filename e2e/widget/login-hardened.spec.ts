import type { Page } from "@playwright/test";
import { test, expect, skipUnlessMode } from "./fixtures";

/**
 * End-to-end widget sign-in through the hardened flow:
 *
 *   demo page  →  <next-user-menu> Sign In (.nw-login-btn)
 *              →  GET /api/embed/auth/login   (widget host, sets state cookie)
 *              →  MP /oauth/connect/authorize  (username + password form)
 *              →  GET /api/embed/auth/callback (server session + handoff code)
 *              →  demo page #nextwidgets_auth=<code>    (SDK exchanges it for a sid)
 *              →  avatar rendered (.nw-avatar-btn)
 *              →  Log out from the dropdown    → nextwidgets_sid cleared
 *
 * Preconditions (the spec skips itself otherwise):
 *   - PLAYWRIGHT_MP_USERNAME / PLAYWRIGHT_MP_PASSWORD: a non-admin MP user with
 *     MFA disabled (see .env.example).
 *   - The server must resolve dual or hardened for the demo origin, i.e. either
 *     EMBED_AUTH_MODE=dual|hardened or
 *     EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual, in the environment
 *     the Next dev server reads. The `embedConfig` fixture asks the server
 *     which mode it resolved, so setting only the per-origin override is
 *     enough -- nothing needs to be exported into the Playwright shell. In
 *     legacy mode the widget renders <mpp-user-login> instead and there is
 *     nothing to drive, so this spec skips.
 *   - http://localhost:3000/api/embed/auth/callback registered as a redirect
 *     URI on the MP OAuth client used by OIDC_CLIENT_ID.
 *
 * This spec talks to a real Ministry Platform tenant and is NOT run in CI.
 */

const USERNAME = process.env.PLAYWRIGHT_MP_USERNAME;
const PASSWORD = process.env.PLAYWRIGHT_MP_PASSWORD;

const HAS_CREDS = Boolean(USERNAME && PASSWORD);

/** localStorage key the SDK uses for the opaque session id (auth-session.ts SID_KEY). */
const SID_KEY = "nextwidgets_sid";

/** Read the sid from either storage — the demo page uses the default (localStorage). */
async function readSid(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    try {
      return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }, SID_KEY);
}

/**
 * Fill MP's hosted login form. MP's markup is not under our control, so try
 * the most specific selectors first and fall back to generic ones.
 */
async function completeMpLogin(page: Page, username: string, password: string): Promise<void> {
  // We should have left the demo origin for the MP host (via the widget host).
  await expect
    .poll(() => new URL(page.url()).origin, { timeout: 30_000 })
    .not.toBe("http://localhost:5173");

  const userField = page
    .locator(
      [
        'input[name="Username"]',
        'input[name="username"]',
        'input#Username',
        'input#username',
        'input[autocomplete="username"]',
        'input[type="email"]',
        'input[type="text"]',
      ].join(", "),
    )
    .first();

  // MP answers a rejected authorize request with its own error page rather than
  // a login form -- "Provided redirect URI is not registered for the client."
  // is the usual one. Waiting only for the username field turns that into a
  // blank 30s timeout that says nothing about the cause, so race the two and
  // report whatever MP actually said.
  const mpError = page.locator('h1:has-text("Error")').first();
  const outcome = await Promise.race([
    userField
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "form" as const)
      .catch(() => "timeout" as const),
    mpError
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "error" as const)
      .catch(() => "timeout" as const),
  ]);

  if (outcome === "error") {
    // MP's error page is Angular-bound: the heading renders before the message
    // does, so a read taken the moment it appears captures the literal
    // `{{model.errorMessage}}`. Give the binding a moment to resolve, and drop
    // any placeholder that is still unbound rather than reporting braces.
    // The populated "Request Id" is the marker that binding finished; waiting
    // only for the braces to disappear races Angular to a briefly-empty render
    // and captures nothing.
    await page
      .waitForFunction(
        () => {
          const text = document.body.innerText || "";
          return !text.includes("{{") && /Request Id:\s*\S+/i.test(text);
        },
        null,
        { timeout: 5_000 },
      )
      .catch(() => {
        /* best effort; the filter below keeps the message readable regardless */
      });

    const detail = (await page.locator("body").innerText().catch(() => ""))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.includes("{{"))
      .join(" | ");
    throw new Error(
      [
        `MinistryPlatform rejected the authorize request at ${page.url()}`,
        `  MP said: ${detail}`,
        "",
        "This is tenant OAuth-client configuration, not a defect in this repo.",
        "Register the widget host's callback as a redirect URI on the MP OAuth",
        "client named by OIDC_CLIENT_ID -- for local dev that is exactly:",
        "  http://localhost:3000/api/embed/auth/callback",
        "(EMBED_PUBLIC_URL overrides the host half when set; see getPublicUrl in",
        "src/app/api/embed/auth/_lib/auth-route-helpers.ts).",
      ].join("\n"),
    );
  }

  await userField.waitFor({ state: "visible", timeout: 30_000 });
  await userField.fill(username);

  const passField = page
    .locator(
      [
        'input[name="Password"]',
        'input[name="password"]',
        'input#Password',
        'input#password',
        'input[autocomplete="current-password"]',
        'input[type="password"]',
      ].join(", "),
    )
    .first();
  await passField.waitFor({ state: "visible", timeout: 10_000 });
  await passField.fill(password);

  const submit = page
    .locator(
      [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Log in")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button:has-text("Sign In")',
      ].join(", "),
    )
    .first();
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  } else {
    // Some MP themes submit on Enter only.
    await passField.press("Enter");
  }
}

test.describe("User Menu Widget - hardened sign-in", () => {
  test.skip(
    !HAS_CREDS,
    "PLAYWRIGHT_MP_USERNAME / PLAYWRIGHT_MP_PASSWORD not set (MFA-disabled MP test account required)",
  );
  // A full OAuth round trip against a live tenant is slow; be generous.
  test.setTimeout(120_000);

  test("Sign In → MP login → returns with a sid and avatar → Log out clears the sid", async ({
    page,
    embedConfig,
  }) => {
    // The mode is a server, per-origin decision, so ask the server rather than
    // the shell. `embedConfig` has already failed the run if the config
    // endpoint was unreachable, so reaching here in `legacy` means the server
    // really is in legacy -- not that the SDK silently fell back to it.
    skipUnlessMode(embedConfig, ["dual", "hardened"]);

    // Start signed out regardless of what an earlier run left behind.
    await page.goto("/demo-user-menu.html");
    await page.evaluate(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* storage blocked */
      }
    });
    await page.reload();

    const menu = page.locator("next-user-menu");
    await expect(menu).toBeAttached({ timeout: 10_000 });

    // The page must have resolved the same mode the fixture confirmed with the
    // server. A mismatch here is a page-side config-fetch failure (the pill
    // falls back to "legacy (config unavailable)"), which would otherwise show
    // up as .nw-login-btn simply never appearing.
    await expect(page.locator("#auth-mode-pill")).toHaveText(embedConfig.mode, {
      timeout: 15_000,
    });

    // 1. Sign In button inside the widget's shadow root. Playwright locators
    //    pierce open shadow DOM, so a plain CSS selector reaches it.
    const signIn = menu.locator(".nw-login-btn");
    await expect(signIn).toBeVisible({ timeout: 15_000 });
    await signIn.click();

    // 2. MP hosted login form (username + password; MFA disabled on this account).
    await completeMpLogin(page, USERNAME!, PASSWORD!);

    // 3. Back on the demo page. The callback lands us on
    //    /demo-user-menu.html#nextwidgets_auth=<code>; the SDK strips the fragment as it
    //    exchanges the code, so wait for the origin rather than the exact URL.
    await page.waitForURL((url) => url.origin === "http://localhost:5173", { timeout: 60_000 });
    await expect(page).toHaveURL(/\/demo-user-menu\.html/);

    // 4. The handoff was exchanged for a sid ...
    await expect.poll(() => readSid(page), { timeout: 30_000 }).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    // ... and the one-time code no longer sits in the URL.
    expect(page.url()).not.toContain("nextwidgets_auth=");
    expect(page.url()).not.toContain("nextwidgets_auth_error=");

    // 5. Authenticated render: avatar button replaces Sign In.
    const avatar = menu.locator(".nw-avatar-btn");
    await expect(avatar).toBeVisible({ timeout: 30_000 });
    await expect(menu.locator(".nw-login-btn")).toHaveCount(0);

    // In dual/hardened the SDK must never write MP tokens to the host page.
    const legacyToken = await page.evaluate(() => {
      try {
        return localStorage.getItem("mpp-widgets_AuthToken");
      } catch {
        return null;
      }
    });
    expect(legacyToken).toBeNull();

    // 6. Log out via the dropdown. The widget calls /api/embed/auth/logout,
    //    clears the sid, emits `userLogout` and (unless prevented) navigates to
    //    MP's end-session URL, which sends us back to post-logout-redirect-uri
    //    (defaults to this page). Cancel the navigation so the assertion below
    //    does not depend on the MP client's post-logout URI registration.
    await page.evaluate(() => {
      document.querySelector("next-user-menu")?.addEventListener(
        "userLogout",
        (e) => e.preventDefault(),
        { once: true },
      );
    });
    await avatar.click();
    const logoutItem = menu.locator('.nw-dropdown-item[data-action="logout"]');
    await expect(logoutItem).toBeVisible({ timeout: 10_000 });
    await logoutItem.click();

    // 7. sid gone and the widget is back to its signed-out state.
    await expect.poll(() => readSid(page), { timeout: 30_000 }).toBeNull();
    await expect(menu.locator(".nw-login-btn")).toBeVisible({ timeout: 15_000 });
    await expect(menu.locator(".nw-avatar-btn")).toHaveCount(0);

    // A revoked sid must not mint a user token any more: reload and confirm the
    // widget stays signed out (the server answers 401 invalid_session, the SDK
    // clears the sid and falls back to a public token).
    await page.reload();
    await expect(page.locator("next-user-menu .nw-login-btn")).toBeVisible({ timeout: 15_000 });
    expect(await readSid(page)).toBeNull();
  });
});
