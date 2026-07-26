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

describe("R5.1A Studio static heroes foundation surface", () => {
  it("describes the Heroes card as an opt-in roster whose v2 adds movement only", () => {
    const match = app.match(/\{\s*id:\s*["']heroes["']\s*,\s*title:\s*["']Heroes["']\s*,\s*description:\s*["']([^"']+)["']\s*\}/);
    expect(match, "Heroes Mechanics Hub card copy must be explicit").not.toBeNull();
    const copy = match?.[1] ?? "";
    expect(copy).toMatch(/opt-in|optional/i);
    expect(copy).toMatch(/roster/i);
    expect(copy).toMatch(/core/i);
    expect(copy).toMatch(/movement|move/i);
    expect(copy).not.toMatch(/abilit|aura|skill\s*tree|command(?:er)?\s+units?/i);
  });

  it("keeps the exact roster editor isolated inside Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-heroes-editor",
      "mechanics-heroes-selected-id",
      "mechanics-heroes-definition-rows",
      "btn-mechanics-add-hero"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    for (const marker of [
      "data-hero-definition-id",
      "data-hero-label",
      "data-hero-spawn"
    ]) expect(`${html}\n${app}`).toContain(marker);
    expect(hub).toMatch(/selected hero|hero definitions|commander/i);
    expect(`${html}\n${app}`).toMatch(/value=["']core["']|spawn[\s\S]{0,120}core/i);

    const heroStart = hub.indexOf('id="mechanics-heroes-editor"');
    const heroEnd = hub.indexOf('id="mechanics-logistics-editor"', heroStart);
    const editor = hub.slice(heroStart, heroEnd > heroStart ? heroEnd : undefined);
    expect(editor).not.toMatch(/mana|ability|skill|aura|blocking|shield|TowerScript/i);
  });

  it("keeps loaded profiles lossless and saves the whole profile via revision guard", () => {
    const normalize = functionSource(app, "normalizeHeroesMechanicsDraft");
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");
    const apply = functionSource(app, "applyMechanics");

    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(normalize).not.toMatch(/selectedHeroId\s*=|movementProfileId\s*=|defineOwnDataValue|Commander|Ground/);
    expect(render).toMatch(/selectedHeroId/);
    expect(render).toMatch(/definitions/);
    expect(render).toMatch(/spawn/);
    expect(render).toMatch(/core/);
    expect(render).toMatch(/MechanicsUI\.capabilities\?\.heroes|mechanicsAuthoringLimits|HEROES/i);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:selectedHeroId|definitions)/);
    expect(apply).toMatch(/previewMechanics/);
    expect(apply).toMatch(/ifRevision|preview\.revision/);
    expect(apply).toMatch(/await\s+load\(\)/);
  });

  it("enables v1, preserves it across disable/re-enable, and keeps future v3 read-only", () => {
    const hub = functionSource(app, "renderMechanicsHub");
    const effectiveVersion = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    const load = functionSource(app, "loadMechanicsProfile");

    expect(app).toMatch(/selectedModuleId\s*===\s*["']heroes["'][\s\S]*renderHeroesMechanicsEditor\s*\(/);
    expect(hub).toMatch(/btn-mechanics-disable[\s\S]*applyMechanics\(false\)/);
    expect(hub).toMatch(/btn-mechanics-enable[\s\S]*applyMechanics\(true\)/);
    expect(effectiveVersion).toMatch(/heroes[\s\S]*(?:1|moduleSchemaVersion)/i);
    expect(load).toMatch(/normalizeHeroesMechanicsDraft/);
    expect(app).toMatch(/heroes[\s\S]{0,500}(?:future|read-only|schemaVersion\s*3)/i);
  });
});

describe("R5.1B Studio hero movement authoring", () => {
  it("keeps v2 movement controls collapsed inside Mechanics Hub and preserves the v1 editor", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;

    for (const id of [
      "mechanics-heroes-movement-profile-rows",
      "btn-mechanics-add-hero-movement-profile"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    expect(hub).toMatch(/<details[\s\S]*hero movement/i);
    for (const marker of [
      "data-hero-movement-profile-id",
      "data-hero-movement-speed",
      "data-hero-movement-profile-definition-id"
    ]) expect(`${html}\n${app}`).toContain(marker);

    // V1 remains a complete opt-in static profile; the new controls are conditional on v2.
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    expect(render).toMatch(/movementEnabled\s*=\s*editorVersion\s*===\s*2/);
    expect(app).toMatch(/HEROES_SUPPORTED_MODULE_SCHEMA_VERSIONS\s*=\s*Object\.freeze\(\[1,\s*2\]\)/);
  });

  it("round-trips exact nested movement and heroes-owned MovementProfileV1 records", () => {
    const normalize = functionSource(app, "normalizeHeroesMechanicsDraft");
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");

    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(normalize).not.toMatch(/movementProfileId\s*=|defaultTerrainCost\s*=|respect_walkable|ground/i);
    expect(render).toMatch(/movementProfiles/);
    expect(render).toMatch(/movementProfileId/);
    expect(render).toMatch(/speed/);
    expect(render).toMatch(/terrainMode/);
    expect(render).toMatch(/towerOccupancy/);
    expect(render).toMatch(/defaultTerrainCost/);
    expect(render).toMatch(/Unknown\/missing/);
    expect(render).toMatch(/data-hero-movement-profile-id/);
    expect(render).toMatch(/data-hero-movement-speed/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:movementProfiles|definitions)/);
    expect(`${normalize}\n${render}`).not.toMatch(/navigation\.mode|dynamic_flow|enableNavigation/i);
  });

  it("edits v1 and v2, while preserving future v3+ modules read-only", () => {
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    const load = functionSource(app, "loadMechanicsProfile");

    expect(load).toMatch(/normalizeHeroesMechanicsDraft/);
    expect(app).toMatch(/supportedModuleSchemaVersions[\s\S]{0,300}1[\s\S]{0,100}2|heroes[\s\S]{0,500}\[\s*1\s*,\s*2\s*\]/i);
    expect(render).toMatch(/future[\s\S]{0,200}(?:3\+|schemaVersion\s*3)|read-only/i);
    expect(app).not.toMatch(/future heroes schemaVersion 2\+/i);
  });
});
