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

describe("R4.4C generated Canvas/Phaser campaign battle handoff", () => {
  it("imports the engine-owned prepare/settle protocol in both generated players", () => {
    expect(buildSource.match(/\bprepareCampaignBattle\b/g) ?? []).toHaveLength(4);
    expect(buildSource.match(/\bsettleCampaignBattleVictory\b/g) ?? []).toHaveLength(4);
    expect(buildSource.match(/\bprepareCampaignBattle\s*,/g) ?? []).toHaveLength(2);
    expect(buildSource.match(/\bsettleCampaignBattleVictory\s*,/g) ?? []).toHaveLength(2);
  });

  it("prepares an available node before adopting its mission and engine-created game", () => {
    const selectors = functionSources(buildSource, "selectCampaignNode");
    expect(selectors).toHaveLength(2);
    for (const select of selectors) {
      expect(select).toMatch(/prepareCampaignBattle\s*\(\s*campaignRun\s*,\s*content\s*,\s*nodeId\s*\)/);
      expect(select).toMatch(/prepared\.ok[\s\S]*pendingCampaignNodeId\s*=\s*prepared\.nodeId[\s\S]*missionId\s*=\s*prepared\.missionId[\s\S]*game\s*=\s*prepared\.game/);
      expect(select.indexOf("prepareCampaignBattle")).toBeLessThan(select.indexOf("pendingCampaignNodeId = prepared.nodeId"));
      expect(select).not.toMatch(/campaignRun\.(?:deck|artifacts)\s*=|Math\.random|getSnapshot\(\)\.roguelite/);
      // Marker v1 remains a playable campaign, but never enters the marker-v2 carry protocol.
      expect(select).toMatch(/campaign_handoff_inactive[\s\S]*recordCampaignBattleVictory|campaign_handoff_inactive[\s\S]*legacy/i);
    }
  });

  it("settles the exact victorious game atomically and retains the marker-v1 reducer fallback", () => {
    const huds = functionSources(buildSource, "updateHud");
    expect(huds).toHaveLength(2);
    for (const hud of huds) {
      expect(hud).toMatch(/settleCampaignBattleVictory\s*\(\s*campaignRun\s*,\s*progress\s*,\s*content\s*,\s*pendingCampaignNodeId\s*,\s*earnedStars\s*,\s*game\s*\)/);
      expect(hud).toMatch(/result\.ok[\s\S]*campaignRun\s*=\s*result\.run[\s\S]*progress\s*=\s*result\.profile[\s\S]*persistPlayerProfile\(\)/);
      expect(hud).toMatch(/recordCampaignBattleVictory\s*\(/);
      expect(hud).not.toMatch(/snapshot\.(?:roguelite|artifacts|draft)[\s\S]{0,240}(?:deck|artifacts)\s*=/);
    }
  });

  it("does not swap the portable run underneath a pending handoff battle", () => {
    const controls = functionSources(buildSource, "setupCampaignRunControls");
    expect(controls).toHaveLength(2);
    for (const setup of controls) {
      const pendingGuard = setup.search(/pendingCampaignNodeId|pendingCampaignBattle/);
      const importCall = setup.indexOf("importCampaignRun");
      expect(pendingGuard).toBeGreaterThanOrEqual(0);
      expect(importCall).toBeGreaterThan(pendingGuard);
      expect(setup).toMatch(/(?:pendingCampaignNodeId|pendingCampaignBattle)[\s\S]{0,320}(?:return|disabled|cannot|active battle)/i);
      expect(setup).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  it("keeps absent campaigns inert and exposes carry only through explicit run inspection", () => {
    expect(buildSource.match(/window\.__towerforgeCampaignInspect\s*=\s*\(\)\s*=>/g) ?? []).toHaveLength(2);
    expect(buildSource.match(/active:\s*Boolean\(activeCampaign\s*&&\s*campaignRun\)/g) ?? []).toHaveLength(2);
    expect(buildSource).not.toMatch(/(?:localStorage|sessionStorage)\.(?:getItem|setItem)\([^)]*(?:campaignRun|campaign-run|campaign_run)/i);
  });
});
