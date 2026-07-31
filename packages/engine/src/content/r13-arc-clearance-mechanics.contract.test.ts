import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

type Activation = "active" | "disabled" | "unselected" | "absent" | "future";

const CLEARANCE_LIMITS = Object.freeze({
  terrainBlockerTags: 64,
  terrainTagUtf8Bytes: 128,
  maximumBlockerHeight: 1_000_000,
  terrainDefinitions: 256,
  terrainTagsPerDefinition: 64,
  terrainTagsAcrossDefinitions: 8_192,
  maximumRayDistance: 256,
  cellInspectionsPerTick: 1_048_576
});

function profile(clearance: unknown = {
  terrainBlockerHeights: { wall: 4, opaque: 2 }
}): unknown {
  return {
    projectiles: {
      towers: {
        mortar: { trajectory: "arc", travelTimeUnits: 1, maxAltitude: 6 },
        bolt: { trajectory: "direct", travelTimeUnits: 1 }
      },
      clearance
    }
  };
}

function fixture(
  activation: Activation = "active",
  authoredProfile: unknown = profile()
): GameContentInput {
  const selected = activation === "active" || activation === "disabled" || activation === "future";
  return {
    balance: {
      defaultMissionId: "clearance_lab",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        cliff: {
          id: "cliff", label: "Cliff", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: ["wall", "opaque"]
        }
      },
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        bolt: {
          id: "bolt", label: "Bolt", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: { kind: "single", fireRate: 1, damagePerStack: 10, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
        },
        mortar: {
          id: "mortar", label: "Mortar", cost: { coins: 1 }, footprintRadius: 0, range: 8,
          attack: { kind: "single", fireRate: 1, damagePerStack: 20, startingStacks: 1, maxStacks: 1, upgradeCost: 1 }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1", label: "Wave",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        clearance_lab: {
          id: "clearance_lab", label: "Clearance Lab", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["bolt", "mortar"], abilityIds: [],
          ...(selected ? { mechanics: { profiles: { ballistics: "field" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 10, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable", spawnCoord: { q: 4, r: 1 }, coreCoord: { q: 9, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, index) => ({ q: index + 4, r: 1 })),
        pathRoutes: [], terrainOverrides: [{ q: 2, r: 1, terrain: "cliff" }]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: activation === "absent" ? {} : {
        ballistics: {
          schemaVersion: activation === "future" ? 2 : 1,
          enabled: activation !== "disabled",
          profiles: { field: authoredProfile }
        }
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "clearance_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function registry(activation: Activation = "active", authoredProfile: unknown = profile()): GameContentRegistry {
  return createGameContentRegistry(fixture(activation, authoredProfile));
}

function validation(activation: Activation = "active", authoredProfile: unknown = profile()): ValidationResult {
  return validateGameContentRegistry(registry(activation, authoredProfile));
}

function normalizer(): (value: unknown) => any {
  const normalize = (Engine as unknown as { normalizeBallisticsProfileV1?: (value: unknown) => unknown })
    .normalizeBallisticsProfileV1;
  expect(normalize).toBeTypeOf("function");
  return normalize!;
}

function issue(result: ValidationResult, severity: "error" | "warning", expression: RegExp): boolean {
  return result.issues.some((entry) => entry.severity === severity
    && expression.test(`${entry.fieldPath} ${entry.message}`));
}

describe("R13.2 arc-clearance ballistics authoring contract (RED)", () => {
  it("publishes the closed clearance descriptor and independent exact budgets", () => {
    expect((Engine as unknown as Record<string, unknown>).ARC_CLEARANCE_LIMITS).toEqual(CLEARANCE_LIMITS);
    expect((Engine as unknown as Record<string, any>).BALLISTICS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      projectiles: {
        requiredFields: ["towers"], optionalFields: ["clearance", "ricochet", "destructibles"], additionalProperties: false
      },
      clearance: {
        requiredFields: ["terrainBlockerHeights"], optionalFields: [], additionalProperties: false,
        terrainBlockerHeights: {
          kind: "record", key: "terrainTag",
          value: { type: "number", minimum: 0, maximum: 1_000_000 }
        },
        limits: CLEARANCE_LIMITS
      }
    });
  });

  it("normalizes blocker tags in binary order into detached, deeply frozen own data", () => {
    const authored = profile({ terrainBlockerHeights: { wall: 4, opaque: 2 } }) as any;
    const normalized = normalizer()(authored);
    expect(Object.keys(normalized.projectiles.clearance.terrainBlockerHeights)).toEqual(["opaque", "wall"]);
    expect(normalized.projectiles.clearance.terrainBlockerHeights).toEqual({ opaque: 2, wall: 4 });
    expect(Object.isFrozen(normalized.projectiles.clearance)).toBe(true);
    expect(Object.isFrozen(normalized.projectiles.clearance.terrainBlockerHeights)).toBe(true);
    authored.projectiles.clearance.terrainBlockerHeights.wall = 99;
    expect(normalized.projectiles.clearance.terrainBlockerHeights.wall).toBe(4);
  });

  it("accepts zero and the maximum height, resolves active clearance, and preserves exact R13.1 shape when omitted", () => {
    const exact = profile({ terrainBlockerHeights: { wall: 1_000_000, opaque: 0 } });
    expect(validation("active", exact)).toEqual({ ok: true, issues: [] });
    expect((Engine as any).resolveActiveBallisticsMechanics(registry("active", exact), "clearance_lab"))
      .toMatchObject({
        schemaVersion: 1,
        projectiles: {
          clearance: { terrainBlockerHeights: { opaque: 0, wall: 1_000_000 } }
        }
      });

    const legacyR131 = { projectiles: { towers: { bolt: { trajectory: "direct", travelTimeUnits: 1 } } } };
    expect(normalizer()(legacyR131)).toEqual(legacyR131);
    expect(normalizer()(legacyR131).projectiles).not.toHaveProperty("clearance");
  });

  it.each(["disabled", "unselected"] as const)(
    "keeps malformed %s clearance inactive and reports only a structural warning",
    (activation) => {
      const malformed = profile({ terrainBlockerHeights: { wall: -1 }, extra: true });
      const result = validation(activation, malformed);
      expect(result.ok).toBe(true);
      expect(issue(result, "warning", /ballistics.*clearance|clearance.*height|unknown.*extra/i)).toBe(true);
      expect((Engine as any).resolveActiveBallisticsMechanics(registry(activation, malformed), "clearance_lab"))
        .toBeUndefined();
    }
  );

  it("rejects a selected future module before reading clearance accessors", () => {
    let calls = 0;
    const projectiles = { towers: {} } as Record<string, unknown>;
    Object.defineProperty(projectiles, "clearance", {
      enumerable: true,
      get: () => { calls += 1; return { terrainBlockerHeights: { wall: 1 } }; }
    });
    const authored = { projectiles };
    const result = validation("future", authored);
    expect(result.ok).toBe(false);
    expect(issue(result, "error", /ballistics.*version|schemaVersion.*unsupported/i)).toBe(true);
    expect(calls).toBe(0);
  });

  it("rejects closed-shape errors, unknown tags, malformed heights, and exact budget overflow", () => {
    const invalid: unknown[] = [
      profile({ terrainBlockerHeights: { wall: 1 }, extra: true }),
      profile({}),
      profile({ terrainBlockerHeights: {} }),
      profile({ terrainBlockerHeights: { missing_tag: 1 } }),
      profile({ terrainBlockerHeights: { " padded ": 1 } }),
      profile({ terrainBlockerHeights: { wall: -Number.EPSILON } }),
      profile({ terrainBlockerHeights: { wall: 1_000_001 } }),
      profile({ terrainBlockerHeights: { wall: Number.NaN } }),
      profile({ terrainBlockerHeights: Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`tag_${index}`, 1])
      ) })
    ];
    for (const authored of invalid) {
      const result = validation("active", authored);
      expect(result.ok, JSON.stringify(authored).slice(0, 180)).toBe(false);
      expect(issue(result, "error", /ballistics|clearance|blocker|terrain.*tag|height|limit|unknown/i)).toBe(true);
    }
  });

  it("rejects accessors, proxies, arrays, cycles, symbols, and custom prototypes without invoking user code", () => {
    let getterCalls = 0;
    const accessor = profile() as any;
    Object.defineProperty(accessor.projectiles.clearance.terrainBlockerHeights, "wall", {
      enumerable: true,
      get: () => { getterCalls += 1; return 4; }
    });
    expect(() => normalizer()(accessor)).toThrow(/accessor|own data|inspect|wall/i);
    expect(getterCalls).toBe(0);

    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("trap"); } });
    expect(() => normalizer()(profile({ terrainBlockerHeights: hostile }))).toThrow(/inspect|safe|plain/i);
    expect(() => normalizer()(profile({ terrainBlockerHeights: Object.assign(new Array(2), { 1: 2 }) })))
      .toThrow(/array|record|plain|sparse/i);

    const cyclic: any = { terrainBlockerHeights: { wall: 1 } };
    cyclic.loop = cyclic;
    expect(() => normalizer()(profile(cyclic))).toThrow(/closed|unknown|cycle/i);

    const symbol: any = { terrainBlockerHeights: { wall: 1 } };
    symbol[Symbol("hidden")] = true;
    expect(() => normalizer()(profile(symbol))).toThrow(/symbol|field/i);
    expect(() => normalizer()(profile(Object.create({ terrainBlockerHeights: { wall: 1 } }))))
      .toThrow(/prototype|plain/i);
  });
});
