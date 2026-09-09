import { launch, shot, waitForWidget, newDemoUrl } from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const h = await launch({ site: "new", authed: false });
await h.page.goto(newDemoUrl("group-finder"), { waitUntil: "domcontentloaded" });
await waitForWidget(h.page, "next-group-finder", { apiPattern: /\/api\/embed\/group-finder(\?|$)/, timeout: 60000 });
await h.page.locator('next-group-finder [data-action="open-suggest"]').click();
await sleep(700);
await h.page.evaluate(() => {
  const sr = document.querySelector("next-group-finder").shadowRoot;
  const set = (id, v) => { const el = sr.querySelector(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
  set("#gf-s-name", "ZZTEST anon suggest (should be blocked)");
  set("#gf-s-desc", "ZZTEST anon");
  const cong = sr.querySelector("#gf-s-cong");
  cong.value = [...cong.options].find((o) => o.text === "Main Congregation").value;
  cong.dispatchEvent(new Event("change", { bubbles: true }));
});
await h.page.locator("next-group-finder #gf-suggest-form button[type=submit]").click();
await sleep(4000);
console.log("URL now:", h.page.url());
console.log("NEW anon suggest submit:", (await h.page.evaluate(() => document.querySelector("next-group-finder") ? document.querySelector("next-group-finder").shadowRoot.textContent.replace(/\s+/g, " ").trim().slice(0, 400) : "widget gone")));
await shot(h.page, "group-finder-new-suggest-anon-submit");
console.log("api:", h.log.api.map((a) => `${a.status} ${a.method || ""} ${a.url.replace("http://localhost:3000", "")}`).join("\n"));
// also confirm the "See Details" CTA is not an anchor
await h.page.goto(newDemoUrl("group-finder"), { waitUntil: "domcontentloaded" });
await waitForWidget(h.page, "next-group-finder", { apiPattern: /\/api\/embed\/group-finder(\?|$)/, timeout: 60000 });
console.log("card anchors:", await h.page.evaluate(() => {
  const sr = document.querySelector("next-group-finder").shadowRoot;
  const c = sr.querySelector(".nw-gf-card");
  return { anchorsInCard: c.querySelectorAll("a[href]").length, ctaTag: c.querySelector(".nw-gf-card-cta") ? c.querySelector(".nw-gf-card-cta").tagName : null, cardTag: c.tagName, role: c.getAttribute("role") };
}));
await h.close();
