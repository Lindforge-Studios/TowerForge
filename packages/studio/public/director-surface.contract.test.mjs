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
  return Function("deep", `"use strict"; return (${functionSource(app, "normalizeDirectorMechanicsDraft")});`)(deep);
}

describe("R7 Studio opt-in AI Wave Director surface", () => {
  it("describes a deterministic authored counter pool as an optional capability", () => {
    const match = app.match(/\{\s*id:\s*["']director["']\s*,\s*title:\s*["']([^"']+)["']\s*,\s*description:\s*["']([^"']+)["']\s*\}/);
    expect(match, "Director Mechanics Hub card copy must be explicit").not.toBeNull();
    expect(match?.[1]).toMatch(/director/i);
    expect(match?.[2]).toMatch(/opt-in|optional/i);
    expect(match?.[2]).toMatch(/deterministic/i);
    expect(match?.[2]).toMatch(/authored|counter pool/i);
    expect(match?.[2]).toMatch(/budget|fairness/i);
  });

  it("keeps the complete v1 editor isolated inside Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    for (const id of [
      "mechanics-director-editor",
      "mechanics-director-capability",
      "mechanics-director-read-only",
      "mechanics-director-counter-pool",
      "mechanics-director-threat-base",
      "mechanics-director-threat-per-wave",
      "mechanics-director-minimum-wave",
      "mechanics-director-max-consecutive",
      "mechanics-director-max-added-groups",
      "mechanics-director-max-added-enemies"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(outside).not.toContain(`id="${id}"`);
      expect(html.match(new RegExp(`id=["']${id}["']`, "g")) ?? []).toHaveLength(1);
    }
    expect(hub).toMatch(/damage distribution|coverage|movement layers|logistics/i);
    expect(hub).toMatch(/authored counter pool/i);
    expect(hub).toMatch(/threat budget/i);
    expect(hub).toMatch(/fairness/i);
  });

  it("round-trips the closed Director profile and edits every v1 section", () => {
    const normalize = evaluateNormalize();
    const profile = {
      counterPool: {
        anti_fire: {
          label: "Fire counter",
          priority: 7,
          conditions: [{ metric: "damage_share", key: "fire", operator: "gte", threshold: 0.8 }],
          groups: [{ enemyId: "fire_guard", count: 2, spawnInterval: 0.5, startDelay: 0 }],
          threatCost: 5
        }
      },
      threatBudget: { base: 10, perWave: 5 },
      fairness: { minimumWaveIndex: 1, maxConsecutiveUses: 2, maxAddedGroups: 3, maxAddedEnemies: 20 }
    };
    const result = normalize(profile);
    expect(result).toEqual(profile);
    expect(result).not.toBe(profile);
    expect(result.counterPool).not.toBe(profile.counterPool);

    const render = functionSource(app, "renderDirectorMechanicsEditor");
    for (const field of [
      "counterPool", "threatBudget", "fairness", "base", "perWave", "minimumWaveIndex",
      "maxConsecutiveUses", "maxAddedGroups", "maxAddedEnemies"
    ]) expect(render).toContain(field);
    expect(render).toMatch(/JSON\.parse/);
    expect(render).toMatch(/setCustomValidity/);
    expect(render).toMatch(/MechanicsUI\.capabilities\?\.director|mechanicsSelectedCapability/);
  });

  it("uses the shared recipe and guarded enable/save/reload/disable lifecycle while future versions remain read-only", () => {
    const load = functionSource(app, "loadMechanicsProfile");
    const request = functionSource(app, "mechanicsRequest");
    const apply = functionSource(app, "applyMechanics");
    const hub = functionSource(app, "renderMechanicsHub");

    expect(app).toMatch(/DIRECTOR_RECIPE_IDS\s*=\s*new Set\(\[["']basic_adaptive_wave_director["']\]\)/);
    expect(app).toMatch(/selectedModuleId\s*===\s*["']director["'][\s\S]*renderDirectorMechanicsEditor\s*\(/);
    expect(load).toMatch(/normalizeDirectorMechanicsDraft/);
    expect(request).toMatch(/profile\s*=\s*deep\(MechanicsUI\.draft\)/);
    expect(request).toMatch(/director[\s\S]{0,300}(?:future|read-only|schemaVersion\s*2)/i);
    expect(apply).toMatch(/previewMechanics/);
    expect(apply).toMatch(/ifRevision|preview\.revision/);
    expect(apply).toMatch(/await\s+load\(\)/);
    expect(hub).toMatch(/btn-mechanics-disable[\s\S]*applyMechanics\(false\)/);
    expect(hub).toMatch(/btn-mechanics-enable[\s\S]*applyMechanics\(true\)/);
  });

  it("does not add Director mechanics to ordinary entity forms", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;
    expect(outside).not.toMatch(/mechanics-director-|data-director-/);
    const ordinary = ["renderTowerEditor", "renderEnemyDetail", "renderMissionEditor"]
      .map((name) => functionSource(app, name))
      .join("\n");
    expect(ordinary).not.toMatch(/director|counterPool|threatBudget|fairness/i);
  });
});
