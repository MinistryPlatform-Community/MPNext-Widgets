import { launch, shot, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";
const o = await launch({ site: "old", authed: true });
await o.page.route("**/widgets/pledge_campaign.aspx", async route => {
  const r = await route.fetch(); let b = await r.text();
  b = b.replace(/pledgecampaignid="5"/i, 'pledgecampaignid="6"');
  await route.fulfill({ response: r, body: b });
});
const reqs = [];
o.page.on("request", q => { if (/PledgeCampaignApi/i.test(q.url())) reqs.push(`${q.method()} ${q.url().split("?")[0].split("/").pop()}${q.url().includes("?")?"?"+q.url().split("?")[1].slice(0,80):""}`); });
o.page.on("dialog", async d => { console.log("dialog:", d.type(), JSON.stringify(d.message())); await d.accept(); });

async function load() {
  await o.page.goto("https://mpi.ministryplatform.com/widgets/pledge_campaign.aspx", { waitUntil: "domcontentloaded" });
  await assertAuthenticated(o.page, "old");
  await o.page.waitForTimeout(8000);
}
async function state(tag) {
  return o.page.evaluate(() => {
    const sr = document.querySelector("mpp-pledge-campaign").shadowRoot;
    const vis = n => { const cs = getComputedStyle(n); return cs.display !== "none" && cs.visibility !== "hidden"; };
    return {
      alerts: [...sr.querySelectorAll(".mppw-alert__text, .mppw-form-field__message--is-invalid")].filter(vis).map(e=>e.textContent.trim().slice(0,90)),
      total: sr.querySelector("#TotalPledge")?.value,
      totalText: [...sr.querySelectorAll("*")].map(n=>n.textContent).filter(t=>/Total Pledge/.test(t||"")).slice(-1)[0]?.replace(/\s+/g," ").trim().slice(0,40),
      amount: sr.querySelector("#InstallmentAmount")?.value,
      submitted: !!sr.querySelector(".mppw-alert__text")?.textContent.match(/thank/i),
    };
  });
}
const f = (sel, v) => o.page.locator(`mpp-pledge-campaign ${sel}`).fill(v);
const s = (sel, v) => o.page.locator(`mpp-pledge-campaign ${sel}`).selectOption(v);
const submit = async () => { await o.page.locator("mpp-pledge-campaign #createPledge").click(); await o.page.waitForTimeout(2500); };

await load();
// negative
reqs.length = 0;
await f("#InstallmentAmount", "-50"); await s("#Frequency", "12");
await o.page.waitForTimeout(400);
console.log("legacy total after -50 monthly:", JSON.stringify(await state()));
await submit();
console.log("NEG result:", JSON.stringify(await state()), "reqs:", JSON.stringify(reqs));
await shot(o.page, "pledge-campaign-old-validation-negative");

// zero
await load();
reqs.length = 0;
await f("#InstallmentAmount", "0"); await s("#Frequency", "12");
await o.page.waitForTimeout(400);
await submit();
console.log("ZERO result:", JSON.stringify(await state()), "reqs:", JSON.stringify(reqs));
await shot(o.page, "pledge-campaign-old-validation-zero");

// absurd
await load();
reqs.length = 0;
await f("#InstallmentAmount", "999999999999"); await s("#Frequency", "12");
await o.page.waitForTimeout(400);
console.log("legacy total after absurd:", JSON.stringify(await state()));
await submit();
console.log("ABSURD result:", JSON.stringify(await state()), "reqs:", JSON.stringify(reqs));
await shot(o.page, "pledge-campaign-old-validation-absurd");
await o.close();
