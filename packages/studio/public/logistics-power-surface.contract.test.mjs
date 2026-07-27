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

describe("R5.7A Studio Logistics Mechanics Hub surface RED", () => {
  it("keeps the complete nullable power editor isolated inside the Logistics Hub card", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-logistics-editor",
      "mechanics-logistics-power-enabled",
      "mechanics-logistics-generator-rows",
      "mechanics-logistics-relay-rows",
      "mechanics-logistics-consumer-rows",
      "mechanics-logistics-recipe-generator",
      "mechanics-logistics-recipe-relay",
      "mechanics-logistics-recipe-consumer",
      "btn-mechanics-add-logistics-generator",
      "btn-mechanics-add-logistics-relay",
      "btn-mechanics-add-logistics-consumer"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    for (const marker of [
      "data-logistics-role", "data-logistics-tower-type-id", "data-logistics-output",
      "data-logistics-link-radius", "data-logistics-coverage-radius",
      "data-logistics-demand", "data-logistics-priority", "data-remove-logistics-role"
    ]) expect(`${html}\n${app}`).toContain(marker);
    expect(hub).toMatch(/generator/i);
    expect(hub).toMatch(/relay|pylon/i);
    expect(hub).toMatch(/consumer/i);
    expect(hub).toMatch(/power|brownout/i);
  });

  it("does not pollute ordinary tower, mission, map, or renderer forms while Logistics is disabled", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    expect(outside).not.toMatch(/data-logistics-|mechanics-logistics-(?:power|generator|relay|consumer)/);
    const towerRender = functionSource(app, "renderTowerEditor");
    const missionRender = functionSource(app, "renderMissionEditor");
    expect(`${towerRender}\n${missionRender}`).not.toMatch(
      /logistics|generator|power output|linkRadius|coverageRadius|brownout/i
    );
  });

  it("round-trips exact closed role records and passes invalid visible numbers to shared validation", () => {
    const normalize = functionSource(app, "normalizeLogisticsMechanicsDraft");
    const render = functionSource(app, "renderLogisticsMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");
    expect(normalize).toMatch(/return\s+deep\(source\)/);
    expect(normalize).not.toMatch(/power\s*=|generators\s*=|relays\s*=|consumers\s*=/);
    for (const field of [
      "generators", "relays", "consumers", "output", "linkRadius", "coverageRadius",
      "demand", "priority"
    ]) expect(render).toContain(field);
    expect(render).toMatch(/4096|definitionsPerKind/);
    expect(render).toMatch(/1000000000000|1_000_000_000_000/);
    expect(render).toMatch(/64/);
    expect(render).toMatch(/1000000|1_000_000/);
    expect(render).toMatch(/Number\(event\.target\.value\)/);
    expect(render).not.toMatch(/Number\.isFinite[\s\S]{0,160}(?:Math\.max|Math\.min)/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).not.toMatch(/delete\s+profile\.(?:power|generators|relays|consumers)/);
  });

  it("supports power:null plus enable/edit/save/reload/disable/re-enable through the existing revision guard", () => {
    const load = functionSource(app, "loadMechanicsProfile");
    const renderHub = functionSource(app, "renderMechanicsHub");
    const apply = functionSource(app, "applyMechanics");
    expect(app).toMatch(/selectedModuleId\s*===\s*["']logistics["'][\s\S]*renderLogisticsMechanicsEditor\s*\(/);
    expect(load).toMatch(/normalizeLogisticsMechanicsDraft/);
    expect(renderHub).toMatch(/btn-mechanics-disable[\s\S]*applyMechanics\(false\)/);
    expect(renderHub).toMatch(/btn-mechanics-enable[\s\S]*applyMechanics\(true\)/);
    expect(apply).toMatch(/previewMechanics/);
    expect(apply).toMatch(/ifRevision|preview\.revision/);
    expect(apply).toMatch(/await\s+load\(\)/);
    expect(app).toMatch(/power\s*===\s*null|power\s*:\s*null/);
    expect(app).toMatch(/materializeLogisticsRecipeDraft/);
    expect(app).toMatch(
      /generatorTowerTypeId[\s\S]{0,300}relayTowerTypeId[\s\S]{0,300}consumerTowerTypeId/
    );
  });

  it("keeps future Logistics v4 visible and lossless but disables every write control", () => {
    const load = functionSource(app, "loadMechanicsProfile");
    const render = functionSource(app, "renderLogisticsMechanicsEditor");
    expect(load).toMatch(/normalizeLogisticsMechanicsDraft/);
    expect(app).toMatch(/LOGISTICS_SUPPORTED_MODULE_SCHEMA_VERSIONS\s*=\s*Object\.freeze\(\[1,\s*2,\s*3\]\)/);
    expect(app).toMatch(/Future logistics schemaVersion 4\+|future logistics|logistics[\s\S]{0,500}read-only/i);
    expect(render).toMatch(/readOnly|future/i);
    expect(app).toMatch(
      /mechanicsProjectModuleVersion\(\)\s*>\s*3[\s\S]{0,500}(?:btn-mechanics-preview|btn-mechanics-save|disabled)/i
    );
  });

  it("shows Studio Playtest power state only through the shared snapshot projection", () => {
    expect(html).toContain('id="pt-logistics-power"');
    expect(app).toMatch(/PT\.rmod\.projectLogisticsPresentation\s*\(\s*snapshot\s*\)/);
    expect(app).toMatch(/coveredConsumerIds|powered|brownout|allocated/i);
    const render = functionSource(app, "renderPlaytestLogistics");
    expect(render).toMatch(/pt-logistics-link-cue/);
    expect(render).toMatch(/pt-logistics-coverage-cue/);
    expect(render).toMatch(/node\.linkTowerIds[\s\S]{0,800}(?:textContent|append)/);
    expect(render).toMatch(/node\.coveredConsumerIds[\s\S]{0,800}(?:textContent|append)/);
    expect(render).not.toMatch(/dataset\.(?:linkCount|coveredConsumerCount|coveredConsumerIds)/);
    expect(app).not.toMatch(/PT\.(?:game|map|mod)\.(?:compute|resolve|rebuild)(?:Power|Logistics)/);
    expect(app).not.toMatch(/data-pt-(?:power|logistics)-(?:toggle|assign|connect|command)/);
  });
});
