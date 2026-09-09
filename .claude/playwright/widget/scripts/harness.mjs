/**
 * harness.mjs — shared Playwright harness for the 2026-09-08 widget comparison run.
 *
 * Read `.claude/playwright/widget/HARNESS.md` first; this file is the implementation.
 *
 * WHY IT LIVES IN THE REPO: bare specifiers (`playwright`, `dotenv`) only resolve
 * from inside the repo tree. A script in your scratchpad that does
 * `import { chromium } from "playwright"` fails with ERR_MODULE_NOT_FOUND. So this
 * module re-exports what you need — import ONLY from here and your scratchpad
 * scripts work unchanged:
 *
 *   import { launch, shot, chromium } from
 *     "S:/MP/MPNext-Components/.claude/playwright/widget/scripts/harness.mjs";
 *
 * Nothing here writes token material to disk outside the scratchpad state files.
 */

import { chromium, firefox, webkit, devices } from "playwright";
import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync, renameSync, readFileSync } from "node:fs";
import path from "node:path";

export { chromium, firefox, webkit, devices };

// ── Paths & constants ────────────────────────────────────────────────

export const REPO = "S:/MP/MPNext-Components";
export const SHOTS = `${REPO}/.claude/playwright/widget/screenshots`;
export const TESTS = `${REPO}/.claude/playwright/widget/tests`;

/** Scratchpad for this session. Storage-state files live here and NEVER in the repo. */
export const SCRATCH =
  "C:/Users/ckeha/AppData/Local/Temp/claude/S--MP-MPNext-Components/198145b8-6d5f-4e71-88c0-2213ef0546ec/scratchpad";

export const STATE_FILES = {
  new: `${SCRATCH}/state-new.json`,
  old: `${SCRATCH}/state-old.json`,
};

export const NEW_ORIGIN = "http://localhost:5173";
export const API_HOST = "http://localhost:3000";
export const OLD_ORIGIN = "https://mpi.ministryplatform.com";
export const MP_LOGIN_RE = /\/ministryplatformapi\/oauth\/login/;

loadEnv({ path: `${REPO}/.env.local`, quiet: true });

mkdirSync(SHOTS, { recursive: true });

// ── URL helpers ──────────────────────────────────────────────────────

/**
 * newDemoUrl("event-finder")        -> http://localhost:5173/demo-event-finder.html
 * newDemoUrl("next-event-finder")   -> same (the `next-` prefix is stripped)
 * newDemoUrl("demo-event-finder.html") -> same (already a file name)
 */
export function newDemoUrl(widget) {
  let w = String(widget).trim();
  if (w.startsWith("http")) return w;
  w = w.replace(/\.html$/, "").replace(/^demo-/, "").replace(/^next-/, "");
  return `${NEW_ORIGIN}/demo-${w}.html`;
}

/** Old-site page names, as listed in BRIEF.md, keyed by a kebab alias. */
export const OLD_PAGES = {
  home: "",
  "event-finder": "event_finder.aspx",
  "group-finder": "group_finder.aspx",
  "pledge-campaign": "pledge_campaign.aspx",
  giving: "giving.aspx",
  "prayer-feedback": "prayer_feedback_form.aspx",
  "mission-trip-finder": "mission_trip_finder.aspx",
  "my-contribution-statement": "my_contribution_statement.aspx",
  "my-groups": "my_groups.aspx",
  "my-household": "my_household.aspx",
  "my-invoices": "my_invoices.aspx",
  "my-mission-trips": "my_mission_trips.aspx",
  "my-pledges": "my_pledges.aspx",
  "my-giving": "my_giving.aspx",
  subscriptions: "subscriptions.aspx",
  "online-directory": "online_directory.aspx",
  "opportunity-finder": "opportunity_finder.aspx",
  "plan-your-visit": "plan_your_visit.aspx",
  "subscribe-to-publication": "subscribe_to_publication.aspx",
  "about-me": "AboutMe",
  "widget-configurator": "WidgetConfigurator",
};

/**
 * oldPageUrl("my-household")     -> https://mpi.ministryplatform.com/widgets/my_household.aspx
 * oldPageUrl("my_household.aspx")-> same (a raw file name passes through)
 */
export function oldPageUrl(page) {
  const p = String(page ?? "").trim();
  if (p.startsWith("http")) return p;
  const file = Object.prototype.hasOwnProperty.call(OLD_PAGES, p) ? OLD_PAGES[p] : p;
  return file ? `${OLD_ORIGIN}/widgets/${file}` : `${OLD_ORIGIN}/widgets`;
}

// ── Redaction ────────────────────────────────────────────────────────

const SECRET_RE =
  /((?:code|state|id_token|access_token|token|sid|t)=)([A-Za-z0-9._~%+/-]{8,})/gi;

/** Strip credential-looking query/fragment values before logging a URL. */
export function safeUrl(u) {
  return String(u).replace(SECRET_RE, "$1<redacted>");
}

// ── launch() ─────────────────────────────────────────────────────────

/**
 * launch({ site, authed, viewport, headless, verify })
 *
 *   site      "new" (localhost:5173 demos) | "old" (mpi.ministryplatform.com/widgets)
 *   authed    true  -> reuse the saved storageState, verify it, and re-run the
 *                      interactive MP login (re-saving the state) if it went stale
 *             false -> a clean anonymous context
 *   viewport  { width, height }; default 1440x900. Use { width: 390, height: 844 }
 *             for the responsive pass.
 *   headless  default true. Only set false if you must watch.
 *   verify    default true when authed. Set false to skip the extra probe load
 *             (then call assertAuthenticated yourself after your own goto).
 *
 * Returns { browser, ctx, page, log, site, close }.
 *
 * `log` is live-collected and safe to assert on:
 *   log.console     [{ type, text }]
 *   log.errors      [string]                 // pageerror
 *   log.failed      [{ url, error }]         // requestfailed
 *   log.responses   [{ status, method, url }]// ALL responses
 *   log.api         [{ status, method, url }]// our /api/embed/* responses only
 *   log.sessionPosts[{ wid, hasMpUserToken, hasSid, status }]  // POST /api/embed/session
 *   log.consoleErrors()  -> console entries of type "error"
 *   log.apiFailures()    -> log.api entries with status >= 400
 *   log.reset()          -> clear everything (use between phases of one script)
 */
export async function launch({
  site = "new",
  authed = false,
  viewport = { width: 1440, height: 900 },
  headless = true,
  verify = undefined,
  extraContextOptions = {},
} = {}) {
  if (site !== "new" && site !== "old") throw new Error(`launch: bad site ${site}`);
  const shouldVerify = verify === undefined ? authed : verify;

  const browser = await chromium.launch({ headless });
  const statePath = STATE_FILES[site];
  const ctxOpts = { viewport, ...extraContextOptions };
  if (authed && existsSync(statePath)) ctxOpts.storageState = statePath;

  let ctx = await browser.newContext(ctxOpts);
  let page = await ctx.newPage();
  let log = attachLogging(page);

  if (authed && shouldVerify) {
    const probe = site === "new" ? newDemoUrl("user-menu") : oldPageUrl("my-household");
    await page.goto(probe, { waitUntil: "domcontentloaded" });
    let ok = true;
    try {
      await assertAuthenticated(page, site);
    } catch (e) {
      ok = false;
      console.log(`[harness] stored ${site} session is stale (${e.message}); re-logging in…`);
    }
    if (!ok) {
      // Start from a clean context: a half-expired MP token in localStorage is
      // exactly what makes AuthSession fall back to a public token silently.
      await ctx.close();
      ctx = await browser.newContext({ viewport, ...extraContextOptions });
      page = await ctx.newPage();
      log = attachLogging(page);
      if (site === "new") await loginNew(page);
      else await loginOld(page);
      await assertAuthenticated(page, site);
      await saveState(ctx, site);
    }
  }

  // Plain object: the relogin swap above already happened, so these are the
  // final objects and `const { page, log } = await launch(...)` is safe.
  return { browser, ctx, page, log, site, close: () => browser.close() };
}

/** Wire console / pageerror / requestfailed / response logging onto a page. */
export function attachLogging(page, { echo = true } = {}) {
  const log = {
    console: [],
    errors: [],
    failed: [],
    responses: [],
    api: [],
    sessionPosts: [],
    consoleErrors() {
      return log.console.filter((c) => c.type === "error");
    },
    apiFailures() {
      return log.api.filter((r) => r.status >= 400);
    },
    reset() {
      for (const k of ["console", "errors", "failed", "responses", "api", "sessionPosts"]) {
        log[k].length = 0;
      }
    },
  };

  page.on("console", (m) => {
    const e = { type: m.type(), text: m.text() };
    log.console.push(e);
    if (echo && (e.type === "error" || e.type === "warning")) {
      console.log(`console> ${e.type} ${e.text.slice(0, 300)}`);
    }
  });
  page.on("pageerror", (e) => {
    log.errors.push(e.message);
    if (echo) console.log(`pageerror> ${e.message}`);
  });
  page.on("requestfailed", (r) => {
    const e = { url: safeUrl(r.url()), error: r.failure()?.errorText };
    log.failed.push(e);
    // net::ERR_ABORTED on data.pendo.io is MP's analytics being blocked; ignore.
    if (echo && !/pendo\.io/.test(e.url)) console.log(`reqfail> ${e.url} ${e.error}`);
  });
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/embed/session")) {
      let body = {};
      try {
        body = JSON.parse(r.postData() || "{}");
      } catch {
        /* ignore */
      }
      // Presence flags only — never the token itself.
      log.sessionPosts.push({
        wid: body.wid,
        hasMpUserToken: !!body.mpUserToken,
        hasSid: !!body.sid,
        status: null,
      });
    }
  });
  page.on("response", (r) => {
    const entry = { status: r.status(), method: r.request().method(), url: safeUrl(r.url()) };
    log.responses.push(entry);
    if (/\/api\/embed\//.test(entry.url)) {
      log.api.push(entry);
      if (echo) console.log(`api> ${entry.status} ${entry.method} ${entry.url.replace(API_HOST, "")}`);
      if (entry.method === "POST" && entry.url.includes("/api/embed/session")) {
        const pending = log.sessionPosts.filter((p) => p.status === null);
        if (pending.length) pending[pending.length - 1].status = entry.status;
      }
    }
  });

  return log;
}

// ── Login ────────────────────────────────────────────────────────────

/**
 * Interactive MP login on the NEW demo pages.
 *
 * Flow (auth mode is `legacy` for http://localhost:5173):
 *   demo-user-menu.html
 *     -> next-user-menu appends <mpp-user-login>; MPWidgets.js fetches
 *        /widgets/dist/UserLogin.js and upgrades it (watchMpLoginRegistration
 *        re-inserts the tag until it does — allow ~6s)
 *     -> click its shadow-DOM #loginButton  = top-level nav to
 *        mpi.ministryplatform.com/ministryplatformapi/oauth/login?signin=…
 *     -> username/password form (the default visible flow) -> #loginButton
 *     -> back to demo-user-menu.html?cacheKey=… ; MPWidgets.js writes
 *        mpp-widgets_AuthToken/_IdToken/_ExpiresAfter into localStorage
 *     -> AuthSession sends that token as `mpUserToken` to POST /api/embed/session
 *        and gets a ver:1 JWT whose `sub` is the MP user GUID.
 *
 * Leaves `page` on the demo page it started from, signed in.
 *
 * `from` defaults to demo-user-menu.html, but ALL 25 demo pages carry both
 * <script id="MPWidgets"> and <next-user-menu>, so you can sign in in place on
 * the page under test: `await loginNew(page, { from: "my-pledges" })`.
 */
export async function loginNew(page, { from = "user-menu" } = {}) {
  const url = newDemoUrl(from);
  if (!page.url().startsWith(url)) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  const btn = page.locator("next-user-menu mpp-user-login #loginButton");
  await btn.waitFor({ state: "visible", timeout: 30000 });
  await btn.click();
  await submitMpLoginForm(page, (u) => u.href.startsWith(`${NEW_ORIGIN}/`));
  // Give AuthSession time to mint a JWT from the freshly stored MP token.
  await page.waitForResponse(
    (r) => r.url().includes("/api/embed/session") && r.request().method() === "POST",
    { timeout: 20000 },
  ).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}

/**
 * Interactive MP login on the OLD site. Same MP login page; the difference is
 * that <mpp-user-login> is already in the .aspx markup, so no registration
 * watch is needed. Leaves `page` on /widgets/my_household.aspx, signed in.
 */
export async function loginOld(page) {
  const url = oldPageUrl("my-household");
  if (!page.url().startsWith(url)) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  const btn = page.locator("mpp-user-login #loginButton").first();
  await btn.waitFor({ state: "visible", timeout: 30000 });
  await btn.click();
  await submitMpLoginForm(page, (u) => u.href.includes("/widgets/"));
  await page.waitForTimeout(3000);
  return page;
}

/**
 * Shared half of both logins: MP's Identity Server page.
 *
 * If MP's SSO cookie is still live, MP bounces straight back without ever
 * showing a form, so a timeout waiting for the login URL is a valid outcome.
 * Do NOT test `isReturn(page.url())` up front — the click that triggered the
 * navigation has not necessarily landed yet and the pre-click URL usually
 * already satisfies isReturn, which short-circuits the whole login.
 *
 * `#loginFlowToggleButton` swaps the one-time-code flow for username/password
 * if MP ever defaults to the former (today username/password is the visible
 * default).
 */
async function submitMpLoginForm(page, isReturn) {
  try {
    await page.waitForURL((u) => MP_LOGIN_RE.test(u.href), { timeout: 25000 });
  } catch {
    /* MP may have bounced straight back on its SSO cookie */
  }
  if (!MP_LOGIN_RE.test(page.url())) {
    // No credential prompt was shown. Let whatever navigation is in flight land.
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return;
  }

  const user = process.env.PLAYWRIGHT_MP_USERNAME;
  const pass = process.env.PLAYWRIGHT_MP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "PLAYWRIGHT_MP_USERNAME / PLAYWRIGHT_MP_PASSWORD missing from S:/MP/MPNext-Components/.env.local",
    );
  }

  if (!(await page.locator("#username").isVisible().catch(() => false))) {
    await page.locator("#loginFlowToggleButton").click({ timeout: 10000 });
    await page.locator("#username").waitFor({ state: "visible", timeout: 10000 });
  }
  await page.fill("#username", user);
  await page.fill("#password", pass);
  await Promise.all([
    page.waitForURL((u) => isReturn(u), { timeout: 60000 }),
    // MP's own submit control. Same id as the widget's login link, but this is
    // MP's page, so there is no ambiguity here.
    page.locator("#loginButton").click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
}

/** Persist the context's cookies + localStorage to the scratchpad state file. */
export async function saveState(ctx, site) {
  const target = STATE_FILES[site];
  const tmp = `${target}.${process.pid}.tmp`;
  await ctx.storageState({ path: tmp });
  renameSync(tmp, target); // atomic-ish: siblings never read a half-written file
  console.log(`[harness] saved ${site} storage state (${path.basename(target)})`);
  return target;
}

/** Best-effort read of when MP says the stored widget token expires (Date | null). */
export function storedTokenExpiry(site) {
  try {
    const st = JSON.parse(readFileSync(STATE_FILES[site], "utf8"));
    for (const o of st.origins ?? []) {
      for (const kv of o.localStorage ?? []) {
        if (kv.name === "mpp-widgets_ExpiresAfter") {
          const d = new Date(kv.value);
          if (!Number.isNaN(+d)) return d;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ── Authentication assertions ────────────────────────────────────────

/**
 * assertAuthenticated(page, site)
 *
 * Throws with a specific message if the session is not a REAL user session.
 * This is the guard TODO 37 existed for: AuthSession degrades to a public token
 * on any failure and a widget then renders a plausible empty state.
 *
 * NEW: mints a JWT through the page's own AuthSession and decodes the payload,
 *      requiring sub !== "public". In legacy mode the claim set is
 *      { sub: <MP user GUID>, ver: 1, mpAccessToken: … }. Nothing is logged
 *      except the ver and a masked sub.
 *      NOTE: GET /api/embed/auth/me is NOT a usable check here — for a v1
 *      (legacy) token that route answers 200 { authenticated: false } by
 *      design, because identity lives on the host page in legacy mode.
 * OLD: requires <mpp-user-login>'s #userNameContainer to be displayed with a
 *      real display name (it stays display:none and reads "Login" when out).
 *
 * The page must already be loaded (any page on the right origin).
 */
export async function assertAuthenticated(page, site = "new") {
  if (site === "new") {
    const res = await page.evaluate(async () => {
      const auth = window.MPNextEmbed?.getAuthSession?.();
      if (!auth) return { err: "window.MPNextEmbed.getAuthSession() unavailable — did the SDK module load?" };
      const legacyPresent = !!localStorage.getItem("mpp-widgets_AuthToken");
      let claims = null;
      try {
        const t = await auth.getToken("harness");
        claims = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      } catch (e) {
        return { err: `getToken failed: ${e}`, legacyPresent };
      }
      return {
        legacyPresent,
        sub: claims.sub,
        ver: claims.ver,
        hasMpAccessToken: !!claims.mpAccessToken,
        hasSid: !!claims.sid,
      };
    });
    if (res.err) throw new Error(`[assertAuthenticated new] ${res.err}`);
    if (!res.legacyPresent) {
      throw new Error(
        "[assertAuthenticated new] no mpp-widgets_AuthToken in localStorage — not signed in (run loginNew).",
      );
    }
    if (res.sub === "public" || !res.sub) {
      throw new Error(
        "[assertAuthenticated new] widget JWT sub is \"public\" — the MP token was rejected " +
          "(expired?) and AuthSession fell back to a PUBLIC token. Any 'empty' widget you see " +
          "is an anonymous render, not real data. Re-run loginNew.",
      );
    }
    console.log(
      `[harness] new: authenticated (ver=${res.ver}, sub=${String(res.sub).slice(0, 8)}…, mpToken=${res.hasMpAccessToken})`,
    );
    return res;
  }

  // <mpp-user-login> paints its logged-OUT state first: #userNameContainer stays
  // display:none and #userDisplayName reads "Login" until MPWidgets.js has
  // upgraded the element (DOMContentLoaded scan + /widgets/dist/UserLogin.js
  // fetch) AND validated the stored token. Sampling once here is the classic
  // false negative. Poll for the signed-in appearance instead.
  const hasStoredToken = await page.evaluate(() => !!localStorage.getItem("mpp-widgets_AuthToken"));
  if (hasStoredToken) {
    await page
      .waitForFunction(
        () => {
          const sr = document.querySelector("mpp-user-login")?.shadowRoot;
          if (!sr) return false;
          const box = sr.querySelector("#userNameContainer");
          const name = sr.querySelector("#userDisplayName")?.textContent?.trim() || "";
          return !!box && getComputedStyle(box).display !== "none" && !!name && name !== "Login";
        },
        undefined,
        { timeout: 20000 },
      )
      .catch(() => {});
  }

  const res = await page.evaluate(() => {
    const el = document.querySelector("mpp-user-login");
    if (!el) return { err: "no <mpp-user-login> on this page" };
    if (!el.shadowRoot) return { err: "<mpp-user-login> has no shadowRoot — MPWidgets.js never upgraded it" };
    const box = el.shadowRoot.querySelector("#userNameContainer");
    const name = el.shadowRoot.querySelector("#userDisplayName")?.textContent?.trim() || "";
    return {
      display: box ? getComputedStyle(box).display : "missing",
      name,
      hasTok: !!localStorage.getItem("mpp-widgets_AuthToken"),
    };
  });
  if (res.err) throw new Error(`[assertAuthenticated old] ${res.err}`);
  if (!res.hasTok || res.display === "none" || !res.name || res.name === "Login") {
    throw new Error(
      `[assertAuthenticated old] not signed in (token=${res.hasTok}, userNameContainer display=${res.display}, name="${res.name}"). Run loginOld.`,
    );
  }
  console.log(`[harness] old: authenticated as "${res.name}"`);
  return res;
}

// ── Waiting for a widget to finish rendering ──────────────────────────

/**
 * waitForWidget(page, tag, opts)
 *
 * `networkidle` alone is not enough: our widgets mint a JWT, then fetch, then
 * re-render, and MP's widgets do a CSRF round-trip before their own fetch — the
 * network goes idle in between. This waits for the custom element to be
 * defined, a shadow root to exist, and its text to STOP CHANGING (two equal
 * samples `settle` ms apart), which is the only signal that worked on both
 * sites.
 *
 *   tag          "next-my-household" | "mpp-household" | any custom element
 *   minChars     require at least this much shadow text (default 20)
 *   settle       ms between stability samples (default 600)
 *   timeout      overall budget in ms (default 30000)
 *   apiPattern   optional RegExp — also require one response whose URL matches
 *                (use for "the widget's own call actually happened")
 *
 * Returns the settled shadow text (whitespace-collapsed).
 */
export async function waitForWidget(
  page,
  tag,
  { minChars = 20, settle = 600, timeout = 30000, apiPattern = null } = {},
) {
  const apiSeen = apiPattern
    ? page.waitForResponse((r) => apiPattern.test(r.url()), { timeout }).catch(() => null)
    : Promise.resolve(null);

  const deadline = Date.now() + timeout;
  let last = null;
  let text = "";
  while (Date.now() < deadline) {
    text = await page.evaluate((t) => {
      if (!customElements.get(t)) return "\u0000undefined";
      const el = document.querySelector(t);
      if (!el) return "\u0000missing";
      if (!el.shadowRoot) return "\u0000noshadow";
      return el.shadowRoot.textContent.replace(/\s+/g, " ").trim();
    }, tag);
    if (!text.startsWith("\u0000") && text.length >= minChars && text === last) break;
    last = text;
    await page.waitForTimeout(settle);
  }
  if (text.startsWith("\u0000")) {
    throw new Error(`waitForWidget(${tag}): ${text.slice(1)} after ${timeout}ms`);
  }
  await apiSeen;
  return text;
}

/**
 * Whitespace-collapsed text of an element's shadow root (or "" if none).
 * Works for our widgets and MP's alike.
 */
export async function shadowText(page, tag) {
  return page.evaluate((t) => {
    const el = document.querySelector(t);
    return el?.shadowRoot ? el.shadowRoot.textContent.replace(/\s+/g, " ").trim() : "";
  }, tag);
}

/**
 * Every custom element on the page that has an open shadow root, with a text
 * preview. Use it to discover an unfamiliar page's real element names — the old
 * "My Household" page, for instance, uses <mpp-household>, not
 * <mpp-my-household>.
 */
export async function listShadowHosts(page, { preview = 160 } = {}) {
  return page.evaluate((n) => {
    const out = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          out.push({
            tag: el.tagName.toLowerCase(),
            text: el.shadowRoot.textContent.replace(/\s+/g, " ").trim().slice(0, n),
          });
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
    return out;
  }, preview);
}

/**
 * Locator that reaches into NESTED shadow roots. Playwright's CSS engine
 * pierces open shadow roots automatically, so `page.locator("a b")` usually
 * suffices — reach for this only when you need `>>>`-style explicitness or the
 * element is inside a shadow root created after your locator resolved.
 *
 *   deep(page, "next-my-household", ".nw-member button")
 */
export function deep(page, ...selectors) {
  return page.locator(selectors.join(" ").trim());
}

// ── Screenshots ──────────────────────────────────────────────────────

/**
 * shot(page, "event-finder-new-initial") -> .claude/playwright/widget/screenshots/<name>.png
 *
 * Naming convention from BRIEF.md: `<widget>-<old|new>-<what>.png`, lowercase
 * kebab. Never put a token, password, or user id in the name. Full page by
 * default.
 */
export async function shot(page, name, { fullPage = true } = {}) {
  const clean = String(name)
    .toLowerCase()
    .replace(/\.png$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const file = `${SHOTS}/${clean}.png`;
  await page.screenshot({ path: file, fullPage });
  console.log(`[harness] shot ${clean}.png`);
  return file;
}

/** Convenience: re-render at phone size, screenshot, restore the desktop size. */
export async function shotMobile(page, name) {
  const before = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const f = await shot(page, name);
  if (before) await page.setViewportSize(before);
  return f;
}
