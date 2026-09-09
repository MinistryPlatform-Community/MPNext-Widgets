import { launch, shot, shotMobile, oldPageUrl, waitForWidget, shadowText, listShadowHosts, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const pages = [
  ["my_giving.aspx", "my-giving"],
  ["my_contribution_statement.aspx", "my-contribution-statement"],
  ["my_pledges.aspx", "my-pledges"],
  ["pledge_campaign.aspx", "pledge-campaign"],
];

const h = await launch({ site: "old", authed: true });
for (const [aspx, slug] of pages) {
  console.log(`\n======== OLD ${aspx} ========`);
  h.log.reset();
  await h.page.goto(`https://mpi.ministryplatform.com/widgets/${aspx}`, { waitUntil: "domcontentloaded" });
  try { await assertAuthenticated(h.page, "old"); } catch (e) { console.log("AUTHFAIL", e.message); }
  const hosts = await listShadowHosts(h.page, { preview: 400 });
  console.log("hosts:", JSON.stringify(hosts.map(x => x.tag)));
  for (const x of hosts) {
    if (x.tag.startsWith("mpp-") && !["mpp-locale-selector","mpp-user-login"].includes(x.tag)) {
      console.log(`--- ${x.tag} text: ${x.text}`);
    }
  }
  await h.page.waitForTimeout(2500);
  const full = await h.page.evaluate(() => {
    const walk = (root, out) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) { out.push({ tag: el.tagName.toLowerCase(), text: el.shadowRoot.textContent.replace(/\s+/g," ").trim(), attrs: [...el.attributes].map(a=>a.name+"="+a.value) }); walk(el.shadowRoot, out); }
      }
      return out;
    };
    return walk(document, []);
  });
  for (const f of full) {
    if (f.tag.startsWith("mpp-") && !["mpp-locale-selector","mpp-user-login"].includes(f.tag)) {
      console.log(`>>> ${f.tag} attrs=${JSON.stringify(f.attrs)}`);
      console.log(`>>> ${f.tag} SETTLED TEXT: ${f.text}`);
    }
  }
  await shot(h.page, `${slug}-old-initial`);
  console.log("api failures:", JSON.stringify(h.log.apiFailures()));
  console.log("console errors:", JSON.stringify(h.log.consoleErrors().map(c=>c.text).slice(0,10)));
}
await h.close();
