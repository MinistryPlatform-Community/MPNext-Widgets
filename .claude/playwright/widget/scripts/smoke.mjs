/**
 * smoke.mjs — proves harness.mjs works. Run it if anything looks broken:
 *
 *   cd S:/MP/MPNext-Components
 *   node .claude/playwright/widget/scripts/smoke.mjs
 *
 * 1. public NEW demo page   (anonymous context)
 * 2. authed NEW demo page   (storage state, verified, auto-relogin if stale)
 * 3. authed OLD site page   (storage state, verified)
 */

import {
  launch,
  shot,
  shotMobile,
  newDemoUrl,
  oldPageUrl,
  waitForWidget,
  assertAuthenticated,
  listShadowHosts,
  storedTokenExpiry,
} from "./harness.mjs";

// ── 1. public NEW ────────────────────────────────────────────────────
{
  console.log("\n=== 1. NEW / public: demo-event-finder.html ===");
  const h = await launch({ site: "new", authed: false });
  await h.page.goto(newDemoUrl("event-finder"), { waitUntil: "domcontentloaded" });
  const text = await waitForWidget(h.page, "next-event-finder", {
    apiPattern: /\/api\/embed\/events/,
  });
  console.log("shadow text:", text.slice(0, 160));
  console.log("session posts:", JSON.stringify(h.log.sessionPosts));
  console.log("api failures:", JSON.stringify(h.log.apiFailures()));
  await shot(h.page, "smoke-event-finder-new-public");
  await shotMobile(h.page, "smoke-event-finder-new-public-mobile");
  await h.close();
}

// ── 2. authed NEW ────────────────────────────────────────────────────
{
  console.log("\n=== 2. NEW / authed: demo-my-household.html ===");
  console.log("stored token expiry:", storedTokenExpiry("new")?.toString() ?? "unknown");
  const h = await launch({ site: "new", authed: true });
  await h.page.goto(newDemoUrl("my-household"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "new");
  const text = await waitForWidget(h.page, "next-my-household", {
    apiPattern: /\/api\/embed\/household/,
  });
  console.log("shadow text:", text.slice(0, 240));
  console.log("session posts:", JSON.stringify(h.log.sessionPosts));
  await shot(h.page, "smoke-my-household-new-authed");
  await h.close();
}

// ── 3. authed OLD ────────────────────────────────────────────────────
{
  console.log("\n=== 3. OLD / authed: my_household.aspx ===");
  console.log("stored token expiry:", storedTokenExpiry("old")?.toString() ?? "unknown");
  const h = await launch({ site: "old", authed: true });
  await h.page.goto(oldPageUrl("my-household"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "old");
  console.log("shadow hosts:", JSON.stringify(await listShadowHosts(h.page, { preview: 70 })));
  const text = await waitForWidget(h.page, "mpp-household");
  console.log("shadow text:", text.slice(0, 240));
  await shot(h.page, "smoke-my-household-old-authed");
  await h.close();
}

console.log("\nsmoke: OK");
