import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import {
  computeCheckpointStateDigest,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCheckpointV1
} from "../index.js";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { dispatchGameCommand } from "./commands.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GridCoord, GridDefinition } from "./types.js";

type Mode = "active" | "null" | "legacy" | "absent" | "disabled" | "unselected" | "future"
  | "no_navigation" | "authored_routes";

interface Group {
  readonly enemyId: "walker" | "digger" | "flyer" | "attacker";
  readonly count?: number;
  readonly startDelay?: number;
}

interface FixtureOptions {
  readonly mode?: Mode;
  readonly capacity?: number;
  readonly blockedProfileIds?: readonly string[];
  readonly groups?: readonly Group[];
  readonly enemySpeed?: number;
  readonly heroSpeed?: number;
  readonly grid?: GridDefinition;
  readonly skillTree?: boolean;
  readonly passiveAura?: boolean;
  readonly attackerDamage?: number;
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

function skillTree(): Record<string, unknown> {
  return {
    points: { starting: 1, perInterwave: 0 },
    nodes: {
      focus: {
        label: "Focus", description: "Focus", cost: 1, requires: [],
        effects: [{
          kind: "modifier", scope: "hero_ability_damage",
          modifier: { target: "damage", operation: "flat", value: 1 }
        }]
      }
    }
  };
}

function passiveAura(): Record<string, unknown> {
  return {
    id: "command_link", label: "Command link", radius: 1,
    effects: [{
      kind: "modifier", scope: "tower_damage",
      modifier: { target: "damage", operation: "multiplier", value: 1 }
    }]
  };
}

function runtimeInput(options: FixtureOptions = {}): GameContentInput {
  const mode = options.mode ?? "active";
  const schemaVersion = mode === "legacy" ? 6 : mode === "future" ? 8 : 7;
  const block = mode === "null" ? null : {
    blockCapacity: options.capacity ?? 2,
    movementProfileIds: [...(options.blockedProfileIds ?? ["ground"])]
  };
  const definition: Record<string, unknown> = {
    label: "Commander",
    spawn: "core",
    movement: { movementProfileId: "hero_ground", speed: options.heroSpeed ?? 5 },
    durability: { maxHp: 10, shield: null },
    mana: { max: 100, starting: 100, regenerationPerUnit: 0 },
    activeAbility: {
      id: "arc_bolt", label: "Arc Bolt", target: "enemy",
      manaCost: 10, cooldown: 0, range: 20, damage: 10
    },
    skillTree: options.skillTree ? skillTree() : null,
    passiveAura: options.passiveAura ? passiveAura() : null,
    ...(mode === "legacy" ? {} : { blocking: block })
  };
  const heroesSelected = mode !== "absent" && mode !== "unselected";
  const navigationSelected = mode !== "no_navigation" && mode !== "authored_routes";
  const missionProfiles: Record<string, string> = {};
  if (heroesSelected) missionProfiles.heroes = "commanders";
  if (navigationSelected) missionProfiles.navigation = "maze";
  const groups = options.groups ?? [{ enemyId: "walker", count: 3 }];
  const enemySpeed = options.enemySpeed ?? 5;

  const modules: Record<string, unknown> = {};
  if (mode !== "absent") {
    modules.heroes = {
      schemaVersion,
      enabled: mode !== "disabled",
      profiles: {
        commanders: {
          selectedHeroId: "commander",
          definitions: { commander: definition },
          movementProfiles: {
            hero_ground: {
              label: "Hero ground", terrainMode: "respect_walkable",
              towerOccupancy: "blocked", defaultTerrainCost: 1_000
            }
          }
        }
      }
    };
  }
  if (mode !== "no_navigation") {
    modules.navigation = {
      schemaVersion: 1,
      enabled: true,
      profiles: {
        maze: mode === "authored_routes"
          ? { mode: "authored_routes" }
          : {
              mode: "dynamic_flow",
              defaultMovementProfileId: "ground",
              movementProfiles: {
                ground: {
                  label: "Ground", terrainMode: "respect_walkable",
                  towerOccupancy: "blocked", defaultTerrainCost: 1_000
                },
                burrow: {
                  label: "Burrow", terrainMode: "respect_walkable",
                  towerOccupancy: "ignored", defaultTerrainCost: 1_000
                },
                air: {
                  label: "Air", terrainMode: "ignore_walkable",
                  towerOccupancy: "ignored", defaultTerrainCost: 1_000
                }
              },
              enemyMovementProfiles: {
                walker: "ground", digger: "burrow", flyer: "air", attacker: "ground"
              }
            }
      }
    };
  }

  return {
    balance: {
      defaultMissionId: "hero_block",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 20, startingCoins: 100,
        startingResources: { coins: 100 }, prepTimeUnits: 0,
        moveTowerCost: { coins: 1 }, waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1, pathWaterDurationUnits: 1,
        pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        },
        wall: {
          id: "wall", label: "Wall", buildable: false, walkable: false,
          groundSpeedMultiplier: 0, tags: []
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 100, speed: enemySpeed,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        digger: {
          id: "digger", label: "Digger", maxHp: 100, speed: enemySpeed,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2
        },
        flyer: {
          id: "flyer", label: "Flyer", maxHp: 100, speed: enemySpeed,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 3,
          targetClass: "flying", movementKind: "direct_flying"
        },
        attacker: {
          id: "attacker", label: "Attacker", maxHp: 100, speed: enemySpeed,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 4,
          towerAttack: { interval: 0.01, damage: options.attackerDamage ?? 20, range: 0 }
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
          groups: groups.map((group) => ({
            enemyId: group.enemyId,
            count: group.count ?? 1,
            spawnInterval: 0,
            startDelay: group.startDelay ?? 0,
            routeId: "main"
          }))
        }]
      },
      missions: {
        hero_block: {
          id: "hero_block", label: "Hero block", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["probe"], abilityIds: [],
          ...(Object.keys(missionProfiles).length === 0 ? {} : { mechanics: { profiles: missionProfiles } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 5, height: 3, grid: options.grid ?? SQUARE,
        defaultTerrain: "floor", spawnCoord: { q: 0, r: 1 }, coreCoord: { q: 4, r: 1 },
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

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(runtimeInput(options));
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "hero_block", seed: "hero-blocking" });
}

function startAndTick(subject: TowerDefenseGame, ticks: number, delta = 0.2): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  for (let index = 0; index < ticks; index += 1) subject.tick(delta);
}

function blockingSnapshot(subject: TowerDefenseGame): any {
  return (subject.getSnapshot().heroes as any)?.units?.[0]?.blocking;
}

function heroSnapshot(subject: TowerDefenseGame): any {
  return (subject.getSnapshot().heroes as any)?.units?.[0];
}

function enemySnapshot(subject: TowerDefenseGame, enemyId: string): any {
  return subject.getSnapshot().enemies.find((enemy) => enemy.id === enemyId);
}

function internal(subject: TowerDefenseGame): any {
  return subject as any;
}

function resign(checkpoint: GameCheckpointV1): void {
  (checkpoint as any).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

describe("R5.6A deterministic dynamic hero blocking runtime (RED)", () => {
  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("holds at the authoritative %s topology anchor before a core leak", (_label, grid) => {
    const subject = game({ grid, capacity: 2 });
    startAndTick(subject, 4);
    expect(subject.coreHp).toBe(19);
    expect(blockingSnapshot(subject)).toEqual({
      blockCapacity: 2,
      active: true,
      blockedEnemyIds: ["enemy_1", "enemy_2"]
    });
    for (const enemyId of ["enemy_1", "enemy_2"]) {
      expect(enemySnapshot(subject, enemyId)).toMatchObject({
        navigation: { currentCoord: { q: 4, r: 1 }, edgeProgress: 0, stepsEntered: 4 },
        pathProgress: 4
      });
    }
  });

  it("uses only explicitly authored profile IDs and never infers ground/flying/burrowing eligibility", () => {
    const subject = game({
      capacity: 2,
      blockedProfileIds: ["air", "burrow"],
      groups: [{ enemyId: "walker" }, { enemyId: "digger" }, { enemyId: "flyer" }]
    });
    startAndTick(subject, 4);
    expect(blockingSnapshot(subject).blockedEnemyIds).toEqual(["enemy_2", "enemy_3"]);
    expect(subject.getSnapshot().enemies.map((enemy) => enemy.typeId).sort()).toEqual(["digger", "flyer"]);
    expect(subject.coreHp).toBe(19);
  });

  it("processes enemies and current holders by binary ID regardless of runtime array order", () => {
    const subject = game({ capacity: 2 });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    internal(subject).enemies.reverse();
    for (let index = 0; index < 4; index += 1) subject.tick(0.2);
    expect(blockingSnapshot(subject).blockedEnemyIds).toEqual(["enemy_1", "enemy_2"]);
    expect(subject.getSnapshot().enemies.map((enemy) => enemy.id).sort()).toEqual(["enemy_1", "enemy_2"]);
  });

  it("requires zero edge progress and a reachable field cell for current candidates", () => {
    const progressing = game({ capacity: 1 });
    expect(progressing.startNextWave()).toEqual({ ok: true });
    progressing.tick(0);
    const enemy = internal(progressing).enemies[0];
    enemy.navigation.currentCoord = { q: 4, r: 1 };
    enemy.navigation.nextCoord = undefined;
    enemy.navigation.edgeProgress = 0.5;
    enemy.navigation.stepsEntered = 4;
    enemy.pathProgress = 4.5;
    expect(blockingSnapshot(progressing).blockedEnemyIds).toEqual([]);

    const stalledInput = runtimeInput({ capacity: 1, groups: [{ enemyId: "walker" }], heroSpeed: 20 }) as any;
    stalledInput.maps.lane.spawnCoord = { q: 2, r: 1 };
    stalledInput.maps.lane.pathCenterline = [{ q: 2, r: 1 }, { q: 3, r: 1 }, { q: 4, r: 1 }];
    stalledInput.maps.lane.pathRoutes = [{
      id: "main", pathCenterline: [{ q: 2, r: 1 }, { q: 3, r: 1 }, { q: 4, r: 1 }]
    }];
    stalledInput.maps.lane.terrainOverrides = [0, 1, 2].map((r) => ({ q: 3, r, terrain: "wall" }));
    stalledInput.mechanics.modules.heroes.profiles.commanders.movementProfiles.hero_ground = {
      label: "Hero phase", terrainMode: "ignore_walkable", towerOccupancy: "ignored", defaultTerrainCost: 1_000
    };
    const stalled = new TowerDefenseGame({
      content: createGameContentRegistry(stalledInput), missionId: "hero_block", seed: "stalled-block"
    });
    expect(stalled.startNextWave()).toEqual({ ok: true });
    stalled.tick(0);
    expect(dispatchGameCommand(stalled, {
      schemaVersion: 6, type: "moveHero", heroId: "commander", target: { q: 2, r: 1 }
    })).toEqual({ ok: true });
    stalled.tick(0.2);
    expect(heroSnapshot(stalled).coord).toEqual({ q: 2, r: 1 });
    expect(stalled.getSnapshot().navigation?.stalledEnemyIds).toEqual(["enemy_1"]);
    expect(blockingSnapshot(stalled).blockedEnemyIds).toEqual([]);
  });

  it("acquires a new arrival after a multi-cell delta and lets overflow continue through a full anchor", () => {
    const subject = game({ capacity: 1, enemySpeed: 20, groups: [{ enemyId: "walker", count: 2 }] });
    startAndTick(subject, 1);
    expect(blockingSnapshot(subject).blockedEnemyIds).toEqual(["enemy_1"]);
    expect(subject.getSnapshot().enemies.map((enemy) => enemy.id)).toEqual(["enemy_1"]);
    expect(subject.coreHp).toBe(19);
  });

  it("keeps a mid-edge hero anchored, then releases old and reacquires new co-located enemies on entry", () => {
    const midEdge = game({ capacity: 1, enemySpeed: 20, heroSpeed: 1, groups: [{ enemyId: "walker" }] });
    startAndTick(midEdge, 1);
    expect(dispatchGameCommand(midEdge, {
      schemaVersion: 6, type: "moveHero", heroId: "commander", target: { q: 2, r: 1 }
    })).toEqual({ ok: true });
    midEdge.tick(0.2);
    expect(heroSnapshot(midEdge)).toMatchObject({
      coord: { q: 4, r: 1 },
      movement: { nextCoord: { q: 3, r: 1 }, edgeProgress: 0.2 }
    });
    expect(blockingSnapshot(midEdge).blockedEnemyIds).toEqual(["enemy_1"]);

    const transfer = game({ capacity: 1, heroSpeed: 5, groups: [{ enemyId: "walker", count: 2 }] });
    expect(transfer.startNextWave()).toEqual({ ok: true });
    transfer.tick(0);
    const [oldHolder, newHolder] = internal(transfer).enemies;
    Object.assign(oldHolder.navigation, {
      currentCoord: { q: 4, r: 1 }, nextCoord: undefined, edgeProgress: 0, stepsEntered: 4
    });
    oldHolder.pathProgress = 4;
    Object.assign(newHolder.navigation, {
      currentCoord: { q: 3, r: 1 }, nextCoord: { q: 4, r: 1 }, edgeProgress: 0, stepsEntered: 3
    });
    newHolder.pathProgress = 3;
    expect(blockingSnapshot(transfer).blockedEnemyIds).toEqual(["enemy_1"]);
    expect(dispatchGameCommand(transfer, {
      schemaVersion: 6, type: "moveHero", heroId: "commander", target: { q: 3, r: 1 }
    })).toEqual({ ok: true });
    transfer.tick(0.2);
    expect(heroSnapshot(transfer).coord).toEqual({ q: 3, r: 1 });
    expect(blockingSnapshot(transfer).blockedEnemyIds).toEqual(["enemy_2"]);
    expect(transfer.getSnapshot().enemies.map((candidate) => candidate.id)).toEqual(["enemy_2"]);
  });

  it("releases after defeat on the next movement phase and reports terminal state inactive immediately", () => {
    const defeated = game({
      capacity: 1, enemySpeed: 20, groups: [{ enemyId: "attacker" }], attackerDamage: 20
    });
    startAndTick(defeated, 1);
    expect(heroSnapshot(defeated).durability.defeated).toBe(true);
    expect(blockingSnapshot(defeated)).toEqual({ blockCapacity: 1, active: false, blockedEnemyIds: [] });
    expect(defeated.getSnapshot().enemies.map((enemy) => enemy.id)).toEqual(["enemy_1"]);
    defeated.tick(0.2);
    expect(defeated.getSnapshot().enemies).toEqual([]);
    expect(defeated.coreHp).toBe(19);

    const terminal = game({ capacity: 1, enemySpeed: 20, groups: [{ enemyId: "walker" }] });
    startAndTick(terminal, 1);
    internal(terminal).outcome = "victory";
    expect(blockingSnapshot(terminal)).toEqual({ blockCapacity: 1, active: false, blockedEnemyIds: [] });
  });

  it("does not retain a precomputed holder after an earlier binary enemy causes terminal defeat", () => {
    const subject = game({
      capacity: 1,
      blockedProfileIds: ["ground"],
      groups: [{ enemyId: "flyer" }, { enemyId: "walker" }]
    });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    subject.coreHp = 1;
    const [nonBlockable, blockable] = internal(subject).enemies;
    for (const enemy of [nonBlockable, blockable]) {
      Object.assign(enemy.navigation, {
        currentCoord: { q: 4, r: 1 },
        nextCoord: undefined,
        edgeProgress: 0,
        stepsEntered: 4
      });
      enemy.pathProgress = 4;
    }

    subject.tick(0);

    expect(subject.outcome).toBe("defeat");
    expect(subject.coreHp).toBe(0);
    expect(subject.getSnapshot().enemies).toEqual([]);
    expect(blockingSnapshot(subject)).toEqual({ blockCapacity: 1, active: false, blockedEnemyIds: [] });
  });

  it("does not change navigation occupancy, resolver generation/builds, placement safety, RNG, or events", () => {
    const subject = game({ capacity: 1, enemySpeed: 20, groups: [{ enemyId: "walker" }] });
    expect(subject.canPlaceTower("probe", { q: 2, r: 0 })).toEqual(
      game({ mode: "null", enemySpeed: 20, groups: [{ enemyId: "walker" }] })
        .canPlaceTower("probe", { q: 2, r: 0 })
    );
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    const resolver = internal(subject).navigationResolver;
    const beforeStats = resolver.getStats();
    const beforeRng = subject.createCheckpoint().rng;
    subject.tick(0.2);
    const afterStats = resolver.getStats();
    expect(afterStats.fieldBuildCount).toBe(beforeStats.fieldBuildCount);
    expect(afterStats.generation).toBe(beforeStats.generation);
    expect(subject.createCheckpoint().rng).toEqual(beforeRng);
    expect(subject.lastEvents.some((event) => /block/i.test(event.type))).toBe(false);

    const digest = subject.getStateDigest();
    const first = subject.getSnapshot();
    expect(subject.getSnapshot()).toEqual(first);
    expect(subject.getStateDigest()).toBe(digest);
  });

  it("bounds the authoritative output to 64 while sharing one field for more enemies", () => {
    const subject = game({ capacity: 64, enemySpeed: 20, groups: [{ enemyId: "walker", count: 65 }] });
    startAndTick(subject, 1);
    expect(blockingSnapshot(subject).blockedEnemyIds).toHaveLength(64);
    expect(blockingSnapshot(subject).blockedEnemyIds).toEqual(
      Array.from({ length: 65 }, (_, index) => `enemy_${index + 1}`).sort().slice(0, 64)
    );
    expect(subject.coreHp).toBe(19);
    expect(internal(subject).navigationResolver.getStats().fieldBuildCount).toBe(1);
  });

  it.each([
    ["absent", "absent", undefined],
    ["disabled", "disabled", undefined],
    ["unselected", "unselected", undefined],
    ["legacy v6", "legacy", 4],
    ["v7 null", "null", 4],
    ["future v8", "future", undefined]
  ] as const)("keeps literal legacy/null/future compatibility: %s", (_label, mode, snapshotVersion) => {
    const subject = game({ mode });
    const heroes = subject.getSnapshot().heroes;
    if (snapshotVersion === undefined) expect(heroes).toBeUndefined();
    else {
      expect(heroes?.schemaVersion).toBe(snapshotVersion);
      expect((heroes as any).units[0]).not.toHaveProperty("blocking");
    }
  });

  it.each([
    [false, false, 4, 3],
    [true, false, 5, 4],
    [false, true, 6, 3],
    [true, true, 6, 4]
  ] as const)(
    "downgrades blocking:null for tree=%s aura=%s to snapshot v%s/checkpoint v%s",
    (tree, aura, snapshotVersion, checkpointVersion) => {
      const subject = game({ mode: "null", skillTree: tree, passiveAura: aura });
      expect(subject.getSnapshot().heroes?.schemaVersion).toBe(snapshotVersion);
      expect(subject.createCheckpoint().state.heroes?.schemaVersion).toBe(checkpointVersion);
    }
  );

  it.each([
    [false, false, 3],
    [true, false, 4],
    [false, true, 3],
    [true, true, 4]
  ] as const)(
    "publishes v7 for tree=%s aura=%s with unchanged nested checkpoint",
    (tree, aura, checkpointVersion) => {
      const subject = game({ skillTree: tree, passiveAura: aura });
      const hero = heroSnapshot(subject);
      expect(subject.getSnapshot().heroes?.schemaVersion).toBe(7);
      expect(hero.skills === null).toBe(!tree);
      expect(hero.passiveAura === null).toBe(!aura);
      expect(hero.blocking).toEqual({ blockCapacity: 2, active: true, blockedEnemyIds: [] });
      expect(subject.createCheckpoint().state.heroes?.schemaVersion).toBe(checkpointVersion);
    }
  );

  it("round-trips derived holders through checkpoint and v6 journal replay without a new wire field", () => {
    const activeContent = content({ capacity: 2, enemySpeed: 20, groups: [{ enemyId: "walker", count: 3 }] });
    const subject = new TowerDefenseGame({ content: activeContent, missionId: "hero_block", seed: "checkpoint" });
    startAndTick(subject, 1);
    const checkpoint = subject.createCheckpoint();
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.state.heroes?.schemaVersion).toBe(3);
    expect((checkpoint.state.heroes?.unit as any)).not.toHaveProperty("blocking");
    const restored = TowerDefenseGame.fromCheckpoint({ content: activeContent, checkpoint });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    expect(blockingSnapshot(restored)).toEqual(blockingSnapshot(subject));
    restored.tick(0.2);
    subject.tick(0.2);
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());

    const session = new JournaledGameSession(new TowerDefenseGame({
      content: activeContent, missionId: "hero_block", seed: "journal"
    }));
    expect(session.dispatch({ schemaVersion: 6, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 6, type: "tick", units: 0 })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 6, type: "tick", units: 0.2 })).toEqual({ ok: true });
    const journal = session.exportJournal();
    expect(journal.schemaVersion).toBe(6);
    const replay = replayGameCommandJournal({ content: activeContent, journal });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  it("rejects a forged derived blocking checkpoint field through existing closed validators", () => {
    const activeContent = content({ enemySpeed: 20, groups: [{ enemyId: "walker" }] });
    const subject = new TowerDefenseGame({ content: activeContent, missionId: "hero_block" });
    startAndTick(subject, 1);
    const forged = JSON.parse(JSON.stringify(subject.createCheckpoint())) as GameCheckpointV1;
    Object.assign((forged.state.heroes as any).unit, { blockedEnemyIds: ["enemy_1"] });
    resign(forged);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: activeContent, checkpoint: forged }))
      .toThrow(/unknown|closed|field|blockedEnemyIds/i);
  });

  it("does not bump commands, journals, TowerScript, profile, campaign, or checkpoint version domains", () => {
    expect((Engine as any).GAME_COMMAND_SCHEMA_VERSION).toBe(6);
    expect((Engine as any).GAME_COMMAND_JOURNAL_SCHEMA_VERSION).toBe(6);
    expect((Engine as any).TOWER_SCRIPT_SCHEMA.schemaVersion).toBe(6);
    expect((Engine as any).GAME_CHECKPOINT_SCHEMA_VERSION).toBe(1);
    expect((Engine as any).PLAYER_PROFILE_SCHEMA_VERSION).toBe(3);
    expect((Engine as any).CAMPAIGN_RUN_SCHEMA_VERSION).toBe(1);
  });
});
