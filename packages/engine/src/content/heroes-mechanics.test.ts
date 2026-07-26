import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "./registry.js";
import { validateGameContentRegistry, type ValidationResult } from "./validate.js";

const HEROES_LIMITS_V1 = Object.freeze({
  definitions: 32,
  idUtf8Bytes: 128,
  labelUtf8Bytes: 128
});

type HeroProfileFixture = Readonly<Record<string, unknown>>;

interface FixtureOptions {
  readonly enabled?: boolean;
  readonly selected?: boolean;
  readonly profileId?: string;
  readonly moduleSchemaVersion?: number;
  readonly profiles?: Readonly<Record<string, HeroProfileFixture>>;
}

function validProfile(): HeroProfileFixture {
  return {
    selectedHeroId: "commander",
    definitions: {
      commander: { label: "Commander", spawn: "core" }
    }
  };
}

function heroesInput(options: FixtureOptions = {}): GameContentInput {
  const profileId = options.profileId ?? "field_commander";
  return {
    balance: {
      defaultMissionId: "heroes",
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
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 20, speed: 0.2,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        pelter: {
          id: "pelter", label: "Pelter", cost: { coins: 1 }, footprintRadius: 0,
          range: 3,
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
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
        heroes: {
          id: "heroes", label: "Heroes", description: "", startingCoreHp: 20,
          startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["pelter"], abilityIds: [],
          ...(options.selected === false ? {} : {
            mechanics: { profiles: { heroes: profileId } }
          })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 4, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 3, r: 1 },
        pathCenterline: Array.from({ length: 4 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        heroes: {
          schemaVersion: (options.moduleSchemaVersion ?? 1) as 1,
          enabled: options.enabled ?? true,
          profiles: options.profiles ?? { [profileId]: validProfile() }
        }
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#ffffff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "heroes", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(heroesInput(options));
}

function validate(options: FixtureOptions = {}): ValidationResult {
  return validateGameContentRegistry(content(options));
}

function issue(
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

function selfRevokingOnLastDescriptor<T extends object>(target: T): T {
  const lastKey = Reflect.ownKeys(target).at(-1);
  let revoke = () => {};
  const revocable = Proxy.revocable(target, {
    getOwnPropertyDescriptor(subject, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(subject, key);
      if (key === lastKey) revoke();
      return descriptor;
    }
  });
  revoke = revocable.revoke;
  return revocable.proxy;
}

describe("R5.1A static heroes v1 authoring contract", () => {
  it("publishes heroes as implemented with one exact deep-frozen v1 descriptor", () => {
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("heroes");
    const schema = (Engine as unknown as { HEROES_MECHANICS_SCHEMA?: unknown }).HEROES_MECHANICS_SCHEMA;
    const limits = (Engine as unknown as { HEROES_LIMITS?: unknown }).HEROES_LIMITS;
    expect(limits).toEqual(HEROES_LIMITS_V1);
    expect(schema).toEqual({
      schemaVersion: 1,
      moduleId: "heroes",
      supportedModuleSchemaVersions: [1],
      profile: {
        requiredFields: ["selectedHeroId", "definitions"],
        optionalFields: [],
        additionalProperties: false
      },
      definition: {
        requiredFields: ["label", "spawn"],
        optionalFields: [],
        additionalProperties: false,
        spawnValues: ["core"]
      },
      limits: HEROES_LIMITS_V1,
      runtimeSnapshot: {
        path: "snapshot.heroes",
        schemaVersion: 1,
        optionalUnlessActive: true,
        unitFields: ["id", "definitionId", "label", "coord"]
      }
    });
    expect(Object.isFrozen(schema)).toBe(true);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it("resolves absent, disabled, unselected, missing-profile, future, unavailable, and active states", () => {
    expect(Engine.resolveCapabilitySet({ schemaVersion: 1, modules: {} }).heroes)
      .toMatchObject({ available: true, active: false, reason: "module_missing" });
    const catalog = heroesInput().mechanics!;
    expect(Engine.resolveCapabilitySet(catalog, {}).heroes)
      .toMatchObject({ available: true, active: false, reason: "not_selected" });
    expect(Engine.resolveCapabilitySet(catalog, { profiles: { heroes: "missing" } }).heroes)
      .toMatchObject({ available: true, active: false, reason: "profile_missing" });
    expect(Engine.resolveCapabilitySet(
      heroesInput({ enabled: false }).mechanics!,
      { profiles: { heroes: "field_commander" } }
    ).heroes).toMatchObject({ available: true, active: false, reason: "module_disabled" });
    expect(Engine.resolveCapabilitySet(
      heroesInput({ moduleSchemaVersion: 2 }).mechanics!,
      { profiles: { heroes: "field_commander" } }
    ).heroes).toMatchObject({ available: true, active: false, reason: "module_version_unsupported" });
    expect(Engine.resolveCapabilitySet(
      catalog,
      { profiles: { heroes: "field_commander" } },
      Engine.IMPLEMENTED_MECHANICS_MODULE_IDS.filter((id) => id !== "heroes")
    ).heroes).toMatchObject({ available: false, active: false, reason: "module_unavailable" });
    expect(Engine.resolveCapabilitySet(catalog, { profiles: { heroes: "field_commander" } }).heroes)
      .toEqual({
        moduleId: "heroes", available: true, moduleEnabled: true,
        active: true, profileId: "field_commander", reason: "active"
      });
  });

  it("accepts and resolves a detached frozen roster whose selected ID is an own definition", () => {
    expect(validate()).toMatchObject({ ok: true, issues: [] });
    const resolve = (Engine as unknown as {
      resolveActiveHeroesMechanics?: (content: GameContentRegistry, missionId: string) => unknown;
    }).resolveActiveHeroesMechanics;
    expect(resolve).toBeTypeOf("function");
    const active = resolve!(content(), "heroes") as {
      schemaVersion: number;
      profileId: string;
      selectedHeroId: string;
      definitions: Record<string, { label: string; spawn: string }>;
    };
    expect(active).toEqual({
      schemaVersion: 1,
      profileId: "field_commander",
      selectedHeroId: "commander",
      definitions: { commander: { label: "Commander", spawn: "core" } }
    });
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active.definitions)).toBe(true);
    expect(Object.isFrozen(active.definitions.commander)).toBe(true);
  });

  it.each([
    ["missing selectedHeroId", { definitions: { commander: { label: "Commander", spawn: "core" } } }],
    ["missing definitions", { selectedHeroId: "commander" }],
    ["unknown profile field", { ...validProfile(), extra: true }],
    ["unknown definition field", { selectedHeroId: "commander", definitions: { commander: { label: "Commander", spawn: "core", hp: 10 } } }],
    ["empty label", { selectedHeroId: "commander", definitions: { commander: { label: "", spawn: "core" } } }],
    ["unsupported spawn", { selectedHeroId: "commander", definitions: { commander: { label: "Commander", spawn: "spawn" } } }]
  ])("rejects the closed structural shape: %s", (_name, profile) => {
    const result = validate({ profiles: { field_commander: profile as HeroProfileFixture } });
    expect(result.ok).toBe(false);
    expect(issue(result, "error", /heroes|field_commander|definition|selectedHeroId/i, /required|unknown|closed|label|spawn|core/i))
      .toBe(true);
  });

  it("enforces 1..32 definitions and 128 real UTF-8 bytes for IDs and labels", () => {
    const exact = Object.fromEntries(Array.from({ length: 32 }, (_, index) => [
      `hero_${index}`,
      { label: `Hero ${index}`, spawn: "core" }
    ]));
    expect(validate({
      profiles: { field_commander: { selectedHeroId: "hero_0", definitions: exact } }
    }).issues.some((candidate) => candidate.severity === "error")).toBe(false);

    const cases: HeroProfileFixture[] = [
      { selectedHeroId: "commander", definitions: {} },
      {
        selectedHeroId: "hero_0",
        definitions: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [
          `hero_${index}`, { label: `Hero ${index}`, spawn: "core" }
        ]))
      },
      {
        selectedHeroId: "ж".repeat(65),
        definitions: { ["ж".repeat(65)]: { label: "Commander", spawn: "core" } }
      },
      {
        selectedHeroId: "commander",
        definitions: { commander: { label: "ж".repeat(65), spawn: "core" } }
      }
    ];
    for (const profile of cases) {
      const result = validate({ profiles: { field_commander: profile } });
      expect(result.ok).toBe(false);
      expect(issue(result, "error", /heroes|definitions|label|selectedHeroId/i, /1|32|128|UTF-8|limit|maximum|non-empty/i))
        .toBe(true);
    }
  });

  it("reports a missing selected own reference as error only while active", () => {
    const broken = {
      selectedHeroId: "ghost",
      definitions: { commander: { label: "Commander", spawn: "core" } }
    };
    const active = validate({ profiles: { field_commander: broken } });
    expect(active.ok).toBe(false);
    expect(issue(active, "error", /selectedHeroId|heroes/i, /ghost|missing|definition|unknown/i)).toBe(true);

    for (const inactive of [
      validate({ enabled: false, profiles: { field_commander: broken } }),
      validate({ selected: false, profiles: { field_commander: broken } })
    ]) {
      expect(inactive.issues.some((candidate) => candidate.severity === "error")).toBe(false);
      expect(issue(inactive, "warning", /selectedHeroId|heroes/i, /ghost|missing|inactive|unselected/i)).toBe(true);
    }
  });

  it("rejects future versions and accessor/prototype-backed authored values without invoking them", () => {
    expect(validate({ enabled: false, moduleSchemaVersion: 2 }).ok).toBe(false);
    let calls = 0;
    const hostileDefinition = Object.defineProperty({}, "label", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("SYNTHETIC_HERO_SECRET");
      }
    });
    const hostile = {
      selectedHeroId: "commander",
      definitions: { commander: hostileDefinition }
    };
    const result = validate({ enabled: false, profiles: { field_commander: hostile } });
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_HERO_SECRET");

    const inherited = Object.create({ commander: { label: "Inherited", spawn: "core" } });
    const inheritedResult = validate({
      profiles: { field_commander: { selectedHeroId: "commander", definitions: inherited } }
    });
    expect(inheritedResult.ok).toBe(false);
    expect(issue(inheritedResult, "error", /definitions|selectedHeroId|heroes/i, /own|plain|missing|unknown/i))
      .toBe(true);
  });

  it("wraps a self-revoking profile inspection as HeroesProfileValidationError", () => {
    const hostile = selfRevokingOnLastDescriptor({
      selectedHeroId: "commander",
      definitions: { commander: { label: "Commander", spawn: "core" } }
    });
    let caught: unknown;
    try {
      Engine.normalizeHeroesProfileV1(hostile);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Engine.HeroesProfileValidationError);
    expect(caught).toMatchObject({
      name: "HeroesProfileValidationError",
      fieldPath: "profile",
      message: expect.stringMatching(/inspect.*safe/i)
    });
    expect(caught).not.toBeInstanceOf(TypeError);
    expect(String(caught)).not.toMatch(/IsArray|revoked/i);
  });

  it.each([
    ["module", (registry: GameContentRegistry) => {
      const modules = registry.mechanics.modules as unknown as Record<string, unknown>;
      modules.heroes = selfRevokingOnLastDescriptor({
        schemaVersion: 1,
        enabled: true,
        profiles: { field_commander: validProfile() }
      });
    }],
    ["profile", (registry: GameContentRegistry) => {
      const module = registry.mechanics.modules.heroes as unknown as {
        profiles: Record<string, unknown>;
      };
      module.profiles.field_commander = selfRevokingOnLastDescriptor({
        selectedHeroId: "commander",
        definitions: { commander: { label: "Commander", spawn: "core" } }
      });
    }]
  ] as const)("turns a self-revoking heroes %s into a safe-inspection validation issue", (_kind, poison) => {
    const registry = content();
    poison(registry);
    let result: ValidationResult | undefined;
    expect(() => { result = validateGameContentRegistry(registry); }).not.toThrow();
    expect(result?.ok).toBe(false);
    expect(result?.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/heroes/i),
      message: expect.stringMatching(/inspect.*safe/i)
    }));
    expect(JSON.stringify(result)).not.toMatch(/IsArray|revoked/i);
  });
});
