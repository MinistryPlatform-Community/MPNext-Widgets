import { launch, shot, shotMobile, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const h = await launch({ site: "old", authed: true });

// ── 1. legacy my-giving year floor ────────────────────────────────
await h.page.goto("https://mpi.ministryplatform.com/widgets/my_giving.aspx", { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "old");
await h.page.waitForTimeout(5000);
for (let i = 0; i < 8; i++) {
  const state = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-my-giving").shadowRoot;
    const p = sr.querySelector(".prev-year"), n = sr.querySelector("[class*=next-year]");
    return { prev: p?.textContent.trim(), prevCls: p?.className, next: n?.textContent.trim(), nextCls: n?.className,
             total: sr.querySelector(".total-giving-row")?.textContent.trim(),
             sel: sr.querySelector("#monthSelector")?.options[0]?.text };
  });
  console.log(`OLD nav step ${i}:`, JSON.stringify(state));
  if (/button-disabled/.test(state.prevCls || "")) break;
  await h.page.locator("mpp-my-giving .prev-year").click();
  await h.page.waitForTimeout(2500);
}
await shot(h.page, "my-giving-old-year-floor");

// ── 2. legacy contribution statement ──────────────────────────────
await h.page.goto("https://mpi.ministryplatform.com/widgets/my_contribution_statement.aspx", { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "old");
await h.page.waitForTimeout(6000);
const st = await h.page.evaluate(() => {
  const sr = document.querySelector("mpp-my-contribution-statement").shadowRoot;
  const visible = (n) => { const cs = getComputedStyle(n); return cs.display !== "none" && cs.visibility !== "hidden"; };
  return {
    classes: [...new Set([...sr.querySelectorAll("*")].map(e=>e.className).filter(c=>typeof c==="string"&&c))],
    controls: [...sr.querySelectorAll("button,input,select,a")].filter(visible).map(e=>({tag:e.tagName.toLowerCase(),type:e.type,id:e.id,cls:e.className,val:e.value,txt:e.textContent.trim().slice(0,40),href:e.getAttribute("href"),checked:e.checked})),
    headings: [...sr.querySelectorAll("h1,h2,h3,h4")].map(x=>x.tagName+":"+x.textContent.trim()),
    visibleText: [...sr.querySelectorAll("*")].filter(visible).map(n=>[...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent.trim()).filter(Boolean).join(" ")).filter(Boolean).join(" | "),
  };
});
console.log("=== OLD statement ===", JSON.stringify(st, null, 1));
await shot(h.page, "my-contribution-statement-old-authed");
await shotMobile(h.page, "my-contribution-statement-old-mobile");

// legacy: what does the download control do? intercept the popup/download
const dlControls = await h.page.locator("mpp-my-contribution-statement a, mpp-my-contribution-statement button, mpp-my-contribution-statement input[type=button], mpp-my-contribution-statement input[type=submit]").count();
console.log("legacy statement clickable count:", dlControls);

await h.close();
