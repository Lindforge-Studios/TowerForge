import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // MCP/project tests share the generated engine cache and perform real filesystem
    // transactions. A small fixed worker pool keeps the default gate deterministic instead of
    // letting CPU-count-based fan-out turn valid 5-second contracts into load-only timeouts.
    maxWorkers: process.env.CI ? 1 : 4,
    include: ["packages/**/*.test.{js,mjs,ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/runtime/**",
      "**/target/**"
    ]
  }
});
