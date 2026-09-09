import type { Page } from "@playwright/test";
import { test, expect, skipUnlessMode } from "./fixtures";

/**
 * Baseline widget health check.
 *
 * This spec used to assert only that `<next-user-menu>` was attached, which
 * `customElements.define` satisfies before any auth or data happens -- it
 * passed with the API down, with the origin missing from
 * EMBED_ALLOWED_ORIGINS, and with the SDK fallen back to a public token. The
 * assertions below instead require evidence that the cross-origin token ladder
 * actually completed: a server-minted JWT bound to this demo origin, plus the
 * signed-out control that belongs to the mode the server really resolved.
 */

/** Decoded widget-JWT payload (see `WidgetClaims` in src/lib/embed/types.ts). */
interface TokenClaims {
  sub?: unknown;
  wid?: unknown;
  ver?: unknown;
  origin?: unknown;
  exp?: unknown;
  iss?: unknown;
  aud?: unknown;
}

/**
 * Mint a token through the SDK's own `AuthSession` and return its decoded
 * payload. Going through the SDK (rather than calling `/api/embed/session`
 * from Node) is what makes this meaningful: it exercises config discovery,
 * the credential ladder and CORS exactly as a host page does.
 */
async function mintTokenClaims(page: Page, wid: string): Promise<TokenClaims> {
  return page.evaluate(async (widget) => {
    const embed = (
      window as unknown as {
        MPNextEmbed?: { getAuthSession?: () => { getToken(wid: string): Promise<string> } };
      }
    ).MPNextEmbed;
    const session = embed?.getAuthSession?.();
    if (!session) throw new Error("window.MPNextEmbed.getAuthSession() is unavailable");

    const token = await session.getToken(widget);
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error(`not a JWS: ${parts.length} segments`);

    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  }, wid);
}

test.describe("User Menu Widget", () => {
  test("mints a real widget token and renders the resolved mode's signed-out control", async ({
    page,
    embedConfig,
  }) => {
    await page.goto("/demo-user-menu.html");

    const menu = page.locator("next-user-menu");
    await expect(menu).toBeAttached({ timeout: 10_000 });

    // 1. The demo page agrees with the server about the mode. This is the
    //    assertion that fails loudly instead of degrading: "legacy (config
    //    unavailable)" can no longer masquerade as a passing legacy run.
    await expect(page.locator("#auth-mode-pill")).toHaveText(embedConfig.mode, {
      timeout: 15_000,
    });

    // 2. A token actually minted, and it is this origin's. A public token is a
    //    real server-signed JWT, so asserting the claims -- not merely that a
    //    string came back -- is what distinguishes a working ladder from a
    //    fallback that produced nothing.
    const claims = await mintTokenClaims(page, "user-menu");
    expect(claims.origin).toBe(embedConfig.origin);
    expect(claims.wid).toBe("user-menu");
    expect(typeof claims.sub).toBe("string");
    expect(claims.iss).toBeTruthy();
    expect(claims.aud).toBeTruthy();
    expect(typeof claims.exp).toBe("number");
    // 5-minute expiry; assert it is genuinely in the future rather than a
    // replayed or clock-skewed artifact.
    expect(claims.exp as number).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // 3. The signed-out control that belongs to the resolved mode. In `legacy`
    //    the widget defers to MP's own <mpp-user-login>; in dual/hardened it
    //    renders its own Sign In inside the shadow root.
    if (embedConfig.mode === "legacy") {
      await expect(menu.locator("mpp-user-login")).toBeAttached({ timeout: 15_000 });
    } else {
      await expect(menu.locator(".nw-login-btn")).toBeVisible({ timeout: 15_000 });
    }
  });

  test("does not write MP token material to the host page outside legacy", async ({
    page,
    embedConfig,
  }) => {
    skipUnlessMode(embedConfig, ["dual", "hardened"]);

    await page.goto("/demo-user-menu.html");
    await expect(page.locator("next-user-menu")).toBeAttached({ timeout: 10_000 });
    await mintTokenClaims(page, "user-menu");

    const leaked = await page.evaluate(() => {
      try {
        return Object.keys(localStorage).filter((k) => k.startsWith("mpp-widgets_"));
      } catch {
        return [];
      }
    });
    expect(leaked).toEqual([]);
  });
});
