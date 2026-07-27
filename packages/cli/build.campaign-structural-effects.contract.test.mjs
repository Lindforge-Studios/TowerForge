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

describe("R4.4B generated Canvas/Phaser structural campaign contract", () => {
  it("ships one structural choice surface and engine reducer integration in both players", () => {
    expect(buildSource.match(/\bresolveCampaignStructuralChoice\b/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(buildSource.match(/data-campaign-choice-id/g) ?? []).toHaveLength(2);
    const selectors = functionSources(buildSource, "selectCampaignChoice");
    expect(selectors).toHaveLength(2);
    for (const select of selectors) {
      expect(select).toMatch(/resolveCampaignStructuralChoice\s*\(\s*campaignRun\s*,\s*content\s*,\s*nodeId\s*,\s*choiceId\s*\)/);
      expect(select).toMatch(/result\.ok[\s\S]*campaignRun\s*=\s*result\.run[\s\S]*updateCampaignRun\s*\(/);
      expect(select).not.toMatch(/Math\.random|costs[^;\n]*(?:\+|-|reduce)|grants[^;\n]*(?:\+|-|reduce)/);
    }
  });

  it("renders engine-projected run resources and choices without host-side affordability math", () => {
    const renderers = functionSources(buildSource, "updateCampaignRun");
    expect(renderers).toHaveLength(2);
    for (const render of renderers) {
      expect(render).toMatch(/presentation\.runResources/);
      expect(render).toMatch(/node\.choices/);
      expect(render).toMatch(/selectCampaignChoice\s*\(/);
      expect(render).not.toMatch(/resolveCampaignStructuralChoice\s*\(/);
      expect(render).not.toMatch(/(?:costs|grants)[\s\S]{0,120}(?:reduce|every|<=|>=|\+|-)/);
    }
  });

  it("keeps structural progress in the explicit CampaignRun import/export path", () => {
    const controls = functionSources(buildSource, "setupCampaignRunControls");
    expect(controls).toHaveLength(2);
    for (const setup of controls) {
      expect(setup).toMatch(/exportCampaignRun\s*\(\s*campaignRun\s*\)/);
      expect(setup).toMatch(/importCampaignRun\s*\(/);
      expect(setup).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });
});
