import { launch, shot, assertAuthenticated, safeUrl }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const h = await launch({ site: "old", authed: true });
const reqs = [];
h.page.on("request", r => { if (/ContributionsApi|SetStatement|files|Statement/i.test(r.url())) reqs.push(`${r.method()} ${safeUrl(r.url())}`); });
h.page.on("response", async r => { if (/ContributionsApi|SetStatement/i.test(r.url())) console.log("RESP", r.status(), safeUrl(r.url())); });

await h.page.goto("https://mpi.ministryplatform.com/widgets/my_contribution_statement.aspx", { waitUntil: "domcontentloaded" });
await assertAuthenticated(h.page, "old");
await h.page.waitForTimeout(6000);

const cb = await h.page.evaluate(() => {
  const sr = document.querySelector("mpp-my-contribution-statement").shadowRoot;
  const inputs = [...sr.querySelectorAll("input[type=checkbox]")].map(i => ({ id: i.id, checked: i.checked, cls: i.className, disp: getComputedStyle(i).display, op: getComputedStyle(i).opacity }));
  return inputs;
});
console.log("OLD paperless checkbox(es):", JSON.stringify(cb));

// click the label to toggle paperless
reqs.length = 0;
await h.page.locator("mpp-my-contribution-statement .mpp-subscriptions--checkboxlabel").click();
await h.page.waitForTimeout(4000);
console.log("OLD toggle requests:", JSON.stringify(reqs));
console.log("OLD checkbox after:", JSON.stringify(await h.page.evaluate(() => [...document.querySelector("mpp-my-contribution-statement").shadowRoot.querySelectorAll("input[type=checkbox]")].map(i=>i.checked))));
await shot(h.page, "my-contribution-statement-old-paperless-toggled");

// Save as PDF
reqs.length = 0;
const pagesBefore = h.ctx.pages().length;
const dlPromise = h.page.waitForEvent("download", { timeout: 8000 }).catch(()=>null);
const popupPromise = h.ctx.waitForEvent("page", { timeout: 8000 }).catch(()=>null);
await h.page.locator("mpp-my-contribution-statement #saveAsPDFButton").click();
const [dl, popup] = await Promise.all([dlPromise, popupPromise]);
await h.page.waitForTimeout(3000);
console.log("OLD saveAsPDF download:", dl ? dl.suggestedFilename() : null);
console.log("OLD saveAsPDF popup:", popup ? popup.url() : null);
console.log("OLD saveAsPDF requests:", JSON.stringify(reqs));
await h.close();
