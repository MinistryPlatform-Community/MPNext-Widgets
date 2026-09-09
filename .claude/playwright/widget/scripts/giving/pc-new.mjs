import { launch, shot, shotMobile, newDemoUrl, waitForWidget, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const h = await launch({ site: "new", authed: true });
await h.page.goto(newDemoUrl("pledge-campaign"), { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "new");
await waitForWidget(h.page, "next-pledge-campaign", { apiPattern: /pledge-campaign\/\d+/ });

// swap to the ZZTEST campaign 6, mirroring the legacy page's other attributes
await h.page.evaluate(() => {
  const el = document.querySelector("next-pledge-campaign");
  const parent = el.parentElement; el.remove();
  const f = document.createElement("next-pledge-campaign");
  f.setAttribute("api-host", "http://localhost:3000");
  f.setAttribute("campaign-id", "6");
  f.setAttribute("pledge-email-template", "65");
  f.setAttribute("suggested-amounts", "30,50,100");
  parent.appendChild(f);
});
await waitForWidget(h.page, "next-pledge-campaign", { apiPattern: /pledge-campaign\/6/, timeout: 30000 });
await h.page.waitForTimeout(1000);

const shape = await h.page.evaluate(() => {
  const sr = document.querySelector("next-pledge-campaign").shadowRoot;
  const vis = n => { const cs = getComputedStyle(n); return cs.display !== "none" && cs.visibility !== "hidden"; };
  return {
    fields: [...sr.querySelectorAll("input,select,textarea,button")].map(e => ({
      id: e.id, tag: e.tagName.toLowerCase(), type: e.type, name: e.name, req: e.required, val: e.value,
      min: e.getAttribute("min"), max: e.getAttribute("max"), step: e.getAttribute("step"),
      label: sr.querySelector(`label[for="${e.id}"]`)?.textContent.trim() ?? null,
      visible: vis(e), txt: e.textContent.trim().slice(0, 24),
      opts: e.tagName === "SELECT" ? [...e.options].map(o => o.text + "=" + o.value) : undefined,
    })),
    headings: [...sr.querySelectorAll("h1,h2,h3,h4")].map(x => x.tagName + ":" + x.textContent.trim().slice(0,50)),
    visibleText: [...sr.querySelectorAll("*")].filter(vis).map(n=>[...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent.trim()).filter(Boolean).join(" ")).filter(Boolean).join(" | "),
  };
});
console.log("NEW pc shape:", JSON.stringify(shape, null, 1));
await shot(h.page, "pledge-campaign-new-zztest");
await shotMobile(h.page, "pledge-campaign-new-mobile");

// ── validation matrix ──
async function trySubmit(label, setup) {
  await setup();
  await h.page.locator("next-pledge-campaign #pc-submit").click();
  await h.page.waitForTimeout(700);
  const state = await h.page.evaluate(() => {
    const sr = document.querySelector("next-pledge-campaign").shadowRoot;
    return {
      msg: sr.querySelector("#pc-message")?.textContent.trim(),
      msgVisible: sr.querySelector("#pc-message") ? getComputedStyle(sr.querySelector("#pc-message")).display !== "none" : false,
      errs: [...sr.querySelectorAll("[class*=error],[class*=invalid],.nwfv-error,[aria-invalid=true]")].map(e=>e.className+":"+e.textContent.trim().slice(0,50)),
      total: sr.querySelector("#pc-total-value")?.textContent,
      amount: sr.querySelector("#pc-installment-amount")?.value,
    };
  });
  console.log(`VALIDATION [${label}]`, JSON.stringify(state));
  return state;
}
const set = async (sel, v) => h.page.locator(`next-pledge-campaign ${sel}`).fill(v);
const pick = async (sel, v) => h.page.locator(`next-pledge-campaign ${sel}`).selectOption(v);

await trySubmit("empty submit", async () => { await set("#pc-installment-amount",""); });
await shot(h.page, "pledge-campaign-new-validation-empty");
await trySubmit("negative amount", async () => { await set("#pc-installment-amount","-50"); await pick("#pc-frequency","12"); });
await shot(h.page, "pledge-campaign-new-validation-negative");
await trySubmit("zero amount", async () => { await set("#pc-installment-amount","0"); });
console.log("  freq value now:", await h.page.locator("next-pledge-campaign #pc-frequency").inputValue());
console.log("  start value now:", await h.page.locator("next-pledge-campaign #pc-first-installment").inputValue());
await trySubmit("non-numeric (typed)", async () => {
  await h.page.locator("next-pledge-campaign #pc-installment-amount").click();
  await h.page.keyboard.press("Control+A");
  await h.page.keyboard.type("abc");
});
await trySubmit("absurd amount", async () => { await set("#pc-installment-amount","999999999999"); });
await shot(h.page, "pledge-campaign-new-validation-absurd");

// native popup check
const nativePopup = await h.page.evaluate(() => {
  const sr = document.querySelector("next-pledge-campaign").shadowRoot;
  const f = sr.querySelector("#pc-form");
  return { novalidate: f.hasAttribute("novalidate") };
});
console.log("form novalidate:", JSON.stringify(nativePopup));

// past-campaign-end-date guard (campaign 6 ends 2027-12-31, pledgeBeyondEndDate false)
await set("#pc-installment-amount", "100");
await pick("#pc-frequency", "12");
await h.page.locator("next-pledge-campaign #pc-last-installment").fill("2028-06-30");
await h.page.locator("next-pledge-campaign #pc-submit").click();
await h.page.waitForTimeout(700);
console.log("past-end-date msg:", await h.page.locator("next-pledge-campaign #pc-message").textContent());
await shot(h.page, "pledge-campaign-new-past-end-date");

// ── real submit ──
await h.page.locator("next-pledge-campaign #pc-last-installment").fill("2026-12-01");
await set("#pc-installment-amount", "10");
await pick("#pc-frequency", "12");
await h.page.waitForTimeout(400);
console.log("computed total before submit:", await h.page.locator("next-pledge-campaign #pc-total-value").textContent());
h.log.reset();
await h.page.locator("next-pledge-campaign #pc-submit").click();
await h.page.waitForResponse(r => /pledge-campaign\/save/.test(r.url()), { timeout: 20000 });
await h.page.waitForTimeout(1500);
console.log("after submit msg:", await h.page.locator("next-pledge-campaign #pc-message").textContent());
console.log("submit btn now:", await h.page.locator("next-pledge-campaign #pc-submit").textContent());
console.log("api:", JSON.stringify(h.log.api.map(a=>`${a.status} ${a.method||""} ${a.url.replace("http://localhost:3000","")}`)));
await shot(h.page, "pledge-campaign-new-submitted");

// already-pledged warning on reload
await h.page.reload({ waitUntil: "domcontentloaded" });
await waitForWidget(h.page, "next-pledge-campaign", { apiPattern: /pledge-campaign\/\d+/, timeout: 30000 });
await h.close();
