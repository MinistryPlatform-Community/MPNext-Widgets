import { launch, newDemoUrl, waitForWidget, assertAuthenticated }
  from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";
const h = await launch({ site: "new", authed: true });
const specs = [["my-giving","next-my-giving",/my-giving/],["my-contribution-statement","next-my-contribution-statement",/contribution-statements/],["statement-preferences","next-statement-preferences",/statement-preferences/],["my-pledges","next-my-pledges",/my-pledges/]];
for (const [slug, tag, api] of specs) {
  await h.page.goto(newDemoUrl(slug), { waitUntil: "domcontentloaded" });
  await assertAuthenticated(h.page, "new");
  await waitForWidget(h.page, tag, { apiPattern: api });
  const seq = [];
  for (let i = 0; i < 25; i++) {
    await h.page.keyboard.press("Tab");
    const a = await h.page.evaluate((t) => {
      let el = document.activeElement;
      const path = [];
      while (el) { path.push(el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")); if (el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; else break; }
      const inner = path[path.length - 1];
      const fo = document.activeElement;
      let deep = fo; while (deep.shadowRoot && deep.shadowRoot.activeElement) deep = deep.shadowRoot.activeElement;
      const cs = getComputedStyle(deep);
      return { inner, host: path[0], outline: cs.outlineStyle + " " + cs.outlineWidth, txt: (deep.textContent||deep.value||"").trim().slice(0,28) };
    }, tag);
    if (a.host && a.host.startsWith("next-")) seq.push(a);
    if (seq.length > 0 && !(a.host||"").startsWith("next-") && seq.length > 1) break;
  }
  console.log(`KBD ${slug}:`, JSON.stringify(seq));
}
await h.close();
