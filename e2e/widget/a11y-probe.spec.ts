import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { runA11yProbe, type A11yViolation } from "./a11y-probe";

/**
 * Accessibility probe over every demo page (W8 section 3, CROSS-3 class).
 *
 * For each `packages/embed-sdk/demo-*.html` (enumerated from disk, so a new
 * widget's demo page is covered the day it lands) this loads the page as an
 * anonymous visitor, waits for the widgets to settle, and runs the probe in
 * `a11y-probe.ts` over every `next-*` shadow root:
 *
 *   - every visible focusable control has an accessible name;
 *   - no `role="link"` without an `<a href>`;
 *   - every content widget renders at least one heading;
 *   - every `[role=dialog][aria-modal=true]` that opens holds focus -- the spec
 *     clicks each `[aria-haspopup=dialog]` opener it finds to get one open.
 *
 * Prerequisites: the `widget` project's servers (Next :3000, Vite :5173),
 * started by playwright.config.ts `webServer`. No MP credentials, no MP writes:
 * the only clicks are dialog openers, which open UI and send nothing.
 *
 * What it does not see: signed-in renders (every auth-only widget shows the
 * sign-in panel here), and dialogs that need data to open (the full-calendar
 * event modal needs an event to click). Those are covered by unit tests on
 * `dialog-focus.ts` and the per-widget tests.
 *
 * Known defects are listed in KNOWN_DEFECTS with the source file:line that
 * causes them. They are reported as `test.fixme` entries and excluded from the
 * per-page assertion, so a *new* violation still fails the page. An entry that
 * stops matching fails the run -- delete it in the commit that fixes it.
 */

const DEMO_DIR = resolve(__dirname, "../../packages/embed-sdk");
const DEMO_PAGES = readdirSync(DEMO_DIR)
  .filter((f) => /^demo-.*\.html$/.test(f))
  .sort();

/**
 * Widgets that are a single control, not a content region, so a heading would
 * be wrong rather than missing: a header sign-in/avatar button, an "Add to
 * Calendar" button with its menu, and a language <select>.
 */
const NO_HEADING_EXPECTED = new Set(["next-user-menu", "next-add-to-calendar", "next-locale-selector"]);

/**
 * Dialog openers that do not carry `aria-haspopup="dialog"`, per demo page. No
 * widget declares that attribute today, so without this map the dialog rule
 * would never see an open dialog. The user-menu account modal needs a signed-in
 * visitor and is covered by user-menu.spec.ts / dialog-focus unit tests.
 */
const DIALOG_OPENERS: Record<string, string[]> = {
  // Cards-view "Learn More" opens the event modal (C08).
  "demo-full-calendar.html": [".nw-fc-card-learn-more:visible"],
};

interface KnownDefect {
  page: string;
  rule: A11yViolation["rule"];
  widget: string;
  /** Substring of the violation's `node` description. */
  node: string;
  /** Source of the defect, for the integrator. */
  source: string;
}

/**
 * Widgets whose only heading is the record's own title (`<h1 class="*-title">`),
 * which the demo page cannot show: its default id matches no record, so the
 * widget renders its "not found" / "not specified" message. That message is a
 * status line, not a section, and needs no heading. Exempt here rather than in
 * KNOWN_DEFECTS because nothing is wrong with the source. The headings exist:
 * event-details.ts:1229, group-details.ts:644, opportunity-details.ts:535.
 */
const HEADING_NEEDS_A_RECORD = new Set([
  "next-event-details",
  "next-group-details",
  "next-opportunity-details",
]);

/**
 * Real defects this probe found. Do not add to this list to silence a new one;
 * delete an entry in the commit that fixes it.
 *
 * Empty since 2026-10-11: the four W8 found (checkout, pay, full-calendar and
 * unsubscribe rendering their title as a `<div>`/`<p>`) were fixed by giving
 * each a real heading under the `heading-level` convention
 * (`shared/heading-level.ts`).
 */
const KNOWN_DEFECTS: KnownDefect[] = [];

const matches = (d: KnownDefect, page: string, v: A11yViolation) =>
  d.page === page && d.rule === v.rule && d.widget === v.widget && v.node.includes(d.node);

/**
 * Wait until every widget has finished loading and its shadow DOM has stopped
 * changing, or 45s pass. "Finished loading" means no `aria-busy="true"` and no
 * catalogue "Loading..." copy in any shadow root (en/es/pt-BR): a widget parked
 * on its loading line is perfectly stable, and probing it would test the
 * spinner, not the widget. 45s because `next dev` compiles each API route on
 * first hit and the demo pages run in parallel.
 */
async function settle(page: Page): Promise<void> {
  const snapshot = () =>
    page.evaluate(() => {
      const roots = Array.from(document.querySelectorAll("*"))
        .filter((el) => el.localName.startsWith("next-") && el.shadowRoot)
        .map((el) => el.shadowRoot!);
      const busy = roots.some(
        (r) =>
          r.querySelector('[aria-busy="true"]') !== null ||
          /(Loading|Cargando|Carregando)/i.test(r.textContent ?? ""),
      );
      return busy ? "busy" : roots.map((r) => r.innerHTML.length).join(",");
    });
  const deadline = Date.now() + 45_000;
  let previous = "";
  let stableReads = 0;
  while (Date.now() < deadline) {
    const current = await snapshot();
    stableReads = current === previous && current !== "" && current !== "busy" ? stableReads + 1 : 0;
    if (stableReads >= 2) return;
    previous = current;
    await page.waitForTimeout(500);
  }
}

for (const demo of DEMO_PAGES) {
  test(`a11y probe: ${demo}`, async ({ page, embedConfig }, testInfo) => {
    test.setTimeout(90_000);
    void embedConfig; // fail fast (fixture) if the API is unreachable
    await page.goto(`/${demo}`);
    await settle(page);

    const first = await page.evaluate(runA11yProbe);
    const violations: A11yViolation[] = [...first.violations];

    for (const w of first.widgets) {
      if (NO_HEADING_EXPECTED.has(w.tag)) continue;
      // A host the demo page keeps hidden (several wait for sign-in) has no
      // render to judge.
      if (!w.rendered) continue;
      if (HEADING_NEEDS_A_RECORD.has(w.tag)) continue;
      // The shared signed-out panel is a role=status message, not a content
      // region; the heading contract applies to the widget's real render.
      if (w.signedOutPanel) continue;
      if (w.headings === 0) violations.push({ rule: "heading", widget: w.tag, node: "(no h1-h6)" });
    }

    // Open every dialog opener and check focus moved inside the dialog.
    // `[aria-haspopup="dialog"]` is the generic opener; DIALOG_OPENERS adds the
    // ones that do not declare it (only the first match of each is clicked).
    let dialogsOpened = 0;
    const openerSelectors: { selector: string; all: boolean }[] = [
      { selector: '[aria-haspopup="dialog"]:visible', all: true },
      ...(DIALOG_OPENERS[demo] ?? []).map((selector) => ({ selector, all: false })),
    ];
    for (const tag of new Set(first.widgets.map((w) => w.tag))) {
      for (const { selector, all } of openerSelectors) {
        const openers = page.locator(tag).locator(selector);
        const count = all ? await openers.count() : Math.min(1, await openers.count());
        for (let i = 0; i < count; i++) {
          await openers.nth(i).click();
          await page.waitForTimeout(400);
          const after = await page.evaluate(runA11yProbe);
          dialogsOpened += await page
            .locator(tag)
            .locator("[role=dialog][aria-modal=true]:visible")
            .count();
          violations.push(...after.violations.filter((v) => v.rule === "dialog"));
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
        }
      }
    }
    if (DIALOG_OPENERS[demo]) {
      expect(dialogsOpened, `no modal dialog opened on ${demo}; the dialog check did not run`).toBeGreaterThan(0);
    }
    testInfo.annotations.push({
      type: "a11y",
      description: `${first.widgets.length} widget(s) probed, ${dialogsOpened} modal dialog(s) opened`,
    });

    const known = KNOWN_DEFECTS.filter((d) => d.page === demo);
    const unexpected = violations.filter((v) => !known.some((d) => matches(d, demo, v)));
    for (const d of known) {
      expect(
        violations.some((v) => matches(d, demo, v)),
        `KNOWN_DEFECTS entry no longer reproduces -- delete it: ${JSON.stringify(d)}`,
      ).toBe(true);
    }
    expect(unexpected, `accessibility violations on ${demo}`).toEqual([]);
  });
}

// The probe must be able to fail: a probe that never reports anything passes
// every page. Needs no server.
test("a11y probe self-test: detects each rule on a synthetic widget", async ({ page }) => {
  await page.setContent(`<!doctype html><html><body><next-probe-fixture></next-probe-fixture><script>
    const host = document.querySelector("next-probe-fixture");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = [
      '<button type="button"></button>',
      '<button type="button">Named</button>',
      '<label for="f1">First</label><input id="f1">',
      '<input id="f2">',
      '<div role="link" tabindex="0">Card</div>',
      '<a href="/x" role="link">Real link</a>',
      '<button type="button" id="opener">Open</button>',
      '<div role="dialog" aria-modal="true" aria-label="D"><button type="button">In</button></div>',
    ].join("");
    root.getElementById("opener").focus();
  </script></body></html>`);
  const result = await page.evaluate(runA11yProbe);
  const rules = result.violations.map((v) => [v.rule, v.node].join(" "));
  expect(rules).toEqual([
    'name button[type="button"]',
    'name input[id="f2"]',
    'role-link div[role="link"]',
    'dialog div[role="dialog"] (focus on button[type="button"][id="opener"])',
  ]);
  expect(result.widgets).toEqual([
    { tag: "next-probe-fixture", signedOutPanel: false, headings: 0, rendered: true },
  ]);
});

// Every known defect, listed so the report shows it as an open item.
for (const d of KNOWN_DEFECTS) {
  test.fixme(`known a11y defect: ${d.page} ${d.widget} ${d.rule} ${d.node} -- ${d.source}`, () => {});
}
