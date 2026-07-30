import { describe, expect, it } from "vitest";
import {
  MechanicsRecipeParameterError,
  listMechanicsRecipes,
  materializeMechanicsRecipe
} from "./mechanics-recipes.mjs";

const RECIPE_ID = "basic_formation_steering";

function context(overrides = {}) {
  return {
    defaultMissionId: "formation_lab",
    missionIds: ["side_route", "formation_lab"],
    enemyIds: ["support_zeta", "grunt_beta", "boss_alpha"],
    ...overrides
  };
}

describe("R12.3 inert formation steering recipe surface (RED)", () => {
  it("lists an enemyBehaviors v1 recipe with an explicit dynamic-flow prerequisite", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: RECIPE_ID,
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      suggestedId: RECIPE_ID,
      prerequisites: {
        navigation: { moduleSchemaVersion: 1, mode: "dynamic_flow" }
      }
    }));
  });

  it("materializes one deterministic detached three-role cohort without enabling either module", () => {
    const first = materializeMechanicsRecipe(RECIPE_ID, context());
    const reordered = materializeMechanicsRecipe(RECIPE_ID, context({
      missionIds: ["formation_lab", "side_route"],
      enemyIds: ["boss_alpha", "grunt_beta", "support_zeta"]
    }));

    expect(reordered).toEqual(first);
    expect(first).toMatchObject({
      id: RECIPE_ID,
      moduleId: "enemyBehaviors",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "enemyBehaviors",
        moduleSchemaVersion: 1,
        missionId: "formation_lab",
        profileId: RECIPE_ID,
        profile: {
          formations: {
            cohorts: {
              main: {
                members: {
                  boss_alpha: "vanguard",
                  grunt_beta: "body",
                  support_zeta: "support"
                },
                steering: {
                  neighborRadius: 2,
                  cohesionWeight: 600,
                  separationWeight: 800,
                  roleWeight: 400
                }
              }
            }
          }
        }
      }
    });
    expect(first.entity).not.toHaveProperty("enabled");
    expect(first.entity.profile).not.toHaveProperty("navigation");

    first.entity.profile.formations.cohorts.main.members.boss_alpha = "support";
    expect(materializeMechanicsRecipe(RECIPE_ID, context()).entity.profile.formations
      .cohorts.main.members.boss_alpha).toBe("vanguard");
  });

  it("rejects materialization without an authored enemy instead of inventing an id", () => {
    let thrown;
    try {
      materializeMechanicsRecipe(RECIPE_ID, context({ enemyIds: [] }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MechanicsRecipeParameterError);
    expect(thrown).toMatchObject({ code: "enemy_behaviors_formation_recipe_context_required" });
  });
});
