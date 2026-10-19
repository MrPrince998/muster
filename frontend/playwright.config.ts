import { defineConfig } from "@playwright/test";

/**
 * Browser tests: the main journeys, against the whole stack (API, database,
 * this app) with the demo data reset first (see e2e/global-setup.ts).
 *
 *   pnpm test:e2e     (the dev stack running: docker compose up, with
 *                      THROTTLE_DISABLED=true for the backend)
 *
 * Each test signs in afresh (e2e/helpers.ts): refresh tokens rotate, and a
 * reused one ends the session, so a session can't be shared between tests.
 *
 * In CI the app runs as its production build; see .github/workflows/ci.yml.
 */
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  // one shared demo world, so one browser at a time, in order
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: ci ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: process.env.BASE_URL,
    // locally, the Chrome already installed; in CI, Playwright's own Chromium
    channel: ci ? undefined : "chrome",
    viewport: { width: 1440, height: 900 },
    // a fixed device zone, so "this club is in another zone" reads the same everywhere (Northside is in Perth)
    timezoneId: "Australia/Sydney",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // video needs Playwright's ffmpeg: CI installs it; locally the trace has the same steps
    video: ci ? "retain-on-failure" : "off",
  },
});
