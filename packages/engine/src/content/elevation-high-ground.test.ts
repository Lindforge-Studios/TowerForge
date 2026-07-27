import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

const HIGH_GROUND_LIMITS_V1 = Object.freeze({
  maximumEffectiveElevationDelta: 64,
  rangeBonusPerElevation: 16,
  damageBonusBasisPointsPerElevation: 10_000,
  totalRangeBonus: 64,
  totalDamageBonusBasisPoints: 100_000,
  modifiersPerDamagePacket: 1
});

const VALID_HIGH_GROUND = Object.freeze({
  maximumEffectiveElevationDelta: 3,
  rangeBonusPerElevation: 1,
  damageBonusBasisPointsPerElevation: 1_000
});

interface InputOptions {
  moduleVersion?: number;
  enabled?: boolean;
  selected?: boolean;
  omitModule?: boolean;
  profileMissing?: boolean;
  profile?: unknown;
}

function highGroundInput(options: InputOptions = {}): GameContentInput {
  const profile = options.profile ?? { highGround: { ...VALID_HIGH_GROUND } };
  return {
    balance: {
      defaultMissionId: "high_ground",
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
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["opaque"]
        }
      },
      abilities: {},
      enemies: {},
      towers: {},
      waveSets: { empty: [{ id: "wave", label: "Wave", groups: [] }] },
      missions: {
        high_ground: {
          id: "high_ground", label: "High ground", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "field", waveSetId: "empty", buildTowerIds: [], abilityIds: [],
          ...(options.selected === false ? {} : {
            mechanics: { profiles: { elevation: "plateau" } }
          })
        }
      }
    },
    maps: {
      field: {
        id: "field", width: 4, height: 1,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 3, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
        pathRoutes: [], terrainOverrides: [], elevationOverrides: []
      }
    },
    ...(options.omitModule ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          elevation: {
            schemaVersion: options.moduleVersion ?? 3,
            enabled: options.enabled ?? true,
            profiles: options.profileMissing ? {} : { plateau: profile }
          }
        }
      }
    }),
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "high_ground", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function content(options: InputOptions = {}): GameContentRegistry {
  return createGameContentRegistry(highGroundInput(options));
}

function validation(options: InputOptions = {}) {
  return validateGameContentRegistry(content(options));
}

type ResolvedHighGround = {
  readonly profileId: string;
  readonly maximumEffectiveElevationDelta: number;
  readonly rangeBonusPerElevation: number;
  readonly damageBonusBasisPointsPerElevation: number;
};

function resolveHighGround(subject: GameContentRegistry): ResolvedHighGround | undefined {
  const resolver = (Engine as unknown as {
    resolveActiveHighGroundMechanics?: (
      registry: GameContentRegistry,
      missionId: string
    ) => ResolvedHighGround | undefined;
  }).resolveActiveHighGroundMechanics;
  expect(resolver, "R3.3 must expose the defensive high-ground resolver").toBeTypeOf("function");
  return resolver!(subject, "high_ground");
}

describe("R3.3 elevation v3 schema and exact budgets", () => {
  it("publishes the frozen public limits and the closed v1/v2/v3 descriptor", () => {
    expect((Engine as unknown as Record<string, unknown>).HIGH_GROUND_LIMITS)
      .toEqual(HIGH_GROUND_LIMITS_V1);
    expect(Object.isFrozen((Engine as unknown as Record<string, unknown>).HIGH_GROUND_LIMITS)).toBe(true);
    expect(Engine.ELEVATION_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 3,
      moduleId: "elevation",
      supportedModuleSchemaVersions: [1, 2, 3],
      profile: {
        requiredFields: [],
        optionalFields: ["lineOfSight", "highGround"],
        additionalProperties: false,
        versions: {
          1: { requiredFields: [], optionalFields: [], additionalProperties: false },
          2: { requiredFields: [], optionalFields: ["lineOfSight"], additionalProperties: false },
          3: {
            requiredFields: [],
            optionalFields: ["lineOfSight", "highGround"],
            additionalProperties: false
          }
        },
        highGround: {
          requiredFields: [
            "maximumEffectiveElevationDelta",
            "rangeBonusPerElevation",
            "damageBonusBasisPointsPerElevation"
          ],
          optionalFields: [],
          additionalProperties: false
        }
      }
    });
  });

  it.each([
    ["ordinary", VALID_HIGH_GROUND],
    ["minimum positive damage-only", {
      maximumEffectiveElevationDelta: 1,
      rangeBonusPerElevation: 0,
      damageBonusBasisPointsPerElevation: 1
    }],
    ["exact total range boundary", {
      maximumEffectiveElevationDelta: 4,
      rangeBonusPerElevation: 16,
      damageBonusBasisPointsPerElevation: 0
    }],
    ["exact total damage boundary", {
      maximumEffectiveElevationDelta: 10,
      rangeBonusPerElevation: 0,
      damageBonusBasisPointsPerElevation: 10_000
    }],
    ["maximum delta within both product budgets", {
      maximumEffectiveElevationDelta: 64,
      rangeBonusPerElevation: 1,
      damageBonusBasisPointsPerElevation: 1_562
    }]
  ])("accepts the %s high-ground boundary", (_label, highGround) => {
    expect(validation({ profile: { highGround } }).ok).toBe(true);
  });

  it.each([
    ["missing maximum delta", { rangeBonusPerElevation: 1, damageBonusBasisPointsPerElevation: 1_000 }],
    ["missing range bonus", { maximumEffectiveElevationDelta: 3, damageBonusBasisPointsPerElevation: 1_000 }],
    ["missing damage bonus", { maximumEffectiveElevationDelta: 3, rangeBonusPerElevation: 1 }],
    ["extra field", { ...VALID_HIGH_GROUND, downhillPenalty: 1 }],
    ["zero maximum delta", { ...VALID_HIGH_GROUND, maximumEffectiveElevationDelta: 0 }],
    ["maximum delta above 64", { ...VALID_HIGH_GROUND, maximumEffectiveElevationDelta: 65 }],
    ["fractional maximum delta", { ...VALID_HIGH_GROUND, maximumEffectiveElevationDelta: 1.5 }],
    ["negative range", { ...VALID_HIGH_GROUND, rangeBonusPerElevation: -1 }],
    ["range per elevation above 16", { ...VALID_HIGH_GROUND, rangeBonusPerElevation: 17 }],
    ["fractional range", { ...VALID_HIGH_GROUND, rangeBonusPerElevation: 0.5 }],
    ["negative damage basis points", { ...VALID_HIGH_GROUND, damageBonusBasisPointsPerElevation: -1 }],
    ["damage basis points above 10000", { ...VALID_HIGH_GROUND, damageBonusBasisPointsPerElevation: 10_001 }],
    ["fractional damage basis points", { ...VALID_HIGH_GROUND, damageBonusBasisPointsPerElevation: 1.5 }],
    ["both bonuses zero", {
      maximumEffectiveElevationDelta: 3,
      rangeBonusPerElevation: 0,
      damageBonusBasisPointsPerElevation: 0
    }],
    ["total range budget overflow", {
      maximumEffectiveElevationDelta: 5,
      rangeBonusPerElevation: 16,
      damageBonusBasisPointsPerElevation: 0
    }],
    ["total damage budget overflow", {
      maximumEffectiveElevationDelta: 11,
      rangeBonusPerElevation: 0,
      damageBonusBasisPointsPerElevation: 10_000
    }],
    ["unsafe integer", {
      ...VALID_HIGH_GROUND,
      damageBonusBasisPointsPerElevation: Number.MAX_SAFE_INTEGER + 1
    }]
  ])("rejects %s without coercion", (_label, highGround) => {
    const result = validation({ profile: { highGround } });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/highGround/i)
    }));
  });

  it("keeps v1 empty, v2 LoS-only, and v3 closed to its two sibling sections", () => {
    const v1 = validation({ moduleVersion: 1, profile: {} });
    expect(v1.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const v2 = validation({
      moduleVersion: 2,
      profile: { lineOfSight: { terrainBlockerTags: ["opaque"] } }
    });
    expect(v2.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(validation({ moduleVersion: 3, profile: {} }).ok).toBe(true);
    expect(validation({
      moduleVersion: 3,
      profile: {
        lineOfSight: { terrainBlockerTags: ["opaque"] },
        highGround: { ...VALID_HIGH_GROUND }
      }
    }).ok).toBe(true);

    for (const options of [
      { moduleVersion: 1, profile: { highGround: VALID_HIGH_GROUND } },
      { moduleVersion: 2, profile: { highGround: VALID_HIGH_GROUND } },
      { moduleVersion: 3, profile: { highGround: VALID_HIGH_GROUND, physics: {} } }
    ]) {
      const result = validation(options);
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/elevation|highGround|physics/i)
      }));
    }
  });

  it("rejects hostile highGround shapes without invoking accessors or leaking Proxy messages", () => {
    let accessorCalls = 0;
    const accessorShape: Record<string, unknown> = {
      rangeBonusPerElevation: 1,
      damageBonusBasisPointsPerElevation: 1_000
    };
    Object.defineProperty(accessorShape, "maximumEffectiveElevationDelta", {
      enumerable: true,
      get() { accessorCalls += 1; return 3; }
    });
    const accessorResult = validation({ profile: { highGround: accessorShape } });
    expect(accessorResult.ok).toBe(false);
    expect(accessorResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/highGround/i)
    }));
    expect(accessorCalls).toBe(0);

    const symbolShape = { ...VALID_HIGH_GROUND } as Record<PropertyKey, unknown>;
    symbolShape[Symbol("verifier")] = true;
    const symbolResult = validation({ profile: { highGround: symbolShape } });
    expect(symbolResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/highGround/i)
    }));

    const secret = "high-ground-verifier-proxy-secret";
    const hostile = new Proxy({ ...VALID_HIGH_GROUND }, {
      ownKeys() { throw new Error(secret); }
    });
    const proxyResult = validation({ profile: { highGround: hostile } });
    expect(proxyResult.ok).toBe(false);
    expect(proxyResult.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/highGround/i)
    }));
    expect(proxyResult.issues.map((issue) => issue.message).join("\n")).not.toContain(secret);
  });
});

describe("R3.3 defensive runtime resolver and sibling isolation", () => {
  it("returns one frozen detached high-ground profile for active v3", () => {
    const authored = { ...VALID_HIGH_GROUND };
    const resolved = resolveHighGround(content({ profile: { highGround: authored } }));
    expect(resolved).toEqual({ profileId: "plateau", ...VALID_HIGH_GROUND });
    expect(resolved).not.toBe(authored);
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it.each([
    ["absent", { omitModule: true }],
    ["disabled", { enabled: false }],
    ["unselected", { selected: false }],
    ["missing profile", { profileMissing: true }],
    ["v1", { moduleVersion: 1, profile: {} }],
    ["v2", { moduleVersion: 2, profile: {} }],
    ["v3 empty", { moduleVersion: 3, profile: {} }],
    ["v3 LoS-only", {
      moduleVersion: 3,
      profile: { lineOfSight: { terrainBlockerTags: ["opaque"] } }
    }],
    ["future", { moduleVersion: 4, profile: { highGround: VALID_HIGH_GROUND } }]
  ])("returns undefined for the %s inactive path", (_label, options) => {
    expect(resolveHighGround(content(options))).toBeUndefined();
  });

  it("ignores only malformed highGround while preserving a valid LoS sibling", () => {
    let calls = 0;
    const malformedHighGround: Record<string, unknown> = {
      rangeBonusPerElevation: 1,
      damageBonusBasisPointsPerElevation: 1_000
    };
    Object.defineProperty(malformedHighGround, "maximumEffectiveElevationDelta", {
      enumerable: true,
      get() { calls += 1; return 3; }
    });
    const subject = content({
      profile: {
        lineOfSight: { terrainBlockerTags: ["opaque"] },
        highGround: malformedHighGround
      }
    });
    expect(resolveHighGround(subject)).toBeUndefined();
    expect(Engine.resolveActiveLineOfSightMechanics(subject, "high_ground")).toEqual({
      profileId: "plateau",
      terrainBlockerTags: ["opaque"]
    });
    expect(calls).toBe(0);
  });

  it("does not let a malformed LoS sibling disable valid high-ground math", () => {
    const subject = content({
      profile: {
        lineOfSight: { terrainBlockerTags: ["opaque", "opaque"] },
        highGround: { ...VALID_HIGH_GROUND }
      }
    });
    expect(Engine.resolveActiveLineOfSightMechanics(subject, "high_ground")).toBeUndefined();
    expect(resolveHighGround(subject)).toEqual({ profileId: "plateau", ...VALID_HIGH_GROUND });
  });
});
