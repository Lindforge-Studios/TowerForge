import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Several suites build isolated engine/player bundles and start local Studio servers. Keep
  // local feedback parallel, but serialize the resource-constrained CI runner so large inline
  // file:// players cannot starve concurrent Studio lifecycle tests.
  workers: process.env.CI ? 1 : 2,
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 820 },
    trace: "retain-on-failure"
  }
});
