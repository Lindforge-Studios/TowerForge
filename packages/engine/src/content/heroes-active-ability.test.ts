import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

const MAX_VALUE = 1_000_000_000_000;
const MAX_COOLDOWN = 86_400;
const MAX_RANGE = 65_536;

function activeProfile(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    selectedHeroId: "commander",
    definitions: {
      commander: {
        label: "Commander",
        spawn: "core",
        movement: { movementProfileId: "ground", speed: 2 },
        durability: { maxHp: 100, shield: { capacity: 25 } },
        mana: { max: 100, starting: 40, regenerationPerUnit: 5 },
        activeAbility: {
          id: "arc_bolt",
          label: "Arc Bolt",
          target: "enemy",
          manaCost: 20,
          cooldown: 3,
          range: 8,
          damage: 30
        }
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

function input(profile: unknown = activeProfile(), enabled = true, selected = true): GameContentInput {
  return {
    balance: {
      defaultMissionId: "hero_ability",
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
          groundSpeedMultiplier: 1, tags: []
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
        wall: {
          id: "wall", label: "Wall", cost: { coins: 1 }, footprintRadius: 0,
          range: 1,
          attack: {
            kind: "single", fireRate: 0.01, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        hero_ability: {
          id: "hero_ability", label: "Hero ability", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["wall"], abilityIds: [],
          ...(selected ? { mechanics: { profiles: { heroes: "commanders" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 6, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 5, r: 1 },
        pathCenterline: Array.from({ length: 6 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        heroes: {
          schemaVersion: 4 as 1,
          enabled,
          profiles: { commanders: profile as Record<string, never> }
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
        missionId: "hero_ability", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as GameContentInput;
}

function withDefinition(patch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const profile = activeProfile();
  const definitions = profile.definitions as Record<string, Record<string, unknown>>;
  definitions.commander = { ...definitions.commander, ...patch };
  return profile;
}

describe("R5.3A heroes v4 targeted active-ability authoring (RED)", () => {
  it("publishes the exact closed v4 schema, snapshot shape, and shared numeric budgets", () => {
    const schema = (Engine as unknown as { HEROES_MECHANICS_SCHEMA: Record<string, any> }).HEROES_MECHANICS_SCHEMA;
    expect(schema).toMatchObject({
      schemaVersion: 5,
      supportedModuleSchemaVersions: [1, 2, 3, 4, 5],
      versions: {
        4: {
          definition: {
            requiredFields: ["label", "spawn", "movement", "durability", "mana", "activeAbility"],
            optionalFields: [],
            additionalProperties: false
          },
          mana: {
            requiredFields: ["max", "starting", "regenerationPerUnit"],
            optionalFields: [],
            additionalProperties: false,
            max: { exclusiveMinimum: 0, maximum: MAX_VALUE },
            starting: { minimum: 0, maximumFrom: "mana.max" },
            regenerationPerUnit: { minimum: 0, maximum: MAX_VALUE }
          },
          activeAbility: {
            requiredFields: ["id", "label", "target", "manaCost", "cooldown", "range", "damage"],
            optionalFields: [],
            additionalProperties: false,
            targetValues: ["enemy"],
            manaCost: { exclusiveMinimum: 0, maximumFrom: "mana.max" },
            cooldown: { minimum: 0, maximum: MAX_COOLDOWN },
            range: { integer: true, minimum: 0, maximum: MAX_RANGE },
            damage: { exclusiveMinimum: 0, maximum: MAX_VALUE }
          }
        }
      },
      runtimeSnapshot: {
        schemaVersions: [1, 2, 3, 4, 5],
        versions: {
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
  });

  it("normalizes and resolves one exact inline v4 ability without activating any adjacent module", () => {
    const normalize = (Engine as unknown as {
      normalizeHeroesProfileV4?: (value: unknown) => unknown;
    }).normalizeHeroesProfileV4;
    expect(normalize).toBeTypeOf("function");
    expect(normalize!(activeProfile())).toEqual(activeProfile());

    const registry = createGameContentRegistry(input());
    expect(validateGameContentRegistry(registry)).toEqual({ ok: true, issues: [] });
    expect(registry.mechanics.modules).not.toHaveProperty("roguelite");
    expect(registry.mechanics.modules).not.toHaveProperty("logistics");
    expect(Engine.resolveActiveHeroesMechanics(registry, "hero_ability")).toEqual({
      schemaVersion: 4,
      profileId: "commanders",
      ...activeProfile()
    });
  });

  it.each([
    ["missing mana", withDefinition({ mana: undefined })],
    ["unknown definition field", withDefinition({ extra: true })],
    ["zero max mana", withDefinition({ mana: { max: 0, starting: 0, regenerationPerUnit: 1 } })],
    ["starting mana above max", withDefinition({ mana: { max: 10, starting: 11, regenerationPerUnit: 1 } })],
    ["negative mana regeneration", withDefinition({ mana: { max: 10, starting: 1, regenerationPerUnit: -1 } })],
    ["multiple abilities", withDefinition({ activeAbility: [
      { id: "a", label: "A", target: "enemy", manaCost: 1, cooldown: 0, range: 0, damage: 1 },
      { id: "b", label: "B", target: "enemy", manaCost: 1, cooldown: 0, range: 0, damage: 1 }
    ] })],
    ["unsupported target", withDefinition({ activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "tile", manaCost: 1, cooldown: 0, range: 0, damage: 1
    } })],
    ["zero mana cost", withDefinition({ activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 0, cooldown: 0, range: 0, damage: 1
    } })],
    ["mana cost above max", withDefinition({ activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 101, cooldown: 0, range: 0, damage: 1
    } })],
    ["cooldown above bound", withDefinition({ activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 1, cooldown: 86_401, range: 0, damage: 1
    } })],
    ["fractional range", withDefinition({ activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 1, cooldown: 0, range: 1.5, damage: 1
    } })],
    ["range above shared map-cell bound", withDefinition({ activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 1, cooldown: 0, range: 65_537, damage: 1
    } })],
    ["zero damage", withDefinition({ activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 1, cooldown: 0, range: 0, damage: 0
    } })],
    ["unknown ability field", withDefinition({ activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy", manaCost: 1, cooldown: 0, range: 0, damage: 1,
      area: 2
    } })]
  ])("rejects the exact bounded v4 shape even while disabled: %s", (_label, profile) => {
    for (const enabled of [true, false]) {
      const result = validateGameContentRegistry(createGameContentRegistry(input(profile, enabled)));
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "error",
        fieldPath: expect.stringMatching(/heroes|definition|mana|activeAbility|ability/i),
        message: expect.stringMatching(/required|unknown|finite|range|maximum|minimum|positive|plain|field/i)
      }));
    }
  });

  it("keeps unselected v4 structurally validated and treats v6 as future fail-closed content", () => {
    expect(validateGameContentRegistry(createGameContentRegistry(input(activeProfile(), true, false))))
      .toEqual({ ok: true, issues: [] });

    const future = input();
    (future.mechanics!.modules.heroes as unknown as { schemaVersion: number }).schemaVersion = 6;
    const result = validateGameContentRegistry(createGameContentRegistry(future));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/heroes.*schemaVersion|schemaVersion/i),
      message: expect.stringMatching(/unsupported|future|version/i)
    }));
  });
});
