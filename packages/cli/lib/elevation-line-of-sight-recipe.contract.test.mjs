import { describe, expect, it } from "vitest";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

const context = Object.freeze({
  defaultMissionId: "mission_b",
  missionIds: Object.freeze(["mission_b", "mission_a"]),
  terrainTags: Object.freeze(["opaque", "path"])
});

describe("R3.2 basic elevation line-of-sight recipe contract", () => {
  it("materializes an inert elevation v2 candidate with an explicit terrain-tag prerequisite", () => {
    expect(listMechanicsRecipes().map((recipe) => recipe.id))
      .toContain("basic_elevation_line_of_sight");

    const recipe = materializeMechanicsRecipe("basic_elevation_line_of_sight", context);

    expect(recipe).toMatchObject({
      id: "basic_elevation_line_of_sight",
      moduleSchemaVersion: 2,
      prerequisites: { terrainTags: ["opaque"] },
      unmetPrerequisites: [],
      entity: {
        moduleId: "elevation",
        moduleSchemaVersion: 2,
        missionId: "mission_b",
        profileId: "basic_elevation_line_of_sight",
        profile: { lineOfSight: { terrainBlockerTags: ["opaque"] } }
      }
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(recipe)).not.toMatch(/elevationOverrides|mapPatch|terrainPatch/);
  });

  it("reports a missing blocker tag without auto-enabling or editing terrain/maps", () => {
    const recipe = materializeMechanicsRecipe("basic_elevation_line_of_sight", {
      ...context,
      terrainTags: []
    });

    expect(recipe.unmetPrerequisites).toContainEqual({
      code: "elevation_terrain_tag_missing",
      terrainTag: "opaque"
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(JSON.stringify(recipe)).not.toMatch(/elevationOverrides|mapPatch|terrainPatch/);
  });
});
