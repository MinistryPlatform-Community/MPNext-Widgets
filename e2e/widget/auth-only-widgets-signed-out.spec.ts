import { test, expect } from "./fixtures";

/**
 * Signed-out state of every auth-only widget (C81 class; W8 section 1).
 *
 * C81 / C13 / C30 / C46 / C53 all shipped the same bug: an auth-only widget
 * opened by a never-authenticated visitor rendered "Unable to Load" and a
 * "Try Again" button that retried an anonymous request into the same 401. W0
 * replaced that with the base class's mode-aware `renderSignInRequired()`
 * (`packages/embed-sdk/src/shared/base-widget.ts`). This spec pins the
 * contract on a real page so the class cannot come back unnoticed:
 *
 *   - no "Unable to Load" text, no `[data-action="retry"]`;
 *   - `dual`:   a `[data-action="login"]` button inside `[data-nw-signin]`;
 *   - `legacy`: the `[data-nw-signin]` copy and **no** login button.
 *
 * Runs once per mode via the `widget-legacy` (:5174) and `widget-dual` (:5175)
 * projects in playwright.config.ts, which pin each origin's mode through
 * `EMBED_AUTH_MODE_ORIGINS` in the env handed to `next dev`.
 *
 * Prerequisites (all started by playwright.config.ts `webServer`):
 *   - Next on :3000 with :5174/:5175 in EMBED_ALLOWED_ORIGINS and pinned in
 *     EMBED_AUTH_MODE_ORIGINS. A dev server you started yourself is reused and
 *     will NOT have that env: the `embedConfig` fixture then fails with a 403 or
 *     a mode mismatch. Stop it, or export the same two variables before
 *     starting it.
 *   - Vite demo servers on :5174 and :5175.
 * No MP credentials needed; no MP writes. Each test uses a fresh context, so
 * the visitor has never been authenticated on that origin.
 *
 * The roster is the set of components that render `renderSignInRequired()` on
 * load for an anonymous visitor (re-measure with
 * `grep -ln renderSignInRequired packages/embed-sdk/src/components/*.ts`).
 * Deliberately excluded: `group-details` and `group-finder`, which call the
 * helper only inside the sign-up / suggest-a-group sub-flows, not on load;
 * `user-menu`, which owns its own Sign In surface (login-hardened.spec.ts).
 */

const AUTH_ONLY_WIDGETS = [
  "contact-attributes",
  "my-contribution-statement",
  "my-giving",
  "my-groups",
  "my-household",
  "my-invoices",
  "my-mission-trips",
  "my-pledges",
  "online-directory",
  "pre-check",
  "profile",
  "statement-preferences",
  "subscriptions",
] as const;

interface WidgetState {
  tag: string;
  index: number;
  state: "signin" | "error" | "pending";
  unableToLoad: boolean;
  retry: number;
  loginButtons: number;
  panelText: string;
}

test.describe("auth-only widgets, never signed in", () => {
  for (const widget of AUTH_ONLY_WIDGETS) {
    test(`next-${widget} shows the sign-in panel, not an error`, async ({
      page,
      embedConfig,
    }, testInfo) => {
      const expectedMode = (testInfo.project.metadata as { expectedMode?: string }).expectedMode;
      // Without a pinned mode this spec would assert against whatever the
      // server happens to resolve and could pass in neither mode.
      expect(expectedMode, "run through the widget-legacy / widget-dual projects").toBeTruthy();
      expect(
        embedConfig.mode,
        `${embedConfig.origin} should be pinned to ${expectedMode} via EMBED_AUTH_MODE_ORIGINS`,
      ).toBe(expectedMode);

      await page.goto(`/demo-${widget}.html`);
      const tag = `next-${widget}`;
      await expect(page.locator(tag).first()).toBeAttached({ timeout: 15_000 });

      const readStates = () =>
        page.evaluate((t) => {
          return Array.from(document.querySelectorAll(t)).map((el, index) => {
            const root = el.shadowRoot;
            const text = root?.textContent ?? "";
            const panel = root?.querySelector("[data-nw-signin]") ?? null;
            const retry = root?.querySelectorAll('[data-action="retry"]').length ?? 0;
            const unableToLoad = /Unable to Load/i.test(text);
            const state: "signin" | "error" | "pending" = panel
              ? "signin"
              : retry > 0 || unableToLoad
                ? "error"
                : "pending";
            return {
              tag: t,
              index,
              state,
              unableToLoad,
              retry,
              loginButtons: root?.querySelectorAll('[data-action="login"]').length ?? 0,
              panelText: (panel?.textContent ?? "").trim(),
            };
          });
        }, tag);

      // Settle: every instance has reached the panel or an error state.
      let states: WidgetState[] = [];
      await expect
        .poll(
          async () => {
            states = await readStates();
            return states.length > 0 && states.every((s) => s.state !== "pending");
          },
          { timeout: 30_000, message: `${tag} never left its loading state` },
        )
        .toBe(true);

      for (const s of states) {
        const where = `${tag}[${s.index}] (${embedConfig.mode})`;
        expect(s.unableToLoad, `${where} rendered "Unable to Load"`).toBe(false);
        expect(s.retry, `${where} rendered a Try Again button`).toBe(0);
        expect(s.state, `${where} did not render the sign-in panel`).toBe("signin");
        expect(s.panelText.length, `${where} sign-in panel has no copy`).toBeGreaterThan(0);
        if (embedConfig.mode === "legacy") {
          expect(s.loginButtons, `${where}: legacy must not offer a dead Sign In button`).toBe(0);
        } else {
          expect(s.loginButtons, `${where}: ${embedConfig.mode} must offer Sign In`).toBeGreaterThan(0);
        }
      }
    });
  }
});
