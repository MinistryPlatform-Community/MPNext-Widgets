import { launch, shot, newDemoUrl, oldPageUrl, waitForWidget } from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- NEW: keyboard activation of result card ----
{
  const h = await launch({ site: "new", authed: false });
  h.log.echo = false;
  await h.page.goto(newDemoUrl("group-finder"), { waitUntil: "domcontentloaded" });
  await waitForWidget(h.page, "next-group-finder", { apiPattern: /\/api\/embed\/group-finder(\?|$)/, timeout: 60000 });

  // focus the first card, press Enter, then Space
  const card = h.page.locator("next-group-finder .nw-gf-card").first();
  await card.focus();
  const focusInfo = await h.page.evaluate(() => {
    const ae = document.activeElement;
    const inner = ae && ae.shadowRoot ? ae.shadowRoot.activeElement : null;
    return { host: ae ? ae.tagName : null, inner: inner ? inner.className : null, role: inner ? inner.getAttribute("role") : null, tabindex: inner ? inner.getAttribute("tabindex") : null };
  });
  console.log("NEW focused:", JSON.stringify(focusInfo));
  const before = h.page.url();
  await h.page.keyboard.press("Enter");
  await sleep(1200);
  console.log("NEW after Enter, url changed:", h.page.url() !== before, h.page.url());
  await h.page.keyboard.press(" ");
  await sleep(1200);
  console.log("NEW after Space, url changed:", h.page.url() !== before, h.page.url());
  await shot(h.page, "group-finder-new-card-keyboard");

  // outline / focus-visible styles on the card
  const fv = await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-finder").shadowRoot;
    const c = sr.querySelector(".nw-gf-card");
    c.focus();
    const cs = getComputedStyle(c);
    return { outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor, boxShadow: cs.boxShadow };
  });
  console.log("NEW card focus style:", JSON.stringify(fv));

  // tab order through the widget
  const order = [];
  await h.page.locator("next-group-finder #gf-keyword").focus();
  for (let i = 0; i < 8; i++) {
    const d = await h.page.evaluate(() => {
      const ae = document.activeElement;
      const inner = ae && ae.shadowRoot ? ae.shadowRoot.activeElement : ae;
      return inner ? `${inner.tagName}#${inner.id || ""}.${(inner.className || "").toString().split(" ")[0]}` : "none";
    });
    order.push(d);
    await h.page.keyboard.press("Tab");
  }
  console.log("NEW tab order:", JSON.stringify(order));

  // suggest-a-group anonymous behaviour
  await h.page.locator('next-group-finder [data-action="open-suggest"]').click();
  await sleep(600);
  console.log("NEW suggest anon shadow text:", (await h.page.evaluate(() => document.querySelector("next-group-finder").shadowRoot.textContent.replace(/\s+/g, " ").trim())).slice(0, 500));
  await shot(h.page, "group-finder-new-suggest-anon");
  // empty submit -> validation
  await h.page.locator("next-group-finder #gf-suggest-form button[type=submit]").click();
  await sleep(800);
  const vres = await h.page.evaluate(() => {
    const sr = document.querySelector("next-group-finder").shadowRoot;
    const msg = sr.querySelector("#gf-suggest-message");
    return {
      message: msg ? msg.textContent.trim() : null,
      fieldErrors: [...sr.querySelectorAll("[class*=error],[class*=invalid],.mpn-field-error,.nw-field-error")].map((e) => `${e.className}:${e.textContent.trim().slice(0, 60)}`),
      ariaInvalid: [...sr.querySelectorAll("[aria-invalid]")].map((e) => `${e.id}=${e.getAttribute("aria-invalid")}`),
    };
  });
  console.log("NEW suggest empty submit:", JSON.stringify(vres, null, 1));
  await shot(h.page, "group-finder-new-suggest-validation");
  await h.close();
}

// ---- OLD: suggest-a-group anonymous ----
{
  const h = await launch({ site: "old", authed: false });
  h.log.echo = false;
  await h.page.goto(oldPageUrl("group-finder"), { waitUntil: "domcontentloaded" });
  await waitForWidget(h.page, "mpp-group-finder", { timeout: 60000 });
  await h.page.locator("mpp-group-finder #suggestAGroupButton").click();
  await sleep(1500);
  const vis = await h.page.evaluate(() => {
    const sr = document.querySelector("mpp-group-finder").shadowRoot;
    const seen = {};
    for (const id of ["loginButtonContainer", "suggestGroupDetailsContainer", "suggestAGroupForm", "goBackButton", "suggestGroupSubmitButton"]) {
      const el = sr.querySelector("#" + id);
      seen[id] = el ? { display: getComputedStyle(el).display, text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 120) } : null;
    }
    const cont = sr.querySelector("#suggest-a-group-container");
    seen._container = cont ? { display: getComputedStyle(cont).display, text: cont.textContent.replace(/\s+/g, " ").trim().slice(0, 300) } : null;
    return seen;
  });
  console.log("OLD suggest anon:", JSON.stringify(vis, null, 1));
  await shot(h.page, "group-finder-old-suggest-anon");
  // old: keyboard on See Details anchor
  await h.page.goto(oldPageUrl("group-finder"), { waitUntil: "domcontentloaded" });
  await waitForWidget(h.page, "mpp-group-finder", { timeout: 60000 });
  const a = h.page.locator("mpp-group-finder a.buildDetailsButton").first();
  await a.focus();
  const before = h.page.url();
  await h.page.keyboard.press("Enter");
  await sleep(2000);
  console.log("OLD after Enter on See Details, url:", h.page.url(), "changed:", h.page.url() !== before);
  await h.close();
}
