import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const PHYSICS_LIMITS_V1 = Object.freeze({
  displacementDistance: 8,
  displacementEffectsPerSource: 8,
  displacementTargetsPerActivation: 64,
  immuneEnemyTypeIds: 4_096,
  fallHazardTerrainTags: 64,
  idOrTagUtf8Bytes: 128,
  stepsPerEffectApplication: 8,
  stepAttemptsPerActivation: 4_096,
  stepAttemptsPerTick: 32_768
});

type PhysicsProfileFixture = Readonly<Record<string, unknown>>;

interface PhysicsFixtureOptions {
  enabled?: boolean;
  selected?: boolean;
  profileId?: string;
  moduleSchemaVersion?: number;
  profiles?: Record<string, PhysicsProfileFixture>;
}

function physicsInput(options: PhysicsFixtureOptions = {}): GameContentInput {
  const profileId = options.profileId ?? "kinetic";
  return {
    balance: {
      defaultMissionId: "physics",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 20,
        startingResources: { coins: 20 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor",
          label: "Floor",
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: []
        },
        chasm: {
          id: "chasm",
          label: "Chasm",
          buildable: false,
          walkable: false,
          groundSpeedMultiplier: 1,
          tags: ["fall_hazard"]
        }
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 20,
          speed: 0.2,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1
        }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 2,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 1,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        physics: {
          id: "physics",
          label: "Physics",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 20 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["pelter"],
          abilityIds: [],
          ...(options.selected === false ? {} : {
            mechanics: { profiles: { physics: profileId } }
          })
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 4,
        height: 2,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 0 },
        coreCoord: { q: 3, r: 0 },
        pathCenterline: Array.from({ length: 4 }, (_, q) => ({ q, r: 0 })),
        pathRoutes: [],
        terrainOverrides: [{ q: 1, r: 1, terrain: "chasm" }]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        physics: {
          schemaVersion: (options.moduleSchemaVersion ?? 1) as 1,
          enabled: options.enabled ?? true,
          profiles: options.profiles ?? { [profileId]: {} }
        }
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "physics",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(options: PhysicsFixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(physicsInput(options));
}

function validatePhysics(options: PhysicsFixtureOptions = {}): ValidationResult {
  return validateGameContentRegistry(content(options));
}

function hasIssue(
  result: ValidationResult,
  severity: "error" | "warning",
  path: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((candidate) => (
    candidate.severity === severity
    && path.test(candidate.fieldPath)
    && message.test(candidate.message)
  ));
}

describe("R3.4a physics module v1 contract", () => {
  it("publishes physics as implemented with exact closed limits and authoring descriptor", () => {
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual([
      "combat", "reactions", "navigation", "elevation", "physics", "terraforming", "roguelite", "heroes",
      "logistics"
    ]);

    const exports = Engine as unknown as {
      PHYSICS_LIMITS?: unknown;
      PHYSICS_MECHANICS_SCHEMA?: unknown;
    };
    expect(exports.PHYSICS_LIMITS).toEqual(PHYSICS_LIMITS_V1);
    expect(exports.PHYSICS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      moduleId: "physics",
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: [],
        optionalFields: [
          "displacementImmuneEnemyTypeIds",
          "fallImmuneEnemyTypeIds",
          "fallHazardTerrainTags"
        ],
        additionalProperties: false
      },
      effect: {
        kind: "displacement",
        requiredFields: ["kind", "mode", "distance", "stopAtBlocker"],
        optionalFields: [],
        additionalProperties: false,
        modes: ["push", "pull"]
      },
      limits: PHYSICS_LIMITS_V1,
      runtimeSnapshot: null
    });
  });

  it("resolves absent, unavailable, disabled, unselected, missing-profile, future, and active states", () => {
    const implemented = ["combat", "reactions", "navigation", "elevation", "physics"] as const;
    expect(Engine.resolveCapabilitySet({ schemaVersion: 1, modules: {} }).physics)
      .toMatchObject({ available: true, active: false, reason: "module_missing" });

    const catalog = physicsInput().mechanics!;
    expect(Engine.resolveCapabilitySet(catalog, {}, implemented).physics)
      .toMatchObject({ available: true, active: false, reason: "not_selected" });
    expect(Engine.resolveCapabilitySet(catalog, { profiles: { physics: "missing" } }, implemented).physics)
      .toMatchObject({ available: true, active: false, reason: "profile_missing" });
    expect(Engine.resolveCapabilitySet(
      physicsInput({ enabled: false }).mechanics!,
      { profiles: { physics: "kinetic" } },
      implemented
    ).physics).toMatchObject({ available: true, active: false, reason: "module_disabled" });
    expect(Engine.resolveCapabilitySet(
      physicsInput({ moduleSchemaVersion: 2 }).mechanics!,
      { profiles: { physics: "kinetic" } },
      implemented
    ).physics).toMatchObject({ available: true, active: false, reason: "module_version_unsupported" });
    expect(Engine.resolveCapabilitySet(
      catalog,
      { profiles: { physics: "kinetic" } },
      ["combat", "reactions", "navigation", "elevation"]
    ).physics).toMatchObject({ available: false, active: false, reason: "module_unavailable" });
    expect(Engine.resolveCapabilitySet(
      catalog,
      { profiles: { physics: "kinetic" } },
      implemented
    ).physics).toEqual({
      moduleId: "physics",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "kinetic",
      reason: "active"
    });
  });

  it("accepts only closed, duplicate-free, bounded own-data profile fields", () => {
    const valid = validatePhysics({
      profiles: {
        kinetic: {
          displacementImmuneEnemyTypeIds: ["grunt"],
          fallImmuneEnemyTypeIds: ["grunt"],
          fallHazardTerrainTags: ["fall_hazard"]
        }
      }
    });
    expect(valid).toMatchObject({ ok: true, issues: [] });

    for (const profile of [
      { unexpected: true },
      { displacementImmuneEnemyTypeIds: ["grunt", "grunt"] },
      { fallImmuneEnemyTypeIds: [""] },
      { fallHazardTerrainTags: ["x".repeat(129)] },
      { fallHazardTerrainTags: Object.assign(new Array(2), { 1: "fall_hazard" }) }
    ]) {
      const result = validatePhysics({ enabled: false, profiles: { kinetic: profile } });
      expect(result.ok).toBe(false);
      expect(hasIssue(
        result,
        "error",
        /physics|profiles\.kinetic|unexpected|immune|fallHazard/i,
        /closed|unknown|duplicate|non-empty|128|dense|sparse|own data/i
      )).toBe(true);
    }
  });

  it("enforces exact array budgets before traversing hostile excess entries", () => {
    const immuneExact = Array.from({ length: 4_096 }, (_, index) => `enemy_${index}`);
    const hazardExact = Array.from({ length: 64 }, (_, index) => `hazard_${index}`);
    const exact = validatePhysics({
      selected: false,
      profiles: {
        kinetic: {
          displacementImmuneEnemyTypeIds: immuneExact,
          fallImmuneEnemyTypeIds: immuneExact,
          fallHazardTerrainTags: hazardExact
        }
      }
    });
    expect(exact.issues.some((issue) => issue.severity === "error")).toBe(false);

    for (const profile of [
      { displacementImmuneEnemyTypeIds: new Array(4_097) },
      { fallImmuneEnemyTypeIds: new Array(4_097) },
      { fallHazardTerrainTags: new Array(65) }
    ]) {
      const result = validatePhysics({ enabled: false, profiles: { kinetic: profile } });
      expect(result.ok).toBe(false);
      expect(hasIssue(result, "error", /physics|immune|fallHazard/i, /4.?096|64|budget|limit|maximum/i))
        .toBe(true);
    }
  });

  it("downgrades missing enemy cross-references only while the module is inactive", () => {
    const broken = {
      displacementImmuneEnemyTypeIds: ["missing_displacement_enemy"],
      fallImmuneEnemyTypeIds: ["missing_fall_enemy"]
    };
    const active = validatePhysics({ profiles: { kinetic: broken } });
    expect(active.ok).toBe(false);
    expect(hasIssue(active, "error", /displacementImmuneEnemyTypeIds/i, /missing_displacement_enemy|unknown/i))
      .toBe(true);
    expect(hasIssue(active, "error", /fallImmuneEnemyTypeIds/i, /missing_fall_enemy|unknown/i))
      .toBe(true);

    for (const inactive of [
      validatePhysics({ enabled: false, profiles: { kinetic: broken } }),
      validatePhysics({ selected: false, profiles: { kinetic: broken } })
    ]) {
      expect(inactive.ok).toBe(true);
      expect(inactive.issues.some((issue) => issue.severity === "error")).toBe(false);
      expect(hasIssue(inactive, "warning", /physics|ImmuneEnemyTypeIds/i, /missing|unknown|inactive|unselected/i))
        .toBe(true);
    }
  });

  it("rejects future versions and hostile profile accessors even while disabled, without invoking them", () => {
    const future = validatePhysics({ enabled: false, moduleSchemaVersion: 2 });
    expect(future.ok).toBe(false);
    expect(hasIssue(future, "error", /physics.*schemaVersion|schemaVersion/i, /future|supported|version|1/i))
      .toBe(true);

    let calls = 0;
    const hostile = Object.defineProperty({}, "fallHazardTerrainTags", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("SECRET_PHYSICS_ACCESSOR_PAYLOAD");
      }
    });
    const result = validatePhysics({ enabled: false, profiles: { kinetic: hostile } });
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET_PHYSICS_ACCESSOR_PAYLOAD");
    expect(hasIssue(result, "error", /physics|profiles\.kinetic|fallHazard/i, /own data|accessor|inspect|plain object/i))
      .toBe(true);
  });

  it("fails closed at the active resolver boundary and returns detached frozen canonical data", () => {
    const resolve = (Engine as unknown as {
      resolveActivePhysicsMechanics?: (
        content: GameContentRegistry,
        missionId: string
      ) => Readonly<Record<string, unknown>> | undefined;
    }).resolveActivePhysicsMechanics;
    expect(resolve).toBeTypeOf("function");
    if (!resolve) return;

    const valid = content({
      profiles: {
        kinetic: {
          displacementImmuneEnemyTypeIds: ["grunt"],
          fallImmuneEnemyTypeIds: ["grunt"],
          fallHazardTerrainTags: ["fall_hazard"]
        }
      }
    });
    const resolved = resolve(valid, "physics");
    expect(resolved).toEqual({
      schemaVersion: 1,
      profileId: "kinetic",
      displacementImmuneEnemyTypeIds: ["grunt"],
      fallImmuneEnemyTypeIds: ["grunt"],
      fallHazardTerrainTags: ["fall_hazard"]
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.values(resolved ?? {}).filter(Array.isArray).every(Object.isFrozen)).toBe(true);

    let calls = 0;
    const hostileProfile = Object.defineProperty({}, "fallHazardTerrainTags", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("SECRET_RUNTIME_PHYSICS_GETTER");
      }
    });
    const hostileContent = content({ profiles: { kinetic: hostileProfile } });
    expect(resolve(hostileContent, "physics")).toBeUndefined();
    expect(calls).toBe(0);

    for (const inactive of [
      content({ enabled: false }),
      content({ selected: false }),
      content({ moduleSchemaVersion: 2 })
    ]) {
      expect(resolve(inactive, "physics")).toBeUndefined();
    }
  });
});
