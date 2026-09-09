import { launch, shot, newDemoUrl, waitForWidget, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const h = await launch({ site: "new", authed: true });
async function load() {
  await h.page.goto(newDemoUrl("pledge-campaign"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "new");
  await waitForWidget(h.page, "next-pledge-campaign", { apiPattern: /pledge-campaign\/\d+/ });
  await h.page.evaluate(() => {
    const el = document.querySelector("next-pledge-campaign");
    const p = el.parentElement; el.remove();
    const f = document.createElement("next-pledge-campaign");
    f.setAttribute("api-host", "http://localhost:3000");
    f.setAttribute("campaign-id", "6");
    f.setAttribute("pledge-email-template", "65");
    f.setAttribute("suggested-amounts", "30,50,100");
    p.appendChild(f);
  });
  await waitForWidget(h.page, "next-pledge-campaign", { apiPattern: /pledge-campaign\/6/, timeout: 30000 });
  await h.page.waitForTimeout(800);
}
const st = async () => h.page.evaluate(() => {
  const sr = document.querySelector("next-pledge-campaign").shadowRoot;
  return { msg: sr.querySelector("#pc-message")?.textContent.trim().slice(0,120),
           total: sr.querySelector("#pc-total-value")?.textContent,
           submitBtn: sr.querySelector("#pc-submit")?.textContent.trim(),
           errs: [...sr.querySelectorAll(".mpx-field-error")].map(e=>e.textContent.trim()) };
});

// 1. absurd amount
await load();
await h.page.locator("next-pledge-campaign #pc-installment-amount").fill("999999999999");
await h.page.locator("next-pledge-campaign #pc-frequency").selectOption("12");
await h.page.waitForTimeout(500);
console.log("ABSURD pre-submit:", JSON.stringify(await st()));
await h.page.locator("next-pledge-campaign #pc-submit").click();
await h.page.waitForTimeout(4000);
console.log("ABSURD post-submit:", JSON.stringify(await st()));
await shot(h.page, "pledge-campaign-new-validation-absurd");

// 2. past-end-date guard
await load();
await h.page.locator("next-pledge-campaign #pc-installment-amount").fill("25");
await h.page.locator("next-pledge-campaign #pc-frequency").selectOption("12");
await h.page.evaluate(() => { const i = document.querySelector("next-pledge-campaign").shadowRoot.querySelector("#pc-last-installment"); i.removeAttribute("max"); i.value = "2028-06-30"; i.dispatchEvent(new Event("change")); });
await h.page.waitForTimeout(400);
await h.page.locator("next-pledge-campaign #pc-submit").click();
await h.page.waitForTimeout(2500);
console.log("PAST-END:", JSON.stringify(await st()));
await shot(h.page, "pledge-campaign-new-past-end-date");

// 3. legitimate submit: $10 monthly, Sep 2026 -> Dec 2026
await load();
await h.page.locator("next-pledge-campaign #pc-installment-amount").fill("10");
await h.page.locator("next-pledge-campaign #pc-frequency").selectOption("12");
await h.page.locator("next-pledge-campaign #pc-last-installment").fill("2026-12-08");
await h.page.waitForTimeout(600);
console.log("VALID pre-submit:", JSON.stringify(await st()));
h.log.reset();
await h.page.locator("next-pledge-campaign #pc-submit").click();
await h.page.waitForResponse(r => /pledge-campaign\/save/.test(r.url()), { timeout: 20000 });
await h.page.waitForTimeout(2000);
console.log("VALID post-submit:", JSON.stringify(await st()));
console.log("api:", JSON.stringify(h.log.api.map(a=>`${a.status} ${a.method||""} ${a.url.replace("http://localhost:3000","")}`)));
await shot(h.page, "pledge-campaign-new-submitted");

// 4. Create Another Pledge resets
await h.page.locator("next-pledge-campaign #pc-submit").click();
await h.page.waitForTimeout(600);
console.log("AFTER reset:", JSON.stringify(await st()));

// 5. Blank Form branch requires contact fields
await h.page.locator("next-pledge-campaign #pc-apply-as").selectOption("");
await h.page.waitForTimeout(600);
console.log("blank-form required flags:", JSON.stringify(await h.page.evaluate(() => {
  const sr = document.querySelector("next-pledge-campaign").shadowRoot;
  return ["#pc-first-name","#pc-last-name","#pc-email","#pc-phone"].map(s => ({ s, req: sr.querySelector(s).required, val: sr.querySelector(s).value }));
})));
await h.page.locator("next-pledge-campaign #pc-installment-amount").fill("5");
await h.page.locator("next-pledge-campaign #pc-frequency").selectOption("1");
await h.page.locator("next-pledge-campaign #pc-submit").click();
await h.page.waitForTimeout(1200);
console.log("blank-form empty submit:", JSON.stringify(await st()));
await shot(h.page, "pledge-campaign-new-blank-form-validation");
await h.close();
