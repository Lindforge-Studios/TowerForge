import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { createGameContentRegistry, type GameContentInput } from "./registry.js";
import { validateGameContentRegistry } from "./validate.js";

function skillTree(): Record<string, unknown> {
  return {
    points: { starting: 2, perInterwave: 2 },
    nodes: {
      focus: {
        label: "Focus",
        description: "Double hero ability damage after learning Arc.",
        cost: 2,
        requires: ["arc"],
        effects: [{
          kind: "modifier",
          scope: "hero_ability_damage",
          modifier: { target: "damage", operation: "multiplier", value: 2 }
        }]
      },
      arc: {
        label: "Arc",
        description: "Add five hero ability damage.",
        cost: 2,
        requires: [],
        effects: [{
          kind: "modifier",
          scope: "hero_ability_damage",
          modifier: { target: "damage", operation: "flat", value: 5 }
        }]
      }
    }
  };
}

function profile(tree: unknown = skillTree()): Record<string, unknown> {
  return {
    selectedHeroId: "commander",
    definitions: {
      commander: {
        label: "Commander",
        spawn: "core",
        movement: { movementProfileId: "ground", speed: 2 },
        durability: { maxHp: 100, shield: null },
        mana: { max: 100, starting: 40, regenerationPerUnit: 5 },
        activeAbility: {
          id: "arc_bolt",
          label: "Arc Bolt",
          target: "enemy",
          manaCost: 10,
          cooldown: 0,
          range: 8,
          damage: 10
        },
        skillTree: tree
      }
    },
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

function input(options: {
  profile?: Record<string, unknown>;
  enabled?: boolean;
  selected?: boolean;
  version?: number;
} = {}): GameContentInput {
  const selected = options.selected ?? true;
  return {
    balance: {
      defaultMissionId: "hero_skills",
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
        two: [0, 1].map((wave) => ({
          id: `wave_${wave}`,
          label: `Wave ${wave + 1}`,
          groups: []
        }))
      },
      missions: {
        hero_skills: {
          id: "hero_skills", label: "Hero skills", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "two", buildTowerIds: ["wall"], abilityIds: [],
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
          schemaVersion: (options.version ?? 5) as 1,
          enabled: options.enabled ?? true,
          profiles: { commanders: options.profile ?? profile() }
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
        missionId: "hero_skills", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as GameContentInput;
}

describe("R5.4A heroes v5 skill-tree authoring contract (RED)", () => {
  it("publishes v5 as an exact capability and snapshot domain", () => {
    const schema = (Engine as unknown as { HEROES_MECHANICS_SCHEMA: Record<string, any> })
      .HEROES_MECHANICS_SCHEMA;
    expect(schema).toMatchObject({
      schemaVersion: 6,
      supportedModuleSchemaVersions: [1, 2, 3, 4, 5, 6],
      versions: {
        5: {
          definition: {
            requiredFields: [
              "label", "spawn", "movement", "durability", "mana", "activeAbility", "skillTree"
            ],
            optionalFields: [],
            additionalProperties: false
          }
        }
      },
      runtimeSnapshot: {
        schemaVersions: [1, 2, 3, 4, 5, 6],
        versions: {
          5: {
            unitFields: [
              "id", "definitionId", "label", "coord", "movement", "durability", "mana", "activeAbility", "skills"
            ],
            skillsFields: [
              "availablePoints", "startingPoints", "pointsPerInterwave", "maximumEarnablePoints",
              "managementAvailable", "nodes"
            ]
          }
        }
      }
    });
  });

  it("normalizes the exact nullable v5 tree and binary-canonicalizes nodes and prerequisites", () => {
    const normalize = (Engine as unknown as {
      normalizeHeroesProfileV5?: (value: unknown) => Record<string, any>;
    }).normalizeHeroesProfileV5;
    expect(normalize).toBeTypeOf("function");

    const raw = profile();
    const definitions = raw.definitions as Record<string, any>;
    const rawTree = definitions.commander.skillTree as Record<string, any>;
    rawTree.nodes.focus.requires = ["arc"];
    const normalized = normalize!(raw);
    expect(Object.keys(normalized.definitions.commander.skillTree.nodes)).toEqual(["arc", "focus"]);
    expect(normalized.definitions.commander.skillTree.nodes.focus.requires).toEqual(["arc"]);
    expect(normalize!(profile(null)).definitions.commander.skillTree).toBeNull();
  });

  it("accepts an active v5 DAG and its explicit null opt-out without changing adjacent modules", () => {
    for (const tree of [skillTree(), null]) {
      const registry = createGameContentRegistry(input({ profile: profile(tree) }));
      expect(validateGameContentRegistry(registry)).toEqual({ ok: true, issues: [] });
      expect(registry.mechanics.modules).not.toHaveProperty("roguelite");
      expect(registry.mechanics.modules).not.toHaveProperty("logistics");
      expect(Engine.resolveActiveHeroesMechanics(registry, "hero_skills")).toMatchObject({
        schemaVersion: 5,
        profileId: "commanders"
      });
    }
  });

  it("treats broken DAG references as active errors but disabled or unselected warnings", () => {
    const broken = skillTree();
    (broken.nodes as Record<string, any>).focus.requires = ["missing"];

    const active = validateGameContentRegistry(createGameContentRegistry(input({ profile: profile(broken) })));
    expect(active.ok).toBe(false);
    expect(active.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/skillTree.*focus.*requires/i),
      message: expect.stringMatching(/unknown|missing|reference/i)
    }));

    for (const options of [{ enabled: false }, { selected: false }]) {
      const result = validateGameContentRegistry(createGameContentRegistry(input({
        ...options,
        profile: profile(broken)
      })));
      expect(result.ok).toBe(true);
      expect(result.issues).toContainEqual(expect.objectContaining({
        severity: "warning",
        fieldPath: expect.stringMatching(/skillTree.*focus.*requires/i),
        message: expect.stringMatching(/unknown|missing|reference/i)
      }));
    }
  });

  it.each([
    ["self prerequisite", () => {
      const tree = skillTree();
      (tree.nodes as Record<string, any>).arc.requires = ["arc"];
      return tree;
    }],
    ["cycle", () => {
      const tree = skillTree();
      (tree.nodes as Record<string, any>).arc.requires = ["focus"];
      return tree;
    }],
    ["duplicate prerequisite", () => {
      const tree = skillTree();
      (tree.nodes as Record<string, any>).focus.requires = ["arc", "arc"];
      return tree;
    }],
    ["wrong modifier scope", () => {
      const tree = skillTree();
      (tree.nodes as Record<string, any>).arc.effects[0].scope = "all_towers";
      return tree;
    }],
    ["too many earned points", () => {
      const tree = skillTree();
      (tree.points as Record<string, unknown>).starting = 65_536;
      (tree.points as Record<string, unknown>).perInterwave = 1;
      return tree;
    }]
  ])("rejects bounded active v5 semantics: %s", (_label, makeTree) => {
    const result = validateGameContentRegistry(createGameContentRegistry(input({
      profile: profile(makeTree())
    })));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/skillTree|points|effects|requires/i)
    }));
  });

  it("rejects a valid-looking modifier sequence that would overflow the selected hero ability", () => {
    const overflowing = skillTree();
    (overflowing.nodes as Record<string, any>).arc.effects[0].modifier = {
      target: "damage",
      operation: "multiplier",
      value: Number.MAX_VALUE
    };
    const result = validateGameContentRegistry(createGameContentRegistry(input({
      profile: profile(overflowing)
    })));

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/skillTree.*arc.*effects.*modifier.*value/i),
      message: expect.stringMatching(/overflow|finite|range|maximum/i)
    }));
  });

  it("keeps v1-v4 literal compatibility and rejects future v7", () => {
    const legacy = input({ version: 4 });
    const definition = (legacy.mechanics!.modules.heroes as any).profiles.commanders
      .definitions.commander;
    delete definition.skillTree;
    expect(validateGameContentRegistry(createGameContentRegistry(legacy))).toEqual({ ok: true, issues: [] });

    const future = validateGameContentRegistry(createGameContentRegistry(input({ version: 7 })));
    expect(future.ok).toBe(false);
    expect(future.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      fieldPath: expect.stringMatching(/heroes.*schemaVersion|schemaVersion/i),
      message: expect.stringMatching(/unsupported|future|version/i)
    }));
  });
});
