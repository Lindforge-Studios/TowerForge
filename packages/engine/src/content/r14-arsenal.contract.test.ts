import { describe, expect, it } from "vitest";
import {
  ArsenalProfileValidationError,
  compileArsenalBlueprintV1,
  craftCampaignGemV1,
  normalizeArsenalProfileV1,
  type CampaignRunV2
} from "../index.js";

const profile = {
  modules: {
    base_stone: { label: "Stone base", category: "base", compatibilityTags: ["cannon"], modifiers: { damageMultiplier: 1, rangeMultiplier: 1, durabilityMultiplier: 1.5 } },
    barrel_long: { label: "Long barrel", category: "barrel", compatibilityTags: ["cannon"], modifiers: { damageMultiplier: 1.2, rangeMultiplier: 1.3, durabilityMultiplier: 1 } },
    core_fire: { label: "Fire core", category: "core", compatibilityTags: ["cannon"], modifiers: { damageMultiplier: 1.1, rangeMultiplier: 1, durabilityMultiplier: 1 } }
  },
  blueprints: {
    cannon: { compatibilityTags: ["cannon"], footprint: [{ q: 0, r: 0 }], defaultModules: { base: "base_stone", barrel: "barrel_long", core: "core_fire" } }
  },
  craftingRecipes: {
    ruby_t2: {
      outputArtifactId: "ruby_t2",
      allowRotations: true,
      pattern: [
        { x: 0, y: 0, artifactId: "ruby_t1" },
        { x: 1, y: 0, artifactId: "ruby_t1" }
      ]
    }
  }
};

describe("R14.1/R14.3 arsenal compiler and gem crafting contract (RED)", () => {
  it("normalizes closed own data and compiles the same immutable effective tower contract", () => {
    const normalized = normalizeArsenalProfileV1(profile);
    const compiled = compileArsenalBlueprintV1(normalized, "cannon");
    expect(compiled).toEqual({
      schemaVersion: 1,
      towerTypeId: "cannon",
      modules: { base: "base_stone", barrel: "barrel_long", core: "core_fire" },
      footprint: [{ q: 0, r: 0 }],
      damageMultiplier: 1.32,
      rangeMultiplier: 1.3,
      durabilityMultiplier: 1.5
    });
    expect(Object.isFrozen(compiled)).toBe(true);
  });

  it("rejects incompatible categories, tags, unknown fields, accessors and sparse arrays", () => {
    expect(() => compileArsenalBlueprintV1(normalizeArsenalProfileV1({
      ...profile,
      blueprints: { cannon: { ...profile.blueprints.cannon, defaultModules: { ...profile.blueprints.cannon.defaultModules, base: "barrel_long" } } }
    }), "cannon")).toThrow(/base|category|compatible/i);
    expect(() => normalizeArsenalProfileV1({ ...profile, hidden: true })).toThrow(/closed|unknown/i);
    const accessor = { ...profile };
    Object.defineProperty(accessor, "modules", { enumerable: true, get: () => profile.modules });
    expect(() => normalizeArsenalProfileV1(accessor)).toThrow(ArsenalProfileValidationError);
    const sparse = Array(2);
    sparse[1] = { q: 0, r: 0 };
    expect(() => normalizeArsenalProfileV1({
      ...profile,
      blueprints: { cannon: { ...profile.blueprints.cannon, footprint: sparse } }
    })).toThrow(/dense|array/i);
  });

  it("crafts an exact rotated 3x3 pattern atomically using artifact instance ids", () => {
    const run: CampaignRunV2 = {
      version: 2,
      seed: "craft",
      nodeId: null,
      deck: [],
      artifacts: [
        { instanceId: "gem_a", artifactId: "ruby_t1" },
        { instanceId: "gem_b", artifactId: "ruby_t1" },
        { instanceId: "gem_keep", artifactId: "sapphire_t1" }
      ],
      runResources: {},
      arsenal: { moduleInventory: [] }
    };
    const result = craftCampaignGemV1(run, normalizeArsenalProfileV1(profile), {
      recipeId: "ruby_t2",
      outputInstanceId: "gem_crafted",
      cells: [
        { x: 2, y: 1, artifactInstanceId: "gem_a" },
        { x: 2, y: 2, artifactInstanceId: "gem_b" }
      ]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run.artifacts).toEqual([
      { instanceId: "gem_keep", artifactId: "sapphire_t1" },
      { instanceId: "gem_crafted", artifactId: "ruby_t2" }
    ]);
    expect(run.artifacts).toHaveLength(3);
  });

  it("rejects duplicate consumption or a non-matching board without partial mutation", () => {
    const run: CampaignRunV2 = {
      version: 2, seed: "craft", nodeId: null, deck: [], runResources: {},
      artifacts: [{ instanceId: "gem_a", artifactId: "ruby_t1" }],
      arsenal: { moduleInventory: [] }
    };
    const normalized = normalizeArsenalProfileV1(profile);
    for (const cells of [
      [{ x: 0, y: 0, artifactInstanceId: "gem_a" }, { x: 1, y: 0, artifactInstanceId: "gem_a" }],
      [{ x: 0, y: 0, artifactInstanceId: "gem_a" }]
    ]) {
      const result = craftCampaignGemV1(run, normalized, { recipeId: "ruby_t2", outputInstanceId: "out", cells });
      expect(result.ok).toBe(false);
      expect(result.run).toBe(run);
    }
  });
});
