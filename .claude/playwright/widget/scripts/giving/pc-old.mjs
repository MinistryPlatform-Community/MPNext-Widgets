import { launch, shot, shotMobile, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const o = await launch({ site: "old", authed: true });
// rewrite the one widget line so the legacy widget points at ZZTEST campaign 6
await o.page.route("**/widgets/pledge_campaign.aspx", async route => {
  const r = await route.fetch();
  let body = await r.text();
  body = body.replace(/pledgecampaignid="5"/i, 'pledgecampaignid="6"');
  await route.fulfill({ response: r, body });
});
const reqs = [];
o.page.on("request", q => { if (/PledgeCampaignApi|SavePledge/i.test(q.url())) reqs.push(`${q.method()} ${q.url()}`); });
o.page.on("dialog", async d => { console.log("OLD dialog:", d.type(), JSON.stringify(d.message())); await d.accept(); });

await o.page.goto("https://mpi.ministryplatform.com/widgets/pledge_campaign.aspx", { waitUntil: "domcontentloaded" });
await assertAuthenticated(o.page, "old");
await o.page.waitForTimeout(8000);
const shape = await o.page.evaluate(() => {
  const el = document.querySelector("mpp-pledge-campaign");
  const sr = el.shadowRoot;
  const vis = n => { const cs = getComputedStyle(n); return cs.display !== "none" && cs.visibility !== "hidden"; };
  return {
    attrs: [...el.attributes].map(a=>a.name+"="+a.value),
    fields: [...sr.querySelectorAll("input,select,textarea,button")].map(e => ({
      id: e.id, tag: e.tagName.toLowerCase(), type: e.type, name: e.name, req: e.required, val: e.value,
      min: e.getAttribute("min"), max: e.getAttribute("max"), step: e.getAttribute("step"),
      label: sr.querySelector(`label[for="${e.id}"]`)?.textContent.trim() ?? null,
      visible: vis(e),
      opts: e.tagName === "SELECT" ? [...e.options].map(x => x.text + "=" + x.value) : undefined,
    })),
    headings: [...sr.querySelectorAll("h1,h2,h3,h4")].map(x => x.tagName + ":" + x.textContent.trim().slice(0,50)),
    visibleText: [...sr.querySelectorAll("*")].filter(vis).map(n=>[...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent.trim()).filter(Boolean).join(" ")).filter(Boolean).join(" | "),
  };
});
console.log("OLD pc shape:", JSON.stringify(shape, null, 1));
await shot(o.page, "pledge-campaign-old-zztest");
await shotMobile(o.page, "pledge-campaign-old-mobile");

// validation on legacy
async function oldSubmit(label, fn) {
  await fn();
  const btn = o.page.locator("mpp-pledge-campaign input[value='Create Pledge'], mpp-pledge-campaign button:has-text('Create Pledge')");
  await btn.first().click();
  await o.page.waitForTimeout(1500);
  const st = await o.page.evaluate(() => {
    const sr = document.querySelector("mpp-pledge-campaign").shadowRoot;
    const vis = n => { const cs = getComputedStyle(n); return cs.display !== "none" && cs.visibility !== "hidden"; };
    return {
      alerts: [...sr.querySelectorAll("[class*=alert],[class*=error],[class*=invalid]")].filter(vis).map(e=>e.className+":"+e.textContent.trim().slice(0,80)),
      total: [...sr.querySelectorAll("*")].filter(n=>/Total Pledge/.test(n.textContent||"")).slice(-1)[0]?.textContent.replace(/\s+/g," ").trim().slice(0,60),
      validationMsgs: [...sr.querySelectorAll("input,select")].map(i=>i.validationMessage).filter(Boolean),
    };
  });
  console.log(`OLD VALIDATION [${label}]`, JSON.stringify(st), "reqs:", JSON.stringify(reqs.slice(-2)));
  return st;
}
const ofill = (sel, v) => o.page.locator(`mpp-pledge-campaign ${sel}`).fill(v);
await oldSubmit("empty submit", async () => {});
await shot(o.page, "pledge-campaign-old-validation-empty");
await oldSubmit("negative amount", async () => { await ofill("#installmentAmount", "-50").catch(()=>{}); });
await shot(o.page, "pledge-campaign-old-validation-negative");
await oldSubmit("zero amount", async () => { await ofill("#installmentAmount", "0").catch(()=>{}); });
await shot(o.page, "pledge-campaign-old-validation-zero");
console.log("OLD all reqs:", JSON.stringify(reqs));
await o.close();
