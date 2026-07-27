import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

const RECIPE_ID = "basic_elevation_high_ground";
const profile = Object.freeze({
  highGround: Object.freeze({
    maximumEffectiveElevationDelta: 3,
    rangeBonusPerElevation: 1,
    damageBonusBasisPointsPerElevation: 1_000
  })
});

describe("R3.3 basic elevation high-ground recipe contract", () => {
  it("materializes one inert elevation v3 candidate without map, enable, or mission-selection writes", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: RECIPE_ID,
      moduleId: "elevation",
      moduleSchemaVersion: 3
    }));

    const recipe = materializeMechanicsRecipe(RECIPE_ID, {
      defaultMissionId: "mission_b",
      missionIds: ["mission_c", "mission_b", "mission_a"]
    });

    expect(recipe).toMatchObject({
      id: RECIPE_ID,
      moduleSchemaVersion: 3,
      entity: {
        moduleId: "elevation",
        moduleSchemaVersion: 3,
        missionId: "mission_b",
        profileId: RECIPE_ID,
        profile
      }
    });
    expect(recipe.entity).not.toHaveProperty("enabled");
    expect(recipe).not.toHaveProperty("prerequisites");
    expect(recipe).not.toHaveProperty("unmetPrerequisites");
    expect(JSON.stringify(recipe)).not.toMatch(
      /elevationOverrides|mapPatch|terrainPatch|missionPatch|selectedProfile|enabled\s*:/i
    );
  });

  it("ships an explicit opt-in reference fixture without changing the recipe's inert contract", () => {
    const fixtureDir = path.resolve("docs/examples/opt-in-elevation-high-ground");
    const expectedFiles = ["README.md", "mechanics.json", "mission-selection.json", "map-source.fragment.json"];
    for (const fileName of expectedFiles) {
      expect(fs.existsSync(path.join(fixtureDir, fileName)), `${fileName} must exist`).toBe(true);
    }

    const mechanics = JSON.parse(fs.readFileSync(path.join(fixtureDir, "mechanics.json"), "utf8"));
    const selection = JSON.parse(fs.readFileSync(path.join(fixtureDir, "mission-selection.json"), "utf8"));
    const mapSource = JSON.parse(fs.readFileSync(path.join(fixtureDir, "map-source.fragment.json"), "utf8"));
    const readme = fs.readFileSync(path.join(fixtureDir, "README.md"), "utf8");

    expect(mechanics).toEqual({
      schemaVersion: 1,
      modules: {
        elevation: {
          schemaVersion: 3,
          enabled: true,
          profiles: { [RECIPE_ID]: profile }
        }
      }
    });
    expect(selection).toEqual({ mechanics: { profiles: { elevation: RECIPE_ID } } });
    expect(mapSource.elevationOverrides).toEqual(expect.arrayContaining([
      expect.objectContaining({ elevation: expect.any(Number) })
    ]));
    expect(readme).toMatch(/opt-in|explicit/i);
    expect(readme).toMatch(/does not|never/i);
    expect(readme).toMatch(/map|enable|select/i);
    expect(materializeMechanicsRecipe(RECIPE_ID, { missionIds: ["mission_b"] }).entity)
      .not.toHaveProperty("enabled");
  });
});
