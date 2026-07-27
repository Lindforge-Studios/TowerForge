import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import {
  computeCheckpointStateDigest,
  JournaledGameSession,
  NAVIGATION_LIMITS,
  replayGameCommandJournal,
  type GameCheckpointV1,
  type GameCommandJournalV1,
  type GameCommandV1
} from "../index.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import { createGridTopology } from "./topology.js";
import type { GridCoord, GridDefinition } from "./types.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CheckpointVersionStaysV1 = Assert<Equal<GameCheckpointV1["schemaVersion"], 1>>;
type CommandVersionStaysV1 = Assert<Equal<GameCommandV1["schemaVersion"], 1>>;
type JournalVersionStaysV1 = Assert<Equal<GameCommandJournalV1["schemaVersion"], 1>>;
type EngineVersionStaysV2 = Assert<Equal<GameCheckpointV1["engineVersion"], "towerforge-sim-v2">>;
const stablePublicVersions: [
  CheckpointVersionStaysV1,
  CommandVersionStaysV1,
  JournalVersionStaysV1,
  EngineVersionStaysV2
] = [true, true, true, true];
void stablePublicVersions;

type Activation = "absent" | "disabled" | "unselected" | "authored_routes" | "dynamic_flow";

interface NavigationStateContract {
  schemaVersion: number;
  movementProfileId: string;
  currentCoord: GridCoord;
  nextCoord?: GridCoord;
  edgeProgress: number;
  stepsEntered: number;
}

interface MutableCheckpointContract {
  schemaVersion: number;
  engineVersion: string;
  contentDigest: string;
  identity: GameCheckpointV1["identity"];
  rng: GameCheckpointV1["rng"];
  state: Omit<GameCheckpointV1["state"], "enemies"> & {
    enemies: Array<Record<string, unknown> & { navigation?: NavigationStateContract }>;
  };
  stateDigest: string;
}

interface FixtureOptions {
  activation?: Activation;
  height?: number;
  start?: GridCoord;
  goal?: GridCoord;
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function navigationInput(grid: GridDefinition, options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "dynamic_flow";
  const height = options.height ?? 3;
  const start = options.start ?? { q: 0, r: height === 1 ? 0 : 1 };
  const goal = options.goal ?? { q: 4, r: height === 1 ? 0 : 1 };
  const route = createGridTopology(grid).line(start, goal);
  const scripts: Record<string, TowerScriptDefinition> = {
    gate: {
      schemaVersion: 5,
      id: "gate",
      bindings: [{ scope: "global" }],
      handlers: {
        signal: [
          {
            when: { $op: "eq", args: [{ $get: "event.signal" }, "close"] },
            actions: [{ action: "setTileTerrain", target: { q: 1, r: start.r }, terrainId: "void" }]
          },
          {
            when: { $op: "eq", args: [{ $get: "event.signal" }, "open"] },
            actions: [{ action: "restoreTileTerrain", target: { q: 1, r: start.r } }]
          }
        ]
      }
    }
  };
  const selected = activation !== "absent" && activation !== "unselected";
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "navigation_checkpoint",
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
        },
        void: {
          id: "void", label: "Void", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker",
          label: "Walker",
          maxHp: 100,
          speed: 1,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "wave",
          label: "Wave",
          groups: [{ enemyId: "walker", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
        }]
      },
      missions: {
        navigation_checkpoint: {
          id: "navigation_checkpoint",
          label: "Navigation checkpoint",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 20 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: [],
          abilityIds: [],
          ...(selected ? { mechanics: { profiles: { navigation: "maze" } } } : {})
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 5,
        height,
        grid,
        defaultTerrain: "floor",
        spawnCoord: { ...start },
        coreCoord: { ...goal },
        pathCenterline: route.map((coord) => ({ ...coord })),
        pathRoutes: [{ id: "main", pathCenterline: route.map((coord) => ({ ...coord })) }],
        terrainOverrides: []
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#000000",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "navigation_checkpoint",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    },
    scripts,
    ...(activation === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          navigation: {
            schemaVersion: 1,
            enabled: activation !== "disabled",
            profiles: {
              maze: activation === "authored_routes"
                ? { mode: "authored_routes" as const }
                : {
                    mode: "dynamic_flow" as const,
                    defaultMovementProfileId: "ground",
                    movementProfiles: {
                      ground: {
                        label: "Ground",
                        terrainMode: "respect_walkable" as const,
                        towerOccupancy: "blocked" as const,
                        defaultTerrainCost: 1_000,
                        terrainCosts: { void: null }
                      }
                    },
                    enemyMovementProfiles: { walker: "ground" }
                  }
            }
          }
        }
      }
    })
  };
  return input;
}

function content(
  grid: GridDefinition = SQUARE,
  options: FixtureOptions = {}
): GameContentRegistry {
  return createGameContentRegistry(navigationInput(grid, options));
}

function game(subjectContent: GameContentRegistry): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "navigation_checkpoint",
    content: subjectContent,
    seed: "navigation-checkpoint-seed"
  });
}

function spawnMidEdge(subject: TowerDefenseGame, expectNavigation = true): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  subject.tick(0.125);
  const enemy = subject.getSnapshot().enemies[0];
  expect(enemy).toMatchObject({
    routeId: "main",
    pathProgress: 0.125
  });
  if (expectNavigation) {
    expect(enemy?.navigation).toMatchObject({ edgeProgress: 0.125, stepsEntered: 0 });
  } else {
    expect(Object.prototype.hasOwnProperty.call(enemy!, "navigation")).toBe(false);
  }
}

function mutable(checkpoint: GameCheckpointV1): MutableCheckpointContract {
  return checkpoint as unknown as MutableCheckpointContract;
}

function resign(checkpoint: MutableCheckpointContract): void {
  checkpoint.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state as unknown as GameCheckpointV1["state"]
  );
}

/** Supplies the desired nested state so semantic RED cases are not hidden by the missing encoder. */
function desiredCheckpoint(subject: TowerDefenseGame): MutableCheckpointContract {
  const checkpoint = mutable(jsonClone(subject.createCheckpoint()));
  const snapshotNavigation = subject.getSnapshot().enemies[0]?.navigation;
  expect(snapshotNavigation).toBeDefined();
  checkpoint.state.enemies[0]!.navigation = jsonClone(snapshotNavigation) as NavigationStateContract;
  resign(checkpoint);
  return checkpoint;
}

function mapFactorySpy(subjectContent: GameContentRegistry): ReturnType<typeof vi.fn> {
  const mission = subjectContent.missions.navigation_checkpoint!;
  const original = mission.mapFactory;
  const spy = vi.fn(() => original());
  Object.defineProperty(mission, "mapFactory", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: spy
  });
  return spy;
}

function restore(subjectContent: GameContentRegistry, checkpoint: MutableCheckpointContract): TowerDefenseGame {
  return TowerDefenseGame.fromCheckpoint({
    content: subjectContent,
    checkpoint: checkpoint as unknown as GameCheckpointV1
  });
}

function applySuffix(subject: TowerDefenseGame): void {
  subject.tick(0.075);
  subject.tick(0.2);
  subject.tick(0.2);
}

function enemyNavigation(checkpoint: MutableCheckpointContract): NavigationStateContract {
  const navigation = checkpoint.state.enemies[0]?.navigation;
  expect(navigation).toBeDefined();
  return navigation!;
}

describe("R2.4b dynamic navigation checkpoint codec and validation", () => {
  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("round-trips a plain-JSON %s mid-edge state without changing outer versions or serializing derived fields", (_label, grid) => {
    const subjectContent = content(grid);
    const continuous = game(subjectContent);
    spawnMidEdge(continuous);

    const checkpoint = mutable(jsonClone(continuous.createCheckpoint()));
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.stateDigest).toBe(continuous.getStateDigest());
    expect(Object.prototype.hasOwnProperty.call(checkpoint.state, "navigation")).toBe(false);
    expect(checkpoint.state).not.toHaveProperty("navigationFields");
    expect(checkpoint.state).not.toHaveProperty("navigationRevision");
    expect(checkpoint.state).not.toHaveProperty("navigationStats");
    expect(enemyNavigation(checkpoint)).toEqual({
      schemaVersion: 1,
      movementProfileId: "ground",
      currentCoord: { q: 0, r: 1 },
      nextCoord: expect.any(Object),
      edgeProgress: 0.125,
      stepsEntered: 0
    });
    expect(Object.keys(enemyNavigation(checkpoint)).sort()).toEqual([
      "currentCoord", "edgeProgress", "movementProfileId", "nextCoord", "schemaVersion", "stepsEntered"
    ]);

    const resumed = restore(subjectContent, mutable(jsonClone(checkpoint as unknown as GameCheckpointV1)));
    expect(resumed.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(resumed.getStateDigest()).toBe(continuous.getStateDigest());

    applySuffix(continuous);
    applySuffix(resumed);
    expect(resumed.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(resumed.getStateDigest()).toBe(continuous.getStateDigest());
  });

  it.each([
    ["active state missing navigation", (checkpoint: MutableCheckpointContract) => {
      delete checkpoint.state.enemies[0]!.navigation;
    }, /navigation.*missing|missing.*navigation/i, true],
    ["future navigation schema", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).schemaVersion = 2;
    }, /navigation.*schema|schema.*navigation/i, true],
    ["unknown movement profile", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).movementProfileId = "missing";
    }, /navigation.*profile|profile.*navigation/i, true],
    ["unknown route", (checkpoint: MutableCheckpointContract) => {
      checkpoint.state.enemies[0]!.routeId = "missing";
    }, /route/i, true],
    ["noninteger current coord", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).currentCoord.q = 0.5;
    }, /navigation.*(current|coord|integer)|(?:current|coord|integer).*navigation/i, true],
    ["out-of-map current coord", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).currentCoord.q = 99;
    }, /navigation.*(current|coord|map)|(?:current|coord|map).*navigation/i, true],
    ["noninteger next coord", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).nextCoord!.r = 0.5;
    }, /navigation.*(next|coord|integer)|(?:next|coord|integer).*navigation/i, true],
    ["out-of-map next coord", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).nextCoord!.q = 99;
    }, /navigation.*(next|coord|map)|(?:next|coord|map).*navigation/i, true],
    ["nonadjacent next coord", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).nextCoord = { q: 3, r: 1 };
    }, /navigation.*(?:adjacent|next)|(?:adjacent|next).*navigation/i, true],
    ["noncanonical lowering next coord", (checkpoint: MutableCheckpointContract) => {
      const navigation = enemyNavigation(checkpoint);
      const alternatives = [{ q: 1, r: 1 }, { q: 0, r: 0 }];
      navigation.nextCoord = alternatives.find((candidate) => (
        candidate.q !== navigation.nextCoord?.q || candidate.r !== navigation.nextCoord?.r
      ));
    }, /navigation.*canonical|canonical.*navigation/i, true],
    ["non-lowering next coord", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).nextCoord = { q: 0, r: 2 };
    }, /navigation.*(?:lower|next)|(?:lower|next).*navigation/i, true],
    ["negative edge progress", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).edgeProgress = -0.01;
    }, /navigation.*(?:edge|progress)|(?:edge|progress).*navigation/i, true],
    ["complete edge progress", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).edgeProgress = 1;
    }, /navigation.*(?:edge|progress)|(?:edge|progress).*navigation/i, true],
    ["nonfinite edge progress", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).edgeProgress = Number.NaN;
    }, /finite|number|navigation|canonical/i, false],
    ["negative steps entered", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).stepsEntered = -1;
    }, /navigation.*step|step.*navigation/i, true],
    ["fractional steps entered", (checkpoint: MutableCheckpointContract) => {
      enemyNavigation(checkpoint).stepsEntered = 0.5;
    }, /navigation.*step|step.*navigation/i, true],
    ["path progress mismatch", (checkpoint: MutableCheckpointContract) => {
      checkpoint.state.enemies[0]!.pathProgress = 0.5;
    }, /navigation.*pathProgress|pathProgress.*navigation|progress.*mismatch|mismatch.*progress/i, true],
    ["reachable non-goal without next", (checkpoint: MutableCheckpointContract) => {
      delete enemyNavigation(checkpoint).nextCoord;
      enemyNavigation(checkpoint).edgeProgress = 0;
      checkpoint.state.enemies[0]!.pathProgress = 0;
    }, /navigation.*(?:reachable|next)|(?:reachable|next).*navigation/i, true]
  ] as const)("rejects %s without mutating input and before constructing the restored map", (_label, mutate, errorPattern, shouldResign) => {
    const subjectContent = content(SQUARE, { start: { q: 0, r: 1 }, goal: { q: 4, r: 0 } });
    const source = game(subjectContent);
    spawnMidEdge(source);
    const checkpoint = desiredCheckpoint(source);
    mutate(checkpoint);
    if (shouldResign) resign(checkpoint);
    const before = structuredClone(checkpoint);
    const factory = mapFactorySpy(subjectContent);

    expect(() => restore(subjectContent, checkpoint)).toThrow(errorPattern);
    expect(factory).not.toHaveBeenCalled();
    expect(checkpoint).toEqual(before);
  });

  it("rejects navigation on an inactive mission before constructing the restored map", () => {
    const subjectContent = content(SQUARE, { activation: "absent" });
    const source = game(subjectContent);
    spawnMidEdge(source, false);
    const checkpoint = mutable(jsonClone(source.createCheckpoint()));
    checkpoint.state.enemies[0]!.navigation = {
      schemaVersion: 1,
      movementProfileId: "ground",
      currentCoord: { q: 0, r: 1 },
      nextCoord: { q: 1, r: 1 },
      edgeProgress: 0.125,
      stepsEntered: 0
    };
    resign(checkpoint);
    const before = structuredClone(checkpoint);
    const factory = mapFactorySpy(subjectContent);

    expect(() => restore(subjectContent, checkpoint)).toThrow(/navigation.*inactive|inactive.*navigation|unexpected.*navigation/i);
    expect(factory).not.toHaveBeenCalled();
    expect(checkpoint).toEqual(before);
  });

  it.each([
    ["future field", (navigation: NavigationStateContract) => {
      (navigation as unknown as Record<string, unknown>).futureField = true;
    }, /navigation.*field|field.*navigation|unsupported.*navigation/i],
    ["non-plain prototype", (navigation: NavigationStateContract) => {
      Object.setPrototypeOf(navigation, null);
    }, /navigation.*(?:plain|prototype)|(?:plain|prototype).*navigation/i],
    ["nested accessor", (navigation: NavigationStateContract) => {
      Object.defineProperty(navigation.currentCoord, "q", {
        enumerable: true,
        get: () => {
          throw new Error("navigation checkpoint accessor must not execute");
        }
      });
    }, /navigation.*(?:accessor|data property)|(?:accessor|data property).*navigation|canonical.*accessor/i]
  ] as const)("rejects hostile navigation %s without publishing a restored map", (_label, mutate, errorPattern) => {
    const subjectContent = content();
    const source = game(subjectContent);
    spawnMidEdge(source);
    const checkpoint = desiredCheckpoint(source);
    const navigation = enemyNavigation(checkpoint);
    mutate(navigation);
    const factory = mapFactorySpy(subjectContent);

    expect(() => restore(subjectContent, checkpoint)).toThrow(errorPattern);
    expect(factory).not.toHaveBeenCalled();
    if (_label === "non-plain prototype") expect(Object.getPrototypeOf(navigation)).toBe(null);
  });

  it("rejects more than the live dynamic enemy-state budget before constructing a restored map", () => {
    const subjectContent = content();
    const source = game(subjectContent);
    spawnMidEdge(source);
    const checkpoint = desiredCheckpoint(source);
    const template = checkpoint.state.enemies[0]!;
    checkpoint.state.enemies = Array.from(
      { length: NAVIGATION_LIMITS.liveEnemyStates + 1 },
      (_, index) => ({ ...jsonClone(template), id: `enemy_${index + 1}` })
    );
    (checkpoint.state as unknown as { enemyCounter: number }).enemyCounter = checkpoint.state.enemies.length;
    resign(checkpoint);
    const factory = mapFactorySpy(subjectContent);

    expect(() => restore(subjectContent, checkpoint)).toThrow(/navigation.*(?:enemy|state).*(?:budget|limit)|live.*enemy|16384/i);
    expect(factory).not.toHaveBeenCalled();
  }, 30_000);

  it("accepts a truly stalled non-goal state without nextCoord and resumes deterministically after terrain reopens", () => {
    const subjectContent = content(SQUARE, { height: 1 });
    const continuous = game(subjectContent);
    expect(continuous.startNextWave()).toEqual({ ok: true });
    continuous.tick(0);
    expect(continuous.emitScriptSignal("close")).toEqual({ ok: true });
    continuous.tick(0);
    const stalled = continuous.getSnapshot();
    expect(stalled.enemies[0]?.navigation).toMatchObject({
      currentCoord: { q: 0, r: 0 },
      edgeProgress: 0,
      stepsEntered: 0
    });
    expect(stalled.enemies[0]?.navigation).not.toHaveProperty("nextCoord");
    expect(stalled.navigation?.stalledEnemyIds).toEqual(["enemy_1"]);

    const checkpoint = desiredCheckpoint(continuous);
    const resumed = restore(subjectContent, mutable(jsonClone(checkpoint as unknown as GameCheckpointV1)));
    expect(resumed.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(resumed.getStateDigest()).toBe(continuous.getStateDigest());

    expect(continuous.emitScriptSignal("open")).toEqual({ ok: true });
    expect(resumed.emitScriptSignal("open")).toEqual({ ok: true });
    continuous.tick(0);
    resumed.tick(0);
    expect(resumed.getSnapshot().enemies[0]?.navigation?.nextCoord).toEqual({ q: 1, r: 0 });
    applySuffix(continuous);
    applySuffix(resumed);
    expect(resumed.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(resumed.getStateDigest()).toBe(continuous.getStateDigest());
  });

  it("stabilizes a terrain-closing signal before an immediate checkpoint without read-side repair", () => {
    const subjectContent = content(SQUARE, { height: 1 });
    const subject = game(subjectContent);
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);

    expect(subject.emitScriptSignal("close")).toEqual({ ok: true });
    const boundary = subject.getSnapshot();
    expect(boundary.enemies[0]?.navigation).toEqual({
      schemaVersion: 1,
      movementProfileId: "ground",
      currentCoord: { q: 0, r: 0 },
      edgeProgress: 0,
      stepsEntered: 0
    });
    expect(boundary.navigation?.stalledEnemyIds).toEqual(["enemy_1"]);

    const checkpoint = subject.createCheckpoint();
    expect(subject.getSnapshot()).toEqual(boundary);
    const resumed = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(resumed.getSnapshot()).toEqual(boundary);
    expect(resumed.getStateDigest()).toBe(subject.getStateDigest());
  });

  it("stabilizes a terrain-opening signal before an immediate checkpoint without read-side repair", () => {
    const subjectContent = content(SQUARE, { height: 1 });
    const subject = game(subjectContent);
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.emitScriptSignal("close")).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.getSnapshot().enemies[0]?.navigation).not.toHaveProperty("nextCoord");

    expect(subject.emitScriptSignal("open")).toEqual({ ok: true });
    const boundary = subject.getSnapshot();
    expect(boundary.enemies[0]?.navigation).toMatchObject({
      currentCoord: { q: 0, r: 0 },
      nextCoord: { q: 1, r: 0 },
      edgeProgress: 0,
      stepsEntered: 0
    });
    expect(boundary.navigation?.stalledEnemyIds).toEqual([]);

    const checkpoint = subject.createCheckpoint();
    expect(subject.getSnapshot()).toEqual(boundary);
    const resumed = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(resumed.getSnapshot()).toEqual(boundary);
    expect(resumed.getStateDigest()).toBe(subject.getStateDigest());
  });

  it("stabilizes terrain mutated by a tick handler before the tick returns", () => {
    const input = navigationInput(SQUARE, { height: 1 });
    input.scripts!.gate!.handlers.tick = [{
      actions: [{ action: "setTileTerrain", target: { q: 1, r: 0 }, terrainId: "void" }]
    }];
    const subjectContent = createGameContentRegistry(input);
    const subject = game(subjectContent);
    expect(subject.startNextWave()).toEqual({ ok: true });

    subject.tick(0);
    const boundary = subject.getSnapshot();
    expect(boundary.enemies[0]?.navigation).toEqual({
      schemaVersion: 1,
      movementProfileId: "ground",
      currentCoord: { q: 0, r: 0 },
      edgeProgress: 0,
      stepsEntered: 0
    });
    expect(boundary.navigation?.stalledEnemyIds).toEqual(["enemy_1"]);

    const checkpoint = subject.createCheckpoint();
    expect(subject.getSnapshot()).toEqual(boundary);
    expect(TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint }).getSnapshot()).toEqual(boundary);
  });
});

const START: GameCommandV1 = { schemaVersion: 1, type: "startWave" };
const TICK_ZERO: GameCommandV1 = { schemaVersion: 1, type: "tick", units: 0 };
const TICK_PARTIAL: GameCommandV1 = { schemaVersion: 1, type: "tick", units: 0.125 };
const TICK_SUFFIX: GameCommandV1 = { schemaVersion: 1, type: "tick", units: 0.2 };

describe("R2.4b dynamic navigation command journal and replay", () => {
  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("replays a full dynamic %s command stream and a mid-edge checkpoint boundary", (_label, grid) => {
    const subjectContent = content(grid);
    const continuous = game(subjectContent);
    const session = new JournaledGameSession(continuous);
    for (const command of [START, TICK_ZERO, TICK_PARTIAL, TICK_SUFFIX]) {
      expect(session.dispatch(command)).toEqual({ ok: true });
    }
    const journal = jsonClone(session.exportJournal());
    expect(journal.schemaVersion).toBe(1);
    expect(journal.engineVersion).toBe("towerforge-sim-v2");
    expect(journal.entries.map((entry) => entry.command.schemaVersion)).toEqual([1, 1, 1, 1]);
    const replayed = replayGameCommandJournal({ content: subjectContent, journal });
    expect(replayed.stateDigest).toBe(continuous.getStateDigest());
    expect(replayed.game.getSnapshot()).toEqual(continuous.getSnapshot());

    const boundaryExpected = game(subjectContent);
    const boundaryRecorded = game(subjectContent);
    spawnMidEdge(boundaryExpected);
    spawnMidEdge(boundaryRecorded);
    const boundarySession = new JournaledGameSession(boundaryRecorded);
    const emptyBoundary = jsonClone(boundarySession.exportJournal());
    const boundaryEnemy = emptyBoundary.initialCheckpoint.state.enemies[0];
    expect(boundaryEnemy?.navigation).toEqual(boundaryExpected.getSnapshot().enemies[0]?.navigation);
    expect(Object.prototype.hasOwnProperty.call(emptyBoundary.initialCheckpoint.state, "navigation")).toBe(false);
    const boundaryReplay = replayGameCommandJournal({ content: subjectContent, journal: emptyBoundary });
    expect(boundaryReplay.game.getSnapshot()).toEqual(boundaryExpected.getSnapshot());
    expect(boundaryReplay.stateDigest).toBe(boundaryExpected.getStateDigest());

    expect(boundarySession.dispatch(TICK_SUFFIX)).toEqual({ ok: true });
    expect(boundarySession.dispatch(TICK_SUFFIX)).toEqual({ ok: true });
    boundaryExpected.tick(TICK_SUFFIX.units);
    boundaryExpected.tick(TICK_SUFFIX.units);
    const suffixJournal = jsonClone(boundarySession.exportJournal());
    const suffixReplay = replayGameCommandJournal({ content: subjectContent, journal: suffixJournal });
    expect(suffixReplay.game.getSnapshot()).toEqual(boundaryExpected.getSnapshot());
    expect(suffixReplay.stateDigest).toBe(boundaryExpected.getStateDigest());
  });

  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("keeps legacy %s checkpoint and replay snapshots exact and free of navigation keys", (_label, grid) => {
    const snapshots = [];
    for (const activation of ["absent", "disabled", "unselected", "authored_routes"] as const) {
      const subjectContent = content(grid, { activation });
      const continuous = game(subjectContent);
      spawnMidEdge(continuous, false);
      const checkpoint = continuous.createCheckpoint();
      expect(Object.prototype.hasOwnProperty.call(checkpoint.state, "navigation"), activation).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(checkpoint.state.enemies[0]!, "navigation"), activation).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(continuous.getSnapshot(), "navigation"), activation).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(continuous.getSnapshot().enemies[0]!, "navigation"), activation).toBe(false);

      const session = new JournaledGameSession(continuous);
      expect(session.dispatch(TICK_SUFFIX)).toEqual({ ok: true });
      const journal = jsonClone(session.exportJournal());
      expect(Object.prototype.hasOwnProperty.call(journal.initialCheckpoint.state.enemies[0]!, "navigation"), activation).toBe(false);
      const replayed = replayGameCommandJournal({ content: subjectContent, journal });
      expect(replayed.game.getSnapshot()).toEqual(continuous.getSnapshot());
      expect(Object.prototype.hasOwnProperty.call(replayed.game.getSnapshot(), "navigation"), activation).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(replayed.game.getSnapshot().enemies[0]!, "navigation"), activation).toBe(false);
      snapshots.push(replayed.game.getSnapshot());
    }
    for (const snapshot of snapshots.slice(1)) expect(snapshot).toEqual(snapshots[0]);
  });
});
