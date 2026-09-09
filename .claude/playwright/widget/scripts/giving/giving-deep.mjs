import { launch, shot, shotMobile, newDemoUrl, waitForWidget, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

// Extract visible rows (date | title | badges | amount) from either widget.
async function rowsNew(page) {
  return page.evaluate(() => {
    const sr = document.querySelector("next-my-giving").shadowRoot;
    return [...sr.querySelectorAll(".donation-row")].map(r => ({
      date: r.querySelector(".don-date")?.textContent.trim(),
      title: r.querySelector(".don-title")?.childNodes[0]?.textContent.trim(),
      badges: [...r.querySelectorAll(".badge")].filter(b => getComputedStyle(b).display !== "none").map(b => b.textContent.trim()),
      amount: r.querySelector(".don-amount")?.textContent.trim(),
    }));
  });
}
async function visibleText(page, tag) {
  return page.evaluate((t) => {
    const sr = document.querySelector(t).shadowRoot;
    const out = [];
    for (const n of sr.querySelectorAll("*")) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const own = [...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent.trim()).filter(Boolean).join(" ");
      if (own) out.push(own);
      if (n.tagName === "INPUT" && n.type !== "checkbox" && n.value) out.push(`[input=${n.value}]`);
      if (n.tagName === "INPUT" && n.type === "checkbox") out.push(`[checkbox checked=${n.checked} disabled=${n.disabled}]`);
    }
    return out.join(" | ");
  }, tag);
}

const h = await launch({ site: "new", authed: true });
await h.page.goto(newDemoUrl("my-giving"), { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "new");
await waitForWidget(h.page, "next-my-giving", { apiPattern: /\/api\/embed\/my-giving/ });

console.log("=== NEW 2026 rows (first 4) ===");
console.log(JSON.stringify(await rowsNew(h.page), null, 0));

// SHOW MORE
await h.page.locator('next-my-giving [data-action="show-more"]').click();
await h.page.waitForTimeout(400);
let all = await rowsNew(h.page);
console.log("=== NEW after SHOW MORE: rowCount ===", all.length);
console.log("badge rows:", JSON.stringify(all.filter(r => r.badges.length)));
console.log("sum of displayed amounts:", all.reduce((s,r)=>s+Number((r.amount||"0").replace(/[$,]/g,""))||s,0));
const sum = all.reduce((s,r)=>s+(Number((r.amount||"").replace(/[$,]/g,""))||0),0);
console.log("sum:", sum.toFixed(2));
await shot(h.page, "my-giving-new-showmore");

// SOFT CREDIT TOGGLE
await h.page.locator("next-my-giving #giving-soft-toggle").check();
await h.page.waitForTimeout(500);
await h.page.locator('next-my-giving [data-action="show-more"]').click().catch(()=>{});
await h.page.waitForTimeout(400);
all = await rowsNew(h.page);
const sum2 = all.reduce((s,r)=>s+(Number((r.amount||"").replace(/[$,]/g,""))||0),0);
console.log("=== NEW soft ON: rowCount", all.length, "sum", sum2.toFixed(2));
console.log("soft rows:", JSON.stringify(all.filter(r=>r.badges.some(b=>/SOFT/i.test(b)))));
console.log("total row still:", await h.page.locator("next-my-giving .total-amount").textContent());
console.log("disclaimers:", JSON.stringify(await h.page.locator("next-my-giving .list-subtitle").allTextContents()));
await shot(h.page, "my-giving-new-softcredits-on");
await h.page.locator("next-my-giving #giving-soft-toggle").uncheck();
await h.page.waitForTimeout(400);

// MONTH FILTER: March 2026 (has the split gift + soft credit)
await h.page.locator("next-my-giving #giving-month-select").selectOption("3");
await h.page.waitForTimeout(2000);
console.log("=== NEW month=March ===");
console.log("total:", await h.page.locator("next-my-giving .total-amount").textContent());
console.log("rows:", JSON.stringify(await rowsNew(h.page)));
console.log("charts present:", await h.page.locator("next-my-giving .chart-title").allTextContents());
await shot(h.page, "my-giving-new-month-march");

// YEAR NAV back to 2025 (year-boundary check: Dec 31 2025 $11.11)
await h.page.locator("next-my-giving #giving-month-select").selectOption("-1");
await h.page.waitForTimeout(1500);
await h.page.locator('next-my-giving [data-action="prev-year"]').click();
await h.page.waitForTimeout(2000);
console.log("=== NEW 2025 ===");
console.log("total:", await h.page.locator("next-my-giving .total-amount").textContent());
console.log("rows:", JSON.stringify(await rowsNew(h.page)));
console.log("month select first option:", await h.page.locator("next-my-giving #giving-month-select option").first().textContent());
await shot(h.page, "my-giving-new-2025-year-boundary");

// walk back to the lower bound
for (let i = 0; i < 4; i++) {
  const dis = await h.page.locator('next-my-giving [data-action="prev-year"]').isDisabled();
  const label = (await h.page.locator('next-my-giving [data-action="prev-year"]').textContent()).trim();
  console.log(`prev-year label=${label} disabled=${dis}`);
  if (dis) break;
  await h.page.locator('next-my-giving [data-action="prev-year"]').click();
  await h.page.waitForTimeout(1600);
}
console.log("next-year disabled at floor?", await h.page.locator('next-my-giving [data-action="next-year"]').isDisabled());
console.log("visible text at floor:", (await visibleText(h.page, "next-my-giving")).slice(0, 400));
await shot(h.page, "my-giving-new-year-floor");

// mobile
await h.page.goto(newDemoUrl("my-giving"), { waitUntil: "domcontentloaded" });
await waitForWidget(h.page, "next-my-giving", { apiPattern: /\/api\/embed\/my-giving/ });
await shotMobile(h.page, "my-giving-new-mobile");

// keyboard/a11y probe
const a11y = await h.page.evaluate(() => {
  const sr = document.querySelector("next-my-giving").shadowRoot;
  const focusables = [...sr.querySelectorAll("button,select,input,a[href]")].map(e => ({
    tag: e.tagName.toLowerCase(), id: e.id, label: (e.getAttribute("aria-label")||e.textContent||"").trim().slice(0,40), disabled: e.disabled
  }));
  const svgs = [...sr.querySelectorAll("svg[role=img]")].map(s => s.getAttribute("aria-label"));
  const headings = [...sr.querySelectorAll("h1,h2,h3,h4,h5,h6")].map(x=>x.tagName+":"+x.textContent.trim());
  const tables = sr.querySelectorAll("table").length;
  return { focusables, svgs, headings, tables };
});
console.log("=== NEW a11y ===", JSON.stringify(a11y));
await h.close();
