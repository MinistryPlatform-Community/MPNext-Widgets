import { launch, shot, shotMobile, newDemoUrl, waitForWidget, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

// ═════════ NEW ═════════
const h = await launch({ site: "new", authed: true });
await h.page.goto(newDemoUrl("my-pledges"), { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "new");
await waitForWidget(h.page, "next-my-pledges", { apiPattern: /my-pledges/ });

console.log("DEFAULT cancel buttons visible:", await h.page.locator('next-my-pledges [data-action="request-cancel"]').count());
console.log("cards:", await h.page.locator("next-my-pledges .pledge-card").count());
console.log("card texts:", JSON.stringify(await h.page.locator("next-my-pledges .pledge-card").allTextContents()));
await shot(h.page, "my-pledges-new-default-nocancel");

// mirror the legacy page config
// NOTE: setAttribute after connect does not re-render (attributeChangedCallback
// ignores oldValue === null), so replace the element outright.
await h.page.evaluate(() => {
  const el = document.querySelector("next-my-pledges");
  el.setAttribute("hidecancelbuttonpledge", "false");
  el.setAttribute("cancelpledgeemailtemplate", "65");
});
await h.page.waitForTimeout(2500);
console.log("after setAttribute only, cancel buttons:", await h.page.locator('next-my-pledges [data-action="request-cancel"]').count());
await h.page.evaluate(() => {
  const el = document.querySelector("next-my-pledges");
  const parent = el.parentElement;
  el.remove();
  const fresh = document.createElement("next-my-pledges");
  fresh.setAttribute("api-host", "http://localhost:3000");
  fresh.setAttribute("hidecancelbuttonpledge", "false");
  fresh.setAttribute("cancelpledgeemailtemplate", "65");
  parent.appendChild(fresh);
});
await waitForWidget(h.page, "next-my-pledges", { apiPattern: /my-pledges/, timeout: 30000 });
await h.page.waitForTimeout(1000);
console.log("AFTER attrs cancel buttons:", await h.page.locator('next-my-pledges [data-action="request-cancel"]').count());
const a11y = await h.page.evaluate(() => {
  const sr = document.querySelector("next-my-pledges").shadowRoot;
  return { headings: [...sr.querySelectorAll("h1,h2,h3,h4")].map(x=>x.tagName+":"+x.textContent.trim().slice(0,30)),
           progress: [...sr.querySelectorAll("[role=progressbar],progress")].length,
           imgAlts: [...sr.querySelectorAll("img,svg")].map(i=>i.getAttribute("alt")||i.getAttribute("aria-label")) };
});
console.log("NEW a11y:", JSON.stringify(a11y));
await shot(h.page, "my-pledges-new-cancel-enabled");

// exercise the confirm step
await h.page.locator('next-my-pledges [data-action="request-cancel"]').first().click();
await h.page.waitForTimeout(300);
console.log("confirm text:", await h.page.locator("next-my-pledges .cancel-confirm").allTextContents());
await shot(h.page, "my-pledges-new-cancel-confirm");
// dismiss then re-open, then confirm
await h.page.locator('next-my-pledges [data-action="dismiss-cancel"]').click();
await h.page.waitForTimeout(300);
console.log("after Keep, confirm gone:", await h.page.locator("next-my-pledges .cancel-confirm").count());

// cancel pledge 40
h.log.reset();
await h.page.locator('next-my-pledges [data-action="request-cancel"][data-id="40"]').click();
await h.page.waitForTimeout(200);
await h.page.locator('next-my-pledges [data-action="confirm-cancel"][data-id="40"]').click();
await h.page.waitForResponse(r => /my-pledges/.test(r.url()) && r.request().method() === "POST", { timeout: 20000 });
await h.page.waitForTimeout(1500);
console.log("post-cancel message:", await h.page.locator("next-my-pledges .message").allTextContents());
console.log("post-cancel cards:", JSON.stringify(await h.page.locator("next-my-pledges .pledge-card").allTextContents()));
console.log("api:", JSON.stringify(h.log.api.map(a=>`${a.status} ${a.method||""} ${a.url.replace("http://localhost:3000","")}`)));
await shot(h.page, "my-pledges-new-after-cancel");
await shotMobile(h.page, "my-pledges-new-mobile");
await h.close();

// ═════════ OLD ═════════
const o = await launch({ site: "old", authed: true });
await o.page.goto("https://mpi.ministryplatform.com/widgets/my_pledges.aspx", { waitUntil: "domcontentloaded" });
await assertAuthenticated(o.page, "old");
await o.page.waitForTimeout(6000);
const oldInfo = await o.page.evaluate(() => {
  const sr = document.querySelector("mpp-my-pledges").shadowRoot;
  const vis = n => { const cs = getComputedStyle(n); return cs.display !== "none" && cs.visibility !== "hidden"; };
  return {
    cards: [...sr.querySelectorAll("[class*=pledge]")].filter(vis).map(c=>({cls:c.className,t:c.textContent.replace(/\s+/g," ").trim().slice(0,140)})).slice(0,25),
    controls: [...sr.querySelectorAll("button,input,a")].filter(vis).map(e=>({tag:e.tagName.toLowerCase(),type:e.type,val:e.value,txt:e.textContent.trim().slice(0,30),cls:e.className})),
    headings: [...sr.querySelectorAll("h1,h2,h3,h4")].map(x=>x.tagName+":"+x.textContent.trim().slice(0,40)),
    visibleText: [...sr.querySelectorAll("*")].filter(vis).map(n=>[...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent.trim()).filter(Boolean).join(" ")).filter(Boolean).join(" | "),
  };
});
console.log("\nOLD pledges:", JSON.stringify(oldInfo, null, 1));
await shot(o.page, "my-pledges-old-authed");
await shotMobile(o.page, "my-pledges-old-mobile");

// legacy cancel: native confirm
o.page.on("dialog", async d => { console.log("OLD dialog:", d.type(), JSON.stringify(d.message())); await d.accept(); });
const oreq = [];
o.page.on("request", r => { if (/PledgesApi|Cancel/i.test(r.url())) oreq.push(`${r.method()} ${r.url()}`); });
const cancelBtns = o.page.locator("mpp-my-pledges input[type=button][value*=Cancel], mpp-my-pledges button:has-text('Cancel')");
console.log("OLD cancel control count:", await cancelBtns.count());
await cancelBtns.first().click();
await o.page.waitForTimeout(6000);
console.log("OLD cancel requests:", JSON.stringify(oreq));
console.log("OLD after cancel text:", (await o.page.evaluate(() => document.querySelector("mpp-my-pledges").shadowRoot.textContent.replace(/\s+/g," ").trim())).slice(0, 400));
await shot(o.page, "my-pledges-old-after-cancel");
await o.close();
