import { launch, shot, waitForWidget, assertAuthenticated, newDemoUrl, oldPageUrl } from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIDE = process.env.SIDE || "new";

if (SIDE === "new") {
  const h = await launch({ site: "new", authed: true });
  await h.page.goto(newDemoUrl("group-finder"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "new");
  await waitForWidget(h.page, "next-group-finder", { apiPattern: /\/api\/embed\/group-finder(\?|$)/, timeout: 60000 });
  await h.page.locator('next-group-finder [data-action="open-suggest"]').click();
  await sleep(700);
  await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-finder").shadowRoot;
    const set = (id, v) => { const el = sr.querySelector(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    set("#gf-s-name", "ZZTEST-groups-agent NEW suggested group");
    set("#gf-s-desc", "ZZTEST suggestion from the comparison run.");
    const cong = sr.querySelector("#gf-s-cong");
    cong.value = [...cong.options].find((o) => o.text === "Main Congregation").value;
    cong.dispatchEvent(new Event("change", { bubbles: true }));
    const day = sr.querySelector("#gf-s-day");
    day.value = "3";
    set("#gf-s-time", "19:00");
  });
  await h.page.locator("next-group-finder #gf-suggest-form button[type=submit]").click();
  await sleep(4000);
  console.log("NEW suggest result:", (await h.page.evaluate(() => document.querySelector("next-group-finder").shadowRoot.textContent.replace(/\s+/g, " ").trim())).slice(0, 400));
  await shot(h.page, "group-finder-new-suggest-submitted");
  console.log("api:", h.log.api.map((a) => `${a.status} ${a.method || ""} ${a.url.replace("http://localhost:3000", "")}`).join("\n"));
  await h.close();
} else {
  const h = await launch({ site: "old", authed: true });
  h.log.echo = false;
  const reqs = [];
  await h.page.goto(oldPageUrl("group-finder"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "old");
  await waitForWidget(h.page, "mpp-group-finder", { timeout: 60000 });
  h.page.on("response", (r) => { if (/GroupsApi/i.test(r.url())) reqs.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  await h.page.locator("mpp-group-finder #suggestAGroupButton").click();
  await sleep(2500);
  const st = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-finder").shadowRoot;
    const vis = (el) => el && getComputedStyle(el).display !== "none";
    return { login: vis(sr.querySelector("#loginButtonContainer")), details: vis(sr.querySelector("#suggestGroupDetailsContainer")) };
  });
  console.log("OLD suggest authed visibility:", JSON.stringify(st));
  await shot(h.page, "group-finder-old-suggest-authed");
  if (st.details) {
    await h.page.evaluate(() => {
      const sr = document.querySelector("mpp-group-finder").shadowRoot;
      const set = (id, v) => { const el = sr.querySelector(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
      set("#groupName", "ZZTEST-groups-agent OLD suggested group");
      set("#description", "ZZTEST suggestion from the comparison run.");
      const cong = sr.querySelector("#newGroupCongregationId");
      cong.value = [...cong.options].find((o) => o.text === "Main Congregation").value;
      cong.dispatchEvent(new Event("change", { bubbles: true }));
      const day = sr.querySelector("#newGroupMeetingDayId");
      day.value = [...day.options].find((o) => o.text === "Tuesday").value;
      set("#newGroupMeetingTime", "19:00");
    });
    await h.page.locator("mpp-group-finder #suggestGroupSubmitButton").click();
    await sleep(5000);
    console.log("OLD suggest result:", (await h.page.evaluate(() => document.querySelector("mpp-group-finder").shadowRoot.textContent.replace(/\s+/g, " ").trim())).slice(0, 500));
    await shot(h.page, "group-finder-old-suggest-submitted");
  }
  console.log("OLD reqs:", reqs.join("\n"));
  await h.close();
}
