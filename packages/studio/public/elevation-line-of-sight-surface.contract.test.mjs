import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");
const server = fs.readFileSync(path.resolve("packages/studio/server.mjs"), "utf8");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
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

describe("R3.2 Studio elevation line-of-sight surface contract", () => {
  it("keeps LoS in Mechanics Hub with a v2 toggle, blocker tags, and bounded source/target analysis controls", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-elevation-los-enabled",
      "mechanics-elevation-los-tags",
      "mechanics-elevation-los-source-q",
      "mechanics-elevation-los-source-r",
      "mechanics-elevation-los-target-q",
      "mechanics-elevation-los-target-r",
      "btn-elevation-los-analyze",
      "mechanics-elevation-los-state"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
    }
    expect(hub).toMatch(/line of sight|\bLoS\b/i);
    expect(hub).toMatch(/terrain.*(?:blocker|tag)|(?:blocker|tag).*terrain/i);
    const losStart = hub.indexOf("mechanics-elevation-los-section");
    const losEnd = hub.indexOf("mechanics-elevation-high-ground-section", losStart);
    const losSection = hub.slice(losStart, losEnd);
    expect(losSection).not.toMatch(/high[- ]ground|damage bonus|range bonus|terraform/i);
  });

  it("preserves optional lineOfSight data and its monotonic v2 module version instead of normalizing elevation to an empty profile", () => {
    const normalize = functionSource(app, "normalizeMechanicsDraft");
    const load = functionSource(app, "loadMechanicsProfile");
    const effectiveVersion = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    const request = functionSource(app, "mechanicsRequest");

    expect(normalize).toMatch(/elevation[\s\S]*normalizeElevationLineOfSightDraft/);
    expect(normalize).not.toMatch(/selectedModuleId\s*===\s*["']elevation["']\)\s*return\s*\{\s*\}/);
    expect(functionSource(app, "normalizeElevationLineOfSightDraft"))
      .toMatch(/lineOfSight[\s\S]*terrainBlockerTags/);
    expect(load).toMatch(/normalizeMechanicsDraft\(profile\)/);
    expect(load).not.toMatch(/selectedModuleId\s*===\s*["']elevation["'][^?]*\?\s*\{\s*\}/);
    expect(effectiveVersion).toMatch(/elevation[\s\S]*(?:mechanicsProjectModuleVersion|moduleSchemaVersion)[\s\S]*lineOfSight[\s\S]*2/);
    expect(effectiveVersion).not.toMatch(/selectedModuleId\s*===\s*["']elevation["']\)\s*return\s*1/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/elevation[\s\S]{0,160}(?:delete\s+profile\.lineOfSight|profile\s*=\s*\{\s*\})/);
  });

  it("analyzes the exact preview candidate at its revision and invalidates diagnostics on authoring changes", () => {
    const analyze = functionSource(app, "analyzeElevationLineOfSight");
    const invalidate = functionSource(app, "invalidateElevationLineOfSightAnalysis");
    const render = functionSource(app, "renderElevationLineOfSightEditor");

    expect(app).toMatch(/(?:const|let|var)\s+ElevationLineOfSightUI\b/);
    expect(invalidate).toMatch(/analysis\s*=\s*null/);
    expect(analyze).toMatch(/\/api\/elevation\/line-of-sight\/analyze/);
    expect(analyze).toMatch(/ifRevision\s*:\s*(?:MechanicsUI\.)?preview\.revision/);
    expect(analyze).toMatch(/candidate\s*:\s*\{[\s\S]*moduleSchemaVersion[\s\S]*profileId[\s\S]*profile/);
    expect(analyze).toMatch(/source[\s\S]*targets/);
    expect(render).toMatch(/mechanics-elevation-los-enabled[\s\S]*lineOfSight/);
    expect(render).toMatch(/mechanics-elevation-los-tags[\s\S]*terrainBlockerTags/);
    expect(render.match(/invalidateElevationLineOfSightAnalysis\s*\(/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
    expect(app.match(/invalidateElevationLineOfSightAnalysis\s*\(/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(5);
    expect(server).toMatch(/\/api\/elevation\/line-of-sight\/analyze/);
    expect(server).toMatch(/callTool\(\s*["']analyze_line_of_sight["']/);
  });

  it("renders shared recipe prerequisites outside the reactions-only subtree for elevation recipes", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const reactionStart = html.indexOf('<div id="mechanics-reaction-editor"', hubStart);
    const reactionEnd = html.indexOf('<div id="mechanics-navigation-editor"', reactionStart);
    const prerequisiteMatch = html.slice(hubStart, hubEnd)
      .match(/id="(mechanics-(?:recipe|reaction)-prerequisites)"/);
    expect(prerequisiteMatch, "Mechanics Hub must expose one shared recipe prerequisite panel").toBeTruthy();
    const prerequisiteIndex = html.indexOf(`id="${prerequisiteMatch?.[1]}"`, hubStart);
    expect(
      prerequisiteIndex < reactionStart || prerequisiteIndex >= reactionEnd,
      "Shared recipe prerequisites must not be hidden with the reactions-only editor"
    ).toBe(true);

    const renderName = app.match(/function (renderMechanics(?:Recipe|Reaction)Prerequisites)\s*\(/)?.[1];
    expect(renderName, "A shared prerequisite render path must exist").toBeTruthy();
    const prerequisiteRender = functionSource(app, renderName);
    const hubRender = functionSource(app, "renderMechanicsHub");
    expect(prerequisiteRender).toMatch(/unmetPrerequisites[\s\S]*\.code/);
    expect(hubRender).toMatch(/selectedModuleId\s*===\s*["']elevation["'][\s\S]*renderMechanics(?:Recipe|Reaction)Prerequisites\s*\(/);

    const panel = {
      hidden: true,
      textContent: "",
      classList: { toggle(_name, value) { panel.hidden = value; } }
    };
    const renderPrerequisites = Function("$", "MechanicsUI", `return (${prerequisiteRender});`)(
      () => panel,
      {
        selectedModuleId: "elevation",
        recipe: { unmetPrerequisites: [{ code: "elevation_terrain_tag_missing" }] }
      }
    );
    renderPrerequisites();
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("elevation_terrain_tag_missing");
  });

  it("round-trips JSON-array blocker tags losslessly without silent dedupe or caps and keeps comma shorthand", () => {
    const parserSource = functionSource(app, "elevationLineOfSightTags");
    const parseTags = Function(`"use strict"; return (${parserSource});`)();
    const validJsonTags = ["opaque,wall", "line\nbreak", "snow"];
    const overBudgetForValidation = Array.from({ length: 65 }, (_, index) => `tag_${index}`);

    expect(parseTags(JSON.stringify(validJsonTags))).toEqual(validJsonTags);
    expect(parseTags(JSON.stringify(["opaque", "opaque"]))).toEqual(["opaque", "opaque"]);
    expect(parseTags(JSON.stringify(overBudgetForValidation))).toEqual(overBudgetForValidation);
    expect(parseTags("opaque, wall")).toEqual(["opaque", "wall"]);

    const render = functionSource(app, "renderElevationLineOfSightEditor");
    expect(render).not.toMatch(/tagsInput\.value[\s\S]{0,120}\.join\s*\(/);
    expect(render).toMatch(/tagsInput\.value[\s\S]{0,180}JSON\.stringify|JSON\.stringify[\s\S]{0,180}tagsInput\.value/);
    expect(render).toMatch(/terrainBlockerTags\[0\]\s*===\s*terrainBlockerTags\[0\]\.trim\(\)/);
    expect(render).toMatch(/!terrainBlockerTags\[0\]\.startsWith\(["']\[["']\)/);
  });
});
