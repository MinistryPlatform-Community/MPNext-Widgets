import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * MP hosted-login helpers shared by the signed-in widget specs
 * (login-hardened.spec.ts, signed-in-invoice-participants.spec.ts).
 */

/** localStorage key the SDK uses for the opaque session id (auth-session.ts SID_KEY). */
export const SID_KEY = "nextwidgets_sid";

/** Read the sid from either storage — the demo page uses the default (localStorage). */
export async function readSid(page: Page): Promise<string | null> {
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
export async function completeMpLogin(
  page: Page,
  username: string,
  password: string,
  demoOrigin = "http://localhost:5173",
): Promise<void> {
  // We should have left the demo origin for the MP host (via the widget host).
  await expect
    .poll(() => new URL(page.url()).origin, { timeout: 30_000 })
    .not.toBe(demoOrigin);

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
