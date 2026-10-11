import type { Page, Response } from "@playwright/test";
import { test, expect, skipUnlessMode } from "./fixtures";
import { completeMpLogin, readSid } from "./mp-login";

/**
 * Signed-in invoice reads (C80 class; W8 section 2).
 *
 * C80 / C42 / C01: the checkout invoice read and the event-details
 * participants read both 500'd for **every signed-in visitor** (a phantom
 * `@MPLoggedInContactID` procedure parameter), while every anonymous test
 * passed -- nothing exercised those routes with a user token. This spec signs
 * in for real and then reads both:
 *
 *   1. GET /api/embed/invoices                         (list -> a known invoice)
 *   2. demo-checkout.html?id=<Invoice_GUID>             (next-checkout UI)
 *      -> GET /api/embed/checkout/invoice?guid=...      must be 200
 *   3. GET /api/embed/event-details/participants/<guid> must not be 5xx
 *      (404 is a correct answer for an invoice that is not an event
 *      registration; 500 is the C80 regression)
 *
 * Every /api/embed/ response the page sees while signed in is also checked for
 * a 5xx.
 *
 * Prerequisites (the spec skips itself otherwise):
 *   - PLAYWRIGHT_MP_USERNAME / PLAYWRIGHT_MP_PASSWORD in .env.local: a non-admin
 *     MP user with MFA disabled.
 *   - The demo origin resolves `dual` or `hardened`. playwright.config.ts runs
 *     this spec in the `widget-dual` project (:5175, pinned to `dual`), so no
 *     manual mode setup is needed when Playwright starts the servers.
 *   - http://localhost:3000/api/embed/auth/callback registered as a redirect
 *     URI on the MP OAuth client (see login-hardened.spec.ts).
 *   - For the invoice steps: the test account has at least one invoice, or
 *     PLAYWRIGHT_INVOICE_GUID names one it purchased. Otherwise those steps are
 *     skipped with an annotation, not failed.
 *
 * Reads only. It opens the checkout page but never submits a payment, and
 * makes no MP writes. NOT run in CI (live tenant).
 */

const USERNAME = process.env.PLAYWRIGHT_MP_USERNAME;
const PASSWORD = process.env.PLAYWRIGHT_MP_PASSWORD;
const HAS_CREDS = Boolean(USERNAME && PASSWORD);
const INVOICE_GUID_OVERRIDE = (process.env.PLAYWRIGHT_INVOICE_GUID ?? "").trim();

interface ApiResult {
  status: number;
  body: unknown;
  sub: string | null;
}

/** GET an embed route from inside the page with the SDK's own token for `wid`. */
async function apiGet(page: Page, apiHost: string, wid: string, path: string): Promise<ApiResult> {
  await page.waitForFunction(() => Boolean((window as { MPNextEmbed?: unknown }).MPNextEmbed));
  return page.evaluate(
    async ({ apiHost, wid, path }) => {
      const session = (
        window as unknown as {
          MPNextEmbed: { getAuthSession(): { getToken(w: string): Promise<string> } };
        }
      ).MPNextEmbed.getAuthSession();
      const token = await session.getToken(wid);
      let sub: string | null = null;
      try {
        const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        sub = (JSON.parse(atob(payload)) as { sub?: string }).sub ?? null;
      } catch {
        /* not a JWT; reported as sub=null */
      }
      const res = await fetch(`${apiHost}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON body */
      }
      return { status: res.status, body, sub };
    },
    { apiHost, wid, path },
  );
}

test.describe("signed-in invoice and participant reads", () => {
  test.skip(
    !HAS_CREDS,
    "PLAYWRIGHT_MP_USERNAME / PLAYWRIGHT_MP_PASSWORD not set (MFA-disabled MP test account required)",
  );
  test.setTimeout(180_000);

  test("checkout and event-details participants answer a signed-in visitor without a 5xx", async ({
    page,
    embedConfig,
  }, testInfo) => {
    skipUnlessMode(embedConfig, ["dual", "hardened"]);

    const serverErrors: string[] = [];
    page.on("response", (res: Response) => {
      if (res.url().startsWith(`${embedConfig.apiHost}/api/embed/`) && res.status() >= 500) {
        serverErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });

    // ── Sign in (same path as login-hardened.spec.ts) ─────────────────────
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
    await expect(page.locator("#auth-mode-pill")).toHaveText(embedConfig.mode, { timeout: 15_000 });
    const signIn = page.locator("next-user-menu").locator(".nw-login-btn");
    await expect(signIn).toBeVisible({ timeout: 15_000 });
    await signIn.click();
    try {
      await completeMpLogin(page, USERNAME!, PASSWORD!, embedConfig.origin);
    } catch (err) {
      // The MP OAuth client not knowing our callback is a tenant prerequisite,
      // not a finding about invoices: skip with MP's own words. Anything else
      // (a wrong password, a changed login form) still fails.
      const message = err instanceof Error ? err.message : String(err);
      test.skip(
        /redirect URI is not registered/i.test(message),
        `prerequisite missing -- ${message.split("\n").slice(0, 2).join(" ")}`,
      );
      throw err;
    }
    await page.waitForURL((url) => url.origin === embedConfig.origin, { timeout: 60_000 });
    await expect.poll(() => readSid(page), { timeout: 30_000 }).toMatch(/^[A-Za-z0-9_-]{16,}$/);

    // ── 1. A known invoice ────────────────────────────────────────────────
    const list = await apiGet(page, embedConfig.apiHost, "my-invoices", "/api/embed/invoices");
    expect(list.sub, "the invoices read must carry a user token, not a public one").not.toBe("public");
    expect(list.status, `GET /api/embed/invoices -> ${JSON.stringify(list.body)}`).toBe(200);

    const invoices = ((list.body as { invoices?: { Invoice_GUID?: string }[] } | null)?.invoices ?? [])
      .map((i) => i.Invoice_GUID)
      .filter((g): g is string => Boolean(g));
    const guid = INVOICE_GUID_OVERRIDE || invoices[0];
    if (!guid) {
      testInfo.annotations.push({
        type: "skipped-steps",
        description: "test account has no invoices and PLAYWRIGHT_INVOICE_GUID is unset",
      });
      expect(serverErrors, "5xx from an embed route while signed in").toEqual([]);
      return;
    }

    // ── 2. next-checkout with that invoice (C42 / C80) ────────────────────
    const checkoutRead = page.waitForResponse(
      (res) => res.url().startsWith(`${embedConfig.apiHost}/api/embed/checkout/invoice`),
      { timeout: 60_000 },
    );
    await page.goto(`/demo-checkout.html?id=${encodeURIComponent(guid)}`);
    const checkoutRes = await checkoutRead;
    expect(
      checkoutRes.status(),
      `GET ${checkoutRes.url()} for the visitor's own invoice`,
    ).toBe(200);
    // The widget rendered the invoice, not its error state.
    const checkout = page.locator("next-checkout");
    await expect(checkout.locator('[data-action="retry"]')).toHaveCount(0);

    // ── 3. event-details participants for the same invoice (C01 / C80) ────
    const participants = await apiGet(
      page,
      embedConfig.apiHost,
      "event-details",
      `/api/embed/event-details/participants/${encodeURIComponent(guid)}`,
    );
    expect(participants.sub).not.toBe("public");
    expect(
      participants.status,
      `GET participants/${guid} -> ${JSON.stringify(participants.body)}`,
    ).toBeLessThan(500);

    expect(serverErrors, "5xx from an embed route while signed in").toEqual([]);
  });
});
