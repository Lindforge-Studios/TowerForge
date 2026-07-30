import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

type FormationRoleV1Contract = "vanguard" | "body" | "support";

interface FormationSteeringV1Contract {
  readonly neighborRadius: 1 | 2;
  readonly cohesionWeight: number;
  readonly separationWeight: number;
  readonly roleWeight: number;
}

interface FormationProfileV1Contract {
  readonly bosses?: Readonly<Record<string, unknown>>;
  readonly targeting?: Readonly<Record<string, unknown>>;
  readonly formations?: {
    readonly cohorts: Readonly<Record<string, {
      readonly members: Readonly<Record<string, FormationRoleV1Contract>>;
      readonly steering: FormationSteeringV1Contract;
    }>>;
  };
}

type NavigationState = "dynamic_flow" | "authored_routes" | "absent" | "disabled" | "unselected";

interface FixtureOptions {
  readonly profile?: unknown;
  readonly enemyBehaviorsEnabled?: boolean;
  readonly enemyBehaviorsSelected?: boolean;
  readonly navigation?: NavigationState;
}

function steering(overrides: Partial<FormationSteeringV1Contract> = {}): FormationSteeringV1Contract {
  return {
    neighborRadius: 2,
    cohesionWeight: 500,
    separationWeight: 750,
    roleWeight: 250,
    ...overrides
  };
}

function formationOnlyProfile(): FormationProfileV1Contract {
  return {
    formations: {
      cohorts: {
        swarm: {
          members: { grunt: "body", scout: "support" },
          steering: steering()
        },
        shield_wall: {
          members: { tank: "vanguard" },
          steering: steering({ neighborRadius: 1, cohesionWeight: 300, separationWeight: 0, roleWeight: 1_000 })
        }
      }
    }
  };
}

function navigationProfile(mode: "dynamic_flow" | "authored_routes") {
  if (mode === "authored_routes") return { mode };
  return {
    mode,
    defaultMovementProfileId: "ground",
    movementProfiles: {
      ground: {
        label: "Ground",
        terrainMode: "respect_walkable",
        towerOccupancy: "blocked",
        defaultTerrainCost: 1_000
      }
    }
  };
}

function input(options: FixtureOptions = {}): GameContentInput {
  const navigation = options.navigation ?? "dynamic_flow";
  const enemyBehaviorsSelected = options.enemyBehaviorsSelected ?? true;
  const navigationSelected = navigation !== "absent" && navigation !== "unselected";
  const mechanicsProfiles = {
    ...(enemyBehaviorsSelected ? { enemyBehaviors: "formations" } : {}),
    ...(navigationSelected ? { navigation: "flow" } : {})
  };
  const navigationModule = navigation === "absent"
    ? {}
    : {
        navigation: {
          schemaVersion: 1,
          enabled: navigation !== "disabled",
          profiles: {
            flow: navigationProfile(navigation === "authored_routes" ? "authored_routes" : "dynamic_flow")
          }
        }
      };

  return {
    balance: {
      defaultMissionId: "formation_lab",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 1,
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
          id: "grunt", label: "Grunt", maxHp: 10, speed: 0.5,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        scout: {
          id: "scout", label: "Scout", maxHp: 8, speed: 0.75,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2
        },
        tank: {
          id: "tank", label: "Tank", maxHp: 30, speed: 0.25,
          reward: { coins: 2 }, coinReward: 2, coreDamage: 2, color: 3
        }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 5,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 2,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        formation_wave: [{
          id: "formation_wave_1",
          label: "Formation",
          groups: [
            { enemyId: "grunt", count: 2, spawnInterval: 1, startDelay: 0 },
            { enemyId: "scout", count: 1, spawnInterval: 1, startDelay: 0 },
            { enemyId: "tank", count: 1, spawnInterval: 1, startDelay: 0 }
          ]
        }]
      },
      missions: {
        formation_lab: {
          id: "formation_lab",
          label: "Formation Lab",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 1,
          mapId: "lane",
          waveSetId: "formation_wave",
          buildTowerIds: ["pelter"],
          abilityIds: [],
          mechanics: { profiles: mechanicsProfiles }
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 8,
        height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [{
          id: "main",
          pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 }))
        }],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ...navigationModule,
        enemyBehaviors: {
          schemaVersion: 1,
          enabled: options.enemyBehaviorsEnabled ?? true,
          profiles: { formations: options.profile ?? formationOnlyProfile() }
        }
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "formation_lab", regionId: "region", x: 5, y: 5, difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function normalizer(): (value: unknown) => FormationProfileV1Contract {
  const normalize = (Engine as unknown as {
    normalizeEnemyBehaviorsProfileV1?: (value: unknown) => FormationProfileV1Contract;
  }).normalizeEnemyBehaviorsProfileV1;
  expect(normalize).toBeTypeOf("function");
  return normalize!;
}

function validate(options: FixtureOptions = {}): {
  readonly content: GameContentRegistry;
  readonly result: ValidationResult;
} {
  const content = createGameContentRegistry(input(options));
  return { content, result: validateGameContentRegistry(content) };
}

function hasIssue(
  result: ValidationResult,
  severity: "error" | "warning",
  fieldPath: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((candidate) => (
    candidate.severity === severity
    && fieldPath.test(candidate.fieldPath)
    && message.test(candidate.message)
  ));
}

describe("R12.3 group 1 enemyBehaviors formation content contract (RED)", () => {
  it("publishes the closed formation v1 descriptor, roles, and exact budgets", () => {
    const schema = Engine.ENEMY_BEHAVIORS_MECHANICS_SCHEMA as unknown as Record<string, any>;
    const limits = Engine.ENEMY_BEHAVIORS_LIMITS as unknown as Record<string, number>;

    expect(schema.profile).toEqual({
      requiredFields: [],
      optionalFields: ["bosses", "targeting", "formations"],
      atLeastOneFields: ["bosses", "formations"],
      dependencies: { targeting: ["bosses"] },
      additionalProperties: false
    });
    expect(schema.formations).toEqual({
      requiredFields: ["cohorts"], optionalFields: [], additionalProperties: false
    });
    expect(schema.formationCohort).toEqual({
      requiredFields: ["members", "steering"], optionalFields: ["protection"], additionalProperties: false
    });
    expect(schema.formationSteering).toEqual({
      requiredFields: ["neighborRadius", "cohesionWeight", "separationWeight", "roleWeight"],
      optionalFields: [],
      additionalProperties: false
    });
    expect(schema.formationRoles).toEqual(["vanguard", "body", "support"]);
    expect(limits).toMatchObject({
      cohortsPerProfile: 64,
      membersPerCohort: 256,
      formationAssignmentsPerProfile: 4_096,
      neighborRadius: 2,
      steeringWeight: 1_000
    });
  });

  it("accepts a formation-only profile and resolves it with active dynamic-flow navigation", () => {
    const { content, result } = validate();
    expect(result).toEqual({ ok: true, issues: [] });
    const resolved = Engine.resolveActiveEnemyBehaviorsV1(content, "formation_lab") as any;
    expect(resolved).toMatchObject({
      schemaVersion: 1,
      profileId: "formations",
      formations: formationOnlyProfile().formations
    });
    expect(resolved).not.toHaveProperty("bosses");
  });

  it("canonicalizes cohort/member records, detaches input, and deeply freezes the result", () => {
    const authored = formationOnlyProfile() as any;
    authored.formations.cohorts = {
      zeta: { members: { zeta: "support", alpha: "body" }, steering: steering() },
      Alpha: { members: { tank: "vanguard" }, steering: steering({ neighborRadius: 1 }) }
    };
    const reversed = {
      formations: {
        cohorts: {
          Alpha: { steering: steering({ neighborRadius: 1 }), members: { tank: "vanguard" } },
          zeta: { steering: steering(), members: { alpha: "body", zeta: "support" } }
        }
      }
    };

    const normalized = normalizer()(authored) as any;
    const permuted = normalizer()(reversed) as any;
    expect(permuted).toEqual(normalized);
    expect(Object.keys(normalized.formations.cohorts)).toEqual(["Alpha", "zeta"]);
    expect(Object.keys(normalized.formations.cohorts.zeta.members)).toEqual(["alpha", "zeta"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.formations)).toBe(true);
    expect(Object.isFrozen(normalized.formations.cohorts.zeta.members)).toBe(true);
    expect(Object.isFrozen(normalized.formations.cohorts.zeta.steering)).toBe(true);
    authored.formations.cohorts.zeta.members.alpha = "vanguard";
    expect(normalized.formations.cohorts.zeta.members.alpha).toBe("body");
  });

  it("preserves the normalized byte shape of a boss-only v1 profile", () => {
    const bossOnly = {
      bosses: {
        citadel_boss: {
          components: {
            core: {
              maxHp: 20,
              hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.25 }
            }
          }
        }
      }
    };
    const before = JSON.stringify(bossOnly);
    const normalized = normalizer()(bossOnly);

    expect(JSON.stringify(normalized)).toBe(before);
    expect(normalized).not.toHaveProperty("formations");
  });

  it.each([
    ["empty profile", {}],
    ["targeting without bosses", { formations: formationOnlyProfile().formations, targeting: { towers: {} } }],
    ["empty cohorts", { formations: { cohorts: {} } }],
    ["unknown formation field", { ...formationOnlyProfile(), formations: { ...formationOnlyProfile().formations, extra: true } }],
    ["missing members", { formations: { cohorts: { alpha: { steering: steering() } } } }],
    ["unknown cohort field", { formations: { cohorts: { alpha: { members: { grunt: "body" }, steering: steering(), extra: true } } } }],
    ["unknown steering field", { formations: { cohorts: { alpha: { members: { grunt: "body" }, steering: { ...steering(), extra: true } } } } }],
    ["invalid role", { formations: { cohorts: { alpha: { members: { grunt: "leader" }, steering: steering() } } } }],
    ["zero radius", { formations: { cohorts: { alpha: { members: { grunt: "body" }, steering: steering({ neighborRadius: 0 as 1 }) } } } }],
    ["radius above two", { formations: { cohorts: { alpha: { members: { grunt: "body" }, steering: steering({ neighborRadius: 3 as 2 }) } } } }],
    ["fractional weight", { formations: { cohorts: { alpha: { members: { grunt: "body" }, steering: steering({ cohesionWeight: 0.5 }) } } } }],
    ["negative weight", { formations: { cohorts: { alpha: { members: { grunt: "body" }, steering: steering({ separationWeight: -1 }) } } } }],
    ["weight above budget", { formations: { cohorts: { alpha: { members: { grunt: "body" }, steering: steering({ roleWeight: 1_001 }) } } } }],
    ["all weights zero", { formations: { cohorts: { alpha: { members: { grunt: "body" }, steering: steering({ cohesionWeight: 0, separationWeight: 0, roleWeight: 0 }) } } } }],
    ["duplicate enemy across cohorts", {
      formations: {
        cohorts: {
          alpha: { members: { grunt: "body" }, steering: steering() },
          beta: { members: { grunt: "support" }, steering: steering() }
        }
      }
    }],
    ["oversized cohort id", { formations: { cohorts: { ["🔥".repeat(33)]: { members: { grunt: "body" }, steering: steering() } } } }],
    ["oversized enemy id", { formations: { cohorts: { alpha: { members: { ["🔥".repeat(33)]: "body" }, steering: steering() } } } }]
  ])("rejects closed malformed or over-range formations even while disabled: %s", (_label, profile) => {
    expect(() => normalizer()(profile)).toThrow(
      /bosses|formations|targeting|cohort|members|steering|role|radius|weight|integer|0\.\.1000|duplicate|UTF-8|128|closed|required|at least/i
    );
    const result = validate({ profile, enemyBehaviorsEnabled: false }).result;
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/enemyBehaviors|formations|targeting/i)
    }));
  });

  it("rejects accessor, proxy, sparse, and cyclic formation data without invoking authored code", () => {
    let getterCalls = 0;
    const accessor = formationOnlyProfile() as any;
    Object.defineProperty(accessor.formations.cohorts.swarm.members, "grunt", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("SECRET_FORMATION_MEMBER_GETTER");
      }
    });
    expect(() => normalizer()(accessor)).toThrow(/members|grunt|own data|accessor|inspect|formations/i);
    expect(getterCalls).toBe(0);

    const proxy = new Proxy(formationOnlyProfile(), {
      getPrototypeOf() {
        throw new Error("SECRET_FORMATION_PROXY");
      }
    });
    expect(() => normalizer()(proxy)).toThrow(/inspect|plain|proxy|own data/i);

    const sparse = formationOnlyProfile() as any;
    sparse.formations.cohorts.swarm.members = Object.assign(new Array(2), { 1: "body" });
    expect(() => normalizer()(sparse)).toThrow(/members|record|array|plain|sparse|formations/i);

    const cyclic = formationOnlyProfile() as any;
    cyclic.formations.cohorts.swarm.steering.cycle = cyclic;
    expect(() => normalizer()(cyclic)).toThrow(/steering|cycle|closed|unknown|formations/i);
  });

  it("enforces cohort, member, and total-assignment budgets before reading hostile tail values", () => {
    let cohortTailReads = 0;
    const cohorts = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [
      `cohort_${String(index).padStart(2, "0")}`,
      { members: { [`enemy_${index}`]: "body" }, steering: steering() }
    ])) as Record<string, unknown>;
    Object.defineProperty(cohorts, "cohort_64", {
      enumerable: true,
      get() {
        cohortTailReads += 1;
        throw new Error("SECRET_FORMATION_COHORT_TAIL");
      }
    });
    expect(() => normalizer()({ formations: { cohorts } })).toThrow(/cohorts|64|budget|limit|maximum/i);
    expect(cohortTailReads).toBe(0);

    let memberTailReads = 0;
    const members = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [
      `enemy_${String(index).padStart(3, "0")}`,
      "body"
    ])) as Record<string, unknown>;
    Object.defineProperty(members, "enemy_256", {
      enumerable: true,
      get() {
        memberTailReads += 1;
        throw new Error("SECRET_FORMATION_MEMBER_TAIL");
      }
    });
    expect(() => normalizer()({
      formations: { cohorts: { alpha: { members, steering: steering() } } }
    })).toThrow(/members|256|budget|limit|maximum/i);
    expect(memberTailReads).toBe(0);

    let assignmentTailReads = 0;
    const saturated = Object.fromEntries(Array.from({ length: 16 }, (_, cohortIndex) => [
      `cohort_${String(cohortIndex).padStart(2, "0")}`,
      {
        members: Object.fromEntries(Array.from({ length: 256 }, (_, memberIndex) => [
          `enemy_${String(cohortIndex).padStart(2, "0")}_${String(memberIndex).padStart(3, "0")}`,
          "body"
        ])),
        steering: steering()
      }
    ])) as Record<string, any>;
    const hostileMembers = {} as Record<string, unknown>;
    Object.defineProperty(hostileMembers, "enemy_tail", {
      enumerable: true,
      get() {
        assignmentTailReads += 1;
        throw new Error("SECRET_FORMATION_ASSIGNMENT_TAIL");
      }
    });
    saturated.cohort_16 = { members: hostileMembers, steering: steering() };
    expect(() => normalizer()({ formations: { cohorts: saturated } }))
      .toThrow(/assignments|4096|budget|limit|maximum/i);
    expect(assignmentTailReads).toBe(0);
  });

  it.each(["absent", "disabled", "unselected", "authored_routes"] as const)(
    "requires active navigation v1 dynamic_flow for active formations: %s",
    (navigation) => {
      const result = validate({ navigation }).result;
      expect(result.ok).toBe(false);
      expect(hasIssue(
        result,
        "error",
        /enemyBehaviors|formations|navigation/i,
        /active|dynamic.flow|navigation|dependency/i
      )).toBe(true);
    }
  );

  it("validates formation enemy references as active errors and inactive warnings", () => {
    const broken = formationOnlyProfile() as any;
    broken.formations.cohorts.swarm.members.missing_enemy = "body";

    const active = validate({ profile: broken }).result;
    expect(active.ok).toBe(false);
    expect(hasIssue(
      active,
      "error",
      /formations\.cohorts\.swarm\.members\.missing_enemy/,
      /missing_enemy|unknown enemy/i
    )).toBe(true);

    for (const inactive of [
      validate({ profile: broken, enemyBehaviorsEnabled: false, navigation: "absent" }).result,
      validate({ profile: broken, enemyBehaviorsSelected: false, navigation: "absent" }).result
    ]) {
      expect(inactive.ok).toBe(true);
      expect(inactive.issues.some((entry) => entry.severity === "error")).toBe(false);
      expect(hasIssue(
        inactive,
        "warning",
        /enemyBehaviors|formations|navigation|missing_enemy/i,
        /missing_enemy|unknown enemy|dynamic.flow|dependency|inactive|unselected/i
      )).toBe(true);
    }
  });
});
