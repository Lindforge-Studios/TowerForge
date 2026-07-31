import { describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput
} from "./registry.js";
import { IMPLEMENTED_MECHANICS_MODULE_IDS } from "./mechanics.js";
import { validateGameContentRegistry } from "./validate.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";

interface ShieldDefinitionFixture {
  capacity: number;
  regeneration?: {
    ratePerUnit: number;
    delayAfterDamage?: number;
  };
  [key: string]: unknown;
}

interface CombatProfileFixture {
  shields?: {
    enemies?: Record<string, ShieldDefinitionFixture>;
    towers?: Record<string, ShieldDefinitionFixture>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CombatFixtureOptions {
  enabled?: boolean;
  selected?: boolean;
  towerMaxHp?: number;
  moduleSchemaVersion?: number;
}

function combatInput(
  profile: CombatProfileFixture,
  options: CombatFixtureOptions = {}
): GameContentInput {
  const enabled = options.enabled ?? true;
  const selected = options.selected ?? true;
  return {
    balance: {
      defaultMissionId: "combat",
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
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 20, speed: 0.2,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 1 }, footprintRadius: 0, range: 5,
          ...(options.towerMaxHp === undefined ? {} : { maxHp: options.towerMaxHp }),
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 2,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        combat: {
          id: "combat", label: "Combat", description: "", startingCoreHp: 20,
          startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["pelter"], abilityIds: [],
          ...(selected ? { mechanics: { profiles: { combat: "shielded" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 3, defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: (options.moduleSchemaVersion ?? 1) as unknown as 1 | 2,
          enabled,
          profiles: { shielded: profile }
        }
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#fff", biome: "test", connections: []
      }],
      missionNodes: [{
        missionId: "combat", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function validate(profile: CombatProfileFixture, options?: CombatFixtureOptions) {
  const content = createGameContentRegistry(combatInput(profile, options));
  return { content, result: validateGameContentRegistry(content) };
}

describe("combat mechanics profile contract", () => {
  it("keeps combat limits stable after reactions and navigation become independently available", () => {
    expect(IMPLEMENTED_MECHANICS_MODULE_IDS).toEqual([
      "combat", "reactions", "navigation", "elevation", "physics", "ballistics", "weather", "terraforming", "roguelite", "heroes",
      "logistics", "director", "quests", "enemyBehaviors", "multiplayer"
    ]);
    expect((Engine as unknown as { SHIELD_LIMITS?: unknown }).SHIELD_LIMITS).toEqual({
      capacity: 1_000_000_000_000,
      ratePerUnit: 1_000_000_000,
      delayAfterDamage: 1_000_000_000
    });
  });

  it("accepts active empty and fully configured v1 profiles with valid references", () => {
    const empty = validate({});
    expect(empty.result).toMatchObject({ ok: true, issues: [] });
    expect(empty.content.missions.combat!.capabilities.combat).toMatchObject({
      available: true, active: true, reason: "active", profileId: "shielded"
    });

    const configured = validate({
      shields: {
        enemies: {
          grunt: { capacity: 1_000_000_000_000 },
        },
        towers: {
          pelter: {
            capacity: 10,
            regeneration: { ratePerUnit: 2, delayAfterDamage: 0 }
          }
        }
      }
    }, { towerMaxHp: 20 });
    expect(configured.result).toMatchObject({ ok: true, issues: [] });
  });

  it("does not inherit a phantom shield for an authored enemy type named __proto__", () => {
    const input = combatInput({});
    const prototypeNamedEnemy = {
      id: "__proto__", label: "Prototype", maxHp: 20, speed: 0.2,
      reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
    };
    Object.defineProperty(input.balance.enemies, "__proto__", {
      value: prototypeNamedEnemy,
      enumerable: true,
      configurable: true,
      writable: true
    });
    input.balance.waveSets.one![0]!.groups[0]!.enemyId = "__proto__";
    const content = createGameContentRegistry(input);
    expect(validateGameContentRegistry(content)).toMatchObject({ ok: true, issues: [] });

    const game = new TowerDefenseGame({ missionId: "combat", content });
    expect(game.startNextWave().ok).toBe(true);
    game.tick(0.05);

    expect(game.getSnapshot().enemies[0]?.typeId).toBe("__proto__");
    expect(game.getSnapshot()).not.toHaveProperty("combat");
    expect(game.createCheckpoint().state).not.toHaveProperty("combat");
  });

  it.each([
    ["capacity zero", { shields: { enemies: { grunt: { capacity: 0 } } } }],
    ["capacity non-finite", { shields: { enemies: { grunt: { capacity: Number.POSITIVE_INFINITY } } } }],
    ["capacity above cap", { shields: { enemies: { grunt: { capacity: 1_000_000_000_001 } } } }],
    ["regeneration rate zero", { shields: { enemies: { grunt: { capacity: 1, regeneration: { ratePerUnit: 0 } } } } }],
    ["regeneration rate above cap", { shields: { enemies: { grunt: { capacity: 1, regeneration: { ratePerUnit: 1_000_000_001 } } } } }],
    ["negative delay", { shields: { enemies: { grunt: { capacity: 1, regeneration: { ratePerUnit: 1, delayAfterDamage: -1 } } } } }],
    ["delay above cap", { shields: { enemies: { grunt: { capacity: 1, regeneration: { ratePerUnit: 1, delayAfterDamage: 1_000_000_001 } } } } }]
  ] as const)("rejects active %s without clamping", (_label, profile) => {
    const { result } = validate(profile as CombatProfileFixture);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.severity === "error" && /shield|capacity|regeneration/i.test(issue.fieldPath))).toBe(true);
  });

  it.each([
    ["profile", { unexpected: true }],
    ["shields", { shields: { unexpected: true } }],
    ["definition", { shields: { enemies: { grunt: { capacity: 1, unexpected: true } } } }],
    ["regeneration", { shields: { enemies: { grunt: { capacity: 1, regeneration: { ratePerUnit: 1, unexpected: true } } } } }]
  ] as const)("rejects unknown keys in the closed active %s object", (_label, profile) => {
    const { result } = validate(profile as CombatProfileFixture);
    expect(result.ok).toBe(false);
  });

  it("rejects active unknown references and tower shields on indestructible towers", () => {
    const unknownEnemy = validate({ shields: { enemies: { ghost: { capacity: 1 } } } });
    expect(unknownEnemy.result.ok).toBe(false);
    expect(unknownEnemy.result.issues.some((issue) => issue.severity === "error" && issue.fieldPath.includes("ghost"))).toBe(true);

    const unknownTower = validate({ shields: { towers: { ghost: { capacity: 1 } } } }, { towerMaxHp: 20 });
    expect(unknownTower.result.ok).toBe(false);
    expect(unknownTower.result.issues.some((issue) => issue.severity === "error" && issue.fieldPath.includes("ghost"))).toBe(true);

    const indestructibleTower = validate({ shields: { towers: { pelter: { capacity: 1 } } } });
    expect(indestructibleTower.result.ok).toBe(false);
    expect(indestructibleTower.result.issues.some((issue) => issue.severity === "error" && /maxHp|destructible/i.test(issue.message))).toBe(true);
  });

  it.each([
    ["disabled", { enabled: false, selected: true }],
    ["unselected", { enabled: true, selected: false }]
  ] as const)("reports inactive %s semantic problems as warnings", (_label, state) => {
    const { result } = validate(
      { shields: { enemies: { ghost: { capacity: 0 } } } },
      state
    );
    expect(result.ok).toBe(true);
    expect(result.issues.some((issue) => issue.severity === "warning" && /ghost|capacity/.test(issue.fieldPath))).toBe(true);
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("rejects future combat module v4 and malformed closed shapes even when inactive", () => {
    const future = validate({}, { enabled: false, moduleSchemaVersion: 4 });
    expect(future.result.ok).toBe(false);
    expect(future.result.issues.some((issue) => issue.severity === "error" && issue.fieldPath.includes("schemaVersion"))).toBe(true);

    const malformed = validate({ shields: { enemies: { grunt: { capacity: 1, unexpected: true } } } }, { enabled: false });
    expect(malformed.result.ok).toBe(false);
  });

  it("rejects an active malformed profile before map creation but permits disabled semantic bounds", () => {
    const active = validate({ shields: { enemies: { grunt: { capacity: 0 } } } });
    const activeFactory = vi.fn(active.content.missions.combat!.mapFactory);
    Object.defineProperty(active.content.missions.combat!, "mapFactory", { value: activeFactory });
    expect(() => new TowerDefenseGame({ missionId: "combat", content: active.content })).toThrow(/shield|capacity/i);
    expect(activeFactory).not.toHaveBeenCalled();

    const disabled = validate(
      { shields: { enemies: { grunt: { capacity: 0 } } } },
      { enabled: false }
    );
    const disabledFactory = vi.fn(disabled.content.missions.combat!.mapFactory);
    Object.defineProperty(disabled.content.missions.combat!, "mapFactory", { value: disabledFactory });
    expect(() => new TowerDefenseGame({ missionId: "combat", content: disabled.content })).not.toThrow();
    expect(disabledFactory).toHaveBeenCalledTimes(1);
  });

  it("recomputes authored combat activation instead of trusting tampered derived capabilities", () => {
    const active = validate({ shields: { enemies: { grunt: { capacity: 0 } } } });
    (active.content.missions.combat!.capabilities.combat as { active: boolean }).active = false;
    const mapFactory = vi.fn(active.content.missions.combat!.mapFactory);
    Object.defineProperty(active.content.missions.combat!, "mapFactory", { value: mapFactory });

    expect(() => new TowerDefenseGame({ missionId: "combat", content: active.content })).toThrow(/shield|capacity/i);
    expect(mapFactory).not.toHaveBeenCalled();
  });

  it("rejects a non-plain definition whose capacity is inherited", () => {
    const inheritedDefinition = Object.create({ capacity: 10 }) as ShieldDefinitionFixture;
    const { result } = validate({
      shields: { enemies: { grunt: inheritedDefinition } }
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => (
      issue.severity === "error" && issue.fieldPath.includes("shields.enemies.grunt")
    ))).toBe(true);
  });

  it.each(["capacity", "regeneration.ratePerUnit"] as const)(
    "rejects accessor-backed nested %s without invoking or leaking its getter",
    (field) => {
      const getter = vi.fn(() => {
        throw new Error("SYNTHETIC_SECRET_SHIELD_GETTER");
      });
      const definition: Record<string, unknown> = {};
      if (field === "capacity") {
        Object.defineProperty(definition, "capacity", { enumerable: true, get: getter });
      } else {
        definition.capacity = 10;
        const regeneration: Record<string, unknown> = {};
        Object.defineProperty(regeneration, "ratePerUnit", { enumerable: true, get: getter });
        definition.regeneration = regeneration;
      }

      let result: ReturnType<typeof validate>["result"] | undefined;
      let caught: unknown;
      try {
        result = validate({
          shields: {
            enemies: { grunt: definition as ShieldDefinitionFixture }
          }
        }).result;
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
      expect(result?.ok).toBe(false);
      expect(result?.issues.some((issue) => issue.message.includes("SYNTHETIC_SECRET"))).toBe(false);
    }
  );

  it("turns a throwing getPrototypeOf Proxy into a generic mechanics error without reading unrelated getters", () => {
    const unrelatedGetter = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_UNRELATED_GETTER");
    });
    const prototypeTrap = vi.fn(() => {
      throw new Error("SYNTHETIC_SECRET_PROXY_PROTOTYPE");
    });
    const target: Record<string, unknown> = { capacity: 10 };
    Object.defineProperty(target, "unrelated", {
      enumerable: true,
      get: unrelatedGetter
    });
    const hostileDefinition = new Proxy(target, { getPrototypeOf: prototypeTrap });

    let result: ReturnType<typeof validate>["result"] | undefined;
    let caught: unknown;
    try {
      result = validate({
        shields: {
          enemies: { grunt: hostileDefinition as ShieldDefinitionFixture }
        }
      }).result;
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeUndefined();
    expect(prototypeTrap).toHaveBeenCalledTimes(1);
    expect(unrelatedGetter).not.toHaveBeenCalled();
    expect(result?.ok).toBe(false);
    expect(result?.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      entityKind: "mechanics",
      fieldPath: "modules.combat.profiles.shielded.shields.enemies.grunt",
      message: expect.stringMatching(/plain object|inspect/i)
    }));
    expect(result?.issues.some((issue) => issue.message.includes("SYNTHETIC_SECRET"))).toBe(false);
  });

  it("rejects a mechanics catalog schemaVersion other than one", () => {
    const futureInput = combatInput({});
    (futureInput.mechanics as unknown as { schemaVersion: number }).schemaVersion = 2;
    const future = validateGameContentRegistry(createGameContentRegistry(futureInput));
    expect(future.ok).toBe(false);
    expect(future.issues.some((issue) => (
      issue.severity === "error" && issue.fieldPath === "schemaVersion" && issue.entityKind === "mechanics"
    ))).toBe(true);
  });

  it("rejects unknown mechanics module IDs", () => {
    const unknownInput = combatInput({});
    (unknownInput.mechanics!.modules as unknown as Record<string, unknown>).futureCombat = {
      schemaVersion: 1,
      enabled: false,
      profiles: {}
    };
    const unknown = validateGameContentRegistry(createGameContentRegistry(unknownInput));
    expect(unknown.ok).toBe(false);
    expect(unknown.issues.some((issue) => (
      issue.severity === "error" && issue.fieldPath.includes("futureCombat")
    ))).toBe(true);
  });

  it("rejects an enabled mission selection of a missing combat profile", () => {
    const missingInput = combatInput({});
    (missingInput.mechanics!.modules.combat as unknown as { profiles: Record<string, unknown> }).profiles = {
      another: {}
    };
    const missing = validateGameContentRegistry(createGameContentRegistry(missingInput));
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((issue) => (
      issue.severity === "error"
      && issue.entityKind === "mission"
      && issue.fieldPath === "mechanics.profiles.combat"
    ))).toBe(true);
  });
});
