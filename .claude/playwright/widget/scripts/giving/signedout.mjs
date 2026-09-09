import { launch, shot, newDemoUrl, waitForWidget, shadowText }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const specs = [
  ["my-giving", "next-my-giving"],
  ["my-contribution-statement", "next-my-contribution-statement"],
  ["statement-preferences", "next-statement-preferences"],
  ["my-pledges", "next-my-pledges"],
  ["pledge-campaign", "next-pledge-campaign"],
];

console.log("############ NEW, anonymous ############");
{
  const h = await launch({ site: "new", authed: false });
  for (const [slug, tag] of specs) {
    h.log.reset();
    await h.page.goto(newDemoUrl(slug), { waitUntil: "domcontentloaded" });
    let t = "";
    try { t = await waitForWidget(h.page, tag, { timeout: 20000 }); } catch (e) { t = "WAITFAIL " + e.message; }
    console.log(`--- ${slug}: ${t}`);
    const hasSignIn = await h.page.locator(`${tag} button`, { hasText: /sign in/i }).count();
    console.log(`    sign-in button count: ${hasSignIn}`);
    console.log(`    api: ${JSON.stringify(h.log.api.map(a=>a.status+" "+a.url.replace("http://localhost:3000","")))}`);
    await shot(h.page, `${slug}-new-signedout`);
    await h.page.waitForTimeout(500);
  }
  await h.close();
}

console.log("\n############ OLD, anonymous ############");
{
  const h = await launch({ site: "old", authed: false });
  const olds = [["my_giving.aspx","mpp-my-giving","my-giving"],["my_contribution_statement.aspx","mpp-my-contribution-statement","my-contribution-statement"],["my_pledges.aspx","mpp-my-pledges","my-pledges"],["pledge_campaign.aspx","mpp-pledge-campaign","pledge-campaign"]];
  for (const [aspx, tag, slug] of olds) {
    await h.page.goto(`https://mpi.ministryplatform.com/widgets/${aspx}`, { waitUntil: "domcontentloaded" });
    await h.page.waitForTimeout(4000);
    const info = await h.page.evaluate((t) => {
      const el = document.querySelector(t);
      if (!el || !el.shadowRoot) return null;
      const sr = el.shadowRoot;
      const visible = [];
      for (const n of sr.querySelectorAll("*")) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const own = [...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent.trim()).filter(Boolean).join(" ");
        if (own) visible.push(own);
        if (n.tagName === "INPUT" && n.value) visible.push(`[input value=${n.value}]`);
      }
      return visible.join(" | ");
    }, tag);
    console.log(`--- ${slug}: ${info}`);
    await shot(h.page, `${slug}-old-signedout`);
  }
  await h.close();
}
