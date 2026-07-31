import { describe, expect, it } from "vitest";
import { listMechanicsRecipes, materializeMechanicsRecipe } from "./mechanics-recipes.mjs";

describe("R14 Modular Arsenal inert recipe", () => {
  it("binds the binary-first authored tower without enabling or selecting the module", () => {
    expect(listMechanicsRecipes()).toContainEqual(expect.objectContaining({
      id: "basic_modular_arsenal", moduleId: "arsenal", moduleSchemaVersion: 1
    }));
    const first = materializeMechanicsRecipe("basic_modular_arsenal", {
      defaultMissionId: "mission", missionIds: ["mission"], enemyIds: [], towerIds: ["zeta", "alpha"]
    });
    const reordered = materializeMechanicsRecipe("basic_modular_arsenal", {
      defaultMissionId: "mission", missionIds: ["mission"], enemyIds: [], towerIds: ["alpha", "zeta"]
    });
    expect(reordered).toEqual(first);
    expect(first.entity).toMatchObject({
      moduleId: "arsenal", moduleSchemaVersion: 1, missionId: "mission",
      profile: { blueprints: { alpha: { defaultModules: { base: "starter_base", barrel: "starter_barrel", core: "starter_core" } } } }
    });
    expect(first.entity).not.toHaveProperty("enabled");
    expect(first).not.toHaveProperty("missionPatch");
  });
});
