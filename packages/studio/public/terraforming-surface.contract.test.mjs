import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");

const STATIC_IDS = Object.freeze([
  "mechanics-terraforming-editor",
  "mechanics-terraforming-transition-rows",
  "btn-mechanics-add-terraforming-transition",
  "mechanics-terraforming-elevation-enabled",
  "mechanics-terraforming-elevation-minimum",
  "mechanics-terraforming-elevation-maximum",
  "mechanics-terraforming-elevation-max-delta",
  "mechanics-terraforming-elevation-dependency",
  "mechanics-terraforming-recipe-source-tag",
  "mechanics-terraforming-recipe-destination",
  "mechanics-terraforming-recipe-transition-id",
  "mechanics-terraforming-recipe-snippet"
]);
const ROW_MARKERS = Object.freeze([
  "data-terraforming-transition-id",
  "data-terraforming-source-tag",
  "data-add-terraforming-source-tag",
  "data-remove-terraforming-source-tag",
  "data-terraforming-destination-id",
  "data-remove-terraforming-transition"
]);

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

function evaluateFunction(source, name) {
  const deep = (value) => JSON.parse(JSON.stringify(value));
  const ownDataValue = (record, key) => {
    if (!record || typeof record !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  return Function("deep", "ownDataValue", `"use strict"; return (${functionSource(source, name)});`)(deep, ownDataValue);
}

describe("R3.4b C5B1 Studio terraforming internal surface contract", () => {
  it("places one Terraforming card immediately after Physics and keeps its isolated editor only in Mechanics Hub", () => {
    const modulesStart = app.indexOf("const MECHANICS_MODULES");
    const modulesEnd = app.indexOf("const REACTION_RECIPE_IDS", modulesStart);
    const modules = app.slice(modulesStart, modulesEnd);
    const physics = modules.indexOf('id: "physics"');
    const terraforming = modules.indexOf('id: "terraforming"');
    const roguelite = modules.indexOf('id: "roguelite"');
    expect(physics).toBeGreaterThanOrEqual(0);
    expect(terraforming).toBeGreaterThan(physics);
    expect(roguelite).toBeGreaterThan(terraforming);
    expect(modules.match(/id:\s*["']terraforming["']/g) ?? []).toHaveLength(1);
    expect(modules.slice(terraforming, roguelite)).toMatch(/Terraforming/i);

    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const ordinaryForms = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of STATIC_IDS) {
      expect(hub).toContain(`id="${id}"`);
      expect(ordinaryForms).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }

    const render = functionSource(app, "renderTerraformingMechanicsEditor");
    for (const marker of ROW_MARKERS) {
      expect(render.match(new RegExp(marker, "g")) ?? []).toHaveLength(1);
      expect(app.match(new RegExp(marker, "g")) ?? []).toHaveLength(1);
    }
    const editorStart = hub.indexOf('id="mechanics-terraforming-editor"');
    const editorEnd = hub.indexOf('<div class="mechanics-actions">', editorStart);
    const editor = hub.slice(editorStart, editorEnd);
    expect(editor).not.toMatch(/<canvas|phaser|visual graph|node graph/i);
    expect(render).not.toMatch(/createCanvasRenderer|Phaser|visual graph|node graph/i);
  });

  it("normalizes a valid v1 transition/elevation profile as a detached lossless draft", () => {
    const normalize = evaluateFunction(app, "normalizeTerraformingMechanicsDraft");
    const profile = {
      terrainTransitions: {
        flood: { fromTerrainTags: ["mutable_path", "snow"], toTerrainId: "water" },
        collapse: { fromTerrainTags: ["bridge", "damaged"], toTerrainId: "rubble" }
      },
      elevation: { minimum: -8, maximum: 16, maximumDeltaPerOperation: 4 }
    };

    const normalized = normalize(profile);
    expect(normalized).toEqual(profile);
    expect(normalized).not.toBe(profile);
    expect(normalized.terrainTransitions).not.toBe(profile.terrainTransitions);
    expect(normalized.terrainTransitions.flood.fromTerrainTags)
      .not.toBe(profile.terrainTransitions.flood.fromTerrainTags);
    expect(normalized.elevation).not.toBe(profile.elevation);
  });

  it("routes only supported v1 drafts, keeps future modules raw/read-only, and derives all limits from capabilities", () => {
    const normalize = functionSource(app, "normalizeMechanicsDraft");
    const effectiveVersion = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    const hub = functionSource(app, "renderMechanicsHub");
    const render = functionSource(app, "renderTerraformingMechanicsEditor");

    expect(normalize).toMatch(/selectedModuleId\s*===\s*["']terraforming["'][\s\S]*normalizeTerraformingMechanicsDraft/);
    expect(normalize).toMatch(/mechanicsProjectModuleVersion\s*\(\)[\s\S]*(?:===|!==)\s*1|moduleSchemaVersion[\s\S]*(?:===|!==)\s*1/);
    expect(normalize).toMatch(/deep\s*\(\s*profile/);
    expect(effectiveVersion).toMatch(/selectedModuleId\s*===\s*["']terraforming["'][\s\S]*return\s+1/);
    expect(effectiveVersion).not.toMatch(/terraforming[\s\S]{0,160}(?:Math\.min|return\s+mechanicsProjectModuleVersion\s*\(\))/);
    expect(hub).toMatch(/authoring\.writable\s*!==\s*false[\s\S]*capability\?\.available/);
    expect(app).toMatch(/capabilities\?*\.terraforming\?*\.authoring\?*\.limits/);
    expect(render).toMatch(/transitionDefinitions|sourceTagsPerTransition|idOrTagUtf8Bytes/);
    expect(render).toMatch(/mechanicsTerraformingLimits|capabilities\?*\.terraforming\?*\.authoring\?*\.limits/);
  });

  it("builds binary-sorted terrain choices only from project terrain and retains missing authored values", () => {
    const render = functionSource(app, "renderTerraformingMechanicsEditor");
    expect(render).toMatch(/S\.project\?*\.terrainTypes|S\.project\.terrainTypes/);
    expect(render).toMatch(/Object\.(?:keys|entries)\s*\([\s\S]*terrainTypes/);
    expect(render).toMatch(/\.sort\s*\(\s*\(left, right\)\s*=>\s*left\s*<\s*right\s*\?\s*-1/);
    expect(render).toMatch(/fromTerrainTags/);
    expect(render).toMatch(/toTerrainId/);
    expect(render).toMatch(/new Set|\.add\s*\(/);
    expect(render).not.toMatch(/capabilities[\s\S]{0,120}(?:terrainIds|terrainTags)/);
  });

  it("deep-copies both sibling sections and preserves the existing frozen preview/apply and ordinary-save boundaries", () => {
    const route = functionSource(app, "normalizeMechanicsDraft");
    const request = functionSource(app, "mechanicsRequest");
    const preview = functionSource(app, "previewMechanics");
    const apply = functionSource(app, "applyMechanics");
    const save = functionSource(app, "save");

    expect(route).toMatch(/terraforming[\s\S]*normalizeTerraformingMechanicsDraft/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:terrainTransitions|elevation)/);
    expect(request).toMatch(/profileId[\s\S]*profile/);
    expect(save).not.toMatch(/S\.project\.mechanics|\bmechanics\s*:/);
    expect(preview).toMatch(/Object\.freeze\(mechanicsRequest\(requestOrEnabled\)\)/);
    expect(apply).toMatch(/requestSnapshot\s*=\s*Object\.freeze\(mechanicsRequest\(enabled\)\)/);
    expect(apply).toMatch(/previewMechanics\(requestSnapshot\)/);
    expect(apply).toMatch(/\.\.\.requestSnapshot[\s\S]*ifRevision:\s*preview\.revision/);
  });

  it("uses the narrow recipe endpoint for parameterized metadata without adding renderer or graph surfaces", () => {
    expect(app).toMatch(/\/api\/mechanics\/recipe/);
    expect(app).toMatch(/mechanics-terraforming-recipe-source-tag[\s\S]*mechanics-terraforming-recipe-destination[\s\S]*mechanics-terraforming-recipe-transition-id/);
    expect(app).toMatch(/towerScriptSnippet|mechanics-terraforming-recipe-snippet/);
    expect(app).not.toMatch(/renderTerraforming(?:Canvas|Phaser|VisualGraph)|createTerraforming(?:Canvas|Phaser|VisualGraph)/);
  });
});
