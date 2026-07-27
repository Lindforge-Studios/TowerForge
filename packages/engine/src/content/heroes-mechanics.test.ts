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

function movingProfile(overrides: Readonly<Record<string, unknown>> = {}): HeroProfileFixture {
  return {
    selectedHeroId: "commander",
    definitions: {
      commander: {
        label: "Commander",
        spawn: "core",
        movement: { movementProfileId: "ground", speed: 2 }
      }
    },
    movementProfiles: {
      ground: {
        label: "Ground",
        terrainMode: "respect_walkable",
        towerOccupancy: "blocked",
        defaultTerrainCost: 1_000
      }
    },
    ...overrides
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
  it("publishes heroes as implemented with one exact deep-frozen versioned descriptor", () => {
    expect(Engine.IMPLEMENTED_MECHANICS_MODULE_IDS).toContain("heroes");
    const currentSchema = (Engine as unknown as { HEROES_MECHANICS_SCHEMA?: Record<string, any> })
      .HEROES_MECHANICS_SCHEMA!;
    const limits = (Engine as unknown as { HEROES_LIMITS?: unknown }).HEROES_LIMITS;
    expect(limits).toEqual(HEROES_LIMITS_V1);
    expect(currentSchema.schemaVersion).toBe(7);
    expect(currentSchema.supportedModuleSchemaVersions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const { 5: version5, 6: _version6, 7: _version7, ...legacyVersions } = currentSchema.versions;
    const { 5: snapshotVersion5, 6: _snapshotVersion6, 7: _snapshotVersion7, ...legacySnapshotVersions } =
      currentSchema.runtimeSnapshot.versions;
    expect(version5).toEqual({
      ...legacyVersions[4],
      definition: {
        requiredFields: ["label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree"],
        optionalFields: [],
        additionalProperties: false,
        spawnValues: ["core"]
      },
      skillTree: {
        nullable: true,
        requiredFields: ["points", "nodes"],
        optionalFields: [],
        additionalProperties: false
      },
      skillPoints: {
        requiredFields: ["starting", "perInterwave"],
        optionalFields: [],
        additionalProperties: false,
        starting: { integer: true, minimum: 0, maximum: 65_536 },
        perInterwave: { integer: true, minimum: 0, maximum: 65_536 }
      },
      skillNode: {
        requiredFields: ["label", "description", "cost", "requires", "effects"],
        optionalFields: [],
        additionalProperties: false,
        cost: { integer: true, minimum: 1, maximum: 65_536 }
      },
      skillEffect: {
        requiredFields: ["kind", "scope", "modifier"],
        optionalFields: [],
        additionalProperties: false,
        kindValues: ["modifier"],
        scopeValues: ["hero_ability_damage"]
      },
      skillModifier: {
        requiredFields: ["target", "operation", "value"],
        optionalFields: [],
        additionalProperties: false,
        targetValues: ["damage"],
        operationValues: ["flat", "additive_ratio", "multiplier"]
      }
    });
    expect(snapshotVersion5).toEqual({
      ...legacySnapshotVersions[4],
      unitFields: [
        "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility", "skills"
      ],
      skillsFields: [
        "availablePoints", "startingPoints", "pointsPerInterwave", "maximumEarnablePoints",
        "managementAvailable", "nodes"
      ]
    });
    const schema = {
      ...currentSchema,
      schemaVersion: 4,
      supportedModuleSchemaVersions: [1, 2, 3, 4],
      versions: legacyVersions,
      runtimeSnapshot: {
        ...currentSchema.runtimeSnapshot,
        schemaVersions: [1, 2, 3, 4],
        versions: legacySnapshotVersions
      }
    };
    expect(schema).toEqual({
      schemaVersion: 4,
      moduleId: "heroes",
      supportedModuleSchemaVersions: [1, 2, 3, 4],
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
      versions: {
        1: {
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
          }
        },
        2: {
          profile: {
            requiredFields: ["selectedHeroId", "definitions", "movementProfiles"],
            optionalFields: [],
            additionalProperties: false
          },
          definition: {
            requiredFields: ["label", "spawn", "movement"],
            optionalFields: [],
            additionalProperties: false,
            spawnValues: ["core"]
          },
          movement: {
            requiredFields: ["movementProfileId", "speed"],
            optionalFields: [],
            additionalProperties: false,
            speed: { exclusiveMinimum: 0, maximum: 20 }
          },
          movementProfile: {
            requiredFields: ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"],
            optionalFields: ["terrainCosts"],
            additionalProperties: false,
            label: { minLength: 1, maxLength: 128 },
            terrainModeValues: ["respect_walkable", "ignore_walkable"],
            towerOccupancyValues: ["blocked", "ignored"],
            defaultTerrainCost: { integer: true, minimum: 1, maximum: 1_000_000, nullable: true },
            terrainCosts: {
              maximumEntries: 256,
              values: { integer: true, minimum: 1, maximum: 1_000_000, nullable: true }
            }
          }
        },
        3: {
          profile: {
            requiredFields: ["selectedHeroId", "definitions", "movementProfiles"],
            optionalFields: [],
            additionalProperties: false
          },
          definition: {
            requiredFields: ["label", "spawn", "movement", "durability"],
            optionalFields: [],
            additionalProperties: false,
            spawnValues: ["core"]
          },
          movement: {
            requiredFields: ["movementProfileId", "speed"],
            optionalFields: [],
            additionalProperties: false,
            speed: { exclusiveMinimum: 0, maximum: 20 }
          },
          movementProfile: {
            requiredFields: ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"],
            optionalFields: ["terrainCosts"],
            additionalProperties: false,
            label: { minLength: 1, maxLength: 128 },
            terrainModeValues: ["respect_walkable", "ignore_walkable"],
            towerOccupancyValues: ["blocked", "ignored"],
            defaultTerrainCost: { integer: true, minimum: 1, maximum: 1_000_000, nullable: true },
            terrainCosts: {
              maximumEntries: 256,
              values: { integer: true, minimum: 1, maximum: 1_000_000, nullable: true }
            }
          },
          durability: {
            requiredFields: ["maxHp", "shield"],
            optionalFields: [],
            additionalProperties: false,
            maxHp: { exclusiveMinimum: 0, maximum: 1_000_000_000_000 }
          },
          shield: {
            nullable: true,
            requiredFields: ["capacity"],
            optionalFields: [],
            additionalProperties: false,
            capacity: { exclusiveMinimum: 0, maximum: 1_000_000_000_000 }
          }
        },
        4: {
          profile: {
            requiredFields: ["selectedHeroId", "definitions", "movementProfiles"],
            optionalFields: [],
            additionalProperties: false
          },
          definition: {
            requiredFields: ["label", "spawn", "movement", "durability", "mana", "activeAbility"],
            optionalFields: [],
            additionalProperties: false,
            spawnValues: ["core"]
          },
          movement: {
            requiredFields: ["movementProfileId", "speed"],
            optionalFields: [],
            additionalProperties: false,
            speed: { exclusiveMinimum: 0, maximum: 20 }
          },
          movementProfile: {
            requiredFields: ["label", "terrainMode", "towerOccupancy", "defaultTerrainCost"],
            optionalFields: ["terrainCosts"],
            additionalProperties: false,
            label: { minLength: 1, maxLength: 128 },
            terrainModeValues: ["respect_walkable", "ignore_walkable"],
            towerOccupancyValues: ["blocked", "ignored"],
            defaultTerrainCost: { integer: true, minimum: 1, maximum: 1_000_000, nullable: true },
            terrainCosts: {
              maximumEntries: 256,
              values: { integer: true, minimum: 1, maximum: 1_000_000, nullable: true }
            }
          },
          durability: {
            requiredFields: ["maxHp", "shield"],
            optionalFields: [],
            additionalProperties: false,
            maxHp: { exclusiveMinimum: 0, maximum: 1_000_000_000_000 }
          },
          shield: {
            nullable: true,
            requiredFields: ["capacity"],
            optionalFields: [],
            additionalProperties: false,
            capacity: { exclusiveMinimum: 0, maximum: 1_000_000_000_000 }
          },
          mana: {
            requiredFields: ["max", "starting", "regenerationPerUnit"],
            optionalFields: [],
            additionalProperties: false,
            max: { exclusiveMinimum: 0, maximum: 1_000_000_000_000 },
            starting: { minimum: 0, maximumFrom: "mana.max" },
            regenerationPerUnit: { minimum: 0, maximum: 1_000_000_000_000 }
          },
          activeAbility: {
            requiredFields: ["id", "label", "target", "manaCost", "cooldown", "range", "damage"],
            optionalFields: [],
            additionalProperties: false,
            targetValues: ["enemy"],
            manaCost: { exclusiveMinimum: 0, maximumFrom: "mana.max" },
            cooldown: { minimum: 0, maximum: 86_400 },
            range: { integer: true, minimum: 0, maximum: 65_536 },
            damage: { exclusiveMinimum: 0, maximum: 1_000_000_000_000 }
          }
        }
      },
      limits: HEROES_LIMITS_V1,
      runtimeSnapshot: {
        path: "snapshot.heroes",
        schemaVersions: [1, 2, 3, 4],
        optionalUnlessActive: true,
        versions: {
          1: { unitFields: ["id", "definitionId", "label", "coord"] },
          2: {
            unitFields: ["id", "definitionId", "label", "coord", "movement"],
            movementFields: ["targetCoord", "nextCoord", "edgeProgress"]
          },
          3: {
            unitFields: ["id", "definitionId", "label", "coord", "movement", "durability"],
            movementFields: ["targetCoord", "nextCoord", "edgeProgress"],
            durabilityFields: ["hp", "maxHp", "shield", "defeated"]
          },
          4: {
            unitFields: [
              "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility"
            ],
            movementFields: ["targetCoord", "nextCoord", "edgeProgress"],
            durabilityFields: ["hp", "maxHp", "shield", "defeated"],
            manaFields: ["current", "max", "regenerationPerUnit"],
            activeAbilityFields: [
              "id", "label", "target", "manaCost", "cooldown", "cooldownRemaining", "range", "damage", "ready"
            ]
          }
        }
      }
    });
    expect(Object.isFrozen(currentSchema)).toBe(true);
    expect(Object.isFrozen(version5)).toBe(true);
    expect(Object.isFrozen(snapshotVersion5)).toBe(true);
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
      heroesInput({ moduleSchemaVersion: 8 }).mechanics!,
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
    expect(validate({ enabled: false, moduleSchemaVersion: 8 }).ok).toBe(false);
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

describe("R5.1B heroes v2 movement authoring contract (RED)", () => {
  function v2Input(profile: HeroProfileFixture = movingProfile()): GameContentInput {
    const fixture = heroesInput({ profiles: { field_commander: profile } }) as GameContentInput & {
      mechanics: { modules: { heroes: { schemaVersion: number } } };
    };
    fixture.mechanics.modules.heroes.schemaVersion = 2;
    return fixture;
  }

  it("accepts and resolves an exact v2 profile without a navigation module", () => {
    const registry = createGameContentRegistry(v2Input());
    expect(validateGameContentRegistry(registry)).toEqual({ ok: true, issues: [] });
    expect(registry.mechanics.modules).not.toHaveProperty("navigation");
    expect(Engine.HEROES_MECHANICS_SCHEMA.supportedModuleSchemaVersions).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect((Engine as unknown as {
      normalizeHeroesProfileV2?: (input: unknown) => unknown;
    }).normalizeHeroesProfileV2?.(movingProfile())).toEqual(movingProfile());
    expect(Engine.resolveActiveHeroesMechanics(registry, "heroes")).toEqual({
      schemaVersion: 2,
      profileId: "field_commander",
      selectedHeroId: "commander",
      definitions: movingProfile().definitions,
      movementProfiles: movingProfile().movementProfiles
    });
  });

  it.each([
    ["unknown profile field", movingProfile({ extra: true })],
    ["missing movement profiles", {
      selectedHeroId: "commander",
      definitions: movingProfile().definitions
    }],
    ["unknown movement profile reference", movingProfile({
      definitions: {
        commander: {
          label: "Commander", spawn: "core",
          movement: { movementProfileId: "missing", speed: 2 }
        }
      }
    })],
    ["zero speed", movingProfile({
      definitions: {
        commander: {
          label: "Commander", spawn: "core",
          movement: { movementProfileId: "ground", speed: 0 }
        }
      }
    })],
    ["speed over bound", movingProfile({
      definitions: {
        commander: {
          label: "Commander", spawn: "core",
          movement: { movementProfileId: "ground", speed: 20.0001 }
        }
      }
    })]
  ])("rejects the closed bounded v2 shape: %s", (_label, profile) => {
    const result = validateGameContentRegistry(createGameContentRegistry(v2Input(profile)));
    expect(result.ok).toBe(false);
    expect(result.issues.some((candidate) => (
      candidate.severity === "error"
      && /heroes|movement|speed|profile/i.test(`${candidate.fieldPath} ${candidate.message}`)
    ))).toBe(true);
  });

  it("treats v8 as future while preserving v1 validation", () => {
    const future = v2Input();
    (future.mechanics!.modules.heroes as unknown as { schemaVersion: number }).schemaVersion = 8;
    expect(validateGameContentRegistry(createGameContentRegistry(future)).ok).toBe(false);
    expect(validate().ok).toBe(true);
  });

  it("validates hero movement terrain references as active errors and inactive warnings", () => {
    const brokenProfile = movingProfile({
      movementProfiles: {
        ground: {
          label: "Ground",
          terrainMode: "respect_walkable",
          towerOccupancy: "blocked",
          defaultTerrainCost: 1_000,
          terrainCosts: { typo_terrain: 1_000 }
        }
      }
    });
    const active = validateGameContentRegistry(createGameContentRegistry(v2Input(brokenProfile)));
    expect(active.ok).toBe(false);
    expect(issue(active, "error", /heroes.*terrainCosts|terrainCosts/i, /typo_terrain|unknown terrain/i)).toBe(true);

    for (const mode of ["disabled", "unselected"] as const) {
      const input = v2Input(brokenProfile);
      if (mode === "disabled") input.mechanics!.modules.heroes!.enabled = false;
      if (mode === "unselected") delete input.balance.missions.heroes!.mechanics;
      const inactive = validateGameContentRegistry(createGameContentRegistry(input));
      expect(inactive.ok).toBe(true);
      expect(inactive.issues.some((candidate) => candidate.severity === "error")).toBe(false);
      expect(issue(inactive, "warning", /heroes.*terrainCosts|terrainCosts/i, /typo_terrain|unknown terrain|inactive|unselected/i)).toBe(true);
    }
  });

  it("rejects active hero movement maps above the shared navigation cell budget", () => {
    const input = v2Input();
    input.maps.lane!.width = 257;
    input.maps.lane!.height = 256;
    const result = validateGameContentRegistry(createGameContentRegistry(input));
    expect(result.ok).toBe(false);
    expect(issue(result, "error", /heroes|map|dimensions|cells/i, /65,?536|cell|budget|limit|maximum/i)).toBe(true);
  });

  it("rejects an unsafe active hero movement map cell product before runtime allocation", () => {
    const input = v2Input();
    input.maps.lane!.width = Number.MAX_SAFE_INTEGER;
    input.maps.lane!.height = 2;
    const result = validateGameContentRegistry(createGameContentRegistry(input));
    expect(result.ok).toBe(false);
    expect(issue(result, "error", /heroes|map|dimensions|cells/i, /safe integer|cell|budget|limit|maximum/i)).toBe(true);
  });

  it("applies the shared navigation terrain budgets to active hero movement only", () => {
    const defaults = createGameContentRegistry(v2Input()).terrainTypes;
    const extraCount = 257 - Object.keys(defaults).length;
    const tooManyTerrainTypes = {
      ...defaults,
      ...Object.fromEntries(Array.from({ length: extraCount }, (_, index) => {
        const id = `hero_extra_${index}`;
        return [id, {
          id,
          label: `Hero extra ${index}`,
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: []
        }];
      }))
    };
    const active = v2Input();
    active.balance.terrainTypes = tooManyTerrainTypes;
    const activeResult = validateGameContentRegistry(createGameContentRegistry(active));
    expect(activeResult.ok).toBe(false);
    expect(issue(activeResult, "error", /heroes|terrainTypes|terrain/i, /256|definition|budget|limit|maximum/i)).toBe(true);

    const inactive = v2Input();
    inactive.balance.terrainTypes = tooManyTerrainTypes;
    inactive.mechanics!.modules.heroes!.enabled = false;
    expect(validateGameContentRegistry(createGameContentRegistry(inactive))).toEqual({ ok: true, issues: [] });

    const tooManyTags = v2Input();
    tooManyTags.balance.terrainTypes = {
      ...defaults,
      buildable: {
        ...defaults.buildable!,
        tags: Array.from({ length: 65 }, (_, index) => `hero_tag_${index}`)
      }
    };
    const tagsResult = validateGameContentRegistry(createGameContentRegistry(tooManyTags));
    expect(tagsResult.ok).toBe(false);
    expect(issue(tagsResult, "error", /heroes|terrainTypes|terrain|tags/i, /64|tag|budget|limit|maximum/i)).toBe(true);
  });
});
