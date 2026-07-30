import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

type Activation = "active" | "disabled" | "unselected" | "absent" | "future";

interface BossComponentV1Contract {
  readonly maxHp: number;
  readonly hitRegion: {
    readonly kind: "circle";
    readonly offsetX: number;
    readonly offsetY: number;
    readonly radius: number;
  };
  readonly label?: string;
  readonly tags?: readonly string[];
  readonly shield?: {
    readonly capacity: number;
    readonly regeneration?: {
      readonly ratePerUnit: number;
      readonly delayAfterDamage?: number;
    };
  };
  readonly armorTypeId?: string;
  readonly disablesAbilities?: readonly ("towerAttack" | "towerDisrupt" | "healAura")[];
}

interface EnemyBehaviorsProfileV1Contract {
  readonly bosses: Readonly<Record<string, {
    readonly components: Readonly<Record<string, BossComponentV1Contract>>;
  }>>;
  readonly targeting?: {
    readonly towers: Readonly<Record<string, {
      readonly priorityTags: readonly string[];
    }>>;
  };
}

interface FixtureOptions {
  readonly activation?: Activation;
  readonly profile?: unknown;
}

function component(overrides: Partial<BossComponentV1Contract> = {}): BossComponentV1Contract {
  return {
    maxHp: 40,
    hitRegion: { kind: "circle", offsetX: -0.3, offsetY: -0.15, radius: 0.24 },
    ...overrides
  };
}

function validProfile(): EnemyBehaviorsProfileV1Contract {
  return {
    bosses: {
      citadel_boss: {
        components: {
          left_cannon: component({
            label: "Left cannon",
            tags: ["weapon"],
            shield: {
              capacity: 15,
              regeneration: { ratePerUnit: 1, delayAfterDamage: 2 }
            },
            armorTypeId: "plate",
            disablesAbilities: ["towerAttack"]
          }),
          shield_core: component({
            label: "Shield core",
            tags: ["shield"],
            hitRegion: { kind: "circle", offsetX: 0.3, offsetY: 0, radius: 0.2 },
            disablesAbilities: ["towerDisrupt"]
          })
        }
      }
    },
    targeting: {
      towers: { pelter: { priorityTags: ["weapon", "shield"] } }
    }
  };
}

function enemyBehaviorsInput(options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const module = activation === "absent"
    ? {}
    : {
        enemyBehaviors: {
          schemaVersion: activation === "future" ? 2 : 1,
          enabled: activation !== "disabled",
          profiles: { bosses: options.profile ?? validProfile() }
        }
      };
  const selectedProfiles = activation === "active" || activation === "disabled" || activation === "future"
    ? { combat: "armored", enemyBehaviors: "bosses" }
    : { combat: "armored" };

  return {
    balance: {
      defaultMissionId: "boss_lab",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 1,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 10,
        pathWaterDurationUnits: 5,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        citadel_boss: {
          id: "citadel_boss",
          label: "Citadel Boss",
          tags: ["boss"],
          maxHp: 500,
          speed: 0.2,
          reward: { coins: 50 },
          coinReward: 50,
          coreDamage: 10,
          color: 0x884444,
          towerAttack: { interval: 2, damage: 5, range: 3 },
          towerDisrupt: { interval: 4, radius: 2, duration: 1 },
          healAura: { radius: 2, healPerUnit: 1 }
        }
      },
      towers: {
        pelter: {
          id: "pelter",
          label: "Pelter",
          cost: { coins: 5 },
          footprintRadius: 0,
          range: 5,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: 5,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 5
          }
        }
      },
      waveSets: {
        boss_wave: [{
          id: "boss_wave_1",
          label: "Boss",
          groups: [{ enemyId: "citadel_boss", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        boss_lab: {
          id: "boss_lab",
          label: "Boss Lab",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 1,
          mapId: "lane",
          waveSetId: "boss_wave",
          buildTowerIds: ["pelter"],
          abilityIds: [],
          mechanics: { profiles: selectedProfiles }
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 7,
        height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 6, r: 1 },
        pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 2,
          enabled: true,
          profiles: {
            armored: {
              damageTypes: { physical: { label: "Physical" } },
              armorTypes: {
                plate: { label: "Plate", defaultMultiplier: 1, multipliers: { physical: 0.75 } }
              }
            }
          }
        },
        ...module
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
        accent: "#884444",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "boss_lab",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function registry(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(enemyBehaviorsInput(options));
}

function validate(options: FixtureOptions = {}): ValidationResult {
  return validateGameContentRegistry(registry(options));
}

function issue(
  result: ValidationResult,
  severity: "error" | "warning",
  fieldPath: RegExp,
  message: RegExp
): boolean {
  return result.issues.some((entry) => (
    entry.severity === severity
    && fieldPath.test(entry.fieldPath)
    && message.test(entry.message)
  ));
}

function normalizer(): (value: unknown) => EnemyBehaviorsProfileV1Contract {
  const normalize = (Engine as unknown as {
    normalizeEnemyBehaviorsProfileV1?: (value: unknown) => EnemyBehaviorsProfileV1Contract;
  }).normalizeEnemyBehaviorsProfileV1;
  expect(normalize, "R12.1 must export the closed EnemyBehaviorsProfileV1 normalizer")
    .toBeTypeOf("function");
  return normalize!;
}

describe("R12.1 enemyBehaviors v1 boss-component content contract (RED)", () => {
  it("publishes an implemented opt-in capability with a closed descriptor", () => {
    expect(Engine.MECHANICS_MODULE_IDS).toContain("enemyBehaviors");
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("enemyBehaviors");

    const exports = Engine as unknown as {
      ENEMY_BEHAVIORS_LIMITS?: unknown;
      ENEMY_BEHAVIORS_MECHANICS_SCHEMA?: unknown;
    };
    expect(exports.ENEMY_BEHAVIORS_LIMITS).toMatchObject({ componentsPerRoot: 32 });
    expect(exports.ENEMY_BEHAVIORS_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 1,
      moduleId: "enemyBehaviors",
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: [],
        optionalFields: ["bosses", "targeting", "formations"],
        atLeastOneFields: ["bosses", "formations"],
        dependencies: { targeting: ["bosses"] },
        additionalProperties: false
      },
      boss: {
        requiredFields: ["components"],
        optionalFields: [],
        additionalProperties: false
      },
      component: {
        requiredFields: ["maxHp", "hitRegion"],
        optionalFields: ["label", "tags", "shield", "armorTypeId", "disablesAbilities"],
        additionalProperties: false
      },
      hitRegion: {
        kinds: ["circle"],
        requiredFields: ["kind", "offsetX", "offsetY", "radius"],
        optionalFields: [],
        additionalProperties: false
      },
      disablesAbilities: ["towerAttack", "towerDisrupt", "healAura"],
      targeting: {
        requiredFields: ["towers"],
        optionalFields: [],
        additionalProperties: false,
        towerBinding: {
          requiredFields: ["priorityTags"],
          optionalFields: [],
          additionalProperties: false
        }
      }
    });
  });

  it("resolves active, disabled, unselected, absent, and future states without implicit activation", () => {
    expect(validate()).toEqual({ ok: true, issues: [] });
    expect((registry().missions.boss_lab!.capabilities as any).enemyBehaviors).toEqual({
      moduleId: "enemyBehaviors",
      available: true,
      moduleEnabled: true,
      active: true,
      profileId: "bosses",
      reason: "active"
    });
    expect((registry({ activation: "disabled" }).missions.boss_lab!.capabilities as any).enemyBehaviors)
      .toMatchObject({ available: true, active: false, reason: "module_disabled" });
    expect((registry({ activation: "unselected" }).missions.boss_lab!.capabilities as any).enemyBehaviors)
      .toMatchObject({ available: true, active: false, reason: "not_selected" });
    expect((registry({ activation: "absent" }).missions.boss_lab!.capabilities as any).enemyBehaviors)
      .toMatchObject({ available: true, active: false, reason: "module_missing" });
    expect((registry({ activation: "future" }).missions.boss_lab!.capabilities as any).enemyBehaviors)
      .toMatchObject({ available: true, active: false, reason: "module_version_unsupported" });
    expect(issue(
      validate({ activation: "future" }),
      "error",
      /modules\.enemyBehaviors\.schemaVersion/,
      /future|supported|version|1/i
    )).toBe(true);
  });

  it("normalizes detached binary-ordered deeply frozen own data", () => {
    const authored = structuredClone(validProfile()) as any;
    authored.bosses.zeta = { components: { zeta: component({ tags: ["zeta", "alpha"] }) } };
    authored.bosses.Alpha = { components: { Zeta: component(), alpha: component() } };
    const normalized = normalizer()(authored);

    expect(Object.keys(normalized.bosses)).toEqual(["Alpha", "citadel_boss", "zeta"]);
    expect(Object.keys(normalized.bosses.Alpha!.components)).toEqual(["Zeta", "alpha"]);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.bosses)).toBe(true);
    expect(Object.isFrozen(normalized.bosses.Alpha!.components)).toBe(true);
    expect(Object.isFrozen(normalized.bosses.Alpha!.components.alpha!.hitRegion)).toBe(true);
    expect(Object.isFrozen(normalized.targeting?.towers.pelter!.priorityTags)).toBe(true);

    authored.bosses.citadel_boss.components.left_cannon.maxHp = 999;
    authored.targeting.towers.pelter.priorityTags[0] = "mutated";
    expect(normalized.bosses.citadel_boss!.components.left_cannon!.maxHp).toBe(40);
    expect(normalized.targeting?.towers.pelter!.priorityTags).toEqual(["weapon", "shield"]);
  });

  it("rejects closed, accessor, proxy, sparse, cyclic, and symbol-backed hostile input without invoking code", () => {
    const normalize = normalizer();
    expect(() => normalize({ ...validProfile(), hostHook: "forbidden" }))
      .toThrow(/hostHook|closed|unknown/i);

    const accessor = structuredClone(validProfile()) as any;
    let reads = 0;
    Object.defineProperty(accessor.bosses.citadel_boss.components.left_cannon, "maxHp", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("SECRET_R12_ACCESSOR_PAYLOAD");
      }
    });
    expect(() => normalize(accessor)).toThrow(/maxHp|own data|accessor|inspect/i);
    expect(reads).toBe(0);

    const proxy = new Proxy(validProfile(), {
      getPrototypeOf() {
        throw new Error("SECRET_R12_PROXY_PAYLOAD");
      }
    });
    expect(() => normalize(proxy)).toThrow(/inspect|plain|proxy|own data/i);

    const sparse = structuredClone(validProfile()) as any;
    sparse.bosses.citadel_boss.components = Object.assign(new Array(2), { 1: component() });
    expect(() => normalize(sparse)).toThrow(/components|record|array|plain|sparse/i);

    const cyclic = structuredClone(validProfile()) as any;
    cyclic.bosses.citadel_boss.components.left_cannon.hitRegion.cycle = cyclic;
    expect(() => normalize(cyclic)).toThrow(/hitRegion|cycle|closed|unknown|plain/i);

    const symbol = structuredClone(validProfile()) as any;
    symbol.bosses.citadel_boss.components.left_cannon[Symbol("hidden")] = true;
    expect(() => normalize(symbol)).toThrow(/symbol/i);
  });

  it("enforces the 32-component budget before traversing hostile excess data and validates disabled structure", () => {
    const normalize = normalizer();
    const exactComponents = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [
      `component_${String(index).padStart(2, "0")}`,
      component()
    ]));
    expect(Object.keys(normalize({ bosses: { citadel_boss: { components: exactComponents } } }).bosses.citadel_boss!.components))
      .toHaveLength(32);

    let tailReads = 0;
    const overBudgetComponents = { ...exactComponents } as Record<string, unknown>;
    Object.defineProperty(overBudgetComponents, "component_32", {
      enumerable: true,
      get() {
        tailReads += 1;
        throw new Error("SECRET_R12_OVER_BUDGET_TAIL");
      }
    });
    expect(() => normalize({ bosses: { citadel_boss: { components: overBudgetComponents } } }))
      .toThrow(/components|32|limit|maximum|budget/i);
    expect(tailReads).toBe(0);

    const malformed = structuredClone(validProfile()) as any;
    malformed.bosses.citadel_boss.components.left_cannon.hostHook = true;
    const disabled = validate({ activation: "disabled", profile: malformed });
    expect(disabled.ok).toBe(false);
    expect(issue(
      disabled,
      "error",
      /modules\.enemyBehaviors\.profiles\.bosses\.bosses\.citadel_boss\.components\.left_cannon\.hostHook/,
      /closed|unknown|unsupported/i
    )).toBe(true);
  });

  it("downgrades only semantic cross-references while inactive and fails closed at the active resolver", () => {
    const cases: readonly {
      readonly label: string;
      readonly mutateProfile?: (profile: any) => void;
      readonly mutateInput?: (input: GameContentInput) => void;
      readonly fieldPath: RegExp;
      readonly message: RegExp;
    }[] = [
      {
        label: "root enemy",
        mutateProfile(profile) {
          profile.bosses.missing_boss = profile.bosses.citadel_boss;
          delete profile.bosses.citadel_boss;
        },
        fieldPath: /bosses\.missing_boss/,
        message: /unknown|missing_boss|enemy/i
      },
      {
        label: "component armor",
        mutateProfile(profile) {
          profile.bosses.citadel_boss.components.left_cannon.armorTypeId = "missing_armor";
        },
        fieldPath: /components\.left_cannon\.armorTypeId/,
        message: /missing_armor|unknown|armor/i
      },
      {
        label: "typed boss ability",
        mutateInput(input) {
          delete (input.balance.enemies.citadel_boss as any).towerAttack;
        },
        fieldPath: /components\.left_cannon\.disablesAbilities/,
        message: /towerAttack|ability|unavailable|missing/i
      },
      {
        label: "tower targeting priority tag",
        mutateProfile(profile) {
          profile.targeting.towers.pelter.priorityTags = ["missing_tag"];
        },
        fieldPath: /targeting\.towers\.pelter\.priorityTags/,
        message: /missing_tag|unknown|component|tag/i
      }
    ];

    for (const testCase of cases) {
      for (const activation of ["active", "disabled", "unselected"] as const) {
        const profile = structuredClone(validProfile()) as any;
        testCase.mutateProfile?.(profile);
        const input = enemyBehaviorsInput({ activation, profile });
        testCase.mutateInput?.(input);
        const result = validateGameContentRegistry(createGameContentRegistry(input));
        const severity = activation === "active" ? "error" : "warning";
        expect(
          issue(result, severity, testCase.fieldPath, testCase.message),
          `${testCase.label} must be an active error and an inactive warning (${activation})`
        ).toBe(true);
        if (activation === "active") expect(result.ok).toBe(false);
        else {
          expect(result.ok).toBe(true);
          expect(result.issues.some((entry) => entry.severity === "error")).toBe(false);
        }
      }
    }

    const resolve = (Engine as unknown as {
      resolveActiveEnemyBehaviorsV1?: (
        content: GameContentRegistry,
        missionId: string
      ) => (EnemyBehaviorsProfileV1Contract & { readonly schemaVersion: 1; readonly profileId: string }) | undefined;
    }).resolveActiveEnemyBehaviorsV1;
    expect(resolve, "R12.1 must export a fail-closed active enemyBehaviors resolver").toBeTypeOf("function");
    if (!resolve) return;

    const resolved = resolve(registry(), "boss_lab");
    expect(resolved).toMatchObject({ schemaVersion: 1, profileId: "bosses", bosses: validProfile().bosses });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved?.bosses)).toBe(true);
    for (const activation of ["disabled", "unselected", "absent", "future"] as const) {
      expect(resolve(registry({ activation }), "boss_lab")).toBeUndefined();
    }
  });

  it.each(["active", "disabled", "unselected"] as const)(
    "validates component armor against only the mission-selected Combat profile (%s)",
    (activation) => {
      const input = enemyBehaviorsInput({ activation });
      const mechanics = input.mechanics as any;
      mechanics.modules.combat.profiles = {
        selected_without_plate: {
          damageTypes: { physical: { label: "Physical" } },
          armorTypes: {}
        },
        unrelated_with_plate: {
          damageTypes: { physical: { label: "Physical" } },
          armorTypes: {
            plate: { label: "Plate", defaultMultiplier: 1, multipliers: { physical: 0.75 } }
          }
        }
      };
      (input.balance.missions.boss_lab as any).mechanics.profiles.combat = "selected_without_plate";

      const result = validateGameContentRegistry(createGameContentRegistry(input));
      const expectedSeverity = activation === "active" ? "error" : "warning";
      const armorIssues = result.issues.filter((entry) => (
        entry.fieldPath
          === "modules.enemyBehaviors.profiles.bosses.bosses.citadel_boss.components.left_cannon.armorTypeId"
        && /plate|armor|selected|combat/i.test(entry.message)
      ));
      expect(armorIssues).toEqual([
        expect.objectContaining({ severity: expectedSeverity })
      ]);
      expect(result.ok).toBe(activation !== "active");
    }
  );
});
