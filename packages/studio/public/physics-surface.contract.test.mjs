import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");

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

describe("R3.4a Studio physics authoring surface contract", () => {
  it("keeps the closed physics profile editor inside Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-physics-editor",
      "mechanics-physics-displacement-immunity",
      "mechanics-physics-fall-immunity",
      "mechanics-physics-hazard-tags"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    expect(hub).toMatch(/push|pull|displacement/i);
    expect(hub).toMatch(/fall hazard|chasm/i);
    const physicsStart = hub.indexOf('<div id="mechanics-physics-editor"');
    const physicsEnd = hub.indexOf('<div id="mechanics-terraforming-editor"', physicsStart);
    expect(physicsEnd).toBeGreaterThan(physicsStart);
    const physicsEditor = hub.slice(physicsStart, physicsEnd);
    expect(physicsEditor).not.toMatch(/terraform|flood|moat|bridge|visual graph/i);
  });

  it("normalizes all three detached lists and saves the whole profile through the guarded transaction", () => {
    const normalize = functionSource(app, "normalizePhysicsMechanicsDraft");
    const request = functionSource(app, "mechanicsRequest");
    const apply = functionSource(app, "applyMechanics");
    for (const field of [
      "displacementImmuneEnemyTypeIds",
      "fallImmuneEnemyTypeIds",
      "fallHazardTerrainTags"
    ]) expect(normalize).toContain(field);
    expect(normalize).toMatch(/128|idOrTagUtf8Bytes/);
    expect(normalize).toMatch(/4096|immuneEnemyTypeIds/);
    expect(normalize).toMatch(/64|fallHazardTerrainTags/);
    expect(app).toMatch(/selectedModuleId\s*===\s*["']physics["'][\s\S]*renderPhysicsMechanicsEditor\s*\(/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:displacementImmuneEnemyTypeIds|fallImmuneEnemyTypeIds|fallHazardTerrainTags)/);
    expect(apply).toMatch(/previewMechanics/);
    expect(apply).toMatch(/ifRevision|preview\.revision/);
  });

  it("shows displacement effect rows only for an active mission-selected physics profile and preserves raw effects otherwise", () => {
    const active = functionSource(app, "isPhysicsMechanicsActive");
    const effect = functionSource(app, "renderDisplacementEffectEditor");
    expect(active).toMatch(/capabilit(?:y|ies)/i);
    expect(active).toMatch(/physics/);
    expect(active).toMatch(/active/);
    expect(effect).toMatch(/isPhysicsMechanicsActive\s*\(/);
    expect(effect).toMatch(/push[\s\S]*pull|pull[\s\S]*push/);
    expect(effect).toMatch(/distance/);
    expect(effect).toMatch(/stopAtBlocker/);
    expect(effect).toMatch(/max=["']8["']|displacementDistance/);
    expect(app.match(/renderDisplacementEffectEditor\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(app).toMatch(/pipeline[\s\S]*renderDisplacementEffectEditor|renderDisplacementEffectEditor[\s\S]*pipeline/i);
    expect(app).toMatch(/abilit(?:y|ies)[\s\S]*renderDisplacementEffectEditor|renderDisplacementEffectEditor[\s\S]*abilit(?:y|ies)/i);
    expect(app).toMatch(/preserve|raw existing effects|effects\s*=\s*deep\(/i);
  });
});
