import { launch, shot, waitForWidget, assertAuthenticated, OLD_ORIGIN, NEW_ORIGIN } from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GID = "49";
const SIDE = process.env.SIDE || "new";
const DO_SIGNUP = process.env.DO_SIGNUP === "1";

if (SIDE === "new") {
  const h = await launch({ site: "new", authed: true });
  h.log.echo = true;
  await h.page.goto(`${NEW_ORIGIN}/demo-group-details.html?id=${GID}`, { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "new");
  await h.page.evaluate((gid) => {
    const box = document.querySelector(".demo-box");
    box.querySelectorAll("next-group-details").forEach((e) => e.remove());
    const w = document.createElement("next-group-details");
    w.setAttribute("group-id", gid);
    w.setAttribute("return-url", "/demo-group-finder.html");
    w.setAttribute("inquiry-email-template", "665");
    w.setAttribute("signup-email-template", "664");
    w.setAttribute("leader-signup-email-template", "664");
    w.setAttribute("inquire-full-groups", "false");
    w.setAttribute("api-host", window.__nextEmbedApiHost);
    box.appendChild(w);
  }, GID);
  await waitForWidget(h.page, "next-group-details", { timeout: 60000 });

  if (!DO_SIGNUP) {
    await h.page.evaluate(() => {
      const sr = document.querySelector("next-group-details").shadowRoot;
      const msg = sr.querySelector("#gd-inquire-message");
      msg.value = "ZZTEST-groups-agent NEW inquiry 2026-09-08";
      msg.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const picker = await h.page.evaluate(() => {
      const sr = document.querySelector("next-group-details").shadowRoot;
      const s = sr.querySelector("#gd-inquire-as");
      return { value: s.value, selectedText: s.options[s.selectedIndex].text };
    });
    console.log("NEW picker default:", JSON.stringify(picker));
    await h.page.locator("next-group-details .gd-submit").first().click();
    await sleep(3500);
    console.log("NEW after inquiry submit:", (await h.page.evaluate(() => document.querySelector("next-group-details").shadowRoot.textContent.replace(/\s+/g, " ").trim())).slice(0, 500));
    await shot(h.page, "group-details-new-inquiry-submitted");
  } else {
    await h.page.locator('next-group-details [data-tab="signup"]').first().click();
    await sleep(1200);
    await h.page.evaluate(() => {
      const sr = document.querySelector("next-group-details").shadowRoot;
      const msg = sr.querySelector("#gd-signup-message");
      msg.value = "ZZTEST-groups-agent NEW signup 2026-09-08";
      msg.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await h.page.locator("next-group-details .gd-submit").first().click();
    await sleep(4000);
    console.log("NEW after signup submit:", (await h.page.evaluate(() => document.querySelector("next-group-details").shadowRoot.textContent.replace(/\s+/g, " ").trim())).slice(0, 500));
    await shot(h.page, "group-details-new-signup-submitted");
  }
  console.log("api:", h.log.api.map((a) => `${a.status} ${a.method || ""} ${a.url.replace("http://localhost:3000", "")}`).join("\n"));
  console.log("apiFailures:", JSON.stringify(h.log.apiFailures()));
  await h.close();
} else {
  const h = await launch({ site: "old", authed: true });
  h.log.echo = false;
  await h.page.goto(`${OLD_ORIGIN}/widgets/group_details.aspx?id=${GID}`, { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "old");
  await waitForWidget(h.page, "mpp-group-details", { timeout: 60000 });
  const reqs = [];
  h.page.on("request", (r) => { if (/GroupsApi|Communication|Inquir|SignUp/i.test(r.url())) reqs.push(`${r.method()} ${r.url()}`); });
  h.page.on("response", async (r) => { if (/GroupsApi/i.test(r.url())) reqs.push(`RESP ${r.status()} ${r.url()}`); });

  if (!DO_SIGNUP) {
    await h.page.evaluate(() => {
      const sr = document.querySelector("mpp-group-details").shadowRoot;
      const sel = sr.querySelector("#inquireAs");
      const opt = [...sel.options].find((o) => o.text === "Kehayias, Chris");
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await sleep(1000);
    await h.page.evaluate(() => {
      const sr = document.querySelector("mpp-group-details").shadowRoot;
      const m = sr.querySelector("#inquire_messageText");
      m.value = "ZZTEST-groups-agent OLD inquiry 2026-09-08";
      m.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await h.page.locator("mpp-group-details #contactGroupButton").click();
    await sleep(5000);
    console.log("OLD after inquiry submit:", (await h.page.evaluate(() => document.querySelector("mpp-group-details").shadowRoot.textContent.replace(/\s+/g, " ").trim())).slice(0, 600));
    await shot(h.page, "group-details-old-inquiry-submitted");
  } else {
    await h.page.locator("mpp-group-details #signUpTab").click();
    await sleep(1200);
    await h.page.evaluate(() => {
      const sr = document.querySelector("mpp-group-details").shadowRoot;
      const sel = sr.querySelector("#signUpAs");
      const opt = [...sel.options].find((o) => o.text === "Kehayias, Chris");
      sel.value = opt.value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      const m = sr.querySelector("#signUp_messageText");
      m.value = "ZZTEST-groups-agent OLD signup 2026-09-08";
      m.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(800);
    await h.page.locator("mpp-group-details #signUpButton").click();
    await sleep(5000);
    console.log("OLD after signup submit:", (await h.page.evaluate(() => document.querySelector("mpp-group-details").shadowRoot.textContent.replace(/\s+/g, " ").trim())).slice(0, 600));
    await shot(h.page, "group-details-old-signup-submitted");
  }
  console.log("OLD requests:", reqs.join("\n"));
  await h.close();
}
