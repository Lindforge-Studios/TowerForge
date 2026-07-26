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
  it("describes the Heroes card as an opt-in roster with monotonic optional versions", () => {
    const match = app.match(/\{\s*id:\s*["']heroes["']\s*,\s*title:\s*["']Heroes["']\s*,\s*description:\s*["']([^"']+)["']\s*\}/);
    expect(match, "Heroes Mechanics Hub card copy must be explicit").not.toBeNull();
    const copy = match?.[1] ?? "";
    expect(copy).toMatch(/opt-in|optional/i);
    expect(copy).toMatch(/roster/i);
    expect(copy).toMatch(/core/i);
    expect(copy).toMatch(/movement|move/i);
    expect(copy).toMatch(/abilit/i);
    expect(copy).toMatch(/skill|tree/i);
    expect(copy).toMatch(/aura/i);
    expect(copy).not.toMatch(/blocking|command(?:er)?\s+units?/i);
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
    expect(editor).not.toMatch(/aura|blocking|TowerScript/i);
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

  it("enables v1, preserves it across disable/re-enable, and keeps future v7 read-only", () => {
    const hub = functionSource(app, "renderMechanicsHub");
    const effectiveVersion = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    const load = functionSource(app, "loadMechanicsProfile");

    expect(app).toMatch(/selectedModuleId\s*===\s*["']heroes["'][\s\S]*renderHeroesMechanicsEditor\s*\(/);
    expect(hub).toMatch(/btn-mechanics-disable[\s\S]*applyMechanics\(false\)/);
    expect(hub).toMatch(/btn-mechanics-enable[\s\S]*applyMechanics\(true\)/);
    expect(effectiveVersion).toMatch(/heroes[\s\S]*(?:1|moduleSchemaVersion)/i);
    expect(load).toMatch(/normalizeHeroesMechanicsDraft/);
    expect(app).toMatch(/heroes[\s\S]{0,500}(?:future|read-only|schemaVersion\s*7)/i);
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
    expect(render).toMatch(/movementEnabled\s*=\s*editorVersion\s*>=\s*2/);
    expect(app).toMatch(/HEROES_SUPPORTED_MODULE_SCHEMA_VERSIONS\s*=\s*Object\.freeze\(\[1,\s*2,\s*3,\s*4,\s*5,\s*6\]\)/);
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

  it("edits v1-v6, while preserving future v7+ modules read-only", () => {
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    const load = functionSource(app, "loadMechanicsProfile");

    expect(load).toMatch(/normalizeHeroesMechanicsDraft/);
    expect(app).toMatch(/supportedModuleSchemaVersions[\s\S]{0,300}1[\s\S]{0,100}2[\s\S]{0,100}3[\s\S]{0,100}4[\s\S]{0,100}5[\s\S]{0,100}6|heroes[\s\S]{0,500}\[\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*,\s*5\s*,\s*6\s*\]/i);
    expect(render).toMatch(/future[\s\S]{0,200}(?:7\+|schemaVersion\s*7)|read-only/i);
    expect(app).not.toMatch(/future heroes schemaVersion 2\+/i);
  });
});

describe("R5.2A Studio hero durability authoring", () => {
  it("keeps exact v3 HP and optional shield controls inside Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;

    for (const marker of ["data-hero-max-hp", "data-hero-shield-enabled", "data-hero-shield-capacity"]) {
      expect(`${html}\n${app}`).toContain(marker);
      expect(outside).not.toContain(marker);
    }
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    expect(render).toMatch(/durabilityEnabled\s*=\s*editorVersion\s*>=\s*3\s*&&\s*editorVersion\s*<=\s*6/);
    expect(render).toMatch(/durability/);
    expect(render).toMatch(/maxHp/);
    expect(render).toMatch(/shield/);
    expect(render).toMatch(/capacity/);
    expect(render).toMatch(/descriptor\?\.versions\?\.\[?3\]?|versions\?\.\[editorVersion\]/);
  });

  it("preserves the exact profile and derives v3 only from authored durability", () => {
    const normalize = functionSource(app, "normalizeHeroesMechanicsDraft");
    const effectiveVersion = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    const request = functionSource(app, "mechanicsRequest");

    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(normalize).not.toMatch(/maxHp\s*=|capacity\s*=|durability\s*=/);
    expect(effectiveVersion).toMatch(/hasDurability[\s\S]{0,320}Math\.max\(authoredVersion,\s*3\)/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:definitions|movementProfiles)/);
  });
});

describe("R5.3A Studio targeted hero ability authoring", () => {
  it("keeps exact v4 mana and one enemy-target ability inside Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const marker of [
      "data-hero-mana-max", "data-hero-mana-starting", "data-hero-mana-regeneration",
      "data-hero-ability-id", "data-hero-ability-label", "data-hero-ability-target",
      "data-hero-ability-mana-cost", "data-hero-ability-cooldown",
      "data-hero-ability-range", "data-hero-ability-damage"
    ]) {
      expect(`${html}\n${app}`).toContain(marker);
      expect(outside).not.toContain(marker);
    }
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    expect(render).toMatch(/abilityEnabled\s*=\s*editorVersion\s*>=\s*4\s*&&\s*editorVersion\s*<=\s*6/);
    expect(render).toMatch(/descriptor\?\.versions\?\.\[?4\]?/);
    expect(render).toMatch(/target[\s\S]{0,160}enemy/i);
  });

  it("keeps v1-v6 behavior and preserves future v7 losslessly read-only", () => {
    const normalize = functionSource(app, "normalizeHeroesMechanicsDraft");
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");
    expect(app).toMatch(/HEROES_SUPPORTED_MODULE_SCHEMA_VERSIONS\s*=\s*Object\.freeze\(\[1,\s*2,\s*3,\s*4,\s*5,\s*6\]\)/);
    expect(render).toMatch(/movementEnabled\s*=\s*editorVersion\s*>=\s*2\s*&&\s*editorVersion\s*<=\s*6/);
    expect(render).toMatch(/durabilityEnabled\s*=\s*editorVersion\s*>=\s*3\s*&&\s*editorVersion\s*<=\s*6/);
    expect(app).toMatch(/Future heroes schemaVersion 7\+/);
    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
  });

  it("passes invalid visible numeric values to shared validation without silent repair", () => {
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    for (const marker of [
      "data-hero-mana-max", "data-hero-mana-starting", "data-hero-mana-regeneration",
      "data-hero-ability-mana-cost", "data-hero-ability-cooldown",
      "data-hero-ability-range", "data-hero-ability-damage"
    ]) {
      expect(render).toMatch(new RegExp(`${marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[\\s\\S]{0,400}Number\\(event\\.target\\.value\\)`));
    }
    expect(render).not.toMatch(/data-hero-(?:mana|ability)[\s\S]{0,350}Number\.isFinite\([\s\S]{0,120}(?:>|>=)\s*0/);
  });
});

describe("R5.4A Studio battle-local hero skill-tree authoring", () => {
  it("keeps the exact nullable v5 tree controls inside Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const marker of [
      "data-hero-skill-tree-enabled",
      "data-hero-skill-starting-points",
      "data-hero-skill-points-per-interwave",
      "data-hero-skill-node-id",
      "data-hero-skill-id",
      "data-hero-skill-label",
      "data-hero-skill-description",
      "data-hero-skill-cost",
      "data-hero-skill-requires",
      "data-hero-skill-operation",
      "data-hero-skill-value",
      "data-add-hero-skill",
      "data-remove-hero-skill"
    ]) {
      expect(`${html}\n${app}`).toContain(marker);
      expect(outside).not.toContain(marker);
    }
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    expect(render).toMatch(/skillTree/);
    expect(render).toMatch(/points[\s\S]{0,200}starting[\s\S]{0,200}perInterwave/);
    expect(render).toMatch(/nodes/);
    expect(render).toMatch(/label[\s\S]{0,200}description[\s\S]{0,200}cost[\s\S]{0,200}requires/);
    expect(render).toMatch(/hero_ability_damage/);
    expect(render).toMatch(/flat[\s\S]{0,160}additive_ratio[\s\S]{0,160}multiplier/);
    expect(render).not.toMatch(/blockCapacity|logistics|TowerScript/i);
  });

  it("promotes v4 to v5 only through an explicit nullable-tree edit and preserves the whole profile", () => {
    const normalize = functionSource(app, "normalizeHeroesMechanicsDraft");
    const effectiveVersion = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");

    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(normalize).not.toMatch(/skillTree\s*=|starting\s*=|perInterwave\s*=/);
    expect(effectiveVersion).toMatch(/hasSkillTree[\s\S]{0,360}Math\.max\(authoredVersion,\s*5\)/);
    expect(render).toMatch(/editorVersion\s*===\s*5|editorVersion\s*>=\s*5\s*&&\s*editorVersion\s*<=\s*6/);
    expect(render).toMatch(/data-hero-skill-tree-enabled[\s\S]{0,900}skillTree\s*=\s*(?:event\.target\.checked\s*\?|null|\{)/);
    expect(render).toMatch(/MechanicsUI\.moduleSchemaVersion\s*=\s*(?:Math\.max\([^)]*5\)|5)/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:definitions|movementProfiles)/);
  });

  it("passes visible tree values to shared validation and keeps future v7 read-only", () => {
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    for (const marker of [
      "data-hero-skill-starting-points",
      "data-hero-skill-points-per-interwave",
      "data-hero-skill-cost",
      "data-hero-skill-value"
    ]) {
      expect(render).toMatch(new RegExp(
        `${marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[\\s\\S]{0,500}Number\\(event\\.target\\.value\\)`
      ));
    }
    expect(render).not.toMatch(/data-hero-skill[\s\S]{0,350}Number\.isFinite\([\s\S]{0,120}(?:>|>=)\s*0/);
    expect(app).toMatch(/HEROES_SUPPORTED_MODULE_SCHEMA_VERSIONS\s*=\s*Object\.freeze\(\[1,\s*2,\s*3,\s*4,\s*5,\s*6\]\)/);
    expect(app).toMatch(/Future heroes schemaVersion 7\+/);
  });
});

describe("R5.5A Studio passive hero damage-aura authoring", () => {
  it("keeps the exact nullable v6 aura and all bounded effects inside Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const marker of [
      "data-hero-passive-aura-enabled",
      "data-hero-passive-aura-id",
      "data-hero-passive-aura-label",
      "data-hero-passive-aura-radius",
      "data-hero-passive-aura-effect-row",
      "data-hero-passive-aura-effect-operation",
      "data-hero-passive-aura-effect-value",
      "data-add-hero-passive-aura-effect",
      "data-remove-hero-passive-aura-effect"
    ]) {
      expect(`${html}\n${app}`).toContain(marker);
      expect(outside).not.toContain(marker);
    }
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    expect(render).toMatch(/passiveAura/);
    expect(render).toMatch(/tower_damage/);
    expect(render).toMatch(/target[\s\S]{0,120}damage/);
    expect(render).toMatch(/flat[\s\S]{0,180}additive_ratio[\s\S]{0,180}multiplier/);
    expect(render).toMatch(/effects\.length\s*<\s*4/);
    expect(render).toMatch(/effects\.length\s*>\s*1/);
    expect(render).not.toMatch(/blockCapacity|logistics|TowerScript/i);
  });

  it("promotes every v5 definition to explicit v6 aura-or-null only after an aura edit", () => {
    const normalize = functionSource(app, "normalizeHeroesMechanicsDraft");
    const effectiveVersion = functionSource(app, "mechanicsEffectiveModuleSchemaVersion");
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");

    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(normalize).not.toMatch(/passiveAura\s*=/);
    expect(effectiveVersion).toMatch(/hasPassiveAura[\s\S]{0,360}Math\.max\(authoredVersion,\s*6\)/);
    expect(render).toMatch(
      /data-hero-passive-aura-enabled[\s\S]{0,1600}Object\.values\(MechanicsUI\.draft\.definitions\)[\s\S]{0,500}passiveAura\s*===\s*undefined[\s\S]{0,220}passiveAura\s*=\s*null/
    );
    expect(render).toMatch(/definition\.passiveAura\s*=\s*event\.target\.checked[\s\S]{0,700}:\s*null/);
    expect(render).toMatch(/MechanicsUI\.moduleSchemaVersion\s*=\s*6/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:definitions|movementProfiles)/);
  });

  it("passes visible aura numbers to shared validation and preserves future v7 read-only", () => {
    const render = functionSource(app, "renderHeroesMechanicsEditor");
    for (const marker of [
      "data-hero-passive-aura-radius",
      "data-hero-passive-aura-effect-value"
    ]) {
      expect(render).toMatch(new RegExp(
        `${marker}[\\s\\S]{0,600}Number\\(event\\.target\\.value\\)`
      ));
    }
    expect(render).not.toMatch(/data-hero-passive-aura[\s\S]{0,350}Number\.isFinite\([\s\S]{0,120}(?:>|>=)\s*0/);
    expect(app).toMatch(/HEROES_SUPPORTED_MODULE_SCHEMA_VERSIONS\s*=\s*Object\.freeze\(\[1,\s*2,\s*3,\s*4,\s*5,\s*6\]\)/);
    expect(app).toMatch(/Future heroes schemaVersion 7\+/);
  });
});
