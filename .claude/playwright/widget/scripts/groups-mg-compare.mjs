import { launch, shot, shotMobile, waitForWidget, listShadowHosts, assertAuthenticated, newDemoUrl, oldPageUrl } from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- OLD authed ----------
{
  const h = await launch({ site: "old", authed: true });
  h.log.echo = false;
  await h.page.goto(oldPageUrl("my-groups"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "old");
  console.log("OLD HOSTS:", JSON.stringify(await listShadowHosts(h.page)).slice(0, 600));
  const t = await waitForWidget(h.page, "mpp-my-groups", { timeout: 60000 });
  console.log("OLD TEXT:", t.slice(0, 2500));
  await shot(h.page, "my-groups-old-authed");
  const info = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-my-groups").shadowRoot;
    const rc = sr.querySelector("#resultsContainer");
    return {
      count: rc ? rc.children.length : -1,
      cards: rc ? [...rc.children].map((c) => c.textContent.replace(/\s+/g, " ").trim().slice(0, 200)) : [],
      links: [...sr.querySelectorAll("a")].map((a) => `${a.textContent.replace(/\s+/g, " ").trim().slice(0, 40)} -> ${a.getAttribute("href")}`),
      buttons: [...sr.querySelectorAll("button,input[type=submit],.mppw-btn")].map((b) => (b.textContent || b.value || "").replace(/\s+/g, " ").trim().slice(0, 40)),
      firstHtml: rc && rc.children[0] ? rc.children[0].outerHTML.slice(0, 1400) : null,
    };
  });
  console.log("OLD INFO:", JSON.stringify(info, null, 1));
  await shotMobile(h.page, "my-groups-old-authed-mobile");
  await h.close();
}

// ---------- OLD anon ----------
{
  const h = await launch({ site: "old", authed: false });
  h.log.echo = false;
  await h.page.goto(oldPageUrl("my-groups"), { waitUntil: "domcontentloaded" });
  const t = await waitForWidget(h.page, "mpp-my-groups", { timeout: 60000 });
  console.log("OLD ANON TEXT:", t.slice(0, 600));
  const info = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-my-groups").shadowRoot;
    const vis = (el) => el && getComputedStyle(el).display !== "none";
    return {
      notLoggedIn: (() => { const e = sr.querySelector("#myGroupsNotLoggedIn"); return e ? { vis: vis(e), text: e.textContent.replace(/\s+/g, " ").trim() } : null; })(),
      loginBtn: (() => { const e = sr.querySelector("#loginButton"); return e ? { vis: vis(e), text: (e.textContent || e.value || "").trim() } : null; })(),
      empty: (() => { const e = sr.querySelector("#emptyContainer"); return e ? e.textContent.replace(/\s+/g, " ").trim().slice(0, 200) : null; })(),
    };
  });
  console.log("OLD ANON INFO:", JSON.stringify(info, null, 1));
  await shot(h.page, "my-groups-old-signed-out");
  await h.close();
}

// ---------- NEW authed ----------
{
  const h = await launch({ site: "new", authed: true });
  h.log.echo = false;
  await h.page.goto(newDemoUrl("my-groups"), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "new");
  await h.page.evaluate(() => {
    const c = document.getElementById("widget-container");
    if (c) c.style.display = "";
    const p = document.getElementById("auth-placeholder");
    if (p) p.style.display = "none";
  });
  const t = await waitForWidget(h.page, "next-my-groups", { apiPattern: /\/api\/embed\/my-groups/, timeout: 60000 });
  console.log("NEW TEXT:", t.slice(0, 2500));
  await shot(h.page, "my-groups-new-authed");
  const info = await h.page.evaluate(() => {
    const sr = document.querySelector("next-my-groups").shadowRoot;
    const g = sr.querySelector(".group-grid");
    return {
      count: g ? g.children.length : -1,
      cards: g ? [...g.children].map((c) => c.textContent.replace(/\s+/g, " ").trim().slice(0, 200)) : [],
      links: [...sr.querySelectorAll("a")].map((a) => `${a.textContent.replace(/\s+/g, " ").trim().slice(0, 40)} -> ${a.getAttribute("href")}`),
      buttons: [...sr.querySelectorAll("button")].map((b) => b.textContent.replace(/\s+/g, " ").trim().slice(0, 40)),
      firstHtml: g && g.children[0] ? g.children[0].outerHTML.slice(0, 1400) : null,
    };
  });
  console.log("NEW INFO:", JSON.stringify(info, null, 1));
  const raw = await h.page.evaluate(async () => {
    const r = await window.MPNextEmbed.getAuthSession().getToken();
    const res = await fetch("http://localhost:3000/api/embed/my-groups", { headers: { Authorization: `Bearer ${r}` } });
    return { status: res.status, body: await res.text() };
  });
  console.log("NEW API my-groups:", raw.status, raw.body.slice(0, 3000));
  await shotMobile(h.page, "my-groups-new-authed-mobile");
  console.log("apiFailures:", JSON.stringify(h.log.apiFailures()));
  console.log("consoleErrors:", JSON.stringify(h.log.consoleErrors().map((c) => c.text).slice(0, 6)));
  await h.close();
}

// ---------- NEW anon ----------
{
  const h = await launch({ site: "new", authed: false });
  h.log.echo = false;
  await h.page.goto(newDemoUrl("my-groups"), { waitUntil: "domcontentloaded" });
  await h.page.evaluate(() => {
    const c = document.getElementById("widget-container");
    if (c) c.style.display = "";
    const p = document.getElementById("auth-placeholder");
    if (p) p.style.display = "none";
  });
  const t = await waitForWidget(h.page, "next-my-groups", { timeout: 60000 });
  console.log("NEW ANON TEXT:", t.slice(0, 600));
  const info = await h.page.evaluate(() => {
    const sr = document.querySelector("next-my-groups").shadowRoot;
    return { html: sr.innerHTML.replace(/\s+/g, " ").slice(0, 900),
      buttons: [...sr.querySelectorAll("button")].map((b) => b.textContent.trim()) };
  });
  console.log("NEW ANON INFO:", JSON.stringify(info, null, 1));
  await shot(h.page, "my-groups-new-signed-out");
  console.log("api:", h.log.api.map((a) => `${a.status} ${a.url.replace("http://localhost:3000", "")}`).join("\n"));
  await h.close();
}
