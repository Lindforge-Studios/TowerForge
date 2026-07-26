import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  // Several suites build isolated engine/player bundles and start local Studio servers. The
  // campaign handoff matrix adds twelve bundles, so two workers keep file:// and Studio boot
  // deadlines deterministic without serializing the complete browser gate.
  workers: 2,
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 820 },
    trace: "retain-on-failure"
  }
});
