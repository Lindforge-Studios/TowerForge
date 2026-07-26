import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(path.resolve("packages/studio/public/index.html"), "utf8");
const app = fs.readFileSync(path.resolve("packages/studio/public/app.js"), "utf8");

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

describe("R5.8A Studio Logistics ammunition Hub RED", () => {
  it("keeps complete ammo type and tower inventory CRUD inside the Mechanics Logistics card", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "btn-mechanics-add-ammunition",
      "mechanics-logistics-ammunition-enabled",
      "mechanics-logistics-ammunition-type-rows",
      "mechanics-logistics-tower-inventory-rows",
      "btn-mechanics-add-ammunition-type",
      "btn-mechanics-add-tower-inventory",
      "mechanics-logistics-recipe-consumer",
      "mechanics-logistics-recipe-ammo-type-id",
      "mechanics-logistics-recipe-ammo-label",
      "mechanics-logistics-recipe-capacity",
      "mechanics-logistics-recipe-starting-amount",
      "mechanics-logistics-recipe-consumption"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    for (const marker of [
      "data-logistics-ammo-type-id", "data-logistics-ammo-label", "data-remove-logistics-ammo-type",
      "data-logistics-inventory-tower-type-id", "data-logistics-inventory-ammo-type-id",
      "data-logistics-inventory-capacity", "data-logistics-inventory-starting-amount",
      "data-logistics-inventory-consumption", "data-remove-logistics-tower-inventory"
    ]) expect(`${html}\n${app}`).toContain(marker);
    expect(hub).toMatch(/ammunition|ammo/i);
    expect(hub).toMatch(/capacity/i);
    expect(hub).toMatch(/starting/i);
  });

  it("opens v1 without migration and uses an explicit action to promote every profile to exact v2", () => {
    const normalize = functionSource(app, "normalizeLogisticsMechanicsDraft");
    const load = functionSource(app, "loadMechanicsProfile");
    const render = functionSource(app, "renderLogisticsMechanicsEditor");
    expect(app).toMatch(/LOGISTICS_SUPPORTED_MODULE_SCHEMA_VERSIONS\s*=\s*Object\.freeze\(\[1,\s*2\]\)/);
    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(normalize).not.toMatch(/ammunition\s*\?\?=|schemaVersion\s*=\s*2/);
    expect(load).toMatch(/normalizeLogisticsMechanicsDraft/);
    expect(render).toMatch(/btn-mechanics-add-ammunition/);
    expect(render).toMatch(/moduleSchemaVersion\s*=\s*2|promot(?:e|ion)[\s\S]{0,500}2/i);
    expect(render).toMatch(/ammunition\s*=\s*null|ammunition\s*:\s*null/);
    expect(app).toMatch(/(?:all|every)[\s\S]{0,300}profile|Object\.entries\([^)]*profiles/i);
    expect(app).toMatch(/power[\s\S]{0,300}ammunition/);
  });

  it("round-trips exact types/inventories and passes invalid visible numbers to shared validation", () => {
    const render = functionSource(app, "renderLogisticsMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");
    for (const field of [
      "types", "towerInventories", "label", "ammoTypeId", "capacity", "startingAmount",
      "consumptionPerActivation"
    ]) expect(render).toContain(field);
    expect(render).toMatch(/256/);
    expect(render).toMatch(/4096|4_096/);
    expect(render).toMatch(/1000000000|1_000_000_000/);
    expect(render).toMatch(/Number\(event\.target\.value\)/);
    expect(render).not.toMatch(/Number\.isFinite[\s\S]{0,160}(?:Math\.max|Math\.min)/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:ammunition|types|towerInventories)/);
  });

  it("supports v2 null/disable/re-enable while future v3 stays visible, lossless, and fully read-only", () => {
    const renderHub = functionSource(app, "renderMechanicsHub");
    const apply = functionSource(app, "applyMechanics");
    const render = functionSource(app, "renderLogisticsMechanicsEditor");
    expect(renderHub).toMatch(/btn-mechanics-disable[\s\S]*applyMechanics\(false\)/);
    expect(renderHub).toMatch(/btn-mechanics-enable[\s\S]*applyMechanics\(true\)/);
    expect(apply).toMatch(/previewMechanics[\s\S]*(?:ifRevision|preview\.revision)[\s\S]*await\s+load\(\)/);
    expect(render).toMatch(/ammunition\s*===\s*null|ammunition\s*:\s*null/);
    expect(app).toMatch(/Future logistics schemaVersion 3\+|future logistics[\s\S]{0,160}3\+|schemaVersion 3\+/i);
    expect(app).toMatch(
      /mechanicsProjectModuleVersion\(\)\s*>\s*2[\s\S]{0,800}(?:btn-mechanics-preview|btn-mechanics-save|disabled)/i
    );
  });

  it("does not pollute ordinary tower, mission, or map forms and adds no refill/input command", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    expect(outside).not.toMatch(/data-logistics-(?:ammo|inventory)|mechanics-logistics-(?:ammunition|inventory)/);
    const towerRender = functionSource(app, "renderTowerEditor");
    const missionRender = functionSource(app, "renderMissionEditor");
    expect(`${towerRender}\n${missionRender}`).not.toMatch(
      /ammunition|ammoTypeId|startingAmount|consumptionPerActivation|refill/i
    );
    expect(app).not.toMatch(/type\s*:\s*["'](?:refill|transfer|reload)(?:Ammunition|Ammo)["']/i);
    expect(app).not.toMatch(/data-(?:ammo|ammunition)-(?:button|input|command)/i);
  });

  it("shows visible amount/capacity and depleted cues from the shared v2 projection beside independent power cues", () => {
    expect(html).toContain('id="pt-logistics-power"');
    expect(app).toMatch(/PT\.rmod\.projectLogisticsPresentation\s*\(\s*snapshot\s*\)/);
    const render = functionSource(app, "renderPlaytestLogistics");
    expect(render).toMatch(/ammunition\.inventories|presentation\.ammunition/);
    expect(render).toMatch(/amount[\s\S]{0,300}capacity/);
    expect(render).toMatch(/pt-logistics-ammunition-cue/);
    expect(render).toMatch(/pt-logistics-depleted-cue/);
    expect(render).toMatch(/hasRequiredAmmo/);
    expect(render).toMatch(/power[\s\S]{0,1200}ammunition|ammunition[\s\S]{0,1200}power/);
    expect(render).not.toMatch(/hasRequiredAmmo\s*=|amount\s*>=\s*.*consumption/);
    expect(app).not.toMatch(/PT\.(?:game|map|mod)\.(?:derive|compute|resolve)(?:Ammo|Ammunition)/);
  });
});
