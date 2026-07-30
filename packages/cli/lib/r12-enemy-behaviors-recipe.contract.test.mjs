import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MechanicsRecipeParameterError,
  listMechanicsRecipes,
  materializeMechanicsRecipe
} from "./mechanics-recipes.mjs";

const RECIPE_ID = "basic_targetable_boss_components";

function context(overrides = {}) {
  return {
    defaultMissionId: "boss_arena",
    missionIds: ["side_route", "boss_arena"],
    enemyIds: ["boss_zeta", "boss_alpha"],
    towerIds: ["tower_zeta", "tower_alpha"],
    ...overrides
  };
}

describe("R12.1 targetable boss components recipe contract (RED)", () => {
  it("lists one explicit opt-in enemyBehaviors v1 recipe", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: RECIPE_ID,
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      suggestedId: RECIPE_ID
    }));
  });

  it("materializes a deterministic project-bound component and tower targeting profile", () => {
    const firstContext = context();
    const reorderedContext = context({
      missionIds: [...firstContext.missionIds].reverse(),
      enemyIds: [...firstContext.enemyIds].reverse(),
      towerIds: [...firstContext.towerIds].reverse()
    });

    const first = materializeMechanicsRecipe(RECIPE_ID, firstContext);
    const reordered = materializeMechanicsRecipe(RECIPE_ID, reorderedContext);

    expect(reordered).toEqual(first);
    expect(first).toMatchObject({
      id: RECIPE_ID,
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "enemyBehaviors",
        moduleSchemaVersion: 1,
        missionId: "boss_arena",
        profileId: RECIPE_ID,
        profile: {
          bosses: {
            boss_alpha: {
              components: {
                core: {
                  maxHp: 20,
                  hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 },
                  tags: ["core"]
                }
              }
            }
          },
          targeting: {
            towers: {
              tower_alpha: { priorityTags: ["core"] }
            }
          }
        }
      }
    });
    expect(first.entity).not.toHaveProperty("enabled");
    expect(first).not.toHaveProperty("missionPatch");
  });

  it("rejects materialization when the project has no authored enemy context", () => {
    let thrown;
    try {
      materializeMechanicsRecipe(RECIPE_ID, context({ enemyIds: [] }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MechanicsRecipeParameterError);
    expect(thrown).toMatchObject({ code: "enemy_behaviors_recipe_context_required" });
    expect(thrown.message).toMatch(/authored enemy/i);
  });

  it("returns detached materializations without mutating or retaining caller data", () => {
    const input = context();
    const before = structuredClone(input);
    const first = materializeMechanicsRecipe(RECIPE_ID, input);

    first.entity.profile.bosses.boss_alpha.components.core.tags.push("mutated");
    first.entity.profile.targeting.towers.tower_alpha.priorityTags.push("mutated");
    input.enemyIds.push("boss_late");
    input.towerIds.push("tower_late");

    const second = materializeMechanicsRecipe(RECIPE_ID, context());
    expect(second.entity.profile.bosses.boss_alpha.components.core.tags).toEqual(["core"]);
    expect(second.entity.profile.targeting.towers.tower_alpha.priorityTags).toEqual(["core"]);
    expect(before).toEqual(context());
  });

  it("keeps the canonical starter fixture equal to the project-bound recipe", () => {
    const fixtureDir = path.resolve("docs/examples/opt-in-targetable-boss-components");
    const mechanics = JSON.parse(fs.readFileSync(path.join(fixtureDir, "mechanics.json"), "utf8"));
    const missionSelection = JSON.parse(fs.readFileSync(path.join(fixtureDir, "mission-selection.json"), "utf8"));
    const recipe = materializeMechanicsRecipe(RECIPE_ID, {
      defaultMissionId: "tutorial_01",
      missionIds: ["tutorial_01"],
      enemyIds: ["swift_runner", "basic_grunt", "armored_brute"],
      towerIds: ["cannon_tower", "arrow_tower"]
    });

    expect(mechanics.modules.enemyBehaviors).toEqual({
      schemaVersion: recipe.entity.moduleSchemaVersion,
      enabled: true,
      profiles: { [recipe.entity.profileId]: recipe.entity.profile }
    });
    expect(missionSelection.mechanics.profiles.enemyBehaviors).toBe(recipe.entity.profileId);
  });
});
