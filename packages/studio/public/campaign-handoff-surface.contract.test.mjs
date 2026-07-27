import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const server = fs.readFileSync(path.resolve("packages/studio/server.mjs"), "utf8");

function functionSource(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

describe("R4.4C Studio marker-v2 campaign surface", () => {
  it("explains that marker v2 carries cards/artifacts while marker v1 stays playable without handoff", () => {
    const start = html.indexOf('id="mechanics-roguelite-campaign-editor"');
    const end = html.indexOf('<div class="mechanics-actions">', start);
    const campaign = html.slice(start, end);
    expect(campaign).toMatch(/marker v2|campaign handoff v2/i);
    expect(campaign).toMatch(/deck|cards/i);
    expect(campaign).toMatch(/artifacts/i);
    expect(campaign).toMatch(/marker v1[\s\S]*(?:legacy|without carry|without handoff)/i);
  });

  it("preserves every marker losslessly and makes future markers read-only in ordinary mechanics edits", () => {
    const normalize = functionSource(app, "normalizeRogueliteMechanicsDraft");
    expect(normalize).toMatch(/draft\.campaign\s*=\s*deep\(campaign\)/);
    expect(normalize).not.toMatch(/\[1,\s*2\][\s\S]*(?:includes|has)/);
    const guard = functionSource(app, "hasUnsupportedRogueliteCampaignMarker");
    expect(guard).toMatch(/schemaVersion[\s\S]*!\[1,\s*2\]\.includes/);
    expect(app).toMatch(/supportedRogueliteVersion[\s\S]*hasUnsupportedRogueliteCampaignMarker\(MechanicsUI\.draft\)/);
  });

  it("keeps graph v1/v2 authoring on the existing guarded four-file endpoint", () => {
    const request = functionSource(app, "campaignRequest");
    const apply = functionSource(app, "applyCampaign");
    expect(request).toMatch(/profileId[\s\S]*campaign/);
    expect(apply).toMatch(/previewCampaign\(requestSnapshot\)[\s\S]*\/api\/campaign\/apply[\s\S]*ifRevision/);
    expect(server).toMatch(/apply_campaign/);
    expect(server).not.toMatch(/\/api\/campaign\/(?:prepare|settle|handoff)/);
  });

  it("keeps direct Studio Playtest battle-local instead of silently creating a CampaignRun", () => {
    const createPlaytest = functionSource(app, "newPlaytestGame");
    expect(createPlaytest).toMatch(/new\s+PT\.mod\.TowerDefenseGame/);
    expect(createPlaytest).not.toMatch(/prepareCampaignBattle|createCampaignRun|settleCampaignBattleVictory/);
  });
});
