import { test, expect, type Page, type Locator } from "@playwright/test";

/** Matches the widget's isTaxSeason() logic: Dec 15 – Apr 15 */
function isTaxSeason(): boolean {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  return month <= 2 || (month === 3 && day <= 15) || (month === 11 && day >= 15);
}

const taxSeasonTest = isTaxSeason() ? test : test.skip;

// Helper: locate an element inside the next-user-menu shadow root.
// Playwright auto-pierces open shadow roots.
function menu(page: Page, selector: string): Locator {
  return page.locator(`next-user-menu ${selector}`);
}

/**
 * Inject fake MP auth tokens into localStorage and set user-info attributes
 * on the widget element so it renders the authenticated state.
 */
async function simulateAuth(page: Page) {
  await page.evaluate(() => {
    // Auth token triggers authenticated state
    localStorage.setItem("mpp-widgets_AuthToken", "fake-auth-token-for-testing");

    // User info via element attributes (highest priority in getUserInfo)
    const el = document.querySelector("next-user-menu");
    if (el) {
      el.setAttribute("first-name", "Test");
      el.setAttribute("last-name", "User");
      el.setAttribute("email", "test@northwoods.church");
    }
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  // Navigate first so we're on the right origin for localStorage
  await page.goto("/demo-user-menu.html");

  // Inject fake auth tokens
  await simulateAuth(page);

  // The widget polls localStorage every 1s — wait for the avatar to appear
  await expect(menu(page, ".next-avatar-btn")).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Authenticated rendering
// ---------------------------------------------------------------------------
test.describe("Authenticated rendering", () => {
  test("shows avatar button when authenticated", async ({ page }) => {
    await expect(menu(page, ".next-avatar-btn")).toBeVisible();
  });

  test("displays user initials from ID token", async ({ page }) => {
    await expect(menu(page, ".next-avatar-initials")).toHaveText("TU");
  });

  test("dropdown is hidden initially", async ({ page }) => {
    await expect(menu(page, ".next-dropdown")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Dropdown menu
// ---------------------------------------------------------------------------
test.describe("Dropdown menu", () => {
  test("opens dropdown on avatar click", async ({ page }) => {
    await menu(page, ".next-avatar-btn").click();
    await expect(menu(page, ".next-dropdown")).toBeVisible();
  });

  test("shows user name and email in dropdown", async ({ page }) => {
    await menu(page, ".next-avatar-btn").click();
    await expect(menu(page, ".next-dropdown-name")).toHaveText("Test User");
    await expect(menu(page, ".next-dropdown-email")).toHaveText(
      "test@northwoods.church"
    );
  });

  test("shows My Account item", async ({ page }) => {
    await menu(page, ".next-avatar-btn").click();
    await expect(
      menu(page, '[data-action="account"]')
    ).toContainText("My Account");
  });

  taxSeasonTest("shows Contribution Statement item (tax season)", async ({ page }) => {
    await menu(page, ".next-avatar-btn").click();
    await expect(
      menu(page, '[data-action="giving"]')
    ).toContainText("Contribution Statement");
  });

  test("shows Log out item", async ({ page }) => {
    await menu(page, ".next-avatar-btn").click();
    await expect(
      menu(page, '[data-action="logout"]')
    ).toContainText("Log out");
  });

  test("closes dropdown on Escape key", async ({ page }) => {
    await menu(page, ".next-avatar-btn").click();
    await expect(menu(page, ".next-dropdown")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page, ".next-dropdown")).not.toBeVisible();
  });

  test("closes dropdown when clicking outside", async ({ page }) => {
    await menu(page, ".next-avatar-btn").click();
    await expect(menu(page, ".next-dropdown")).toBeVisible();
    // Click on the page body (outside the widget)
    await page.locator("h1").click();
    await expect(menu(page, ".next-dropdown")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Contribution Statement link → modal
// ---------------------------------------------------------------------------
test.describe("Contribution Statement link", () => {
  taxSeasonTest("clicking Contribution Statement opens modal on Giving tab", async ({
    page,
  }) => {
    // Open dropdown
    await menu(page, ".next-avatar-btn").click();
    await expect(menu(page, '[data-action="giving"]')).toBeVisible();

    // Click the Contribution Statement item
    await menu(page, '[data-action="giving"]').click();

    // Modal portal is appended to document.body (light DOM)
    const modal = page.locator("#next-user-menu-portal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Modal title should say "My Account"
    await expect(modal.locator(".next-modal-title")).toHaveText("My Account");

    // Giving tab should be the active tab
    const givingTab = modal.locator('.next-tab[data-tab="giving"]');
    await expect(givingTab).toHaveClass(/active/);
  });

  taxSeasonTest("Giving tab contains contribution statement widget", async ({
    page,
  }) => {
    // Open dropdown → click Contribution Statement
    await menu(page, ".next-avatar-btn").click();
    await menu(page, '[data-action="giving"]').click();

    const modal = page.locator("#next-user-menu-portal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // The giving panel should contain the MP contribution statement custom element
    const givingPanel = modal.locator('[data-panel="giving"]');
    await expect(givingPanel).toBeVisible();
    await expect(
      givingPanel.locator("mpp-my-contribution-statement")
    ).toBeAttached();
  });

  taxSeasonTest("contribution statement appears first during tax season", async ({
    page,
  }) => {
    // Open dropdown → click Contribution Statement
    await menu(page, ".next-avatar-btn").click();
    await menu(page, '[data-action="giving"]').click();

    const modal = page.locator("#next-user-menu-portal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // During tax season (Jan-Feb), contribution statement should be the first child
    const givingPanel = modal.locator('[data-panel="giving"]');
    const firstChild = givingPanel.locator(":first-child");
    await expect(firstChild).toHaveAttribute(
      "is",
      /.*/,
      { timeout: 1 }
    ).catch(() => {
      // Custom elements don't have "is" attr — check tag name instead
    });

    // Verify the first element in the giving panel is mpp-my-contribution-statement
    const firstTagName = await givingPanel.evaluate((el) => {
      return el.firstElementChild?.tagName.toLowerCase() ?? "";
    });
    expect(firstTagName).toBe("mpp-my-contribution-statement");
  });

  taxSeasonTest("emits accountModalOpen event with giving tab", async ({ page }) => {
    // Listen for the custom event before clicking
    const eventPromise = page.evaluate(() => {
      return new Promise<{ tab: string }>((resolve) => {
        const el = document.querySelector("next-user-menu")!;
        el.addEventListener(
          "accountModalOpen",
          (e: Event) => {
            resolve((e as CustomEvent).detail);
          },
          { once: true }
        );
      });
    });

    // Open dropdown → click Contribution Statement
    await menu(page, ".next-avatar-btn").click();
    await menu(page, '[data-action="giving"]').click();

    const detail = await eventPromise;
    expect(detail.tab).toBe("giving");
  });

  taxSeasonTest("modal closes with Escape key", async ({ page }) => {
    // Open dropdown → click Contribution Statement
    await menu(page, ".next-avatar-btn").click();
    await menu(page, '[data-action="giving"]').click();

    const modal = page.locator("#next-user-menu-portal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Press Escape to close modal
    await page.keyboard.press("Escape");
    await expect(modal).not.toBeVisible();
  });

  taxSeasonTest("modal closes when clicking backdrop", async ({ page }) => {
    // Open dropdown → click Contribution Statement
    await menu(page, ".next-avatar-btn").click();
    await menu(page, '[data-action="giving"]').click();

    const modal = page.locator("#next-user-menu-portal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click the backdrop area (top-left corner, outside the centered modal container)
    await page.mouse.click(5, 5);
    await expect(modal).not.toBeVisible();
  });

  taxSeasonTest("modal closes with close button", async ({ page }) => {
    // Open dropdown → click Contribution Statement
    await menu(page, ".next-avatar-btn").click();
    await menu(page, '[data-action="giving"]').click();

    const modal = page.locator("#next-user-menu-portal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click the X button
    await modal.locator('[data-action="close-modal"]').click();
    await expect(modal).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// My Account → Giving tab navigation
// ---------------------------------------------------------------------------
test.describe("My Account → Giving tab", () => {
  test("My Account opens modal on Profile tab, can switch to Giving", async ({
    page,
  }) => {
    // Open dropdown → click My Account
    await menu(page, ".next-avatar-btn").click();
    await menu(page, '[data-action="account"]').click();

    const modal = page.locator("#next-user-menu-portal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Should start on Profile tab
    const profileTab = modal.locator('.next-tab[data-tab="profile"]');
    await expect(profileTab).toHaveClass(/active/);

    // Click Giving tab
    const givingTab = modal.locator('.next-tab[data-tab="giving"]');
    await givingTab.click();
    await expect(givingTab).toHaveClass(/active/);

    // Giving panel should now be visible with contribution statement
    const givingPanel = modal.locator('[data-panel="giving"]');
    await expect(givingPanel).toBeVisible();
    await expect(
      givingPanel.locator("mpp-my-contribution-statement")
    ).toBeAttached();
  });

  taxSeasonTest("Giving tab also contains my-giving and my-pledges widgets", async ({
    page,
  }) => {
    // Open dropdown → Contribution Statement (opens giving tab directly)
    await menu(page, ".next-avatar-btn").click();
    await menu(page, '[data-action="giving"]').click();

    const modal = page.locator("#next-user-menu-portal");
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const givingPanel = modal.locator('[data-panel="giving"]');
    await expect(givingPanel.locator("mpp-my-giving")).toBeAttached();
    await expect(givingPanel.locator("mpp-my-pledges")).toBeAttached();
  });
});
