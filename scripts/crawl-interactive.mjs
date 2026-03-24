import { chromium } from "playwright";
import { writeFileSync } from "fs";

// Launch non-headless — stays open until manually closed
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

const page = await context.newPage();
await page.goto("https://northwoods.pastorapp.app/calendar", { waitUntil: "networkidle", timeout: 60000 });

console.log("Browser is open at pastorapp.app/calendar");
console.log("Please log in. The browser will stay open.");
console.log("");
console.log("When ready, create a file to trigger screenshots:");
console.log("  touch /tmp/pw-screenshot-1   → captures current page");
console.log("  touch /tmp/pw-screenshot-2   → captures again (after clicking event detail etc)");
console.log("  touch /tmp/pw-screenshot-3   → captures again (list view etc)");
console.log("  touch /tmp/pw-done           → closes browser");

// Poll for trigger files
let count = 0;
while (true) {
  await page.waitForTimeout(1000);

  try {
    const { statSync } = await import("fs");

    if (count === 0) {
      try { statSync("/tmp/pw-screenshot-1"); count = 1; } catch {}
    }
    if (count === 1) {
      await page.screenshot({ path: "screenshots/pastorapp-calendar.png", fullPage: true });
      console.log("✓ screenshots/pastorapp-calendar.png");
      count = 1.5; // Wait for next trigger
    }

    if (count === 1.5) {
      try { statSync("/tmp/pw-screenshot-2"); count = 2; } catch {}
    }
    if (count === 2) {
      await page.screenshot({ path: "screenshots/pastorapp-event-detail.png", fullPage: true });
      console.log("✓ screenshots/pastorapp-event-detail.png");
      count = 2.5;
    }

    if (count === 2.5) {
      try { statSync("/tmp/pw-screenshot-3"); count = 3; } catch {}
    }
    if (count === 3) {
      await page.screenshot({ path: "screenshots/pastorapp-list-view.png", fullPage: true });
      console.log("✓ screenshots/pastorapp-list-view.png");
      count = 3.5;
    }

    try { statSync("/tmp/pw-done"); break; } catch {}
  } catch {}
}

console.log("✅ Done! Closing browser.");
await browser.close();
process.exit(0);
