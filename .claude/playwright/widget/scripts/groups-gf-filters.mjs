import { launch, shot, newDemoUrl, oldPageUrl, waitForWidget } from "file:///S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  ["keyword=bible", { keyword: "bible" }],
  ["keyword=golf", { keyword: "golf" }],
  ["congregation=Main", { congregationText: "Main Congregation" }],
  ["day=Monday", { day: "2" }],
  ["time=evening", { time: "evening" }],
  ["meetsOnline", { online: true }],
  ["focus=Bible & Book Study", { focusText: "Bible & Book Study" }],
  ["lifeStage=Single", { lifeText: "Single" }],
  ["city=Melbourne", { city: "Melbourne" }],
  ["city=32904", { city: "32904" }],
  ["keyword=zzzznomatch", { keyword: "zzzznomatch" }],
];

const SEL = {
  old: { tag: "mpp-group-finder", keyword: "#keyword", cong: "#congregationId", city: "#cityPostalCode", focus: "#groupFocusId", life: "#lifeStageId", online: "#meetsOnline", submit: "#searchButton", advanced: "#advancedSearchLink" },
  new: { tag: "next-group-finder", keyword: "#gf-keyword", cong: "#gf-congregation", city: "#gf-city", focus: "#gf-focus", life: "#gf-life", online: "#gf-online", submit: "button[type=submit]", advanced: '[data-action="toggle-advanced"]' },
};

function applyInPage(sel, c) {
  const sr = document.querySelector(sel.tag).shadowRoot;
  const q = (s) => sr.querySelector(s);
  q(sel.keyword).value = c.keyword || "";
  q(sel.city).value = c.city || "";
  const setByText = (s, text) => {
    const el = q(s);
    if (!el) return;
    if (!text) { el.value = ""; return; }
    const opt = [...el.options].find((o) => o.text.trim() === text);
    el.value = opt ? opt.value : "";
  };
  setByText(sel.cong, c.congregationText);
  setByText(sel.focus, c.focusText);
  setByText(sel.life, c.lifeText);
  sr.querySelectorAll('input[name="meetingDays"]').forEach((el) => { el.checked = !!c.day && el.value === c.day; });
  sr.querySelectorAll('input[name="meetingTimes"]').forEach((el) => { el.checked = !!c.time && el.value === c.time; });
  q(sel.online).checked = !!c.online;
}

function readOld() {
  const sr = document.querySelector("mpp-group-finder").shadowRoot;
  const rc = sr.querySelector("#resultsContainer");
  const empty = sr.querySelector("#emptyContainer");
  return {
    count: rc ? rc.children.length : -1,
    ids: rc ? [...rc.querySelectorAll("a.buildDetailsButton")].map((a) => a.id) : [],
    titles: rc ? [...rc.querySelectorAll("h3.mpp-card--title")].map((a) => a.textContent.trim()) : [],
    empty: (empty ? empty.textContent : "").replace(/\s+/g, " ").trim().slice(0, 140),
  };
}

function readNew() {
  const sr = document.querySelector("next-group-finder").shadowRoot;
  const g = sr.querySelector(".nw-gf-grid");
  const st = sr.querySelector(".nw-gf-state");
  return {
    count: g ? g.children.length : -1,
    ids: g ? [...g.children].map((c) => c.getAttribute("data-group-id")) : [],
    titles: g ? [...g.querySelectorAll("h3")].map((a) => a.textContent.trim()) : [],
    empty: (st ? st.textContent : "").replace(/\s+/g, " ").trim().slice(0, 140),
  };
}

async function runSite(site) {
  const sel = SEL[site];
  const h = await launch({ site, authed: false });
  h.log.echo = false;
  const url = site === "old" ? oldPageUrl("group-finder") : newDemoUrl("group-finder");
  await h.page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForWidget(h.page, sel.tag, { timeout: 60000, ...(site === "new" ? { apiPattern: /\/api\/embed\/group-finder(\?|$)/ } : {}) });
  await h.page.locator(`${sel.tag} ${sel.advanced}`).click();
  await sleep(400);

  const out = {};
  for (const [label, c] of CASES) {
    await h.page.evaluate(([s, cc]) => {
      const sr = document.querySelector(s.tag).shadowRoot;
      const q = (x) => sr.querySelector(x);
      q(s.keyword).value = cc.keyword || "";
      q(s.city).value = cc.city || "";
      const setByText = (x, text) => {
        const el = q(x);
        if (!el) return;
        if (!text) { el.value = ""; return; }
        const opt = [...el.options].find((o) => o.text.trim() === text);
        el.value = opt ? opt.value : "";
      };
      setByText(s.cong, cc.congregationText);
      setByText(s.focus, cc.focusText);
      setByText(s.life, cc.lifeText);
      sr.querySelectorAll('input[name="meetingDays"]').forEach((el) => { el.checked = !!cc.day && el.value === cc.day; });
      sr.querySelectorAll('input[name="meetingTimes"]').forEach((el) => { el.checked = !!cc.time && el.value === cc.time; });
      q(s.online).checked = !!cc.online;
    }, [sel, c]);
    await h.page.locator(`${sel.tag} ${sel.submit}`).click();
    await sleep(2600);
    const r = await h.page.evaluate(site === "old" ? readOld : readNew);
    out[label] = r;
    console.log(site.toUpperCase(), label, JSON.stringify(r));
  }
  await shot(h.page, `group-finder-${site}-empty-state`);
  if (site === "new") {
    console.log("api group-finder calls:", h.log.api.filter((a) => /group-finder\?/.test(a.url)).map((a) => `${a.status} ${a.url.replace("http://localhost:3000", "")}`).join("\n"));
    console.log("apiFailures", JSON.stringify(h.log.apiFailures()));
  }
  await h.close();
  return out;
}

const oldR = await runSite("old");
const newR = await runSite("new");

console.log("\n=== DIFF ===");
for (const [label] of CASES) {
  const o = oldR[label], n = newR[label];
  const same = o.count === n.count && JSON.stringify(o.ids) === JSON.stringify(n.ids);
  console.log(`${same ? "SAME" : "DIFF"} ${label}: old=${o.count}[${o.ids}] new=${n.count}[${n.ids}]`);
}
console.log("\nold empty copy:", JSON.stringify(oldR["keyword=zzzznomatch"].empty));
console.log("new empty copy:", JSON.stringify(newR["keyword=zzzznomatch"].empty));
