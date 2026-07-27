import { describe, expect, it } from "vitest";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

const BASIC_ID = "basic_displacement_physics";
const HAZARD_ID = "tagged_fall_hazards";

describe("R3.4a physics recipe contracts", () => {
  it("materializes an inert empty physics v1 profile", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: BASIC_ID,
      moduleId: "physics",
      moduleSchemaVersion: 1
    }));

    const recipe = materializeMechanicsRecipe(BASIC_ID, {
      defaultMissionId: "mission_b",
      missionIds: ["mission_c", "mission_b", "mission_a"]
    });
    expect(recipe).toMatchObject({
      id: BASIC_ID,
      moduleId: "physics",
      moduleSchemaVersion: 1,
      entity: {
        moduleId: "physics",
        moduleSchemaVersion: 1,
        missionId: "mission_b",
        profileId: BASIC_ID,
        profile: {}
      }
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(recipe)).not.toMatch(/missionPatch|terrainPatch|towerPatch|abilityPatch|selectedProfile/i);
  });

  it("materializes one bounded hazard tag and never edits terrain or enables physics", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: HAZARD_ID,
      moduleId: "physics",
      moduleSchemaVersion: 1
    }));

    const recipe = materializeMechanicsRecipe(HAZARD_ID, {
      defaultMissionId: "mission_a",
      missionIds: ["mission_a"],
      terrainTags: ["fall_hazard", "walkable"]
    });
    expect(recipe).toMatchObject({
      entity: {
        moduleId: "physics",
        moduleSchemaVersion: 1,
        missionId: "mission_a",
        profileId: HAZARD_ID,
        profile: { fallHazardTerrainTags: ["fall_hazard"] }
      }
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(recipe)).not.toMatch(/terrainPatch|mapPatch|towerPatch|abilityPatch|selectedProfile/i);
  });
});
