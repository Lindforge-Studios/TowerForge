import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { validateGameContentRegistry } from "../content/validate.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import { DamageResolver } from "./damage.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import { createGridTopology } from "./topology.js";
import type { GridCoord, GridDefinition } from "./types.js";

type JsonRecord = Record<string, unknown>;

interface EnemyFixture {
  id: string;
  hp: number;
  reward?: number;
  resistances?: Record<string, number>;
}

interface StartFixture {
  coord: GridCoord;
  terrain?: "path" | "dry_path" | "tagged_stone" | "water";
  enemyId?: string;
  count?: number;
}

interface AdvancedFixtureOptions {
  grid?: GridDefinition;
  starts?: StartFixture[];
  enemies?: EnemyFixture[];
  reactions: JsonRecord;
  exposures?: JsonRecord;
  damageTypes?: string[];
  combat?: JsonRecord;
  towerDamage?: number;
  towerDamageType?: string;
  abilities?: Record<string, JsonRecord>;
  scripts?: GameContentInput["scripts"];
}

const HEX: GridDefinition = { kind: "hex", layout: "odd-r" };
const SQUARE: GridDefinition = { kind: "square", adjacency: "cardinal" };
const ORIGIN = { q: 2, r: 3 } as const;
const CORE = { q: 9, r: 3 } as const;
const TOWER_COORD = { q: 0, r: 0 } as const;

function ability(id: string, radius: number, effects: unknown[]) {
  return { id, label: id, cooldown: 0.01, duration: 0, radius, effects };
}

function advancedInput(options: AdvancedFixtureOptions): GameContentInput {
  const grid = options.grid ?? SQUARE;
  const topology = createGridTopology(grid);
  const starts: StartFixture[] = options.starts ?? [{ coord: ORIGIN, terrain: "dry_path" }];
  const enemyFixtures = options.enemies ?? [{ id: "grunt", hp: 100 }];
  const enemyById = new Map(enemyFixtures.map((enemy) => [enemy.id, enemy]));
  const pathRoutes = starts.map((start, index) => ({
    id: `route_${index.toString().padStart(3, "0")}`,
    pathCenterline: topology.line(start.coord, CORE)
  }));
  const overrideByCoord = new Map<string, { q: number; r: number; terrain: string }>();
  for (const start of starts) {
    overrideByCoord.set(`${start.coord.q},${start.coord.r}`, {
      ...start.coord,
      terrain: start.terrain ?? "dry_path"
    });
  }
  const abilities = options.abilities ?? {
    hit: ability("hit", 0.1, [{ kind: "damage", amount: 10 }])
  };
  const damageTypes = options.damageTypes ?? ["physical", "fire", "ice", "lightning"];
  const defaultCombat: JsonRecord = {
    damageTypes: Object.fromEntries(damageTypes.map((id) => [id, { label: id }])),
    armorTypes: {},
    armorAssignments: {},
    marks: { definitions: {} }
  };
  const groups = starts.map((start, index) => ({
    enemyId: start.enemyId ?? enemyFixtures[0]!.id,
    count: start.count ?? 1,
    spawnInterval: 0,
    startDelay: 0,
    routeId: pathRoutes[index]!.id
  }));
  for (const group of groups) {
    if (!enemyById.has(group.enemyId)) throw new Error(`Missing enemy fixture ${group.enemyId}`);
  }

  return {
    balance: {
      defaultMissionId: "advanced",
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
      terrainTypes: {
        dry_path: {
          id: "dry_path", label: "Dry path", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["path"]
        },
        tagged_stone: {
          id: "tagged_stone", label: "Tagged stone", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["path", "wet"]
        },
        water: {
          id: "water", label: "Water without wet reaction tag", buildable: false, walkable: true,
          groundSpeedMultiplier: 0.5, tags: ["path", "water"]
        }
      },
      abilities: abilities as GameContentInput["balance"]["abilities"],
      enemies: Object.fromEntries(enemyFixtures.map((enemy) => [enemy.id, {
        id: enemy.id,
        label: enemy.id,
        maxHp: enemy.hp,
        speed: 0.000_001,
        reward: { coins: enemy.reward ?? 1 },
        coinReward: enemy.reward ?? 1,
        coreDamage: 1,
        color: 1,
        ...(enemy.resistances === undefined ? {} : { resistances: enemy.resistances })
      }])),
      towers: {
        trigger: {
          id: "trigger",
          label: "Trigger",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 100,
          attack: {
            kind: "single",
            fireRate: 1,
            damagePerStack: options.towerDamage ?? 1,
            damageType: options.towerDamageType ?? "physical",
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{ id: "one", label: "One", groups }]
      },
      missions: {
        advanced: {
          id: "advanced",
          label: "Advanced reactions",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["trigger"],
          abilityIds: Object.keys(abilities),
          mechanics: { profiles: { combat: "base", reactions: "advanced" } }
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 10,
        height: 7,
        grid,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 3 },
        coreCoord: CORE,
        pathCenterline: topology.line({ q: 0, r: 3 }, CORE),
        pathRoutes,
        terrainOverrides: [...overrideByCoord.values()]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: true,
          profiles: { base: { ...defaultCombat, ...(options.combat ?? {}) } }
        },
        reactions: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            advanced: {
              exposures: options.exposures ?? { definitions: {}, applications: { damageTypes: {} } },
              reactions: options.reactions
            }
          }
        }
      }
    } as unknown as GameContentInput["mechanics"],
    ...(options.scripts === undefined ? {} : { scripts: options.scripts }),
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, accent: "#fff", biome: "test", connections: []
      }],
      missionNodes: [{
        missionId: "advanced", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(options: AdvancedFixtureOptions) {
  const registry = createGameContentRegistry(advancedInput(options));
  const validation = validateGameContentRegistry(registry);
  expect(validation.issues, "advanced reaction fixture must be valid").toEqual([]);
  return registry;
}

function game(options: AdvancedFixtureOptions, seed = "advanced-reactions") {
  return new TowerDefenseGame({ missionId: "advanced", content: content(options), seed });
}

function spawn(instance: TowerDefenseGame, expected: number): void {
  expect(instance.startNextWave().ok).toBe(true);
  instance.tick(0.01);
  expect(instance.getSnapshot().enemies).toHaveLength(expected);
}

function fireTower(instance: TowerDefenseGame): void {
  expect(instance.placeTower("trigger", TOWER_COORD).ok).toBe(true);
  const towerId = instance.getSnapshot().towers[0]?.id;
  expect(towerId).toBeDefined();
  expect(instance.setTowerTargetMode(towerId!, "closest").ok).toBe(true);
  instance.tick(0.01);
}

function reactionEvents(instance: TowerDefenseGame): Array<Record<string, unknown>> {
  return (instance.lastEvents as unknown as Array<Record<string, unknown>>)
    .filter((event) => event.type === "enemyReactionTriggered");
}

function enemyHp(instance: TowerDefenseGame, enemyId: string): number | undefined {
  return instance.getSnapshot().enemies.find((enemy) => enemy.id === enemyId)?.hp;
}

function wetFanOutReaction(maxTargets = 3): JsonRecord {
  return {
    wet_chain: {
      label: "Wet chain",
      trigger: { damageTypes: ["physical"] },
      requirements: [{ kind: "terrain_tag", tag: "wet" }],
      effects: {
        chain: {
          kind: "damage",
          amount: { kind: "flat", value: 5 },
          damageType: "physical",
          target: { kind: "terrain_tag", tag: "wet", maxTargets }
        }
      }
    }
  };
}

describe("R1.5 advanced terrain, status, and fan-out runtime", () => {
  it("[verifier] preserves magic exposure ids as own runtime state keys", () => {
    const definitions: Record<string, unknown> = {};
    Object.defineProperty(definitions, "__proto__", {
      value: { label: "Magic", duration: 4, maxStacks: 1 },
      enumerable: true
    });
    const instance = game({
      reactions: {},
      exposures: {
        definitions,
        applications: { damageTypes: { physical: [{ exposureId: "__proto__" }] } }
      }
    });
    spawn(instance, 1);

    expect(instance.useAbility("hit", ORIGIN).ok).toBe(true);
    const state = instance.getSnapshot().reactions?.exposures.enemies.enemy_1;
    expect(state && Object.hasOwn(state, "__proto__")).toBe(true);
    expect(state?.["__proto__"]).toEqual({ stacks: 1, remaining: 4 });
  });

  it.each([
    ["hex", HEX],
    ["square", SQUARE]
  ] as const)("uses canonical %s topology distance and actual terrain tags for bounded fan-out", (_label, grid) => {
    const starts: StartFixture[] = [
      { coord: ORIGIN, terrain: "tagged_stone" },
      { coord: { q: 3, r: 3 }, terrain: "tagged_stone" },
      { coord: { q: 3, r: 2 }, terrain: "dry_path" },
      { coord: { q: 4, r: 3 }, terrain: "tagged_stone" },
      { coord: { q: 2, r: 5 }, terrain: "tagged_stone" },
      { coord: { q: 5, r: 3 }, terrain: "tagged_stone" }
    ];
    const instance = game({ grid, starts, reactions: wetFanOutReaction() });
    spawn(instance, starts.length);
    expect(instance.useAbility("hit", ORIGIN).ok).toBe(true);

    const topology = createGridTopology(grid);
    const expected = starts.slice(1)
      .map((start, index) => ({
        enemyId: `enemy_${index + 2}`,
        distance: topology.distance(ORIGIN, start.coord),
        wet: start.terrain === "tagged_stone"
      }))
      .filter((candidate) => candidate.wet)
      .sort((left, right) => left.distance - right.distance || (left.enemyId < right.enemyId ? -1 : 1))
      .slice(0, 3)
      .map((candidate) => candidate.enemyId);
    expect(reactionEvents(instance)).toContainEqual(expect.objectContaining({
      reactionId: "wet_chain",
      originCoord: ORIGIN,
      scheduledTargetIds: expected
    }));
    expect(enemyHp(instance, "enemy_1")).toBe(90);
    for (let index = 2; index <= starts.length; index += 1) {
      expect(enemyHp(instance, `enemy_${index}`)).toBe(expected.includes(`enemy_${index}`) ? 95 : 100);
    }
  });

  it("does not infer wet from the water terrain id or temporary-water presentation state", () => {
    const dry = game({
      starts: [{ coord: ORIGIN, terrain: "path" }],
      reactions: wetFanOutReaction(),
      abilities: {
        path_water: {
          id: "path_water", label: "Temporary water", cooldown: 0.01,
          duration: 1, radius: 0.1
        },
        hit: ability("hit", 0.1, [{ kind: "damage", amount: 10 }])
      }
    });
    spawn(dry, 1);
    expect(dry.useAbility("path_water", ORIGIN).ok).toBe(true);
    expect(dry.getSnapshot().temporaryWaterTiles).toContainEqual(expect.objectContaining(ORIGIN));
    expect(dry.useAbility("hit", ORIGIN).ok).toBe(true);
    expect(reactionEvents(dry)).toEqual([]);

    const tagged = game({
      starts: [{ coord: ORIGIN, terrain: "tagged_stone" }],
      reactions: {
        tagged: {
          label: "Tagged",
          trigger: { damageTypes: ["physical"] },
          requirements: [{ kind: "terrain_tag", tag: "wet" }],
          effects: {
            self: {
              kind: "damage", amount: { kind: "flat", value: 1 }, damageType: "physical",
              target: { kind: "primary" }
            }
          }
        }
      }
    });
    spawn(tagged, 1);
    expect(tagged.useAbility("hit", ORIGIN).ok).toBe(true);
    expect(reactionEvents(tagged)).toContainEqual(expect.objectContaining({ reactionId: "tagged" }));
  });

  it("reserves consumed status in binary reaction order and clears it before secondary damage", () => {
    const rules = {
      alpha_observe: {
        label: "Observe",
        trigger: { damageTypes: ["physical"] },
        requirements: [{ kind: "status", statusId: "stun", consume: "none" }],
        effects: {
          self: { kind: "damage", amount: { kind: "flat", value: 1 }, damageType: "physical", target: { kind: "primary" } }
        }
      },
      beta_clear: {
        label: "Clear",
        trigger: { damageTypes: ["physical"] },
        requirements: [{ kind: "status", statusId: "stun", consume: "clear" }],
        effects: {
          self: { kind: "damage", amount: { kind: "flat", value: 1 }, damageType: "physical", target: { kind: "primary" } }
        }
      },
      zeta_clear: {
        label: "Conflicting clear",
        trigger: { damageTypes: ["physical"] },
        requirements: [{ kind: "status", statusId: "stun", consume: "clear" }],
        effects: {
          self: { kind: "damage", amount: { kind: "flat", value: 50 }, damageType: "physical", target: { kind: "primary" } }
        }
      }
    };
    const instance = game({
      starts: [{ coord: ORIGIN }],
      reactions: rules,
      towerDamage: 10,
      abilities: { stunner: ability("stunner", 0.1, [{ kind: "status", status: { stun: 10 } }]) }
    });
    spawn(instance, 1);
    expect(instance.useAbility("stunner", ORIGIN).ok).toBe(true);
    expect(instance.getSnapshot().enemies[0]?.statuses?.stun).toBeDefined();
    fireTower(instance);

    expect(reactionEvents(instance).map((event) => event.reactionId)).toEqual(["alpha_observe", "beta_clear"]);
    expect(instance.getSnapshot().enemies[0]?.statuses?.stun).toBeUndefined();
    expect(enemyHp(instance, "enemy_1")).toBe(88);
  });
});

describe("R1.5 advanced reaction queue, death settlement, and budgets", () => {
  it("lets a lethal origin seed fan-out, skips its primary re-hit, and settles death/reward exactly once", () => {
    const instance = game({
      starts: [
        { coord: ORIGIN, enemyId: "origin" },
        { coord: { q: 3, r: 3 }, enemyId: "victim" }
      ],
      enemies: [
        { id: "origin", hp: 10, reward: 7 },
        { id: "victim", hp: 100, reward: 1 }
      ],
      towerDamage: 10,
      reactions: {
        lethal_burst: {
          label: "Lethal burst",
          trigger: { damageTypes: ["physical"] },
          effects: {
            a_primary: { kind: "damage", amount: { kind: "flat", value: 50 }, damageType: "physical", target: { kind: "primary" } },
            b_radius: { kind: "damage", amount: { kind: "flat", value: 5 }, damageType: "physical", target: { kind: "radius", radius: 3, maxTargets: 8 } }
          }
        }
      }
    });
    spawn(instance, 2);
    const coinsBefore = instance.resources.coins ?? 0;
    fireTower(instance);

    expect(enemyHp(instance, "enemy_1")).toBeUndefined();
    expect(enemyHp(instance, "enemy_2")).toBe(95);
    expect(instance.getSnapshot()).toMatchObject({ killCount: 1, resources: { coins: coinsBefore - 1 + 7 } });
    const events = instance.lastEvents as unknown as Array<{ type: string; enemyId?: string }>;
    expect(events.findIndex((event) => event.type === "enemyReactionTriggered"))
      .toBeLessThan(events.findIndex((event) => event.type === "enemyKilled" && event.enemyId === "enemy_1"));
    expect(events.filter((event) => event.type === "enemyKilled" && event.enemyId === "enemy_1")).toHaveLength(1);

    const coinsAfter = instance.resources.coins;
    instance.tick(0.01);
    expect(instance.resources.coins).toBe(coinsAfter);
    expect(instance.getSnapshot().killCount).toBe(1);
  });

  it("skips queued packets whose target was killed by an earlier binary effect", () => {
    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const instance = game({
      starts: [
        { coord: ORIGIN, enemyId: "origin" },
        { coord: { q: 3, r: 3 }, enemyId: "victim" }
      ],
      enemies: [{ id: "origin", hp: 100 }, { id: "victim", hp: 5, reward: 3 }],
      towerDamage: 1,
      reactions: {
        queued: {
          label: "Queued",
          trigger: { damageTypes: ["physical"] },
          effects: {
            a_lethal: { kind: "damage", amount: { kind: "flat", value: 5 }, damageType: "physical", target: { kind: "radius", radius: 2, maxTargets: 8 } },
            b_late: { kind: "damage", amount: { kind: "flat", value: 1 }, damageType: "physical", target: { kind: "radius", radius: 2, maxTargets: 8 } }
          }
        }
      }
    });
    spawn(instance, 2);
    fireTower(instance);

    const reactionPackets = resolveSpy.mock.calls.map(([packet]) => packet).filter((packet) => (
      packet.source.kind === "reaction" && packet.target.kind === "enemy" && packet.target.enemyId === "enemy_2"
    ));
    expect(reactionPackets).toHaveLength(1);
    expect(instance.getSnapshot()).toMatchObject({ killCount: 1, resources: { coins: 102 } });
    resolveSpy.mockRestore();
  });

  it("bounds explicit recursive reactions at depth four with one stable diagnostic", () => {
    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const instance = game({
      starts: [{ coord: ORIGIN }],
      enemies: [{ id: "grunt", hp: 100 }],
      towerDamage: 1,
      reactions: {
        loop: {
          label: "Loop",
          trigger: { damageTypes: ["physical"] },
          effects: {
            recurse: {
              kind: "damage", amount: { kind: "flat", value: 1 }, damageType: "physical",
              target: { kind: "primary" }, allowReactions: true
            }
          }
        }
      }
    });
    spawn(instance, 1);
    fireTower(instance);

    expect(enemyHp(instance, "enemy_1")).toBe(95);
    expect(reactionEvents(instance).map((event) => event.depth)).toEqual([0, 1, 2, 3, 4]);
    expect((instance.lastEvents as unknown as Array<Record<string, unknown>>).filter(
      (event) => event.type === "reactionBudgetExceeded" && event.budget === "depth"
    )).toEqual([expect.objectContaining({ limit: 4, dropped: 1, rootEnemyId: "enemy_1" })]);
    const reactionPackets = resolveSpy.mock.calls.map(([packet]) => packet).filter((packet) => packet.source.kind === "reaction");
    expect(reactionPackets).toHaveLength(4);
    resolveSpy.mockRestore();
  });

  it("[verifier] emits at most one depth diagnostic for a branching reaction root", () => {
    const recursiveEffect = {
      kind: "damage", amount: { kind: "flat", value: 1 }, damageType: "physical",
      target: { kind: "primary" }, allowReactions: true
    };
    const instance = game({
      starts: [{ coord: ORIGIN }],
      enemies: [{ id: "grunt", hp: 1000 }],
      towerDamage: 1,
      reactions: {
        branching_loop: {
          label: "Branching loop",
          trigger: { damageTypes: ["physical"] },
          effects: { a_branch: recursiveEffect, b_branch: recursiveEffect }
        }
      }
    });
    spawn(instance, 1);
    fireTower(instance);

    expect((instance.lastEvents as unknown as Array<Record<string, unknown>>).filter(
      (event) => event.type === "reactionBudgetExceeded" && event.budget === "depth"
    )).toEqual([expect.objectContaining({ limit: 4, dropped: 32, rootEnemyId: "enemy_1" })]);
  });

  it("[verifier] keeps TowerScript exposure applications within the global live-state budget", () => {
    const exposureCount = 253;
    const exposureIds = Array.from({ length: exposureCount }, (_, index) => `exposure_${index}`);
    const actions = exposureIds.map((exposureId) => ({
      action: "applyEnemyExposure" as const,
      target: "allEnemies" as const,
      exposureId
    }));
    const handlers = Array.from({ length: Math.ceil(actions.length / 64) }, (_, index) => ({
      id: `apply_${index}`,
      actions: actions.slice(index * 64, (index + 1) * 64)
    }));
    const instance = game({
      starts: [{ coord: ORIGIN, count: 65 }],
      reactions: {},
      exposures: {
        definitions: Object.fromEntries(exposureIds.map((exposureId) => [exposureId, {
          label: exposureId,
          duration: 10,
          maxStacks: 1
        }])),
        applications: { damageTypes: {} }
      },
      scripts: {
        exposure_budget: {
          schemaVersion: 5,
          id: "exposure_budget",
          bindings: [{ scope: "mission", ids: ["advanced"] }],
          handlers: { tick: handlers }
        }
      }
    });
    spawn(instance, 65);

    const enemies = instance.getSnapshot().reactions?.exposures.enemies ?? {};
    const liveEntries = Object.values(enemies).reduce(
      (total, states) => total + Object.keys(states).length,
      0
    );
    expect(liveEntries).toBeLessThanOrEqual(16_384);
  });

  it("admits only the first 256 secondary packets from binary effects", () => {
    const effects = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
      `effect_${index}`,
      {
        kind: "damage", amount: { kind: "flat", value: 1 }, damageType: "physical",
        target: { kind: "radius", radius: 1, maxTargets: 64 }
      }
    ]));
    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const instance = game({
      starts: [{ coord: ORIGIN, count: 65 }],
      enemies: [{ id: "grunt", hp: 1000 }],
      towerDamage: 1,
      reactions: {
        fanout: { label: "Fanout", trigger: { damageTypes: ["physical"] }, effects }
      }
    });
    spawn(instance, 65);
    fireTower(instance);

    const reactionPackets = resolveSpy.mock.calls.map(([packet]) => packet).filter((packet) => packet.source.kind === "reaction");
    expect(reactionPackets).toHaveLength(256);
    for (let index = 2; index <= 65; index += 1) expect(enemyHp(instance, `enemy_${index}`)).toBe(996);
    expect((instance.lastEvents as unknown as Array<Record<string, unknown>>).filter(
      (event) => event.type === "reactionBudgetExceeded" && event.budget === "secondary_packets"
    )).toEqual([expect.objectContaining({ limit: 256, dropped: 256, rootEnemyId: "enemy_1" })]);
    resolveSpy.mockRestore();
  });

  it("caps live exposures at 16,384, preserves the binary prefix, and emits one diagnostic", () => {
    const exposureIds = Array.from({ length: 256 }, (_, index) => `exposure_${index.toString().padStart(3, "0")}`);
    const definitions = Object.fromEntries(exposureIds.map((id) => [id, { label: id, duration: 10, maxStacks: 1 }]));
    const registry = content({
      starts: [{ coord: ORIGIN, count: 65 }],
      enemies: [{ id: "grunt", hp: 100 }],
      reactions: {},
      exposures: {
        definitions,
        applications: { damageTypes: { physical: [{ exposureId: exposureIds[0] }, { exposureId: exposureIds[1] }] } }
      }
    });
    const original = new TowerDefenseGame({ missionId: "advanced", content: registry, seed: "live-exposure-limit" });
    spawn(original, 65);
    const checkpoint = JSON.parse(JSON.stringify(original.createCheckpoint())) as GameCheckpointV1 & {
      state: GameCheckpointV1["state"] & { reactions?: unknown };
    };
    const otherEnemyIds = original.getSnapshot().enemies.map((enemy) => enemy.id)
      .filter((enemyId) => enemyId !== "enemy_1")
      .sort();
    const filled = Object.fromEntries(otherEnemyIds.slice(0, 63).map((enemyId) => [
      enemyId,
      Object.fromEntries(exposureIds.map((exposureId) => [exposureId, { stacks: 1, remaining: 10 }]))
    ]));
    filled[otherEnemyIds[63]!] = Object.fromEntries(exposureIds.slice(0, 255).map((exposureId) => [
      exposureId, { stacks: 1, remaining: 10 }
    ]));
    checkpoint.state.reactions = {
      schemaVersion: 1,
      exposures: { enemies: Object.fromEntries(Object.entries(filled).sort(([left], [right]) => left < right ? -1 : 1)) }
    };
    (checkpoint as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
    );
    const restored = TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint });
    fireTower(restored);

    const state = (restored.getSnapshot() as unknown as {
      reactions?: { exposures: { enemies: Record<string, Record<string, unknown>> } };
    }).reactions;
    const count = Object.values(state?.exposures.enemies ?? {})
      .reduce((total, exposures) => total + Object.keys(exposures).length, 0);
    expect(count).toBe(16_384);
    expect(state?.exposures.enemies.enemy_1).toEqual({
      [exposureIds[0]!]: { stacks: 1, remaining: 10 }
    });
    expect((restored.lastEvents as unknown as Array<Record<string, unknown>>).filter(
      (event) => event.type === "reactionBudgetExceeded" && event.budget === "live_exposures"
    )).toEqual([expect.objectContaining({ limit: 16_384, dropped: 1, rootEnemyId: "enemy_1" })]);
  });
});

describe("R1.5 recipe formula through marks, armor, resistance, and shields", () => {
  it("bases wet chain on source afterModifiers, then resolves recipient defenses through the common boundary", () => {
    const resolveSpy = vi.spyOn(DamageResolver, "resolve");
    const starts: StartFixture[] = [
      { coord: ORIGIN, terrain: "tagged_stone" },
      { coord: { q: 3, r: 3 }, terrain: "tagged_stone" },
      { coord: { q: 4, r: 3 }, terrain: "tagged_stone" }
    ];
    const instance = game({
      starts,
      enemies: [{ id: "grunt", hp: 100, resistances: { lightning: 0.5 } }],
      towerDamage: 20,
      towerDamageType: "lightning",
      abilities: { marker: ability("marker", 20, [{ kind: "damage", amount: 1 }]) },
      combat: {
        shields: { enemies: { grunt: { capacity: 5 } } },
        armorTypes: { plated: { label: "Plated", multipliers: { lightning: 0.5 } } },
        armorAssignments: { enemies: { grunt: "plated" } },
        marks: {
          definitions: {
            vulnerable: {
              label: "Vulnerable", duration: 10, maxStacks: 1,
              multiplier: 2, consumePolicy: "retain", damageTypes: ["lightning"]
            }
          },
          bindings: { abilities: { marker: [{ markId: "vulnerable" }] } }
        }
      },
      reactions: {
        wet_chain: {
          label: "Wet chain",
          trigger: { damageTypes: ["lightning"] },
          requirements: [{ kind: "terrain_tag", tag: "wet" }],
          effects: {
            chain: {
              kind: "damage",
              amount: { kind: "source_after_modifiers", multiplier: 0.5 },
              damageType: "lightning",
              target: { kind: "terrain_tag", tag: "wet", maxTargets: 32 }
            }
          }
        }
      }
    });
    spawn(instance, 3);
    expect(instance.useAbility("marker", ORIGIN).ok).toBe(true);
    fireTower(instance);

    expect(enemyHp(instance, "enemy_1")).toBe(94);
    expect(enemyHp(instance, "enemy_2")).toBe(99);
    expect(enemyHp(instance, "enemy_3")).toBe(99);
    const reactionPackets = resolveSpy.mock.calls.map(([packet]) => packet).filter((packet) => packet.source.kind === "reaction");
    expect(reactionPackets).toHaveLength(2);
    expect(reactionPackets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        amount: 10,
        damageType: "lightning",
        source: { kind: "reaction", reactionId: "wet_chain" },
        tags: ["reaction", "area"]
      })
    ]));
    const shields = (instance.getSnapshot() as unknown as {
      combat?: { shields: { enemies: Record<string, { current: number }> } };
    }).combat?.shields.enemies;
    expect(shields?.enemy_2?.current).toBe(0);
    expect(shields?.enemy_3?.current).toBe(0);
    resolveSpy.mockRestore();
  });
});
