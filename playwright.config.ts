import { defineConfig, devices } from "@playwright/test";
import { config as loadEnvFile } from "dotenv";

// `next dev` reads .env.local itself, but the Playwright process does not, so
// PLAYWRIGHT_MP_USERNAME / PLAYWRIGHT_MP_PASSWORD documented as living there
// never reached the specs and login-hardened.spec.ts skipped itself on every
// run. dotenv does not override variables already in the environment, so an
// explicit shell export still wins.
loadEnvFile({ path: ".env.local", quiet: true });

/**
 * Signed-out mode matrix (W8, C81 class).
 *
 * The auth mode is a *server*, per-origin decision (`resolveAuthMode`), so the
 * only way to exercise `legacy` and `dual` in one run, against one Next server,
 * is two demo origins. The default `widget` project keeps :5173 on whatever the
 * developer configured (login-hardened.spec.ts wants it on `dual`); two extra
 * Vite instances on :5174 / :5175 are pinned to `legacy` / `dual` through
 * `EMBED_AUTH_MODE_ORIGINS`, and added to `EMBED_ALLOWED_ORIGINS`, in the env
 * handed to `next dev` below. Next's env loader never overrides a variable that
 * is already set, so these win over .env.local.
 *
 * Caveat: with `reuseExistingServer` a dev server you started yourself does not
 * get this env. The `embedConfig` fixture then fails loudly for :5174/:5175
 * (403 or a mode mismatch) rather than testing the wrong mode.
 */
const MODE_ORIGINS = {
  legacy: "http://localhost:5174",
  dual: "http://localhost:5175",
} as const;

function appendList(existing: string | undefined, extra: string[]): string {
  return [...(existing ?? "").split(","), ...extra]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");
}

const nextEnv: Record<string, string> = {
  EMBED_ALLOWED_ORIGINS: appendList(
    process.env.EMBED_ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:5173",
    Object.values(MODE_ORIGINS),
  ),
  EMBED_AUTH_MODE_ORIGINS: appendList(
    process.env.EMBED_AUTH_MODE_ORIGINS,
    Object.entries(MODE_ORIGINS).map(([mode, origin]) => [origin, mode].join("=")),
  ),
};

/** Specs that run once per pinned mode instead of on the default origin. */
const MODE_MATRIX_SPECS = /auth-only-widgets-signed-out\.spec\.ts$/;
/**
 * Signed-in specs that need `dual`/`hardened` and so run on the pinned `dual`
 * origin, where they do not depend on the developer's own mode for :5173.
 */
const DUAL_ONLY_SPECS = /signed-in-invoice-participants\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "widget",
      testDir: "./e2e/widget",
      testIgnore: [MODE_MATRIX_SPECS, DUAL_ONLY_SPECS],
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5173",
      },
    },
    {
      name: "widget-legacy",
      testDir: "./e2e/widget",
      testMatch: MODE_MATRIX_SPECS,
      metadata: { expectedMode: "legacy" },
      use: {
        ...devices["Desktop Chrome"],
        baseURL: MODE_ORIGINS.legacy,
      },
    },
    {
      name: "widget-dual",
      testDir: "./e2e/widget",
      testMatch: [MODE_MATRIX_SPECS, DUAL_ONLY_SPECS],
      metadata: { expectedMode: "dual" },
      use: {
        ...devices["Desktop Chrome"],
        baseURL: MODE_ORIGINS.dual,
      },
    },
  ],

  webServer: [
    // `pnpm dev:next`, not `pnpm dev`: `pnpm dev` is `concurrently "next dev"
    // "pnpm --filter @mpnext/embed-sdk demo"`, so it already starts the Vite
    // demo below. With `reuseExistingServer: false` (CI) the duplicate Vite
    // finds :5173 taken and silently moves to :5174, while the `url` check
    // below passes against the first one -- a stray process and a green run
    // that proves nothing about the server Playwright is actually driving.
    {
      command: "pnpm dev:next",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: nextEnv,
    },
    // BROWSER=none: vite.config.ts sets `server.open`, which would otherwise
    // pop a desktop browser window per instance.
    {
      command: "pnpm --filter @mpnext/embed-sdk demo",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { BROWSER: "none" },
    },
    // `--strictPort`: a taken port must fail the run, not drift to the next
    // port and leave the `url` check passing against some other server.
    {
      command: "pnpm --filter @mpnext/embed-sdk demo --port 5174 --strictPort",
      url: MODE_ORIGINS.legacy,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { BROWSER: "none" },
    },
    {
      command: "pnpm --filter @mpnext/embed-sdk demo --port 5175 --strictPort",
      url: MODE_ORIGINS.dual,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { BROWSER: "none" },
    },
  ],
});
