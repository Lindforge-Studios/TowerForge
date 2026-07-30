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

describe("R12.3 isolated Mechanics Hub formations editor (RED)", () => {
  it("keeps formation controls inside Mechanics Hub and out of the ordinary enemy editor", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const enemyStart = html.indexOf('<section id="tab-enemies"');
    const enemyEnd = html.indexOf("<section", enemyStart + 20);
    const ordinaryEnemyForm = html.slice(enemyStart, enemyEnd);

    for (const id of [
      "mechanics-enemy-formations-editor",
      "mechanics-enemy-formations-profile-json"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(ordinaryEnemyForm).not.toContain(`id="${id}"`);
    }
    expect(functionSource(app, "renderEnemyDetail")).not.toMatch(/formation|cohort/i);
  });

  it("normalizes and renders the descriptor-owned cohort roles and bounded steering fields", () => {
    const normalize = functionSource(app, "normalizeEnemyBehaviorsMechanicsDraft");
    const render = functionSource(app, "renderEnemyFormationsMechanicsEditor");
    const update = functionSource(app, "updateEnemyFormationsMechanicsDraft");

    for (const token of [
      "formations", "cohorts", "vanguard", "body", "support", "neighborRadius",
      "cohesionWeight", "separationWeight", "roleWeight"
    ]) expect(`${normalize}\n${render}\n${update}`).toContain(token);
    expect(render).toContain("mechanics-enemy-formations-profile-json");
    expect(update).toMatch(/JSON\.parse/);
    expect(update).toMatch(/setCustomValidity/);
    expect(functionSource(app, "applyMechanics")).toMatch(/preview\.revision/);
  });

  it("offers both enemyBehaviors recipes without adding a broad or formation-specific writer", () => {
    expect(app).toMatch(/ENEMY_BEHAVIORS_RECIPE_IDS[\s\S]{0,180}basic_targetable_boss_components/);
    expect(app).toMatch(/ENEMY_BEHAVIORS_RECIPE_IDS[\s\S]{0,220}basic_formation_steering/);
    expect(app).not.toMatch(/applyFormationSteering|saveFormationSteering|writeFormationSteering/);
  });
});
