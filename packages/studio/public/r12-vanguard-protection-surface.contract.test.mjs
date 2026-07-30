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

describe("R12.4c isolated Mechanics Hub vanguard protection editor (RED)", () => {
  it("keeps protection controls inside Mechanics Hub and out of the ordinary enemy editor", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const enemyStart = html.indexOf('<section id="tab-enemies"');
    const enemyEnd = html.indexOf("<section", enemyStart + 20);
    const ordinaryEnemyForm = html.slice(enemyStart, enemyEnd);

    for (const id of [
      "mechanics-enemy-formation-protection-editor",
      "mechanics-enemy-formation-protection-help"
    ]) {
      expect(hub).toContain(`id="${id}"`);
      expect(ordinaryEnemyForm).not.toContain(`id="${id}"`);
    }
    expect(functionSource(app, "renderEnemyDetail")).not.toMatch(/protection|intercept/i);
  });

  it("renders descriptor-owned protection fields without implementing interception rules", () => {
    const normalize = functionSource(app, "normalizeEnemyBehaviorsMechanicsDraft");
    const render = functionSource(app, "renderEnemyFormationProtectionEditor");
    const combined = `${normalize}\n${render}`;
    for (const token of [
      "protection", "radius", "sourceKinds", "tower", "ability", "tower_script",
      "status", "reaction", "enemy"
    ]) expect(combined).toContain(token);
    expect(render).toContain("mechanics-enemy-formations-profile-json");
    expect(functionSource(app, "applyMechanics")).toMatch(/preview\.revision/);
    expect(combined).not.toMatch(/resolveDamage|DamageResolver|nearestVanguard|interceptDamage/);
  });

  it("offers the inert protection recipe without adding a broad or protection-specific writer", () => {
    expect(app).toMatch(/ENEMY_BEHAVIORS_RECIPE_IDS[\s\S]{0,300}basic_vanguard_protection/);
    expect(app).not.toMatch(/applyVanguardProtection|saveVanguardProtection|writeVanguardProtection/);
  });
});
