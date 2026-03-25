import { test, expect } from "@playwright/test";

test.describe("User Menu Widget", () => {
  test("demo page loads and widget element is present", async ({ page }) => {
    await page.goto("/demo-user-menu.html");
    await expect(page.locator("next-user-menu")).toBeAttached({ timeout: 10_000 });
  });
});
