import { launch, shot, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";
const o = await launch({ site: "old", authed: true });
o.page.on("dialog", async d => { console.log("OLD dialog:", d.type(), JSON.stringify(d.message())); await d.accept(); });
const oreq = [];
o.page.on("request", r => { if (/PledgesApi|Cancel/i.test(r.url())) oreq.push(`${r.method()} ${r.url()}`); });
await o.page.goto("https://mpi.ministryplatform.com/widgets/my_pledges.aspx", { waitUntil: "domcontentloaded" });
await assertAuthenticated(o.page, "old");
await o.page.waitForTimeout(6000);
const a = o.page.locator("mpp-my-pledges a", { hasText: "Cancel Pledge" });
console.log("cancel anchors:", await a.count());
await a.first().click();
await o.page.waitForTimeout(7000);
console.log("OLD cancel requests:", JSON.stringify(oreq));
console.log("OLD after:", (await o.page.evaluate(() => document.querySelector("mpp-my-pledges").shadowRoot.textContent.replace(/\s+/g," ").trim())).slice(0, 400));
await shot(o.page, "my-pledges-old-after-cancel");
await o.close();
