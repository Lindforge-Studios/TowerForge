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

function evaluateNormalize() {
  const deep = (value) => JSON.parse(JSON.stringify(value));
  return Function("deep", `"use strict"; return (${functionSource(app, "normalizeMultiplayerMechanicsDraft")});`)(deep);
}

describe("R8 Studio opt-in Multiplayer Hub (RED)", () => {
  it("keeps the multiplayer editor isolated inside Mechanics Hub and out of legacy forms/navigation", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-multiplayer-editor", "mechanics-multiplayer-capability", "mechanics-multiplayer-read-only",
      "mechanics-multiplayer-mode", "mechanics-multiplayer-fixed-tick", "mechanics-multiplayer-max-players",
      "mechanics-multiplayer-tower-control", "mechanics-multiplayer-resource-ownership",
      "mechanics-multiplayer-route-ownership", "mechanics-multiplayer-send-pool"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
    }
    expect(outside).not.toMatch(/data-tab=["']multiplayer["']|tab-multiplayer/);
    const ordinary = ["renderTowerEditor", "renderEnemyDetail", "renderMissionEditor"]
      .map((name) => functionSource(app, name)).join("\n");
    expect(ordinary).not.toMatch(/multiplayer|sendPool|fixedTickUnits/i);
  });

  it("round-trips closed local co-op v1 and asymmetric v2 profiles", () => {
    const normalize = evaluateNormalize();
    const v1 = { mode: "local_coop", fixedTickUnits: 1, maxPlayers: 4, ownership: { towerControl: "shared", resources: "shared", routes: "shared" } };
    const v2 = {
      mode: "asymmetric_send_vs_build", fixedTickUnits: 0.5, maxPlayers: 2,
      ownership: { towerControl: "owner_only", resources: "partitioned", routes: "partitioned" },
      sendPool: { grunt: { enemyTypeId: "basic_grunt", cost: { coins: 10 }, income: { coins: 1 }, spawnDelayUnits: 0 } }
    };
    expect(normalize(v1, 1)).toEqual(v1);
    expect(normalize({ ...v1, ownership: { ...v1.ownership, resources: "partitioned", routes: "partitioned" } }, 1))
      .toMatchObject({ ownership: { resources: "partitioned", routes: "partitioned" } });
    expect(normalize(v1, 2)).toEqual(v1);
    expect(normalize(v2, 2)).toEqual(v2);
    expect(normalize(v1, 1)).not.toBe(v1);
  });

  it("edits every v1/v2 field, uses recipes, and preserves future versions read-only", () => {
    const render = functionSource(app, "renderMultiplayerMechanicsEditor");
    const request = functionSource(app, "mechanicsRequest");
    const load = functionSource(app, "loadMechanicsProfile");
    expect(app).toMatch(/MULTIPLAYER_RECIPE_IDS\s*=\s*new Set\(\[[\s\S]*basic_local_coop[\s\S]*basic_partitioned_local_coop[\s\S]*basic_asymmetric_send_vs_build/);
    for (const field of ["mode", "fixedTickUnits", "maxPlayers", "towerControl", "resources", "routes", "sendPool"]) expect(render).toContain(field);
    expect(render).toMatch(/JSON\.parse/);
    expect(render).toMatch(/setCustomValidity/);
    expect(load).toMatch(/normalizeMultiplayerMechanicsDraft/);
    expect(render).not.toMatch(/moduleSchemaVersion\s*=\s*1/);
    expect(request).toMatch(/multiplayer[\s\S]{0,260}(?:future|read-only|schemaVersion\s*3)/i);
    expect(app).toMatch(/selectedModuleId\s*===\s*["']multiplayer["'][\s\S]*renderMultiplayerMechanicsEditor\s*\(/);
  });

  it("uses the shared guarded enable/save/reload/disable lifecycle", () => {
    const request = functionSource(app, "mechanicsRequest");
    const apply = functionSource(app, "applyMechanics");
    const hub = functionSource(app, "renderMechanicsHub");
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(apply).toMatch(/previewMechanics/);
    expect(apply).toMatch(/ifRevision|preview\.revision/);
    expect(apply).toMatch(/await\s+load\(\)/);
    expect(hub).toMatch(/btn-mechanics-disable[\s\S]*applyMechanics\(false\)/);
    expect(hub).toMatch(/btn-mechanics-enable[\s\S]*applyMechanics\(true\)/);
  });
});
