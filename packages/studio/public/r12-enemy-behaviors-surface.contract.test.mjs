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

describe("R12.1 Studio enemyBehaviors boss-component surface (RED)", () => {
  it("keeps an enemyBehaviors card and editor isolated inside Mechanics Hub", () => {
    const hubStart = html.indexOf('<section id="tab-mechanics"');
    const hubEnd = html.indexOf('<section id="tab-settings"', hubStart);
    const hub = html.slice(hubStart, hubEnd);
    const outside = `${html.slice(0, hubStart)}${html.slice(hubEnd)}`;

    for (const id of [
      "mechanics-enemy-behaviors-editor",
      "mechanics-enemy-behaviors-capability",
      "mechanics-enemy-behaviors-read-only",
      "mechanics-enemy-behaviors-profile-json"
    ]) {
      expect(hub, `${id} must live in Mechanics Hub`).toContain(`id="${id}"`);
      expect(outside, `${id} must not leak into ordinary entity forms`).not.toContain(`id="${id}"`);
    }

    expect(app).toMatch(/\{\s*id:\s*["']enemyBehaviors["']/);
    expect(app).toMatch(/data-mechanics-module=["']\$\{esc\(module\.id\)\}["']/);
    expect(functionSource(app, "renderMechanicsHub"))
      .toMatch(/mechanics-enemy-behaviors-editor[\s\S]{0,240}enemyBehaviors/);
  });

  it("authors the closed bosses/components/targeting profile through the guarded mechanics lifecycle", () => {
    const normalize = functionSource(app, "normalizeEnemyBehaviorsMechanicsDraft");
    expect(normalize).toMatch(/bosses/);
    expect(normalize).toMatch(/components/);
    expect(normalize).toMatch(/targeting/);
    expect(normalize).toMatch(/priorityTags/);

    const render = functionSource(app, "renderEnemyBehaviorsMechanicsEditor");
    expect(render).toMatch(/mechanics-enemy-behaviors-profile-json/);
    expect(render).toMatch(/JSON\.stringify/);
    expect(render).toMatch(/supportedVersion|schemaVersion/);

    const update = functionSource(app, "updateEnemyBehaviorsMechanicsDraft");
    expect(update).toMatch(/JSON\.parse/);
    expect(update).toMatch(/setCustomValidity/);
    expect(functionSource(app, "applyMechanics")).toMatch(/preview\.revision/);
  });

  it("keeps a valid synthetic 33rd mechanics recipe instead of applying a global UI cap", async () => {
    const recipes = Array.from({ length: 32 }, (_, index) => ({
      id: `legacy_${index}`,
      entity: { moduleId: "combat", moduleSchemaVersion: 1, profile: { shields: {} } }
    }));
    recipes.push({
      id: "basic_targetable_boss_components",
      entity: {
        moduleId: "enemyBehaviors",
        moduleSchemaVersion: 1,
        profile: { bosses: { citadel_boss: { components: {} } } }
      }
    });
    const state = {
      recipes: [],
      recipe: null,
      recipeId: "basic_targetable_boss_components"
    };
    const loadRecipeSource = functionSource(app, "loadMechanicsRecipe")
      .replace(/^function /, "async function ");
    const loadRecipe = new Function(
      "MechanicsUI",
      "apiGet",
      `${loadRecipeSource}; return loadMechanicsRecipe;`
    )(state, async () => ({ recipes }));

    const selected = await loadRecipe();

    expect(state.recipes).toHaveLength(33);
    expect(selected?.id).toBe("basic_targetable_boss_components");
    expect(state.recipeId).toBe("basic_targetable_boss_components");
  });
});
