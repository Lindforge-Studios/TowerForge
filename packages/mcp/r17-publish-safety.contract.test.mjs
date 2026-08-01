import fs from "node:fs";
import { describe, expect, it } from "vitest";

const toolsSource = fs.readFileSync(new URL("./tools.mjs", import.meta.url), "utf8");
const pluginBuildSource = fs.readFileSync(new URL("../../scripts/build-codex-plugin.mjs", import.meta.url), "utf8");

describe("R17 MCP publish safety surface (RED)", () => {
  it("may preview/inspect publication but never exposes upload or approval minting", () => {
    expect(toolsSource).toMatch(/preview_publish|inspect_publish|publish_manifest/i);
    expect(toolsSource).not.toMatch(/name:\s*["'](?:publish|upload|deploy)_project/);
    expect(toolsSource).not.toMatch(/mintPublishApproval|publishPreparedCandidate/);
  });

  it("ships the browser-safe distribution dependency in the generated plugin runtime", () => {
    expect(pluginBuildSource).toMatch(/packages["'],\s*["']distribution/);
    expect(fs.readFileSync(new URL("../distribution/src/index.mjs", import.meta.url), "utf8"))
      .toBe(fs.readFileSync(new URL("../../plugins/towerforge/runtime/packages/distribution/src/index.mjs", import.meta.url), "utf8"));
  });
});
