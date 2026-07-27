import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

const BLOCK_CAPACITY_MAX = 64;
const BLOCK_PROFILE_IDS_MAX = 32;

function blocking(
  blockCapacity = 2,
  movementProfileIds: unknown = ["ground"]
): Record<string, unknown> {
  return { blockCapacity, movementProfileIds };
}

function heroDefinition(blockingValue: unknown = blocking()): Record<string, unknown> {
  return {
    label: "Commander",
    spawn: "core",
    movement: { movementProfileId: "hero_ground", speed: 5 },
    durability: { maxHp: 100, shield: null },
    mana: { max: 100, starting: 100, regenerationPerUnit: 0 },
    activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy",
      manaCost: 10, cooldown: 0, range: 8, damage: 10
    },
    skillTree: null,
    passiveAura: null,
    blocking: blockingValue
  };
}

type NavigationMode = "dynamic_flow" | "authored_routes" | "absent" | "disabled" | "unselected";

function input(options: {
  readonly version?: number;
  readonly blocking?: unknown;
  readonly heroesEnabled?: boolean;
  readonly heroesSelected?: boolean;
  readonly navigation?: NavigationMode;
  readonly navigationProfileIds?: readonly string[];
} = {}): GameContentInput {
  const version = options.version ?? 7;
  const definition = heroDefinition(options.blocking === undefined ? blocking() : options.blocking);
  if (version === 6) delete definition.blocking;
  const reserveDefinition: Record<string, unknown> = { ...heroDefinition(null), label: "Reserve" };
  if (version === 6) delete reserveDefinition.blocking;
  const navigationMode = options.navigation ?? "dynamic_flow";
  const profileIds = options.navigationProfileIds ?? ["ground", "burrow", "air"];
  const movementProfiles = Object.fromEntries(profileIds.map((id) => [id, {
    label: id,
    terrainMode: id === "air" ? "ignore_walkable" : "respect_walkable",
    towerOccupancy: id === "ground" ? "blocked" : "ignored",
    defaultTerrainCost: 1_000
  }]));
  const missionProfiles: Record<string, string> = {};
  if (options.heroesSelected !== false) missionProfiles.heroes = "commanders";
  if (navigationMode !== "absent" && navigationMode !== "unselected") missionProfiles.navigation = "maze";

  const modules: Record<string, unknown> = {
    heroes: {
      schemaVersion: version,
      enabled: options.heroesEnabled ?? true,
      profiles: {
        commanders: {
          selectedHeroId: "commander",
          definitions: {
            commander: definition,
            reserve: reserveDefinition
          },
          movementProfiles: {
            hero_ground: {
              label: "Hero ground", terrainMode: "respect_walkable",
              towerOccupancy: "blocked", defaultTerrainCost: 1_000
            }
          }
        }
      }
    }
  };
  if (navigationMode !== "absent") {
    modules.navigation = {
      schemaVersion: 1,
      enabled: navigationMode !== "disabled",
      profiles: {
        maze: navigationMode === "authored_routes"
          ? { mode: "authored_routes" }
          : {
              mode: "dynamic_flow",
              defaultMovementProfileId: profileIds[0] ?? "ground",
              movementProfiles,
              enemyMovementProfiles: { walker: profileIds[0] ?? "ground" }
            }
      }
    };
  }
  return {
    balance: {
      defaultMissionId: "hero_block",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 20,
        startingResources: { coins: 20 }, prepTimeUnits: 0,
        moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1,
        pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 100, speed: 1,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {
        probe: {
          id: "probe", label: "Probe", cost: { coins: 1 }, footprintRadius: 0, range: 1,
          attack: {
            kind: "single", fireRate: 0.01, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave", label: "Wave",
          groups: [{ enemyId: "walker", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
        }]
      },
      missions: {
        hero_block: {
          id: "hero_block", label: "Hero block", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["probe"], abilityIds: [],
          ...(Object.keys(missionProfiles).length === 0 ? {} : { mechanics: { profiles: missionProfiles } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 5, height: 3,
        grid: { kind: "square", adjacency: "cardinal" }, defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 4, r: 1 },
        pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [{ id: "main", pathCenterline: Array.from({ length: 5 }, (_, q) => ({ q, r: 1 })) }],
        terrainOverrides: []
      }
    },
    mechanics: { schemaVersion: 1, modules },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "hero_block", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function validate(options: Parameters<typeof input>[0] = {}) {
  return validateGameContentRegistry(createGameContentRegistry(input(options)));
}

describe("R5.6A Heroes v7 blocking authoring contract (RED)", () => {
  it("publishes the exact bounded v7 authoring and authoritative snapshot descriptor", () => {
    expect((Engine as any).HERO_BLOCKING_LIMITS).toEqual({
      blockCapacity: BLOCK_CAPACITY_MAX,
      movementProfileIds: BLOCK_PROFILE_IDS_MAX
    });
    expect((Engine as any).HEROES_MECHANICS_SCHEMA).toMatchObject({
      schemaVersion: 7,
      supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6, 7],
      versions: {
        7: {
          definition: {
            requiredFields: [
              "label", "spawn", "movement", "durability", "mana", "activeAbility",
              "skillTree", "passiveAura", "blocking"
            ],
            optionalFields: [], additionalProperties: false
          },
          blocking: {
            nullable: true,
            requiredFields: ["blockCapacity", "movementProfileIds"],
            optionalFields: [], additionalProperties: false,
            blockCapacity: { integer: true, minimum: 1, maximum: BLOCK_CAPACITY_MAX },
            movementProfileIds: {
              minimumItems: 1, maximumItems: BLOCK_PROFILE_IDS_MAX, uniqueItems: true,
              itemUtf8Bytes: 128
            }
          }
        }
      },
      runtimeSnapshot: {
        schemaVersions: [1, 2, 3, 4, 5, 6, 7],
        versions: {
          7: {
            unitFields: [
              "id", "definitionId", "label", "coord", "movement", "durability", "mana",
              "activeAbility", "skills", "passiveAura", "blocking"
            ],
            skillsNullable: true,
            passiveAuraNullable: true,
            blockingFields: ["blockCapacity", "active", "blockedEnemyIds"]
          }
        }
      }
    });
  });

  it("normalizes, canonicalizes, detaches, and deeply freezes non-null and null blocking", () => {
    const normalize = (Engine as any).normalizeHeroesProfileV7 as ((value: unknown) => any) | undefined;
    expect(normalize).toBeTypeOf("function");
    const raw = (input({ blocking: blocking(3, ["zeta", "alpha"]) }) as any)
      .mechanics.modules.heroes.profiles.commanders;
    const normalized = normalize!(raw);
    expect(normalized.definitions.commander.blocking).toEqual({
      blockCapacity: 3,
      movementProfileIds: ["alpha", "zeta"]
    });
    expect(Object.isFrozen(normalized.definitions.commander.blocking)).toBe(true);
    expect(Object.isFrozen(normalized.definitions.commander.blocking.movementProfileIds)).toBe(true);
    raw.definitions.commander.blocking.movementProfileIds[0] = "mutated";
    expect(normalized.definitions.commander.blocking.movementProfileIds).toEqual(["alpha", "zeta"]);

    const nullRaw = (input({ blocking: null }) as any).mechanics.modules.heroes.profiles.commanders;
    expect(normalize!(nullRaw).definitions.commander.blocking).toBeNull();
  });

  it("accepts and resolves a selected v7 profile only with its active dynamic-flow dependency", () => {
    const registry = createGameContentRegistry(input());
    expect(validateGameContentRegistry(registry)).toEqual({ ok: true, issues: [] });
    expect(Engine.resolveActiveHeroesMechanics(registry, "hero_block")).toMatchObject({
      schemaVersion: 7,
      profileId: "commanders",
      definitions: {
        commander: { blocking: { blockCapacity: 2, movementProfileIds: ["ground"] } }
      }
    });
  });

  it.each(["absent", "disabled", "unselected", "authored_routes"] as const)(
    "requires active dynamic-flow navigation for selected blocking: %s",
    (navigation) => {
      const result = validate({ navigation });
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/heroes|blocking|navigation|movementProfileIds/i),
        message: expect.stringMatching(/dynamic.flow|navigation|dependency|active/i)
      }));
    }
  );

  it("requires every selected blocking movement profile ID to exist in that mission's navigation profile", () => {
    const result = validate({ blocking: blocking(2, ["ground", "missing"]) });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/blocking.*movementProfileIds/i),
      message: expect.stringMatching(/missing|unknown|navigation|movement profile/i)
    }));
  });

  it("downgrades dependency/reference problems to warnings for disabled or unselected Heroes", () => {
    for (const options of [
      { heroesEnabled: false, navigation: "absent" as const },
      { heroesSelected: false, navigation: "absent" as const },
      { heroesEnabled: false, blocking: blocking(2, ["missing"]) }
    ]) {
      const result = validate(options);
      expect(result.ok).toBe(true);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "warning",
        fieldPath: expect.stringMatching(/heroes|blocking|navigation|movementProfileIds/i)
      }));
    }
  });

  it("reports but does not activate an unselected definition's unknown navigation references", () => {
    const raw = input() as any;
    raw.mechanics.modules.heroes.profiles.commanders.definitions.reserve.blocking = blocking(1, ["missing"]);
    const result = validateGameContentRegistry(createGameContentRegistry(raw));
    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "warning",
      fieldPath: expect.stringMatching(/definitions\.reserve\.blocking.*movementProfileIds/i),
      message: expect.stringMatching(/missing|unknown|navigation|movement profile/i)
    }));
  });

  it("does not require navigation when the selected v7 blocking value is explicit null", () => {
    expect(validate({ blocking: null, navigation: "absent" })).toEqual({ ok: true, issues: [] });
  });

  it.each([
    ["missing capacity", { movementProfileIds: ["ground"] }],
    ["unknown field", { ...blocking(), extra: true }],
    ["zero capacity", blocking(0)],
    ["capacity overflow", blocking(65)],
    ["fractional capacity", blocking(1.5)],
    ["non-finite capacity", blocking(Number.POSITIVE_INFINITY)],
    ["empty profile list", blocking(1, [])],
    ["too many profile IDs", blocking(1, Array.from({ length: 33 }, (_, index) => `p${index}`))],
    ["duplicate profile IDs", blocking(1, ["ground", "ground"])],
    ["empty profile ID", blocking(1, [""])],
    ["oversized UTF-8 profile ID", blocking(1, ["🔥".repeat(33)])]
  ])("rejects malformed blocking structure even when disabled: %s", (_name, malformed) => {
    const result = validate({ blocking: malformed, heroesEnabled: false });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/blocking/i),
      message: expect.stringMatching(/required|unknown|integer|capacity|unique|duplicate|dense|1\.\.32|UTF-8|limit|entries/i)
    }));
  });

  it("rejects missing blocking on any v7 definition, including an unselected reserve", () => {
    const raw = input() as any;
    delete raw.mechanics.modules.heroes.profiles.commanders.definitions.reserve.blocking;
    const result = validateGameContentRegistry(createGameContentRegistry(raw));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/definitions\.reserve\.blocking/i)
    }));
  });

  it("rejects sparse arrays, accessors, symbol fields, and revoked proxies without executing authored code", () => {
    let reads = 0;
    const accessor = blocking();
    Object.defineProperty(accessor, "movementProfileIds", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute");
      }
    });
    const sparse = blocking(1, Array(1));
    const symbol = blocking();
    Object.defineProperty(symbol, Symbol("hostile"), { value: true, enumerable: true });
    const revoked = Proxy.revocable(blocking(), {});
    revoked.revoke();
    for (const hostile of [accessor, sparse, symbol, revoked.proxy]) {
      const result = validate({ blocking: hostile, heroesEnabled: false });
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/blocking/i),
        message: expect.stringMatching(/own|data|dense|symbol|inspect|safe|array/i)
      }));
    }
    expect(reads).toBe(0);
  });

  it("keeps v6 valid and makes future v8 fail closed", () => {
    const legacy = createGameContentRegistry(input({ version: 6, navigation: "absent" }));
    expect(validateGameContentRegistry(legacy)).toEqual({ ok: true, issues: [] });
    expect(Engine.resolveActiveHeroesMechanics(legacy, "hero_block")).toMatchObject({ schemaVersion: 6 });

    const future = createGameContentRegistry(input({ version: 8 }));
    expect(Engine.resolveCapabilitySet(future.mechanics, future.missions.hero_block!.mechanics).heroes)
      .toMatchObject({ active: false, reason: "module_version_unsupported" });
    expect(Engine.resolveActiveHeroesMechanics(future, "hero_block")).toBeUndefined();
  });
});
