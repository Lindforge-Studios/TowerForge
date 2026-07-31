import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

type SourceKind = "tower" | "ability" | "tower_script" | "status" | "reaction" | "enemy";

interface ProtectionContract {
  readonly radius: number;
  readonly sourceKinds: readonly SourceKind[];
}

interface Options {
  readonly protection?: unknown;
  readonly members?: Readonly<Record<string, "vanguard" | "body" | "support">>;
  readonly combat?: "active" | "absent" | "disabled" | "unselected";
  readonly enemyBehaviors?: "active" | "disabled" | "unselected";
  readonly shieldedEnemyIds?: readonly string[];
}

const ALL_SOURCES: readonly SourceKind[] = [
  "tower", "ability", "tower_script", "status", "reaction", "enemy"
];

function protection(overrides: Partial<ProtectionContract> = {}): ProtectionContract {
  return { radius: 2, sourceKinds: [...ALL_SOURCES], ...overrides };
}

function input(options: Options = {}): GameContentInput {
  const combat = options.combat ?? "active";
  const enemyBehaviors = options.enemyBehaviors ?? "active";
  const shielded = options.shieldedEnemyIds ?? ["guard"];
  const profiles = {
    navigation: "flow",
    ...(combat === "active" || combat === "disabled" ? { combat: "shielded" } : {}),
    ...(enemyBehaviors === "active" || enemyBehaviors === "disabled"
      ? { enemyBehaviors: "formations" }
      : {})
  };
  return {
    balance: {
      defaultMissionId: "protection_lab",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 0,
        startingResources: { coins: 0 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {},
      enemies: Object.fromEntries(["guard", "guard_alt", "grunt", "medic"].map((id) => [id, {
        id, label: id, maxHp: 100, speed: 0.1, reward: { coins: 1 }, coinReward: 1,
        coreDamage: 1, color: 1
      }])),
      towers: {
        probe: {
          id: "probe", label: "Probe", cost: { coins: 1 }, footprintRadius: 0, range: 1,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        wave: [{
          id: "wave_1", label: "Wave",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0 }]
        }]
      },
      missions: {
        protection_lab: {
          id: "protection_lab", label: "Protection Lab", description: "",
          startingCoreHp: 20, startingResources: { coins: 0 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "wave", buildTowerIds: ["probe"], abilityIds: [],
          mechanics: { profiles: {
            ...profiles,
            ...(combat === "unselected" ? {} : {}),
            ...(enemyBehaviors === "unselected" ? {} : {})
          } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 7, height: 3, grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 6, r: 1 },
        pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: 1, enabled: true,
          profiles: { flow: {
            mode: "dynamic_flow", defaultMovementProfileId: "ground",
            movementProfiles: { ground: {
              label: "Ground", terrainMode: "respect_walkable", towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            } }
          } }
        },
        ...(combat === "absent" ? {} : { combat: {
          schemaVersion: 1,
          enabled: combat !== "disabled",
          profiles: { shielded: {
            shields: { enemies: Object.fromEntries(shielded.map((id) => [id, { capacity: 50 }])) }
          } }
        } }),
        enemyBehaviors: {
          schemaVersion: 1,
          enabled: enemyBehaviors !== "disabled",
          profiles: { formations: {
            formations: { cohorts: { alpha: {
              members: options.members ?? { guard: "vanguard", grunt: "body", medic: "support" },
              steering: {
                neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1
              },
              protection: options.protection ?? protection()
            } } }
          } }
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
        missionId: "protection_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function validate(options: Options = {}) {
  const content = createGameContentRegistry(input(options));
  return { content, result: validateGameContentRegistry(content) };
}

function normalizer(): (value: unknown) => unknown {
  const fn = (Engine as unknown as {
    normalizeEnemyBehaviorsProfileV1(value: unknown): unknown;
  }).normalizeEnemyBehaviorsProfileV1;
  expect(fn).toBeTypeOf("function");
  return fn;
}

function hasIssue(
  issues: readonly { severity: string; fieldPath?: string; message?: string }[],
  severity: "error" | "warning",
  path: RegExp,
  message: RegExp
): boolean {
  return issues.some((issue) => issue.severity === severity
    && path.test(issue.fieldPath ?? "") && message.test(issue.message ?? ""));
}

describe("R12.4 vanguard protection content contract (RED)", () => {
  it("publishes the exact closed schema and runtime budgets", () => {
    const schema = Engine.ENEMY_BEHAVIORS_MECHANICS_SCHEMA as any;
    expect(schema.formationCohort).toEqual({
      requiredFields: ["members", "steering"],
      optionalFields: ["protection"],
      additionalProperties: false
    });
    expect(schema.formationProtection).toEqual({
      requiredFields: ["radius", "sourceKinds"],
      optionalFields: [],
      additionalProperties: false,
      sourceKinds: ALL_SOURCES
    });
    expect(schema.limits).toMatchObject({
      protectionRadius: 4,
      protectionSourceKinds: 6,
      protectionCandidatesPerPacket: 16,
      protectionTransactionsPerTick: 512
    });
  });

  it("accepts, canonicalizes, detaches, and deeply freezes a valid protected cohort", () => {
    const { result } = validate();
    expect(result).toEqual({ ok: true, issues: [] });
    const authored = {
      formations: { cohorts: { alpha: {
        members: { medic: "support", grunt: "body", guard: "vanguard" },
        steering: { neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1 },
        protection: { radius: 2, sourceKinds: ["enemy", "tower", "reaction"] }
      } } }
    };
    const normalized = normalizer()(authored) as any;
    authored.formations.cohorts.alpha.protection.sourceKinds[0] = "ability";
    expect(normalized.formations.cohorts.alpha.protection).toEqual({
      radius: 2,
      sourceKinds: ["tower", "reaction", "enemy"]
    });
    expect(Object.isFrozen(normalized.formations.cohorts.alpha.protection)).toBe(true);
    expect(Object.isFrozen(normalized.formations.cohorts.alpha.protection.sourceKinds)).toBe(true);
  });

  const malformed: readonly [string, unknown, RegExp][] = [
    ["unknown field", { radius: 2, sourceKinds: ["tower"], extra: true }, /protection.*(closed|unknown).*extra|protection\.extra/i],
    ["missing radius", { sourceKinds: ["tower"] }, /radius|required/i],
    ["missing sources", { radius: 2 }, /sourceKinds|required/i],
    ["radius zero", protection({ radius: 0 }), /radius|1|4|range/i],
    ["radius five", protection({ radius: 5 }), /radius|1|4|range/i],
    ["fractional radius", protection({ radius: 1.5 }), /radius|integer/i],
    ["empty sources", protection({ sourceKinds: [] }), /sourceKinds|empty|1|subset/i],
    ["duplicate source", protection({ sourceKinds: ["tower", "tower"] }), /sourceKinds|duplicate|unique/i],
    ["leak source", { radius: 2, sourceKinds: ["leak"] }, /sourceKinds|leak|unsupported/i],
    ["unknown source", { radius: 2, sourceKinds: ["script"] }, /sourceKinds|script|unsupported/i]
  ];

  for (const [name, value, pattern] of malformed) {
    it(`structurally rejects protection ${name} even while the module is disabled`, () => {
      expect(() => normalizer()({
        formations: { cohorts: { alpha: {
          members: { guard: "vanguard", grunt: "body" },
          steering: { neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1 },
          protection: value
        } } }
      })).toThrow(pattern);
    });
  }

  it("rejects accessor, proxy, sparse, cyclic, and over-budget source arrays without tail reads", () => {
    let reads = 0;
    const accessor = protection();
    Object.defineProperty(accessor, "sourceKinds", {
      enumerable: true,
      get() { reads += 1; return ["tower"]; }
    });
    expect(() => normalizer()({ formations: { cohorts: { alpha: {
      members: { guard: "vanguard", grunt: "body" },
      steering: { neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1 },
      protection: accessor
    } } } })).toThrow(/accessor|own data|sourceKinds/i);
    expect(reads).toBe(0);

    const proxied = new Proxy(protection(), { ownKeys() { throw new Error("hostile proxy"); } });
    expect(() => normalizer()({ formations: { cohorts: { alpha: {
      members: { guard: "vanguard", grunt: "body" },
      steering: { neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1 },
      protection: proxied
    } } } })).toThrow(/inspect|safe|protection/i);

    const sparse = new Array<string>(2);
    sparse[0] = "tower";
    expect(() => normalizer()({ formations: { cohorts: { alpha: {
      members: { guard: "vanguard", grunt: "body" },
      steering: { neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1 },
      protection: { radius: 2, sourceKinds: sparse }
    } } } })).toThrow(/sourceKinds|dense|sparse/i);

    const cyclic: any = protection();
    cyclic.sourceKinds = cyclic;
    expect(() => normalizer()({ formations: { cohorts: { alpha: {
      members: { guard: "vanguard", grunt: "body" },
      steering: { neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1 },
      protection: cyclic
    } } } })).toThrow(/sourceKinds|array|cyclic/i);

    let tailReads = 0;
    const oversized = ["tower", "ability", "tower_script", "status", "reaction", "enemy", "leak"];
    Object.defineProperty(oversized, 6, {
      enumerable: true,
      get() { tailReads += 1; throw new Error("tail"); }
    });
    expect(() => normalizer()({ formations: { cohorts: { alpha: {
      members: { guard: "vanguard", grunt: "body" },
      steering: { neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1 },
      protection: { radius: 2, sourceKinds: oversized }
    } } } })).toThrow(/sourceKinds|6|limit|maximum|budget/i);
    expect(tailReads).toBe(0);
  });

  it("requires at least one vanguard and one protected body or support member", () => {
    const invalidMembers: readonly Readonly<Record<string, "vanguard" | "body" | "support">>[] = [
      { grunt: "body", medic: "support" },
      { guard: "vanguard", guard_alt: "vanguard" }
    ];
    for (const members of invalidMembers) {
      const { result } = validate({ members });
      expect(hasIssue(result.issues, "error", /protection|members|cohorts\.alpha/i, /vanguard|body|support/i))
        .toBe(true);
    }
  });

  it("requires every authored vanguard enemy type to have an active root combat shield", () => {
    for (const options of [
      { combat: "absent" as const },
      { combat: "disabled" as const },
      { combat: "unselected" as const },
      { shieldedEnemyIds: [] as string[] },
      {
        members: { guard: "vanguard" as const, guard_alt: "vanguard" as const, grunt: "body" as const },
        shieldedEnemyIds: ["guard"]
      }
    ]) {
      const { result } = validate(options);
      expect(hasIssue(result.issues, "error", /protection|members|guard|guard_alt/i, /combat|shield|vanguard|active/i))
        .toBe(true);
    }
  });

  it("downgrades semantic dependencies to warnings for disabled or unselected enemyBehaviors", () => {
    for (const enemyBehaviors of ["disabled", "unselected"] as const) {
      const { result } = validate({ enemyBehaviors, combat: "absent" });
      expect(result.ok).toBe(true);
      expect(hasIssue(result.issues, "warning", /protection|members|guard/i, /combat|shield|vanguard|active/i))
        .toBe(true);
    }
  });
});
