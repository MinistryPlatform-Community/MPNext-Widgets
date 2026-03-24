import { chromium } from "playwright";

// Use a persistent context so login state from prior sessions is kept
const userDataDir = "/tmp/pw-profile";
const browser = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width: 1440, height: 900 },
});

const page = browser.pages()[0] || await browser.newPage();

// ── 1: events page ──
console.log("1/4 — Loading events page...");
await page.goto("https://northwoods.church/events/#/", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: "screenshots/church-events.png", fullPage: true });
console.log("  ✓ screenshots/church-events.png");

// ── 2: pastorapp calendar ──
console.log("2/4 — Loading pastorapp calendar...");
await page.goto("https://northwoods.pastorapp.app/calendar", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: "screenshots/pastorapp-calendar.png", fullPage: true });
console.log("  ✓ screenshots/pastorapp-calendar.png");

// ── 3: Try to click on an event card ──
console.log("3/4 — Looking for clickable event cards...");
try {
  // Look for common event card selectors
  const eventCard = await page.$('[class*="event-card"], [class*="EventCard"], [class*="event-item"], [class*="calendar-event"], .fc-event, [data-event], a[href*="event"]');
  if (eventCard) {
    await eventCard.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "screenshots/pastorapp-event-detail.png", fullPage: true });
    console.log("  ✓ screenshots/pastorapp-event-detail.png");
  } else {
    console.log("  ⚠ No event card found to click. Taking current view.");
    await page.screenshot({ path: "screenshots/pastorapp-event-detail.png", fullPage: true });
  }
} catch (e) {
  console.log("  ⚠ Could not click event:", e.message);
}

// ── 4: Try list view ──
console.log("4/4 — Looking for list view toggle...");
try {
  const listBtn = await page.$('button:has-text("List"), [class*="list-view"], [aria-label*="list"]');
  if (listBtn) {
    await listBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "screenshots/pastorapp-list-view.png", fullPage: true });
    console.log("  ✓ screenshots/pastorapp-list-view.png");
  } else {
    console.log("  ⚠ No list view button found.");
  }
} catch (e) {
  console.log("  ⚠ Could not switch to list view:", e.message);
}

console.log("\n✅ Done! Closing browser in 3s...");
await page.waitForTimeout(3000);
await browser.close();
process.exit(0);
