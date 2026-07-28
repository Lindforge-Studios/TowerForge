import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const DIRECTOR_LIMITS_V1 = Object.freeze({
  counterDefinitions: 256,
  conditionsPerCounter: 8,
  groupsPerCounter: 8,
  totalCounterGroups: 2_048,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 256,
  addedGroupsPerDecision: 8,
  addedEnemiesPerDecision: 1_024,
  threatCost: 1_000_000_000,
  decisionHistory: 1_024
});

type Activation = "active" | "disabled" | "unselected" | "absent" | "future";

function validProfile(): Record<string, unknown> {
  return {
    counterPool: {
      anti_fire: {
        label: "Fire guard",
        priority: 20,
        conditions: [{
          metric: "damage_share",
          key: "fire",
          operator: "gte",
          threshold: 0.6
        }],
        groups: [{
          enemyId: "fire_guard",
          count: 2,
          spawnInterval: 0.5,
          startDelay: 0,
          routeId: "main"
        }],
        threatCost: 8
      }
    },
    threatBudget: { base: 10, perWave: 5 },
    fairness: {
      minimumWaveIndex: 1,
      maxConsecutiveUses: 1,
      maxAddedGroups: 2,
      maxAddedEnemies: 8
    }
  };
}

function directorInput(options: {
  readonly activation?: Activation;
  readonly profile?: unknown;
} = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const modules = activation === "absent" ? {} : {
    director: {
      schemaVersion: (activation === "future" ? 2 : 1) as 1,
      enabled: activation !== "disabled",
      profiles: { adaptive: options.profile ?? validProfile() }
    }
  };
  const path = Array.from({ length: 6 }, (_, q) => ({ q, r: 0 }));
  return {
    balance: {
      defaultMissionId: "director",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 5,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 20, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        fire_guard: {
          id: "fire_guard", label: "Fire Guard", maxHp: 40, speed: 0.8,
          reward: { coins: 2 }, coinReward: 2, coreDamage: 1, color: 2,
          resistances: { fire: 0.25 }
        }
      },
      towers: {
        flame: {
          id: "flame", label: "Flame", cost: { coins: 1 }, footprintRadius: 0, range: 3,
          attack: {
            kind: "single", damageType: "fire", fireRate: 1, damagePerStack: 4,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        two: [
          {
            id: "first", label: "First",
            groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0, routeId: "main" }]
          },
          {
            id: "second", label: "Second",
            groups: [{ enemyId: "grunt", count: 2, spawnInterval: 1, startDelay: 0, routeId: "main" }]
          }
        ]
      },
      missions: {
        director: {
          id: "director", label: "Director", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 5,
          mapId: "lane", waveSetId: "two", buildTowerIds: ["flame"], abilityIds: [],
          ...(activation === "unselected" || activation === "absent"
            ? {}
            : { mechanics: { profiles: { director: "adaptive" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 1,
        grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 5, r: 0 },
        pathCenterline: path,
        pathRoutes: [{ id: "main", pathCenterline: path }],
        terrainOverrides: []
      }
    },
    mechanics: { schemaVersion: 1, modules } as unknown as GameContentInput["mechanics"],
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "director", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function registry(options: Parameters<typeof directorInput>[0] = {}): GameContentRegistry {
  return createGameContentRegistry(directorInput(options));
}

function validate(options: Parameters<typeof directorInput>[0] = {}): ValidationResult {
  return validateGameContentRegistry(registry(options));
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

describe("R7.1 deterministic AI Wave Director mechanics contract (RED)", () => {
  it("publishes Director v1 as an implemented, closed, bounded opt-in capability", () => {
    expect(Engine.MECHANICS_MODULE_IDS).toContain("director");
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("director");

    const exported = Engine as unknown as {
      DIRECTOR_LIMITS?: unknown;
      DIRECTOR_MECHANICS_SCHEMA?: unknown;
    };
    expect(exported.DIRECTOR_LIMITS).toEqual(DIRECTOR_LIMITS_V1);
    expect(exported.DIRECTOR_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      moduleId: "director",
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: ["counterPool", "threatBudget", "fairness"],
        optionalFields: [],
        additionalProperties: false
      },
      counter: {
        requiredFields: ["label", "priority", "conditions", "groups", "threatCost"],
        optionalFields: [],
        additionalProperties: false
      },
      condition: {
        metrics: [
          "damage_share",
          "coverage_ratio",
          "movement_layer_share",
          "logistics_brownout_ratio"
        ],
        operators: ["gte", "lte"]
      },
      tieBreak: ["priority_desc", "condition_severity_desc", "counter_id_binary_asc"],
      limits: DIRECTOR_LIMITS_V1
    });
  });

  it("accepts a valid selected profile and resolves active, disabled, unselected, absent, and future states", () => {
    expect(validate()).toEqual({ ok: true, issues: [] });
    expect(registry().missions.director!.capabilities.director).toEqual({
      moduleId: "director",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "adaptive",
      reason: "active"
    });
    expect(registry({ activation: "disabled" }).missions.director!.capabilities.director)
      .toMatchObject({ available: true, active: false, reason: "module_disabled" });
    expect(registry({ activation: "unselected" }).missions.director!.capabilities.director)
      .toMatchObject({ available: true, active: false, reason: "not_selected" });
    expect(registry({ activation: "absent" }).missions.director!.capabilities.director)
      .toMatchObject({ available: true, active: false, reason: "module_missing" });
    expect(registry({ activation: "future" }).missions.director!.capabilities.director)
      .toMatchObject({ available: true, active: false, reason: "module_version_unsupported" });

    const future = validate({ activation: "future" });
    expect(hasIssue(future, "error", /modules\.director\.schemaVersion/, /future|supported|schemaVersion/i)).toBe(true);
  });

  it("normalizes valid profiles into detached, binary-ordered, deeply frozen own data", () => {
    const normalize = (Engine as unknown as {
      normalizeDirectorProfileV1?: (value: unknown) => any;
    }).normalizeDirectorProfileV1;
    expect(normalize).toBeTypeOf("function");
    const authored = validProfile() as any;
    authored.counterPool.zeta = { ...authored.counterPool.anti_fire, label: "Zeta" };
    authored.counterPool.Alpha = { ...authored.counterPool.anti_fire, label: "Alpha" };
    const normalized = normalize!(authored);

    expect(Object.keys(normalized.counterPool)).toEqual(["Alpha", "anti_fire", "zeta"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.counterPool)).toBe(true);
    expect(Object.values(normalized.counterPool).every(Object.isFrozen)).toBe(true);
    authored.counterPool.anti_fire.groups[0].count = 999;
    expect(normalized.counterPool.anti_fire.groups[0].count).toBe(2);
  });

  it("preserves an authored __proto__ counter as own frozen data without changing prototypes", () => {
    const normalize = Engine.normalizeDirectorProfileV1;
    const authored = validProfile() as any;
    authored.counterPool = JSON.parse(JSON.stringify({ safe: authored.counterPool.anti_fire }).replace('"safe"', '"__proto__"'));
    const normalized = normalize(authored);

    expect(Object.keys(normalized.counterPool)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(normalized.counterPool, "__proto__")?.value.label).toBe("Fire guard");
    expect(Object.getPrototypeOf(normalized.counterPool)).toBeNull();
    expect(({} as any).label).toBeUndefined();
  });

  it("rejects closed-shape and active cross-reference errors but downgrades disabled broken references to warnings", () => {
    const normalize = (Engine as unknown as {
      normalizeDirectorProfileV1?: (value: unknown) => unknown;
    }).normalizeDirectorProfileV1;
    expect(normalize).toBeTypeOf("function");
    expect(() => normalize!({ ...validProfile(), arbitraryHostHook: "forbidden" }))
      .toThrow(/arbitraryHostHook|closed|unknown/i);

    const missingEnemy = structuredClone(validProfile()) as any;
    missingEnemy.counterPool.anti_fire.groups[0].enemyId = "not_authored";
    const active = validate({ profile: missingEnemy });
    expect(hasIssue(
      active,
      "error",
      /modules\.director\.profiles\.adaptive\.counterPool\.anti_fire\.groups\[0\]\.enemyId/,
      /not_authored|unknown enemy/i
    )).toBe(true);

    const disabled = validate({ activation: "disabled", profile: missingEnemy });
    expect(disabled.ok).toBe(true);
    expect(hasIssue(
      disabled,
      "warning",
      /modules\.director\.profiles\.adaptive\.counterPool\.anti_fire\.groups\[0\]\.enemyId/,
      /not_authored|unknown enemy/i
    )).toBe(true);
  });

  it("always rejects malformed module structure and inspects accessors without invoking them", () => {
    const malformed = directorInput() as any;
    malformed.mechanics.modules.director.enabled = "yes";
    malformed.mechanics.modules.director.hostHook = true;
    const structural = validateGameContentRegistry(createGameContentRegistry(malformed));
    expect(structural.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: "modules.director.enabled" }),
      expect.objectContaining({ severity: "error", fieldPath: "modules.director.hostHook" })
    ]));

    const accessor = directorInput() as any;
    let reads = 0;
    Object.defineProperty(accessor.mechanics.modules.director, "profiles", {
      enumerable: true,
      get() { reads += 1; return { adaptive: validProfile() }; }
    });
    const inspected = validateGameContentRegistry(createGameContentRegistry(accessor));
    expect(reads).toBe(0);
    expect(inspected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", fieldPath: "modules.director.profiles" })
    ]));
  });

  it("resolves only a selected exact-v1 Director profile without mutating authored content", () => {
    const resolve = (Engine as unknown as {
      resolveActiveDirectorMechanics?: (content: GameContentRegistry, missionId: string) => unknown;
    }).resolveActiveDirectorMechanics;
    expect(resolve).toBeTypeOf("function");
    const authored = directorInput();
    const before = structuredClone(authored);
    const active = resolve!(createGameContentRegistry(authored), "director") as any;
    expect(active).toMatchObject({ schemaVersion: 1, profileId: "adaptive" });
    expect(active.counterPool.anti_fire.groups[0].enemyId).toBe("fire_guard");
    expect(authored).toEqual(before);
    expect(resolve!(registry({ activation: "disabled" }), "director")).toBeUndefined();
    expect(resolve!(registry({ activation: "future" }), "director")).toBeUndefined();

    const tampered = registry({ activation: "unselected" });
    Object.assign(tampered.missions.director!.capabilities.director, {
      active: true,
      profileId: "adaptive",
      reason: "active"
    });
    expect(resolve!(tampered, "director")).toBeUndefined();
  });
});
