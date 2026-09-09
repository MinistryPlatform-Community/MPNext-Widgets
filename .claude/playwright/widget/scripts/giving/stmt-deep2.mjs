import { launch, shot, shotMobile, newDemoUrl, waitForWidget, assertAuthenticated, SCRATCH }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";
import fs from "node:fs";

const h = await launch({ site: "new", authed: true });
await h.page.goto(newDemoUrl("my-contribution-statement"), { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "new");
await waitForWidget(h.page, "next-my-contribution-statement", { apiPattern: /contribution-statements/ });

// capture the download URLs the widget would open
const urls = [];
h.ctx.on("page", async p => { urls.push(p); });
await h.page.locator('next-my-contribution-statement [data-action="download"]').click();
await h.page.waitForTimeout(3000);
for (const p of urls) console.log("popup url:", p.url() || "(empty) main:" + p.mainFrame().url());

// read the API payload for the true URL
const payload = await h.page.evaluate(async () => {
  const s = window.MPNextEmbed.getAuthSession();
  const t = await s.getToken();
  const r = await fetch("http://localhost:3000/api/embed/contribution-statements", { headers: { Authorization: "Bearer " + t } });
  return r.json();
});
console.log("API payload:", JSON.stringify(payload));
const dl = payload.groups[0].statements;
for (const s of dl) {
  const r = await h.page.request.get(s.Download_Url);
  const b = await r.body();
  console.log(`GET ${s.Statement_Year} ${s.Download_Url} -> ${r.status()} ct=${r.headers()["content-type"]} bytes=${b.length}`);
  fs.writeFileSync(`${SCRATCH}/stmt-${s.Statement_Year}.bin`, b);
  console.log("   head:", b.slice(0, 60).toString("latin1").replace(/\n/g, "\n"));
  console.log("   has marker:", b.toString("latin1").includes(`ZZTEST ${s.Statement_Year} Contribution Statement`));
}
// anonymous fetch of the same URL (is the statement PDF protected?)
const anon = await launch({ site: "new", authed: false, verify: false });
const ar = await anon.page.request.get(dl[0].Download_Url);
console.log("ANON fetch of statement PDF:", ar.status(), ar.headers()["content-type"], (await ar.body()).length);
await anon.close();

// ── statement-preferences round trip (click the visible switch) ──
await h.page.goto(newDemoUrl("statement-preferences"), { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "new");
await waitForWidget(h.page, "next-statement-preferences", { apiPattern: /statement-preferences/ });
const before = await h.page.locator("next-statement-preferences #paperless-toggle").isChecked();
console.log("initial checked:", before);
h.log.reset();
await h.page.locator("next-statement-preferences .slider").click();
await h.page.waitForResponse(r => /statement-preferences/.test(r.url()) && r.request().method() === "PUT", { timeout: 20000 });
await h.page.waitForTimeout(1000);
console.log("after flip checked:", await h.page.locator("next-statement-preferences #paperless-toggle").isChecked());
console.log("message:", await h.page.locator("next-statement-preferences .message").allTextContents());
console.log("api:", JSON.stringify(h.log.api.map(a=>`${a.status} ${a.method||""} ${a.url.replace("http://localhost:3000","")}`)));
await shot(h.page, "statement-preferences-new-flipped");
await h.page.reload({ waitUntil: "domcontentloaded" });
await waitForWidget(h.page, "next-statement-preferences", { apiPattern: /statement-preferences/ });
console.log("after reload checked:", await h.page.locator("next-statement-preferences #paperless-toggle").isChecked());
await shotMobile(h.page, "statement-preferences-new-mobile");
console.log("prefs a11y:", JSON.stringify(await h.page.evaluate(() => {
  const sr = document.querySelector("next-statement-preferences").shadowRoot;
  return { headings: [...sr.querySelectorAll("h1,h2,h3,h4")].map(x=>x.tagName), labels: [...sr.querySelectorAll("label")].map(l=>({for:l.getAttribute("for"),txt:l.textContent.trim()})),
           inputVisible: (()=>{const i=sr.querySelector("#paperless-toggle");const cs=getComputedStyle(i);return {display:cs.display,opacity:cs.opacity,w:cs.width};})() };
})));
await h.close();
