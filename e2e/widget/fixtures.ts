/**
 * Shared fixtures for the `widget` Playwright project.
 *
 * Every widget spec straddles two origins: the demo page (Vite, :5173) and the
 * API (Next, :3000). When the browser cannot reach the API, `AuthSession`
 * degrades silently and by design -- `fetchConfig()`
 * (`packages/embed-sdk/src/shared/auth-session.ts`) returns `fallbackConfig()`
 * on a non-200, an unrecognised body, *or* a thrown fetch, so the SDK resolves
 * `legacy` and mints a public token. The widget still renders; it just never
 * got a real credential. Any assertion loose enough to accept the signed-out
 * render therefore passes while nothing under test actually worked, and the
 * demo pill reads "legacy (config unavailable)" for every one of those causes
 * alike -- a dead server, a missing origin in EMBED_ALLOWED_ORIGINS, and a
 * browser network-policy block are indistinguishable from the page.
 *
 * `embedConfig` closes that hole. It resolves the auth mode once per worker and
 * fails the run when the answer is anything but a real mode, so a spec can no
 * longer pass on a silently-degraded SDK.
 *
 * The probe deliberately runs **inside the browser, from the demo origin**. A
 * Node-side fetch would skip CORS preflight and the browser's own network
 * policies, i.e. precisely the failures this fixture exists to catch, and would
 * report success while every widget on the page was starved of a token.
 */

import { test as base, expect } from "@playwright/test";

export type EmbedAuthMode = "legacy" | "dual" | "hardened";

const VALID_MODES: readonly string[] = ["legacy", "dual", "hardened"];

/**
 * Probe page. Any demo page works; this one is the roster's login surface and
 * it publishes `window.__nextEmbedApiHost` from a classic script in <head>
 * (a property `src/demo-placeholder-substitution.test.ts` enforces), so the
 * probe reads the same API host the widgets on the page will use instead of
 * guessing one.
 */
const PROBE_PAGE = "/demo-user-menu.html";

/** Pin the expected mode in CI so a misconfigured server fails loudly. */
const EXPECTED_MODE = (process.env.EMBED_EXPECTED_AUTH_MODE ?? "").trim().toLowerCase();

export interface EmbedConfig {
  /** Mode the server resolved for the demo origin, confirmed from the browser. */
  mode: EmbedAuthMode;
  /** API host the demo page hands its widgets. */
  apiHost: string;
  /** Demo origin the probe ran from -- the origin the server keyed `mode` on. */
  origin: string;
}

type ProbeResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number | null; message: string };

export const test = base.extend<Record<never, never>, { embedConfig: EmbedConfig }>({
  embedConfig: [
    async ({ browser }, use, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL;
      if (!baseURL) {
        throw new Error(
          "embedConfig: the `widget` project has no baseURL, so there is no demo origin to probe from.",
        );
      }

      const page = await browser.newPage({ baseURL });

      // Keep the transport-level reason for a failed config request. The
      // in-page fetch only ever sees an opaque "Failed to fetch" for a CORS
      // rejection, a refused connection and a browser policy block alike;
      // `net::ERR_*` is what tells those apart, and guessing wrong there is
      // what sent a previous investigation after the wrong root cause
      // (.claude/TODO/37).
      const netErrors: string[] = [];
      page.on("requestfailed", (req) => {
        if (req.url().includes("/api/embed/auth/config")) {
          netErrors.push(req.failure()?.errorText ?? "(no errorText)");
        }
      });

      let config: EmbedConfig;
      try {
        await page.goto(PROBE_PAGE, { waitUntil: "domcontentloaded" });

        const apiHost = await page
          .waitForFunction(() => (window as { __nextEmbedApiHost?: string }).__nextEmbedApiHost)
          .then((handle) => handle.jsonValue() as Promise<string>);

        const origin = new URL(page.url()).origin;

        const probe: ProbeResult = await page.evaluate(async (host) => {
          try {
            const res = await fetch(`${host}/api/embed/auth/config`, {
              method: "GET",
              mode: "cors",
              credentials: "omit",
            });
            let body: unknown = null;
            try {
              body = await res.json();
            } catch {
              /* non-JSON body; reported via status below */
            }
            return res.ok
              ? { ok: true as const, status: res.status, body }
              : { ok: false as const, status: res.status, message: `HTTP ${res.status}` };
          } catch (err) {
            return {
              ok: false as const,
              status: null,
              message: err instanceof Error ? err.message : String(err),
            };
          }
        }, apiHost);

        const target = `${apiHost}/api/embed/auth/config`;

        if (!probe.ok) {
          throw new Error(
            [
              `embedConfig: ${origin} could not read ${target} -- ${probe.message}`,
              netErrors.length ? `  transport: ${netErrors.join(", ")}` : null,
              "",
              "Until this resolves the SDK falls back to `legacy` + a public token and every",
              "widget spec asserts against a widget that never got a credential. Check, in order:",
              `  1. Is the API up?  curl -i "${target}" -H "Origin: ${origin}"`,
              `  2. Is ${origin} in EMBED_ALLOWED_ORIGINS? (a 403 here means it is not)`,
              "  3. A net::ERR_* above that is neither CONNECTION_REFUSED nor a CORS rejection",
              "     points at a browser network policy rather than at this repo.",
            ]
              .filter((line) => line !== null)
              .join("\n"),
          );
        }

        const mode = (probe.body as { mode?: unknown } | null)?.mode;
        if (typeof mode !== "string" || !VALID_MODES.includes(mode)) {
          throw new Error(
            [
              `embedConfig: ${target} answered ${probe.status} but with mode`,
              `${JSON.stringify(mode)}; expected one of ${VALID_MODES.join(", ")}.`,
              "The SDK treats this as `legacy`.",
            ].join(" "),
          );
        }

        if (EXPECTED_MODE) {
          if (!VALID_MODES.includes(EXPECTED_MODE)) {
            throw new Error(
              [
                `embedConfig: EMBED_EXPECTED_AUTH_MODE=${JSON.stringify(EXPECTED_MODE)} is not a`,
                `valid mode (${VALID_MODES.join(", ")}).`,
              ].join(" "),
            );
          }
          if (mode !== EXPECTED_MODE) {
            throw new Error(
              [
                `embedConfig: EMBED_EXPECTED_AUTH_MODE=${EXPECTED_MODE} but ${target} resolved "${mode}" for ${origin}.`,
                "The server decides this per origin: EMBED_AUTH_MODE_ORIGINS overrides the",
                "deployment-wide EMBED_AUTH_MODE, which defaults to `legacy`",
                "(src/lib/embed/auth-mode.ts). Set e.g.",
                `  EMBED_AUTH_MODE_ORIGINS=${origin}=${EXPECTED_MODE}`,
                "in the environment the Next dev server reads, not just in the Playwright shell.",
              ].join("\n"),
            );
          }
        }

        config = { mode: mode as EmbedAuthMode, apiHost, origin };
      } finally {
        await page.close();
      }

      await use(config);
    },
    { scope: "worker" },
  ],
});

/**
 * Skip the current test unless the server resolved one of `modes` for the demo
 * origin.
 *
 * Guard on this rather than on `process.env.EMBED_AUTH_MODE`: the mode is a
 * *server*, per-origin decision (`resolveAuthMode`), so a shell variable is not
 * evidence of it. Reading the shell instead is why a spec could skip itself
 * while the server was correctly in `dual` -- and, worse, run while the server
 * was in `legacy`.
 */
export function skipUnlessMode(config: EmbedConfig, modes: readonly EmbedAuthMode[]): void {
  test.skip(
    !modes.includes(config.mode),
    `server resolved "${config.mode}" for ${config.origin}; this spec needs ${modes.join(" or ")}`,
  );
}

export { expect };
