import { launch, shot, shotMobile, waitForWidget, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

async function vis(page, tag) {
  return page.evaluate((t) => {
    const sr = document.querySelector(t).shadowRoot;
    const out = [];
    for (const n of sr.querySelectorAll("*")) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const own = [...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent.trim()).filter(Boolean).join(" ");
      if (own) out.push(own);
      if (n.tagName === "INPUT" && n.type === "checkbox") out.push(`[cb checked=${n.checked}]`);
      else if (n.tagName === "INPUT" && n.value) out.push(`[input=${n.value}]`);
      if (n.tagName === "SELECT") out.push(`[select value=${n.value} opts=${[...n.options].map(o=>o.text+(o.disabled?"(dis)":"")).join("/")}]`);
    }
    return out.join(" | ");
  }, tag);
}

const h = await launch({ site: "old", authed: true });
await h.page.goto("https://mpi.ministryplatform.com/widgets/my_giving.aspx", { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "old");
await h.page.waitForTimeout(6000);
console.log("=== OLD 2026 visible ===");
console.log(await vis(h.page, "mpp-my-giving"));

// structure: rows
const rows = await h.page.evaluate(() => {
  const sr = document.querySelector("mpp-my-giving").shadowRoot;
  const cand = sr.querySelectorAll("[class*=donation], [class*=row], li, tr");
  const seen = new Set(); const out = [];
  for (const r of cand) {
    const cs = getComputedStyle(r);
    if (cs.display === "none") continue;
    const t = r.textContent.replace(/\s+/g," ").trim();
    if (!t || t.length > 200 || seen.has(t)) continue;
    seen.add(t); out.push({ cls: r.className, t });
  }
  return out.slice(0, 30);
});
console.log("OLD rows:", JSON.stringify(rows, null, 0));

// classes present, for reference
console.log("OLD classes:", JSON.stringify(await h.page.evaluate(() => {
  const sr = document.querySelector("mpp-my-giving").shadowRoot;
  return [...new Set([...sr.querySelectorAll("*")].map(e=>e.className).filter(c=>typeof c==="string"&&c))].slice(0,60);
})));
console.log("OLD a11y:", JSON.stringify(await h.page.evaluate(() => {
  const sr = document.querySelector("mpp-my-giving").shadowRoot;
  return {
    focusables: [...sr.querySelectorAll("button,select,input,a[href]")].map(e=>({tag:e.tagName.toLowerCase(),type:e.type,id:e.id,label:(e.getAttribute("aria-label")||e.value||e.textContent||"").trim().slice(0,40),disabled:e.disabled})),
    labels: [...sr.querySelectorAll("label")].map(l=>l.textContent.trim().slice(0,50)),
    headings: [...sr.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(x=>x.tagName+":"+x.textContent.trim().slice(0,40)),
    svgAria: [...sr.querySelectorAll("svg")].map(s=>s.getAttribute("aria-label")),
    tables: sr.querySelectorAll("table").length,
  };
})));
await shot(h.page, "my-giving-old-authed");
await shotMobile(h.page, "my-giving-old-mobile");

// year nav range on legacy
const navInfo = await h.page.evaluate(() => {
  const sr = document.querySelector("mpp-my-giving").shadowRoot;
  const btns = [...sr.querySelectorAll("input[type=button],button")].map(b => ({ v: (b.value||b.textContent||"").trim(), cls: b.className, disabled: b.disabled }));
  return btns;
});
console.log("OLD nav buttons:", JSON.stringify(navInfo));
await h.close();
