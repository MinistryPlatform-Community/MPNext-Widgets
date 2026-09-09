import { defineConfig, devices } from "@playwright/test";
import { config as loadEnvFile } from "dotenv";

// `next dev` reads .env.local itself, but the Playwright process does not, so
// PLAYWRIGHT_MP_USERNAME / PLAYWRIGHT_MP_PASSWORD documented as living there
// never reached the specs and login-hardened.spec.ts skipped itself on every
// run. dotenv does not override variables already in the environment, so an
// explicit shell export still wins.
loadEnvFile({ path: ".env.local", quiet: true });

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
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:5173",
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
    },
    {
      command: "pnpm --filter @mpnext/embed-sdk demo",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
