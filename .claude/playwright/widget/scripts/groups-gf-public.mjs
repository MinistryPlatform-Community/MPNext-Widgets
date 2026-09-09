import {
  launch, shot, shotMobile, newDemoUrl, oldPageUrl,
  waitForWidget, listShadowHosts,
} from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

// ---------- OLD ----------
{
  const h = await launch({ site: "old", authed: false });
  await h.page.goto(oldPageUrl("group-finder"), { waitUntil: "domcontentloaded" });
  console.log("HOSTS:", JSON.stringify(await listShadowHosts(h.page)).slice(0, 800));
  const t = await waitForWidget(h.page, "mpp-group-finder", { timeout: 60000 });
  console.log("OLD TEXT:", t.slice(0, 1500));
  await shot(h.page, "group-finder-old-initial");
  // enumerate controls
  const ctrl = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-finder").shadowRoot;
    const out = [];
    sr.querySelectorAll("input,select,textarea,button,.mppw-btn,a").forEach(el => {
      const cs = getComputedStyle(el);
      let vis = cs.display !== "none" && cs.visibility !== "hidden";
      let p = el.parentElement;
      while (vis && p && p !== sr) { const s = getComputedStyle(p); if (s.display === "none") vis = false; p = p.parentElement; }
      out.push({ tag: el.tagName.toLowerCase(), type: el.type || "", id: el.id, name: el.name || "", label: (el.textContent||"").trim().slice(0,40) || el.value || "", visible: vis,
        opts: el.tagName === "SELECT" ? [...el.options].slice(0,6).map(o=>o.text) : undefined });
    });
    return out;
  });
  console.log("OLD CONTROLS:", JSON.stringify(ctrl, null, 1));
  // labels of visible form fields
  const labels = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-finder").shadowRoot;
    return [...sr.querySelectorAll("label")].map(l => l.textContent.trim()).filter(Boolean);
  });
  console.log("OLD LABELS:", JSON.stringify(labels));
  const cards = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-finder").shadowRoot;
    const rc = sr.querySelector("#resultsContainer");
    return { count: rc ? rc.children.length : -1,
      titles: rc ? [...rc.children].map(c => c.textContent.replace(/\s+/g," ").trim().slice(0,120)) : [] };
  });
  console.log("OLD CARDS:", cards.count);
  console.log(JSON.stringify(cards.titles, null, 1));
  console.log("OLD CARD HTML:", await h.page.evaluate(() => {
    const rc = document.querySelector("mpp-group-finder").shadowRoot.querySelector("#resultsContainer");
    return rc && rc.children[0] ? rc.children[0].outerHTML.slice(0,1500) : "none";
  }));
  await shotMobile(h.page, "group-finder-old-mobile");
  await h.close();
}

// ---------- NEW ----------
{
  const h = await launch({ site: "new", authed: false });
  await h.page.goto(newDemoUrl("group-finder"), { waitUntil: "domcontentloaded" });
  const t = await waitForWidget(h.page, "next-group-finder", { apiPattern: /\/api\/embed\/group-finder(\?|$)/, timeout: 60000 });
  console.log("NEW TEXT:", t.slice(0, 1500));
  await shot(h.page, "group-finder-new-initial");
  const ctrl = await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-finder").shadowRoot;
    const out = [];
    sr.querySelectorAll("input,select,textarea,button,a").forEach(el => {
      out.push({ tag: el.tagName.toLowerCase(), type: el.type || "", id: el.id, name: el.name || "", label: (el.textContent||"").trim().slice(0,40),
        opts: el.tagName === "SELECT" ? [...el.options].slice(0,6).map(o=>o.text) : undefined });
    });
    return out;
  });
  console.log("NEW CONTROLS:", JSON.stringify(ctrl, null, 1));
  const labels = await h.page.evaluate(() => [...document.querySelector("next-group-finder").shadowRoot.querySelectorAll("label")].map(l=>l.textContent.trim()).filter(Boolean));
  console.log("NEW LABELS:", JSON.stringify(labels));
  const cards = await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-finder").shadowRoot;
    const g = sr.querySelector(".nw-gf-grid");
    return { count: g ? g.children.length : -1,
      titles: g ? [...g.children].map(c => c.textContent.replace(/\s+/g," ").trim().slice(0,120)) : [] };
  });
  console.log("NEW CARDS:", cards.count);
  console.log(JSON.stringify(cards.titles, null, 1));
  console.log("NEW CARD HTML:", await h.page.evaluate(() => {
    const g = document.querySelector("next-group-finder").shadowRoot.querySelector(".nw-gf-grid");
    return g && g.children[0] ? g.children[0].outerHTML.slice(0,1500) : "none";
  }));
  await shotMobile(h.page, "group-finder-new-mobile");
  console.log("api:", h.log.api.map(a => `${a.status} ${a.method||""} ${a.url.replace("http://localhost:3000","")}`).join("\n"));
  console.log("apiFailures:", JSON.stringify(h.log.apiFailures()));
  console.log("consoleErrors:", JSON.stringify(h.log.consoleErrors().map(c=>c.text).slice(0,10)));
  await h.close();
}
