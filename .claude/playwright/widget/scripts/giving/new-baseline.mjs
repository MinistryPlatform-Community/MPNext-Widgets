import { launch, shot, shotMobile, newDemoUrl, waitForWidget, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const specs = [
  ["my-giving", "next-my-giving", /\/api\/embed\/my-giving/],
  ["my-contribution-statement", "next-my-contribution-statement", /\/api\/embed\/contribution-statements/],
  ["statement-preferences", "next-statement-preferences", /\/api\/embed\/statement-preferences/],
  ["my-pledges", "next-my-pledges", /\/api\/embed\/my-pledges/],
  ["pledge-campaign", "next-pledge-campaign", /\/api\/embed\/pledge-campaign/],
];

const h = await launch({ site: "new", authed: true });
for (const [slug, tag, api] of specs) {
  console.log(`\n======== NEW ${slug} ========`);
  h.log.reset();
  await h.page.goto(newDemoUrl(slug), { waitUntil: "domcontentloaded" });
  try { await assertAuthenticated(h.page, "new"); } catch (e) { console.log("AUTHFAIL", e.message); }
  let text = "";
  try { text = await waitForWidget(h.page, tag, { apiPattern: api, timeout: 30000 }); }
  catch (e) { console.log("WAITFAIL", e.message); }
  const attrs = await h.page.evaluate((t) => {
    const el = document.querySelector(t);
    return el ? [...el.attributes].map(a => a.name + "=" + a.value) : null;
  }, tag);
  console.log("attrs:", JSON.stringify(attrs));
  console.log("TEXT:", text);
  console.log("api:", JSON.stringify(h.log.api.map(a => `${a.status} ${a.method||''} ${a.url.replace('http://localhost:3000','')}`)));
  console.log("api failures:", JSON.stringify(h.log.apiFailures()));
  console.log("console errors:", JSON.stringify(h.log.consoleErrors().map(c=>c.text).slice(0,10)));
  await shot(h.page, `${slug}-new-initial`);
  await h.page.waitForTimeout(800);
}
await h.close();
