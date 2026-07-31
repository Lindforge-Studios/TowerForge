import { describe, expect, it } from "vitest";
import { projectArsenalPresentation } from "./arsenal-presentation.mjs";

const snapshot = {
  arsenal: {
    schemaVersion: 1,
    profileId: "basic",
    managementAllowed: true,
    towers: [{
      towerId: "tower_1", schemaVersion: 1, towerTypeId: "cannon",
      modules: { base: "base_a", barrel: "barrel_a", core: "core_a" }, footprint: [{ q: 0, r: 0 }],
      damageMultiplier: 1, rangeMultiplier: 1, durabilityMultiplier: 1,
      availableModules: {
        base: [{ id: "base_a", label: "Base A" }],
        barrel: [{ id: "barrel_a", label: "Barrel A" }],
        core: [{ id: "core_a", label: "Core A" }]
      }
    }],
    craftingRecipes: [{ id: "ruby_t2", outputArtifactId: "ruby_2", allowRotations: true, pattern: [
      { x: 0, y: 0, artifactId: "ruby_1" }, { x: 1, y: 0, artifactId: "ruby_1" }
    ] }]
  }
};

describe("R14 arsenal renderer projection", () => {
  it("projects detached engine-owned module choices and exact crafting recipes", () => {
    const projected = projectArsenalPresentation(snapshot);
    expect(projected).toMatchObject({ active: true, profileId: "basic", managementAllowed: true });
    expect(projected.towers[0]).toMatchObject({ towerId: "tower_1", modules: { base: "base_a" } });
    snapshot.arsenal.towers[0].availableModules.base[0].label = "mutated";
    expect(projected.towers[0].availableModules.base[0].label).toBe("Base A");
  });

  it("keeps legacy inactive and rejects accessor-backed active data", () => {
    expect(projectArsenalPresentation({})).toEqual({ active: false, profileId: null, managementAllowed: false, towers: [], craftingRecipes: [] });
    const hostile = structuredClone(snapshot);
    Object.defineProperty(hostile.arsenal, "profileId", { enumerable: true, get: () => "basic" });
    expect(projectArsenalPresentation(hostile)).toBeUndefined();
  });
});
