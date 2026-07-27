import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const buildSource = fs.readFileSync(path.resolve("packages/cli/build.mjs"), "utf8");

function functionSources(source, name) {
  const results = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(`function ${name}`, cursor);
    if (start < 0) break;
    const open = source.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      if (depth === 0) { end += 1; break; }
    }
    results.push(source.slice(start, end));
    cursor = end;
  }
  return results;
}

describe("R4.4A generated Canvas/Phaser campaign run contract", () => {
  it("ships the shared campaign projection and explicit portable codec to both players", () => {
    expect(buildSource.match(/\bcreateCampaignRun\b/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(buildSource.match(/\bimportCampaignRun\b/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(buildSource.match(/\bexportCampaignRun\b/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(buildSource.match(/\bprojectCampaignPresentation\b/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(buildSource.match(/projectCampaignPresentation\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(buildSource).toContain('id="campaign-run-panel"');
    expect(buildSource).toContain('id="campaign-run-export"');
    expect(buildSource).toContain('id="campaign-run-import"');
    expect(buildSource).toContain('id="campaign-run-file"');
  });

  it("hides the complete run UI when campaign is absent and reads availability from engine", () => {
    const renderers = functionSources(buildSource, "updateCampaignRun");
    expect(renderers).toHaveLength(2);
    for (const render of renderers) {
      expect(render).toMatch(/projectCampaignPresentation\s*\(/);
      expect(render).toMatch(/getAvailableCampaignNodeIds\s*\(/);
      expect(render).toMatch(/panel\.hidden\s*=\s*!presentation\.active/);
      expect(render).not.toMatch(/nextNodeIds[\s\S]{0,160}(?:includes|some|filter)/);
    }
  });

  it("imports and exports only after explicit user actions and never persists a run in browser storage", () => {
    const controls = functionSources(buildSource, "setupCampaignRunControls");
    expect(controls).toHaveLength(2);
    for (const setup of controls) {
      expect(setup).toMatch(/campaign-run-export[\s\S]*addEventListener\(["']click["']/);
      expect(setup).toMatch(/exportCampaignRun\s*\(\s*campaignRun\s*\)/);
      expect(setup).toMatch(/campaign-run-import[\s\S]*addEventListener\(["']click["']/);
      expect(setup).toMatch(/campaign-run-file/);
      expect(setup).toMatch(/importCampaignRun\s*\(/);
      expect(setup).not.toMatch(/localStorage|sessionStorage|createPlayerProfileStore|indexedDB/);
    }
    expect(buildSource).not.toMatch(
      /(?:localStorage|sessionStorage)\.(?:getItem|setItem)\([^)]*(?:campaignRun|campaign-run|campaign_run)/i
    );
  });

  it("launches only available battle nodes and records victory once through the campaign reducer", () => {
    const selectors = functionSources(buildSource, "selectCampaignNode");
    expect(selectors).toHaveLength(2);
    for (const select of selectors) {
      expect(select).toMatch(/getAvailableCampaignNodeIds\s*\(\s*campaignRun\s*,\s*content\s*\)/);
      expect(select).toMatch(/!availableNodeIds\.includes\(nodeId\)/);
      expect(select).toMatch(/node\.type\s*===\s*["']merchant["'][\s\S]*node\.type\s*===\s*["']event["'][\s\S]*return/);
      expect(select).toMatch(/pendingCampaignNodeId\s*=\s*node\.id[\s\S]*missionId\s*=\s*node\.missionId[\s\S]*game\s*=\s*createGame\(\)/);
    }

    const huds = functionSources(buildSource, "updateHud");
    expect(huds).toHaveLength(2);
    for (const hud of huds) {
      expect(hud).toMatch(/recordCampaignBattleVictory\s*\(\s*campaignRun\s*,\s*progress\s*,\s*content\s*,\s*pendingCampaignNodeId\s*,\s*earnedStars\s*\)/);
      expect(hud).toMatch(/campaignRun\s*=\s*result\.run[\s\S]*progress\s*=\s*result\.profile[\s\S]*persistPlayerProfile\(\)/);
      expect(hud).toMatch(/else\s*{\s*recordPlayerVictory\(missionId,\s*earnedStars\)/);
    }
  });

  it("exposes the same read-only campaign inspection hook in both generated players", () => {
    expect(buildSource.match(/window\.__towerforgeCampaignInspect\s*=\s*\(\)\s*=>/g) ?? []).toHaveLength(2);
    expect(buildSource.match(/availableNodeIds:\s*activeCampaign\s*&&\s*campaignRun/g) ?? []).toHaveLength(2);
    expect(buildSource.match(/JSON\.parse\(exportCampaignRun\(campaignRun\)\)/g) ?? []).toHaveLength(2);
  });
});
