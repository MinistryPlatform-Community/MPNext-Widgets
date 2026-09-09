import { launch, shot, waitForWidget, assertAuthenticated, OLD_ORIGIN, NEW_ORIGIN } from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GID = "49";

// ---------- NEW ----------
{
  const h = await launch({ site: "new", authed: true });
  h.log.echo = false;
  let nativePopup = false;
  h.page.on("console", (m) => { if (/reportValidity/i.test(m.text())) nativePopup = true; });
  await h.page.goto(`${NEW_ORIGIN}/demo-group-details.html?id=${GID}`, { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "new");
  // instrument reportValidity so we can detect the native popup
  await h.page.evaluate(() => {
    window.__rv = 0;
    const p = HTMLFormElement.prototype.reportValidity;
    HTMLFormElement.prototype.reportValidity = function () { window.__rv++; return p.apply(this, arguments); };
    const pe = HTMLInputElement.prototype.reportValidity;
    HTMLInputElement.prototype.reportValidity = function () { window.__rv++; return pe.apply(this, arguments); };
  });
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

  // --- SIGN UP tab ---
  await h.page.locator('next-group-details [data-tab="signup"]').first().click();
  await sleep(1200);
  const signup = await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-details").shadowRoot;
    return {
      text: sr.textContent.replace(/\s+/g, " ").trim().slice(0, 700),
      inputs: [...sr.querySelectorAll("#gd-signup-form input,#gd-signup-form select,#gd-signup-form textarea")].map((e) => ({ id: e.id, name: e.name, type: e.type, req: e.hasAttribute("required"), opts: e.tagName === "SELECT" ? [...e.options].map((o) => o.text) : undefined })),
      warningVisible: (() => { const w = sr.querySelector("#gd-signup-warning"); return w ? getComputedStyle(w).display !== "none" : null; })(),
    };
  });
  console.log("NEW SIGNUP TAB:", JSON.stringify(signup, null, 1));
  await shot(h.page, "group-details-new-signup-authed");

  // --- back to inquire, "Someone else" + empty submit ---
  await h.page.locator('next-group-details [data-tab="inquire"]').first().click();
  await sleep(900);
  await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-details").shadowRoot;
    const sel = sr.querySelector("#gd-inquire-as");
    sel.value = "blank";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(900);
  await h.page.locator("next-group-details .gd-submit").first().click();
  await sleep(1000);
  const v1 = await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-details").shadowRoot;
    return { rv: window.__rv, text: sr.textContent.replace(/\s+/g, " ").trim().slice(0, 600),
      errs: [...sr.querySelectorAll(".mpx-field-error,[class*=field-error]")].map((e) => e.textContent.trim()),
      invalid: [...sr.querySelectorAll("[aria-invalid=true]")].map((e) => e.name || e.id),
      required: [...sr.querySelectorAll("#gd-inquire-form [required]")].map((e) => e.name) };
  });
  console.log("NEW empty submit (blank form):", JSON.stringify(v1, null, 1));
  await shot(h.page, "group-details-new-inquiry-validation");

  // --- bad email + bad phone ---
  await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-details").shadowRoot;
    const set = (n, v) => { const el = sr.querySelector(`#gd-inquire-form [name="${n}"]`); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true })); };
    set("firstName", "ZZTEST");
    set("lastName", "Agent");
    set("emailAddress", "not-an-email");
    set("mobilePhoneNumber", "abc");
  });
  await h.page.locator("next-group-details .gd-submit").first().click();
  await sleep(1000);
  const v2 = await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-details").shadowRoot;
    return { rv: window.__rv, errs: [...sr.querySelectorAll(".mpx-field-error,[class*=field-error]")].map((e) => e.textContent.trim()),
      invalid: [...sr.querySelectorAll("[aria-invalid=true]")].map((e) => e.name || e.id),
      msg: (sr.querySelector(".gd-message") || {}).textContent };
  });
  console.log("NEW bad email/phone:", JSON.stringify(v2, null, 1));
  await shot(h.page, "group-details-new-inquiry-bad-email");
  console.log("nativeReportValidity calls:", await h.page.evaluate(() => window.__rv));
  await h.close();
}

// ---------- OLD ----------
{
  const h = await launch({ site: "old", authed: true });
  h.log.echo = false;
  await h.page.goto(`${OLD_ORIGIN}/widgets/group_details.aspx?id=${GID}`, { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "old");
  await waitForWidget(h.page, "mpp-group-details", { timeout: 60000 });
  // signup tab
  await h.page.locator("mpp-group-details #signUpTab").click();
  await sleep(1200);
  const signup = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-details").shadowRoot;
    const vis = (el) => el && getComputedStyle(el).display !== "none";
    return { formVis: vis(sr.querySelector("#signupForm")), loginVis: vis(sr.querySelector("#loginButtonContainer")),
      inputs: [...sr.querySelectorAll("#signupForm input,#signupForm select,#signupForm textarea")].map((e) => ({ id: e.id, name: e.name, type: e.type, req: e.hasAttribute("required"), vis: vis(e), opts: e.tagName === "SELECT" ? [...e.options].map((o) => o.text) : undefined })),
      text: sr.querySelector("#signupContainer") ? sr.querySelector("#signupContainer").textContent.replace(/\s+/g, " ").trim().slice(0, 400) : null };
  });
  console.log("OLD SIGNUP TAB:", JSON.stringify(signup, null, 1));
  await shot(h.page, "group-details-old-signup-authed");

  // inquire: Blank Form + empty submit
  await h.page.locator("mpp-group-details #inquireTab").click();
  await sleep(900);
  await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-details").shadowRoot;
    const sel = sr.querySelector("#inquireAs");
    const opt = [...sel.options].find((o) => o.text === "Blank Form");
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(900);
  await h.page.locator("mpp-group-details #contactGroupButton").click();
  await sleep(1200);
  const v1 = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-details").shadowRoot;
    return { text: sr.textContent.replace(/\s+/g, " ").trim().slice(0, 700),
      errs: [...sr.querySelectorAll("[class*=error],[class*=invalid],.mppw-form-field__error")].map((e) => `${e.className}:${e.textContent.trim().slice(0, 60)}`),
      required: [...sr.querySelectorAll("#inquiryForm [required]")].map((e) => e.name) };
  });
  console.log("OLD empty submit (blank form):", JSON.stringify(v1, null, 1));
  await shot(h.page, "group-details-old-inquiry-validation");

  await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-details").shadowRoot;
    const set = (id, v) => { const el = sr.querySelector(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true })); };
    set("#inquire_firstNameText", "ZZTEST");
    set("#inquire_lastNameText", "Agent");
    set("#inquire_emailText", "not-an-email");
    set("#inquire_phoneText", "abc");
  });
  await h.page.locator("mpp-group-details #contactGroupButton").click();
  await sleep(1500);
  const v2 = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-details").shadowRoot;
    return { errs: [...sr.querySelectorAll("[class*=error],[class*=invalid],.mppw-alert")].map((e) => `${e.className}:${e.textContent.replace(/\s+/g, " ").trim().slice(0, 80)}`) };
  });
  console.log("OLD bad email/phone:", JSON.stringify(v2, null, 1));
  await shot(h.page, "group-details-old-inquiry-bad-email");
  await h.close();
}
