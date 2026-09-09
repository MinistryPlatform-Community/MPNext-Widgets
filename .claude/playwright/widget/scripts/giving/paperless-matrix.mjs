import { launch, newDemoUrl, waitForWidget, assertAuthenticated, safeUrl, shot }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";
import { execSync } from "node:child_process";

const SCD = process.env.GIVING_SCRATCH || ".";
function mpq(args) {
  const q = args.map(a => `"${a}"`).join(" ");
  return execSync(`pnpm exec tsx .claude/playwright/widget/scripts/giving/mp-query.mts ${q}`, { cwd: "S:/MP/MPNext-Components", encoding: "utf8", shell: "cmd.exe" });
}
function setMethod(id) { mpq(["updatef", "Donors", `${SCD}/donor-${id}.json`]); }
function getMethod() {
  const o = mpq(["t", "Donors", "Donor_ID,Statement_Method_ID", "Contact_ID = 98", "1"]);
  return JSON.parse(o.slice(o.indexOf("[")))[0].Statement_Method_ID;
}

const hn = await launch({ site: "new", authed: true });
const ho = await launch({ site: "old", authed: true });
const reqs = [];
ho.page.on("request", r => { if (/ContributionsApi/i.test(r.url())) reqs.push(`${r.method()} ${safeUrl(r.url())}`); });

for (const m of [1, 2, 4]) {
  setMethod(m);
  console.log(`\n##### MP Statement_Method_ID = ${m} (${getMethod()}) #####`);
  await hn.page.goto(newDemoUrl("statement-preferences"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(hn.page, "new");
  await waitForWidget(hn.page, "next-statement-preferences", { apiPattern: /statement-preferences/ });
  console.log("NEW toggle checked:", await hn.page.locator("next-statement-preferences #paperless-toggle").isChecked());

  await ho.page.goto("https://mpi.ministryplatform.com/widgets/my_contribution_statement.aspx", { waitUntil: "domcontentloaded" });
  await assertAuthenticated(ho.page, "old");
  await ho.page.waitForTimeout(6000);
  console.log("OLD checkbox:", JSON.stringify(await ho.page.evaluate(() => [...document.querySelector("mpp-my-contribution-statement").shadowRoot.querySelectorAll("input[type=checkbox]")].map(i=>({id:i.id,checked:i.checked})))));
}

// Now: what does LEGACY write when toggled? Start from 1.
setMethod(1);
await ho.page.goto("https://mpi.ministryplatform.com/widgets/my_contribution_statement.aspx", { waitUntil: "domcontentloaded" });
await assertAuthenticated(ho.page, "old");
await ho.page.waitForTimeout(6000);
reqs.length = 0;
const clicked = await ho.page.evaluate(() => {
  const sr = document.querySelector("mpp-my-contribution-statement").shadowRoot;
  const cb = sr.querySelector("#StatementMethod");
  const lbl = sr.querySelector("label[for], .mpp-subscriptions--checkboxlabel, .mpp-card-multiselect--checkbox");
  const info = { cbFound: !!cb, lblTag: lbl?.tagName, lblCls: lbl?.className, lblFor: lbl?.getAttribute?.("for") };
  if (cb) { cb.click(); }
  return info;
});
console.log("\nlegacy click info:", JSON.stringify(clicked));
await ho.page.waitForTimeout(5000);
console.log("legacy requests after JS click:", JSON.stringify(reqs));
console.log("legacy checkbox now:", JSON.stringify(await ho.page.evaluate(() => document.querySelector("mpp-my-contribution-statement").shadowRoot.querySelector("#StatementMethod").checked)));
console.log("MP method after legacy toggle:", getMethod());
await shot(ho.page, "my-contribution-statement-old-paperless-write");
await hn.close(); await ho.close();
