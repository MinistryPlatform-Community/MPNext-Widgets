import { launch, shot, shotMobile, waitForWidget, listShadowHosts, assertAuthenticated, OLD_ORIGIN, NEW_ORIGIN } from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GID = process.env.GID || "49";
const AUTHED = process.env.AUTHED === "1";
const suffix = AUTHED ? "authed" : "anon";

// ---- OLD ----
{
  const h = await launch({ site: "old", authed: AUTHED });
  h.log.echo = false;
  await h.page.goto(`${OLD_ORIGIN}/widgets/group_details.aspx?id=${GID}`, { waitUntil: "domcontentloaded" });
  if (AUTHED) await assertAuthenticated(h.page, "old");
  console.log("OLD HOSTS:", JSON.stringify(await listShadowHosts(h.page)).slice(0, 500));
  const t = await waitForWidget(h.page, "mpp-group-details", { timeout: 60000 });
  console.log("OLD TEXT:", t.slice(0, 2500));
  await shot(h.page, `group-details-old-${suffix}`);
  const info = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-details").shadowRoot;
    const vis = (el) => {
      if (!el) return false;
      let n = el;
      while (n && n !== sr) { const s = getComputedStyle(n); if (s.display === "none" || s.visibility === "hidden") return false; n = n.parentElement || n.getRootNode().host; }
      return true;
    };
    const ids = ["formTabs", "inquireTab", "signUpTab", "inquiryForm", "signupForm", "loginButtonContainer", "inquireAs", "signUpAs", "inquiryBlankForm", "signupBlankForm", "userHasInquiredContainer", "userHasSignedUpContainer", "map", "mapAddress", "contactGroupButton", "signUpButton", "invalidInquiryEmailContainer", "invalidSignUpEmailContainer"];
    const out = {};
    for (const id of ids) { const el = sr.querySelector("#" + id); out[id] = el ? { vis: vis(el), text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 150) } : null; }
    out._labels = [...sr.querySelectorAll("label")].map((l) => l.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
    out._inputs = [...sr.querySelectorAll("input,select,textarea")].map((e) => ({ id: e.id, name: e.name, type: e.type, req: e.hasAttribute("required"), vis: vis(e), opts: e.tagName === "SELECT" ? [...e.options].map((o) => o.text) : undefined }));
    out._details = (sr.querySelector("#detailsContainer") || {}).textContent ? sr.querySelector("#detailsContainer").textContent.replace(/\s+/g, " ").trim().slice(0, 1200) : null;
    out._tabs = [...sr.querySelectorAll("#formTabs *")].map((e) => e.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 8);
    return out;
  });
  console.log("OLD INFO:", JSON.stringify(info, null, 1));
  await shotMobile(h.page, `group-details-old-${suffix}-mobile`);
  await h.close();
}

// ---- NEW (attributes mirrored onto the legacy page's config) ----
{
  const h = await launch({ site: "new", authed: AUTHED });
  h.log.echo = false;
  await h.page.goto(`${NEW_ORIGIN}/demo-group-details.html?id=${GID}`, { waitUntil: "domcontentloaded" });
  if (AUTHED) await assertAuthenticated(h.page, "new");
  // rebuild the widget with the legacy page's exact configuration
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
  const t = await waitForWidget(h.page, "next-group-details", { timeout: 60000 });
  console.log("NEW TEXT:", t.slice(0, 2500));
  await shot(h.page, `group-details-new-${suffix}`);
  const info = await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-details").shadowRoot;
    const out = {};
    out._labels = [...sr.querySelectorAll("label")].map((l) => l.textContent.replace(/\s+/g, " ").trim()).filter(Boolean);
    out._inputs = [...sr.querySelectorAll("input,select,textarea")].map((e) => ({ id: e.id, name: e.name, type: e.type, req: e.hasAttribute("required"), opts: e.tagName === "SELECT" ? [...e.options].map((o) => o.text) : undefined }));
    out._tabs = [...sr.querySelectorAll('[role="tab"],.tab,[data-tab]')].map((e) => `${e.tagName}.${e.className}[role=${e.getAttribute("role")}]:${e.textContent.trim().slice(0, 30)}`);
    out._buttons = [...sr.querySelectorAll("button,a")].map((e) => `${e.tagName}:${e.textContent.replace(/\s+/g, " ").trim().slice(0, 40)}`);
    out._hasMap = !!sr.querySelector("iframe,#map,.nw-gd-map");
    out._html = sr.innerHTML.length;
    return out;
  });
  console.log("NEW INFO:", JSON.stringify(info, null, 1));
  await shotMobile(h.page, `group-details-new-${suffix}-mobile`);
  console.log("api:", h.log.api.map((a) => `${a.status} ${a.url.replace("http://localhost:3000", "")}`).join("\n"));
  console.log("apiFailures:", JSON.stringify(h.log.apiFailures()));
  console.log("consoleErrors:", JSON.stringify(h.log.consoleErrors().map((c) => c.text).slice(0, 8)));
  await h.close();
}
