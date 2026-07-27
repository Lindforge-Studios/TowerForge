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

function mechanicsRegions() {
  const start = html.indexOf('<section id="tab-mechanics"');
  const end = html.indexOf('<section id="tab-settings"', start);
  return { hub: html.slice(start, end), outside: `${html.slice(0, start)}${html.slice(end)}` };
}

describe("R5.8B Studio Logistics supply Hub RED", () => {
  it("keeps complete recipe/producer/storage CRUD only inside a dedicated Supply subsection", () => {
    const { hub, outside } = mechanicsRegions();
    for (const id of [
      "btn-mechanics-add-supply", "mechanics-logistics-supply-enabled",
      "mechanics-logistics-production-recipe-rows", "mechanics-logistics-producer-rows",
      "mechanics-logistics-storage-rows", "btn-mechanics-add-production-recipe",
      "btn-mechanics-add-producer", "btn-mechanics-add-storage",
      "mechanics-logistics-recipe-producer", "mechanics-logistics-recipe-storage",
      "mechanics-logistics-recipe-production-id", "mechanics-logistics-recipe-production-label",
      "mechanics-logistics-recipe-output-amount", "mechanics-logistics-recipe-production-interval",
      "mechanics-logistics-recipe-producer-capacity", "mechanics-logistics-recipe-storage-capacity"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    for (const marker of [
      "data-logistics-production-recipe-id", "data-logistics-production-recipe-label",
      "data-logistics-production-ammo-type-id", "data-logistics-production-output-amount",
      "data-logistics-production-interval", "data-remove-logistics-production-recipe",
      "data-logistics-producer-tower-type-id", "data-logistics-producer-recipe-id",
      "data-logistics-producer-capacity", "data-logistics-producer-starting-amount",
      "data-logistics-producer-transfer-radius", "data-logistics-producer-transfer-amount",
      "data-logistics-producer-transfer-interval", "data-remove-logistics-producer",
      "data-logistics-storage-tower-type-id", "data-logistics-storage-ammo-type-id",
      "data-logistics-storage-capacity", "data-logistics-storage-starting-amount",
      "data-logistics-storage-transfer-radius", "data-logistics-storage-transfer-amount",
      "data-logistics-storage-transfer-interval", "data-remove-logistics-storage"
    ]) expect(`${html}\n${app}`).toContain(marker);
  });

  it("reads v2 without migration and exposes one explicit all-profile promotion to exact v3", () => {
    const normalize = functionSource(app, "normalizeLogisticsMechanicsDraft");
    const load = functionSource(app, "loadMechanicsProfile");
    const render = functionSource(app, "renderLogisticsMechanicsEditor");
    expect(app).toMatch(/LOGISTICS_SUPPORTED_MODULE_SCHEMA_VERSIONS\s*=\s*Object\.freeze\(\[1,\s*2,\s*3\]\)/);
    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(normalize).not.toMatch(/supply\s*\?\?=|schemaVersion\s*=\s*3/);
    expect(load).toMatch(/normalizeLogisticsMechanicsDraft/);
    expect(render).toMatch(/btn-mechanics-add-supply/);
    expect(render).toMatch(/moduleSchemaVersion\s*=\s*3|promot(?:e|ion)[\s\S]{0,500}3/i);
    expect(app).toMatch(/Object\.entries\([^)]*profiles|(?:all|every)[\s\S]{0,300}profile/i);
    expect(app).toMatch(/power[\s\S]{0,400}ammunition[\s\S]{0,400}supply/);
  });

  it("round-trips exact supply records and passes visible invalid numbers to shared validation", () => {
    const render = functionSource(app, "renderLogisticsMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");
    for (const field of [
      "productionRecipes", "producers", "storages", "recipeId", "ammoTypeId", "outputAmount",
      "interval", "capacity", "startingAmount", "transferRadius", "transferAmount", "transferInterval"
    ]) expect(render).toContain(field);
    expect(render).toMatch(/256/);
    expect(render).toMatch(/4096|4_096/);
    expect(render).toMatch(/64/);
    expect(render).toMatch(/0\.2/);
    expect(render).toMatch(/1000000000|1_000_000_000/);
    expect(render).toMatch(/Number\(event\.target\.value\)/);
    expect(render).not.toMatch(/Number\.isFinite[\s\S]{0,160}(?:Math\.max|Math\.min)/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:supply|productionRecipes|producers|storages)/);
  });

  it("supports supply:null, disable/re-enable, and keeps future v4 visible, lossless, fully read-only", () => {
    const renderHub = functionSource(app, "renderMechanicsHub");
    const apply = functionSource(app, "applyMechanics");
    const render = functionSource(app, "renderLogisticsMechanicsEditor");
    expect(renderHub).toMatch(/btn-mechanics-disable[\s\S]*applyMechanics\(false\)/);
    expect(renderHub).toMatch(/btn-mechanics-enable[\s\S]*applyMechanics\(true\)/);
    expect(apply).toMatch(/previewMechanics[\s\S]*(?:ifRevision|preview\.revision)[\s\S]*await\s+load\(\)/);
    expect(render).toMatch(/supply\s*===\s*null|supply\s*:\s*null/);
    expect(app).toMatch(/Future logistics schemaVersion 4\+|future logistics[\s\S]{0,160}4\+|schemaVersion 4\+/i);
    expect(app).toMatch(
      /mechanicsProjectModuleVersion\(\)\s*>\s*3[\s\S]{0,800}(?:btn-mechanics-preview|btn-mechanics-save|disabled)/i
    );
  });

  it("keeps ordinary forms and commands clean while Playtest renders authoritative supply/refill cues", () => {
    const { outside } = mechanicsRegions();
    expect(outside).not.toMatch(/data-logistics-(?:production|producer|storage|supply)|mechanics-logistics-(?:production|producer|storage|supply)/);
    const ordinary = ["renderTowerEditor", "renderMissionEditor", "renderMapSourceDetail"]
      .map((name) => functionSource(app, name)).join("\n");
    expect(ordinary).not.toMatch(/productionRecipes|transferRadius|transferInterval|supply producer|ammo storage/i);
    expect(app).not.toMatch(/type\s*:\s*["'](?:refill|transfer|produce)(?:Ammunition|Ammo|Supply)["']/i);
    expect(app).not.toMatch(/data-(?:refill|transfer|produce)-(?:button|input|command)/i);

    expect(app).toMatch(/PT\.rmod\.projectLogisticsPresentation\s*\(\s*snapshot\s*\)/);
    const playtest = functionSource(app, "renderPlaytestLogistics");
    expect(playtest).toMatch(/supply\.producers|presentation\.supply/);
    expect(playtest).toMatch(/supply\.storages|storages/);
    expect(playtest).toMatch(/supply\.edges|edges/);
    expect(playtest).toMatch(/amount[\s\S]{0,300}capacity/);
    expect(playtest).toMatch(/productionProgress|transferProgress/);
    expect(playtest).toMatch(/pt-logistics-supply-link-cue/);
    expect(playtest).toMatch(/pt-logistics-supply-paused-cue/);
    expect(playtest).toMatch(/pt-logistics-refill-cue/);
    expect(playtest).not.toMatch(/operational\s*=|amount\s*>=|productionProgress\s*\+=|transferProgress\s*\+=/);
  });
});
