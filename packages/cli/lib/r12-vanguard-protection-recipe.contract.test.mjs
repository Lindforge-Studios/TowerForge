import { describe, expect, it } from "vitest";
import {
  MechanicsRecipeParameterError,
  listMechanicsRecipes,
  materializeMechanicsRecipe
} from "./mechanics-recipes.mjs";

const RECIPE_ID = "basic_vanguard_protection";
const SOURCE_KINDS = ["tower", "ability", "tower_script", "status", "reaction", "enemy"];

function context(overrides = {}) {
  return {
    defaultMissionId: "protection_lab",
    missionIds: ["side_route", "protection_lab"],
    enemyIds: ["support_zeta", "grunt_beta", "guard_alpha"],
    shieldedEnemyIds: ["guard_alpha"],
    ...overrides
  };
}

describe("R12.4c inert vanguard protection recipe surface (RED)", () => {
  it("lists the three explicit active-module prerequisites without enabling them", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: RECIPE_ID,
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      suggestedId: RECIPE_ID,
      prerequisites: {
        navigation: { moduleSchemaVersion: 1, mode: "dynamic_flow" },
        combat: { moduleSchemaVersion: 1, enemyRootShields: true },
        enemyBehaviors: { moduleSchemaVersion: 1, formations: true }
      }
    }));
  });

  it("materializes a deterministic detached protected formation without selecting any module", () => {
    const first = materializeMechanicsRecipe(RECIPE_ID, context());
    const reordered = materializeMechanicsRecipe(RECIPE_ID, context({
      missionIds: ["protection_lab", "side_route"],
      enemyIds: ["guard_alpha", "grunt_beta", "support_zeta"],
      shieldedEnemyIds: ["guard_alpha"]
    }));

    expect(reordered).toEqual(first);
    expect(first).toMatchObject({
      id: RECIPE_ID,
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "enemyBehaviors",
        moduleSchemaVersion: 1,
        missionId: "protection_lab",
        profileId: RECIPE_ID,
        profile: {
          formations: {
            cohorts: {
              main: {
                members: {
                  guard_alpha: "vanguard",
                  grunt_beta: "body",
                  support_zeta: "support"
                },
                steering: {
                  neighborRadius: 2,
                  cohesionWeight: 600,
                  separationWeight: 800,
                  roleWeight: 400
                },
                protection: { radius: 2, sourceKinds: SOURCE_KINDS }
              }
            }
          }
        }
      }
    });
    expect(first.entity).not.toHaveProperty("enabled");
    expect(first.entity.profile).not.toHaveProperty("navigation");
    expect(first.entity.profile).not.toHaveProperty("combat");

    first.entity.profile.formations.cohorts.main.protection.sourceKinds[0] = "enemy";
    expect(materializeMechanicsRecipe(RECIPE_ID, context()).entity.profile.formations
      .cohorts.main.protection.sourceKinds).toEqual(SOURCE_KINDS);
  });

  it("rejects missing authored formation and shield context instead of inventing dependencies", () => {
    for (const overrides of [
      { enemyIds: [] },
      { shieldedEnemyIds: [] },
      { shieldedEnemyIds: ["not_authored"] }
    ]) {
      let thrown;
      try {
        materializeMechanicsRecipe(RECIPE_ID, context(overrides));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MechanicsRecipeParameterError);
      expect(thrown).toMatchObject({ code: "enemy_behaviors_vanguard_protection_recipe_context_required" });
    }
  });
});
