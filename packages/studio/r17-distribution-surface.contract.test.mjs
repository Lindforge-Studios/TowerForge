import fs from "node:fs";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
const mcp = fs.readFileSync(new URL("../mcp/tools.mjs", import.meta.url), "utf8");
const playerBuild = fs.readFileSync(new URL("../cli/build.mjs", import.meta.url), "utf8");
const engineIndex = fs.readFileSync(new URL("../engine/src/index.ts", import.meta.url), "utf8");

describe("R17 Studio/MCP/player isolation surface (RED)", () => {
  it("provides a separate Distribution Hub with preview before explicit publish confirmation", () => {
    for (const id of [
      "distribution-project-id",
      "distribution-license",
      "distribution-license-attribution",
      "distribution-remix-policy",
      "distribution-remix-source",
      "distribution-publish-preview",
      "distribution-publish-prepare",
      "distribution-publish-confirm",
      "distribution-remix-import",
      "distribution-monetization-placements",
      "distribution-preview-result",
      "distribution-save",
      "distribution-disable",
      "distribution-enable"
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(app).toMatch(/previewPublish|publish.*preview/i);
    expect(app).toMatch(/requiresExplicitConfirmation|explicit.*confirm|confirm.*candidate/i);
    expect(app).toMatch(/candidateDigest/);
  });

  it("exposes compute-only AI discovery/preview without an upload or approval-minting tool", () => {
    expect(mcp).toMatch(/distribution|PublishManifestV1/);
    expect(mcp).toMatch(/preview_publish_candidate|inspect_remix_source_pack/);
    expect(mcp).not.toMatch(/name:\s*["'](?:publish|upload|deploy)_project/);
    expect(mcp).not.toMatch(/mintPublishApproval|publishPreparedCandidate/);
  });

  it("keeps distribution and monetization out of the engine and injects hooks only in the host player", () => {
    expect(engineIndex).not.toMatch(/distribution|PublishManifest|MonetizationHook|RemixProvenance/);
    expect(playerBuild).toMatch(/host.*monetization|monetization.*host|purchase_link/i);
    expect(playerBuild).not.toMatch(/rewarded.*(?:coins|resource|damage)|paymentKey|telemetry.*monetization/i);
  });
});
