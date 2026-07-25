import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Several suites build isolated engine/player bundles and start local Studio servers;
  // bounding workers avoids build-lock contention while retaining useful E2E parallelism.
  workers: 3,
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 820 },
    trace: "retain-on-failure"
  }
});
