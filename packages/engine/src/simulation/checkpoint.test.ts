import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import {
  computeCheckpointStateDigest,
  TOWER_SCRIPT_LIMITS,
  type GameCheckpointV1
} from "../index.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GameSnapshot, GridDefinition } from "./types.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CheckpointSchemaVersionIsLiteralOne = Assert<Equal<GameCheckpointV1["schemaVersion"], 1>>;
type EngineVersionIsIndependentLiteral = Assert<Equal<GameCheckpointV1["engineVersion"], "towerforge-sim-v2">>;
const checkpointSchemaVersionIsLiteralOne: CheckpointSchemaVersionIsLiteralOne = true;
const engineVersionIsIndependentLiteral: EngineVersionIsIndependentLiteral = true;
void checkpointSchemaVersionIsLiteralOne;
void engineVersionIsIndependentLiteral;

function checkpointInput(grid: GridDefinition = { kind: "hex", layout: "odd-r" }): GameContentInput {
  const pathCenterline = Array.from({ length: 10 }, (_, q) => ({ q, r: 1 }));
  return {
    balance: {
      defaultMissionId: "checkpoint",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 25,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 2,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5,
        pathWaterDurationUnits: 3,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.35
      },
      abilities: {
        path_water: {
          id: "path_water",
          label: "Water",
          cooldown: 5,
          duration: 3,
          radius: 1
        },
        bind: {
          id: "bind",
          label: "Bind",
          cooldown: 4,
          duration: 2,
          radius: 4,
          effects: [{ kind: "status", status: { stun: 1.2, poison: { dps: 0.5, duration: 2.5 } } }]
        }
      },
      defaultDifficultyId: "normal",
      difficulties: [
        { id: "normal", label: "Normal", enemyHpMultiplier: 1 },
        { id: "hard", label: "Hard", enemyHpMultiplier: 1.1, enemySpeedMultiplier: 1.05 }
      ],
      metaProgression: {
        currencies: [{ id: "shards", label: "Shards" }],
        upgrades: {
          fortification: {
            id: "fortification",
            label: "Fortification",
            maxLevel: 1,
            costs: [{ shards: 1 }],
            effects: [{ kind: "coreHp", amountPerLevel: 2 }]
          }
        },
        rewardsByMission: {}
      },
      enemies: {
        durable: {
          id: "durable",
          label: "Durable",
          maxHp: 80,
          speed: 0.35,
          reward: { coins: 3 },
          coinReward: 3,
          coreDamage: 2,
          color: 0x778899
        },
        flier: {
          id: "flier",
          label: "Flier",
          maxHp: 80,
          speed: 0.35,
          reward: { coins: 3 },
          coinReward: 3,
          coreDamage: 2,
          color: 0x99aabb,
          movementKind: "direct_flying",
          targetClass: "flying"
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
            fireRate: 0.5,
            damagePerStack: 2,
            startingStacks: 1,
            maxStacks: 3,
            upgradeCost: 2
          }
        }
      },
      waveSets: {
        three: [{
          id: "wave_1",
          label: "Wave 1",
          groups: [{ enemyId: "durable", count: 3, spawnInterval: 0.6, startDelay: 0 }]
        }]
      },
      missions: {
        checkpoint: {
          id: "checkpoint",
          label: "Checkpoint",
          description: "",
          startingCoreHp: 25,
          startingResources: { coins: 100 },
          prepTimeUnits: 2,
          mapId: "lane",
          waveSetId: "three",
          buildTowerIds: ["pelter"],
          abilityIds: ["path_water", "bind"],
          objectives: {
            victory: [
              { id: "clear_waves", kind: "clearWaves" },
              { id: "kill_one", kind: "killCount", count: 1 }
            ],
            stars: [
              { id: "healthy_core", label: "Healthy core", kind: "coreHpAtLeast", amount: 20 },
              { id: "speed_star", label: "Speed star", kind: "timeAtMost", seconds: 60 }
            ]
          }
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 10,
        height: 3,
        grid,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 9, r: 1 },
        pathCenterline,
        pathRoutes: [],
        terrainOverrides: pathCenterline.slice(1, -1).map((coord) => ({ ...coord, terrain: "path" }))
      }
    },
    scripts: {
      clock: {
        schemaVersion: 2,
        id: "clock",
        bindings: [{ scope: "global" }],
        initialState: { runs: 0 },
        handlers: {
          tick: [{ id: "paced", every: 0.4, actions: [{ action: "incrementState", key: "runs" }] }]
        }
      }
    },
    worldMap: {
      width: 100,
      height: 100,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        accent: "#778899",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "checkpoint",
        regionId: "region",
        x: 50,
        y: 50,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function createContent(grid?: GridDefinition): GameContentRegistry {
  return createGameContentRegistry(checkpointInput(grid));
}

function createGame(content: GameContentRegistry): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "checkpoint",
    content,
    difficultyId: "hard",
    metaUpgradeLevels: { fortification: 1 },
    seed: "checkpoint-seed"
  });
}

function restore(content: GameContentRegistry, checkpoint: GameCheckpointV1): TowerDefenseGame {
  return TowerDefenseGame.fromCheckpoint({ content, checkpoint });
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function arrangeMidWave(game: TowerDefenseGame): void {
  expect(game.placeTower("pelter", { q: 2, r: 0 }).ok).toBe(true);
  expect(game.startNextWave().ok).toBe(true);
  game.tick(0.2);
  expect(game.useAbility("bind", { q: 0, r: 1 }).ok).toBe(true);
  expect(game.useAbility("path_water", { q: 1, r: 1 }).ok).toBe(true);

  const snapshot = game.getSnapshot();
  expect(snapshot.enemies[0]?.statuses?.stun?.remaining).toBeGreaterThan(0);
  expect(snapshot.enemies[0]?.statuses?.poison?.remaining).toBeGreaterThan(0);
  expect(snapshot.towers[0]?.cooldown).toBeGreaterThan(0);
  expect(snapshot.abilities.bind?.cooldownRemaining).toBeGreaterThan(0);
  expect(snapshot.terrainOverrides.length).toBeGreaterThan(0);
  expect(snapshot.scriptState.values.clock?.["global:global"]?.runs).toBe(1);
}

function applySuffix(game: TowerDefenseGame): void {
  game.tick(0.2);
  expect(game.sellTower("tower_1").ok).toBe(true);
  expect(game.placeTower("pelter", { q: 3, r: 0 }).ok).toBe(true);
  for (let index = 0; index < 12; index += 1) game.tick(0.2);
}

function mutableCheckpoint(checkpoint: GameCheckpointV1): {
  schemaVersion: number;
  engineVersion: string;
  contentDigest: string;
  stateDigest: string;
  identity: {
    missionId: string;
    difficultyId: string;
    metaUpgradeLevels: Record<string, number>;
  };
  rng: {
    initial: { schemaVersion: number; algorithm: string; words: number[] };
    current: { schemaVersion: number; algorithm: string; words: number[] };
  };
  state: Record<string, unknown>;
} {
  return checkpoint as unknown as {
    schemaVersion: number;
    engineVersion: string;
    contentDigest: string;
    stateDigest: string;
    identity: {
      missionId: string;
      difficultyId: string;
      metaUpgradeLevels: Record<string, number>;
    };
    rng: {
      initial: { schemaVersion: number; algorithm: string; words: number[] };
      current: { schemaVersion: number; algorithm: string; words: number[] };
    };
    state: Record<string, unknown>;
  };
}

type MutableCheckpoint = ReturnType<typeof mutableCheckpoint>;

function resignCheckpoint(checkpoint: MutableCheckpoint): void {
  checkpoint.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng as unknown as GameCheckpointV1["rng"],
    checkpoint.state as unknown as GameCheckpointV1["state"]
  );
}

function semanticCheckpoint(content: GameContentRegistry): MutableCheckpoint {
  const game = createGame(content);
  arrangeMidWave(game);
  expect(game.placeTower("pelter", { q: 4, r: 0 }).ok).toBe(true);
  return mutableCheckpoint(jsonRoundTrip(game.createCheckpoint()));
}

function createBudgetExhaustedGame(kind: "actions" | "terrain"): {
  content: GameContentRegistry;
  game: TowerDefenseGame;
} {
  const input = checkpointInput();
  const action = kind === "actions"
    ? { action: "incrementState" as const, key: "runs" }
    : { action: "setTileTerrain" as const, target: { q: 8, r: 0 }, terrainId: "water", duration: 10 };
  const handlerSizes = kind === "actions" ? Array(9).fill(64) : [64, 1];
  input.scripts = {
    ...(input.scripts ?? {}),
    exhaust_budget: {
      schemaVersion: 2,
      id: "exhaust_budget",
      bindings: [{ scope: "global" }],
      initialState: { runs: 0 },
      handlers: {
        signal: handlerSizes.map((size, index) => ({
          id: `exhaust_${index}`,
          actions: Array.from({ length: size }, () => structuredClone(action))
        }))
      }
    }
  };
  const content = createGameContentRegistry(input);
  const game = createGame(content);
  expect(game.emitScriptSignal("exhaust").ok).toBe(true);
  return { content, game };
}

function createOversizedSetStateGame(): { content: GameContentRegistry; game: TowerDefenseGame } {
  const input = checkpointInput();
  input.scripts = {
    ...(input.scripts ?? {}),
    oversized_state: {
      schemaVersion: 2,
      id: "oversized_state",
      bindings: [{ scope: "global" }],
      initialState: { stable: "kept" },
      handlers: {
        signal: [{
          id: "try_oversized",
          actions: [{ action: "setState", key: "oversized", value: { $get: "event.payload" } }]
        }]
      }
    }
  };
  const content = createGameContentRegistry(input);
  const game = createGame(content);
  const payload = "x".repeat(TOWER_SCRIPT_LIMITS.externalSignalPayloadBytes - 16);
  expect(game.emitScriptSignal("oversized", payload).ok).toBe(true);
  return { content, game };
}

describe("GameCheckpointV1", () => {
  it("round-trips a pristine game through plain JSON and exposes stable digests", () => {
    const content = createContent();
    const game = createGame(content);
    const checkpoint = game.createCheckpoint();
    const publicContract: GameCheckpointV1 = checkpoint;

    expect(publicContract.schemaVersion).toBe(1);
    expect(publicContract.engineVersion).toBe("towerforge-sim-v2");
    expect(publicContract.contentDigest).toMatch(/^tf-content-v1:[0-9a-f]{16}$/);
    expect(publicContract.identity).toEqual({
      missionId: "checkpoint",
      difficultyId: "hard",
      metaUpgradeLevels: { fortification: 1 }
    });
    expect(publicContract.rng).toEqual({
      initial: {
        schemaVersion: 1,
        algorithm: "xoshiro128ss",
        words: expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)])
      },
      current: {
        schemaVersion: 1,
        algorithm: "xoshiro128ss",
        words: expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)])
      }
    });
    expect(publicContract.rng.initial.words).toHaveLength(4);
    expect(publicContract.rng.current.words).toHaveLength(4);
    expect(publicContract.stateDigest).toMatch(/^tf-state-v1:[0-9a-f]{16}$/);
    expect(publicContract.stateDigest).toBe(game.getStateDigest());

    const restored = restore(content, jsonRoundTrip(checkpoint));
    expect(restored.getSnapshot()).toEqual(game.getSnapshot());
    expect(restored.getStateDigest()).toBe(game.getStateDigest());
  });

  it.each([
    ["hex", { kind: "hex", layout: "odd-r" } as const],
    ["square", { kind: "square", adjacency: "cardinal" } as const]
  ])("restores a %s mid-wave and produces the exact continuous suffix state", (_label, grid) => {
    const content = createContent(grid);
    const continuous = createGame(content);
    arrangeMidWave(continuous);

    const checkpoint = jsonRoundTrip(continuous.createCheckpoint());
    const resumed = restore(content, checkpoint);
    expect(resumed.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(resumed.getTowerIdAt({ q: 2, r: 0 })).toBe("tower_1");

    applySuffix(continuous);
    applySuffix(resumed);

    expect(resumed.getStateDigest()).toBe(continuous.getStateDigest());
    expect(resumed.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(resumed.towers.map((tower) => tower.id)).toEqual(["tower_2"]);
    expect(new Set(resumed.enemies.map((enemy) => enemy.id)).size).toBe(resumed.enemies.length);
    expect(resumed.enemies.map((enemy) => enemy.id)).toEqual(["enemy_1", "enemy_2", "enemy_3"]);
    expect(resumed.getSnapshot().scriptState.values.clock?.["global:global"]?.runs).toBeGreaterThan(1);
  });

  it("returns a detached checkpoint and restores without retaining checkpoint references", () => {
    const content = createContent();
    const game = createGame(content);
    arrangeMidWave(game);
    const snapshotBefore = game.getSnapshot();
    const checkpoint = game.createCheckpoint();
    const checkpointBefore = jsonRoundTrip(checkpoint);

    game.resources.coins = 1;
    game.enemies[0]!.hp = 1;
    expect(checkpoint).toEqual(checkpointBefore);

    const restored = restore(content, checkpoint);
    const restoredBefore = restored.getSnapshot();
    const restoredDigestBefore = restored.getStateDigest();
    const mutable = mutableCheckpoint(checkpoint);
    (mutable.state.resources as Record<string, number>).coins = 999_999;
    (mutable.state.enemies as Array<Record<string, unknown>>)[0]!.hp = 999_999;
    mutable.rng.current.words[0] = (mutable.rng.current.words[0]! + 1) >>> 0;

    expect(restored.getSnapshot()).toEqual(restoredBefore);
    expect(restored.getStateDigest()).toBe(restoredDigestBefore);
    expect(restored.getSnapshot()).toEqual(snapshotBefore);
  });

  it("rejects a future envelope before touching state or invoking the mission map factory", () => {
    const content = createContent();
    const game = createGame(content);
    const future = mutableCheckpoint(jsonRoundTrip(game.createCheckpoint()));
    future.schemaVersion = 2;
    Object.defineProperty(future, "state", {
      enumerable: true,
      get: () => {
        throw new Error("future checkpoint state must not be inspected");
      }
    });
    const mapFactory = vi.fn(() => {
      throw new Error("mapFactory must not run for an unsupported checkpoint version");
    });
    Object.defineProperty(content.missions.checkpoint!, "mapFactory", { value: mapFactory });

    expect(() => restore(content, future as unknown as GameCheckpointV1)).toThrow(/checkpoint.*version|version.*checkpoint/i);
    expect(mapFactory).not.toHaveBeenCalled();
  });

  it.each([
    ["engine", (checkpoint: ReturnType<typeof mutableCheckpoint>) => { checkpoint.engineVersion = "towerforge-sim-v1"; }],
    ["RNG state", (checkpoint: ReturnType<typeof mutableCheckpoint>) => { checkpoint.rng.current.schemaVersion = 2; }]
  ])("rejects an incompatible %s version before invoking the mission map factory", (_label, mutate) => {
    const content = createContent();
    const checkpoint = mutableCheckpoint(jsonRoundTrip(createGame(content).createCheckpoint()));
    mutate(checkpoint);
    const mapFactory = vi.fn(() => {
      throw new Error("mapFactory must not run for an unsupported checkpoint header");
    });
    Object.defineProperty(content.missions.checkpoint!, "mapFactory", { value: mapFactory });

    expect(() => restore(content, checkpoint as unknown as GameCheckpointV1)).toThrow(/engine|rng|version|algorithm/i);
    expect(mapFactory).not.toHaveBeenCalled();
  });

  it("rejects a gameplay-content mismatch before invoking the mismatched map factory", () => {
    const source = createContent();
    const checkpoint = createGame(source).createCheckpoint();
    const changedInput = checkpointInput();
    changedInput.balance.enemies.durable!.maxHp += 1;
    const changed = createGameContentRegistry(changedInput);
    const mapFactory = vi.fn(changed.missions.checkpoint!.mapFactory);
    Object.defineProperty(changed.missions.checkpoint!, "mapFactory", { value: mapFactory });

    expect(() => restore(changed, checkpoint)).toThrow(/content.*(digest|mismatch)|mismatch.*content/i);
    expect(mapFactory).not.toHaveBeenCalled();
  });

  it.each([
    ["difficulty", (checkpoint: ReturnType<typeof mutableCheckpoint>) => { checkpoint.identity.difficultyId = "missing"; }],
    ["meta upgrade", (checkpoint: ReturnType<typeof mutableCheckpoint>) => { checkpoint.identity.metaUpgradeLevels.unknown = 1; }],
    ["meta level", (checkpoint: ReturnType<typeof mutableCheckpoint>) => { checkpoint.identity.metaUpgradeLevels.fortification = 2; }]
  ])("rejects an invalid checkpoint %s identity", (_label, mutate) => {
    const content = createContent();
    const checkpoint = mutableCheckpoint(jsonRoundTrip(createGame(content).createCheckpoint()));
    mutate(checkpoint);

    expect(() => restore(content, checkpoint as unknown as GameCheckpointV1)).toThrow(/identity|difficulty|meta|upgrade|level/i);
  });

  it("includes the initial RNG state in the state digest", () => {
    const content = createContent();
    const checkpoint = mutableCheckpoint(jsonRoundTrip(createGame(content).createCheckpoint()));
    checkpoint.rng.initial.words[0] = (checkpoint.rng.initial.words[0]! + 1) >>> 0;

    expect(() => restore(content, checkpoint as unknown as GameCheckpointV1)).toThrow(/state.*digest|digest.*state|tamper/i);
  });

  it.each([
    ["top-level", (checkpoint: ReturnType<typeof mutableCheckpoint>) => {
      (checkpoint as unknown as Record<string, unknown>).unexpected = true;
    }],
    ["state", (checkpoint: ReturnType<typeof mutableCheckpoint>) => {
      checkpoint.state.unexpected = true;
    }]
  ])("rejects an extra %s checkpoint field", (_label, mutate) => {
    const content = createContent();
    const checkpoint = mutableCheckpoint(jsonRoundTrip(createGame(content).createCheckpoint()));
    mutate(checkpoint);

    expect(() => restore(content, checkpoint as unknown as GameCheckpointV1)).toThrow(/checkpoint|field|state|digest/i);
  });

  it("rejects a state accessor without invoking it", () => {
    const content = createContent();
    const checkpoint = mutableCheckpoint(jsonRoundTrip(createGame(content).createCheckpoint()));
    let reads = 0;
    Object.defineProperty(checkpoint.state, "coreHp", {
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error("checkpoint state accessor must not execute");
      }
    });

    expect(() => restore(content, checkpoint as unknown as GameCheckpointV1)).toThrow(/accessor|data property|checkpoint|state/i);
    expect(reads).toBe(0);
  });

  it.each([
    ["extra tower field", (checkpoint: MutableCheckpoint) => {
      const tower = (checkpoint.state.towers as Array<Record<string, unknown>>)[0]!;
      tower.unexpected = true;
    }],
    ["missing tower field", (checkpoint: MutableCheckpoint) => {
      const tower = (checkpoint.state.towers as Array<Record<string, unknown>>)[0]!;
      delete tower.cooldown;
    }],
    ["negative nested enemy status duration", (checkpoint: MutableCheckpoint) => {
      const enemy = (checkpoint.state.enemies as Array<Record<string, unknown>>)[0]!;
      const statuses = enemy.statuses as Record<string, Record<string, unknown>>;
      statuses.stun!.remaining = -0.1;
    }],
    ["unknown enemy route", (checkpoint: MutableCheckpoint) => {
      const enemy = (checkpoint.state.enemies as Array<Record<string, unknown>>)[0]!;
      enemy.routeId = "missing_route";
    }],
    ["TowerScript action budget above its limit", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.scriptActionsRemaining = TOWER_SCRIPT_LIMITS.actionsPerTransaction + 1;
    }],
    ["TowerScript terrain budget above its limit", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.scriptTerrainChangesRemaining = TOWER_SCRIPT_LIMITS.terrainChangesPerTransaction + 1;
    }],
    ["TowerScript signal depth above its limit", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.scriptSignalDepth = TOWER_SCRIPT_LIMITS.signalRecursionDepth + 1;
    }],
    ["duplicate completed objective ids", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.completedObjectiveIds = ["clear_waves", "clear_waves"];
    }],
    ["duplicate terrain override coordinates", (checkpoint: MutableCheckpoint) => {
      const overrides = checkpoint.state.runtimeTerrainOverrides as Array<Record<string, unknown>>;
      overrides.push(structuredClone(overrides[0]!));
    }],
    ["empty tower footprint", (checkpoint: MutableCheckpoint) => {
      const tower = (checkpoint.state.towers as Array<Record<string, unknown>>)[0]!;
      tower.footprint = [];
    }],
    ["tower footprint inconsistent with its coord and type", (checkpoint: MutableCheckpoint) => {
      const tower = (checkpoint.state.towers as Array<Record<string, unknown>>)[0]!;
      tower.footprint = [{ q: 5, r: 0 }];
    }],
    ["overlapping tower footprints", (checkpoint: MutableCheckpoint) => {
      const towers = checkpoint.state.towers as Array<Record<string, unknown>>;
      towers[1]!.footprint = structuredClone(towers[0]!.footprint);
    }]
  ])("rejects a digest-valid checkpoint with %s without mutating its input", (_label, mutate) => {
    const content = createContent();
    const checkpoint = semanticCheckpoint(content);
    mutate(checkpoint);
    resignCheckpoint(checkpoint);
    const before = jsonRoundTrip(checkpoint);

    expect(() => restore(content, checkpoint as unknown as GameCheckpointV1)).toThrow(
      /checkpoint|state|tower|enemy|status|route|budget|objective|terrain|footprint|overlap/i
    );
    expect(checkpoint).toEqual(before);
  });

  it.each([
    ["prototype-unsafe enemy type id", (checkpoint: MutableCheckpoint) => {
      const enemy = (checkpoint.state.enemies as Array<Record<string, unknown>>)[0]!;
      enemy.typeId = "__proto__";
    }],
    ["prototype-unsafe tower type id", (checkpoint: MutableCheckpoint) => {
      const tower = (checkpoint.state.towers as Array<Record<string, unknown>>)[0]!;
      tower.typeId = "__proto__";
    }],
    ["enemy counter below a live numeric id", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.enemyCounter = 0;
    }],
    ["tower counter below a live numeric id", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.towerCounter = 1;
    }],
    ["unknown ability cooldown id", (checkpoint: MutableCheckpoint) => {
      (checkpoint.state.abilityCooldowns as Record<string, number>).missing_ability = 1;
    }],
    ["unknown kill-count enemy id", (checkpoint: MutableCheckpoint) => {
      (checkpoint.state.killCountByEnemyType as Record<string, number>).missing_enemy = 1;
    }],
    ["duplicate earned star ids", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.earnedStarIds = ["healthy_core", "healthy_core"];
    }],
    ["unauthored completed objective id", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.completedObjectiveIds = ["missing_objective"];
    }],
    ["unauthored earned star id", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.earnedStarIds = ["missing_star"];
    }],
    ["unknown queued spawn route", (checkpoint: MutableCheckpoint) => {
      const spawn = (checkpoint.state.spawnQueue as Array<Record<string, unknown>>)[0]!;
      spawn.routeId = "missing_route";
    }],
    ["malformed last event", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.lastEvents = [{ type: "not_an_engine_event" }];
      checkpoint.state.scriptEventCursor = 0;
    }],
    ["malformed script diagnostic", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.scriptDiagnostics = [{ scriptId: "clock" }];
    }],
    ["malformed nested script values", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.scriptValues = { clock: [] };
    }]
  ])("rejects verifier case %s after digest recomputation", (_label, mutate) => {
    const content = createContent();
    const checkpoint = semanticCheckpoint(content);
    mutate(checkpoint);
    resignCheckpoint(checkpoint);
    const before = jsonRoundTrip(checkpoint);

    expect(() => restore(content, checkpoint as unknown as GameCheckpointV1)).toThrow(
      /checkpoint|state|enemy|tower|counter|ability|objective|star|route|event|diagnostic|script/i
    );
    expect(checkpoint).toEqual(before);
  });

  it.each([
    ["noncanonical completed-objective order", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.completedObjectiveIds = ["kill_one", "clear_waves"];
    }],
    ["noncanonical earned-star order", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.earnedStarIds = ["speed_star", "healthy_core"];
    }],
    ["reversed spawn queue", (checkpoint: MutableCheckpoint) => {
      (checkpoint.state.spawnQueue as unknown[]).reverse();
    }],
    ["strictly past queued spawn", (checkpoint: MutableCheckpoint) => {
      const spawn = (checkpoint.state.spawnQueue as Array<Record<string, unknown>>)[0]!;
      checkpoint.state.missionElapsed = 2;
      spawn.at = 1;
    }],
    ["enemy progress beyond its resolved track", (checkpoint: MutableCheckpoint) => {
      const enemy = (checkpoint.state.enemies as Array<Record<string, unknown>>)[0]!;
      enemy.pathProgress = 10;
    }],
    ["enemy hp above maxHp", (checkpoint: MutableCheckpoint) => {
      const enemy = (checkpoint.state.enemies as Array<Record<string, number>>)[0]!;
      enemy.hp = enemy.maxHp! + 1;
    }],
    ["enemy maxHp inconsistent with authored content", (checkpoint: MutableCheckpoint) => {
      const enemy = (checkpoint.state.enemies as Array<Record<string, number>>)[0]!;
      enemy.maxHp = enemy.maxHp! + 1;
    }],
    ["invalid phase spawn trigger", (checkpoint: MutableCheckpoint) => {
      const enemy = (checkpoint.state.enemies as Array<Record<string, unknown>>)[0]!;
      enemy.phaseSpawnsTriggered = ["0.5:missing_enemy"];
    }],
    ["route on a direct-flying enemy", (checkpoint: MutableCheckpoint) => {
      const enemy = (checkpoint.state.enemies as Array<Record<string, unknown>>)[0]!;
      enemy.typeId = "flier";
      enemy.routeId = "main";
    }],
    ["handler timer in the future", (checkpoint: MutableCheckpoint) => {
      const timers = checkpoint.state.scriptHandlerLastRun as Record<string, number>;
      const key = Object.keys(timers)[0]!;
      timers[key] = (checkpoint.state.missionElapsed as number) + 1;
    }],
    ["invalid handler timer key", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.scriptHandlerLastRun = { "clock:invalid_binding:missing_handler": 0 };
    }],
    ["unsafe enemy counter", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.enemyCounter = Number.MAX_SAFE_INTEGER + 1;
    }],
    ["unsafe tower counter", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.towerCounter = Number.MAX_SAFE_INTEGER + 1;
    }],
    ["oversized TowerScript binding state", (checkpoint: MutableCheckpoint) => {
      const scripts = checkpoint.state.scriptValues as Record<string, Record<string, unknown>>;
      scripts.clock!["global:global"] = {
        oversized: "x".repeat(TOWER_SCRIPT_LIMITS.stateBytesPerBinding)
      };
    }],
    ["too many retained script diagnostics", (checkpoint: MutableCheckpoint) => {
      checkpoint.state.scriptDiagnostics = Array.from(
        { length: TOWER_SCRIPT_LIMITS.retainedDiagnostics + 1 },
        () => ({
          scriptId: "clock",
          handlerId: "paced",
          event: "tick",
          code: "runtime_error",
          message: "retained diagnostic"
        })
      );
    }]
  ])("rejects re-review case %s after digest recomputation", (_label, mutate) => {
    const content = createContent();
    const checkpoint = semanticCheckpoint(content);
    mutate(checkpoint);
    resignCheckpoint(checkpoint);
    const before = jsonRoundTrip(checkpoint);

    expect(() => restore(content, checkpoint as unknown as GameCheckpointV1)).toThrow(
      /checkpoint|state|canonical|order|spawn|enemy|track|hp|phase|flying|route|handler|timer|counter|script|diagnostic|limit/i
    );
    expect(checkpoint).toEqual(before);
  });

  it("preserves immediate state-digest equality for an accepted mid-wave checkpoint", () => {
    const content = createContent();
    const checkpoint = semanticCheckpoint(content);
    const restored = restore(content, checkpoint as unknown as GameCheckpointV1);

    expect(restored.getStateDigest()).toBe(checkpoint.stateDigest);
    expect(restored.createCheckpoint().stateDigest).toBe(checkpoint.stateDigest);
  });

  it("round-trips immediately after startNextWave when the first spawn is exactly due", () => {
    const content = createContent();
    const game = createGame(content);
    expect(game.startNextWave().ok).toBe(true);
    const checkpoint = game.createCheckpoint();

    expect(checkpoint.state.spawnQueue[0]?.at).toBe(checkpoint.state.missionElapsed);
    const restored = restore(content, jsonRoundTrip(checkpoint));
    expect(restored.getStateDigest()).toBe(checkpoint.stateDigest);
    expect(restored.getSnapshot()).toEqual(game.getSnapshot());
  });

  it.each(["actions", "terrain"] as const)(
    "restores its own checkpoint after TowerScript %s budget exhaustion",
    (kind) => {
      const { content, game } = createBudgetExhaustedGame(kind);
      const checkpoint = game.createCheckpoint();
      const budgetValue = kind === "actions"
        ? checkpoint.state.scriptActionsRemaining
        : checkpoint.state.scriptTerrainChangesRemaining;
      expect(budgetValue).toBe(0);

      const restored = restore(content, jsonRoundTrip(checkpoint));
      expect(restored.getStateDigest()).toBe(checkpoint.stateDigest);
      expect(restored.getSnapshot()).toEqual(game.getSnapshot());
    }
  );

  it("rolls back an oversized TowerScript setState and keeps its self-checkpoint restorable", () => {
    const { content, game } = createOversizedSetStateGame();
    const checkpoint = game.createCheckpoint();
    const restored = restore(content, jsonRoundTrip(checkpoint));
    const liveState = game.getSnapshot().scriptState.values.oversized_state?.["global:global"];
    const restoredState = restored.getSnapshot().scriptState.values.oversized_state?.["global:global"];

    expect(Object.keys(liveState ?? {}).sort()).toEqual(["stable"]);
    expect(Object.keys(restoredState ?? {}).sort()).toEqual(["stable"]);
    expect(liveState?.stable).toBe("kept");
    expect(restoredState?.stable).toBe("kept");
    expect(restored.getStateDigest()).toBe(checkpoint.stateDigest);
  });

  it("rejects tampered or malformed state without mutating the input checkpoint", () => {
    const content = createContent();
    const game = createGame(content);
    arrangeMidWave(game);

    const tampered = mutableCheckpoint(jsonRoundTrip(game.createCheckpoint()));
    tampered.state.coreHp = 1;
    const tamperedBefore = jsonRoundTrip(tampered);
    expect(() => restore(content, tampered as unknown as GameCheckpointV1)).toThrow(/state.*digest|digest.*state|tamper/i);
    expect(tampered).toEqual(tamperedBefore);

    const malformed = mutableCheckpoint(jsonRoundTrip(game.createCheckpoint()));
    malformed.state = {};
    const malformedBefore = jsonRoundTrip(malformed);
    expect(() => restore(content, malformed as unknown as GameCheckpointV1)).toThrow(/checkpoint|state/i);
    expect(malformed).toEqual(malformedBefore);
  });

  it("does not let snapshot-only presentation data define the restored state digest", () => {
    const source = createContent();
    const game = createGame(source);
    arrangeMidWave(game);
    const checkpoint = game.createCheckpoint();

    const relabeledInput = checkpointInput();
    relabeledInput.balance.missions.checkpoint!.label = "Relabeled checkpoint";
    relabeledInput.balance.enemies.durable!.label = "Relabeled enemy";
    relabeledInput.balance.towers.pelter!.label = "Relabeled tower";
    const relabeled = createGameContentRegistry(relabeledInput);
    const restored = restore(relabeled, checkpoint);

    const gameplaySnapshot = (snapshot: GameSnapshot) => ({
      ...snapshot,
      missionLabel: undefined,
      difficultyLabel: undefined
    });
    expect(gameplaySnapshot(restored.getSnapshot())).toEqual(gameplaySnapshot(game.getSnapshot()));
    expect(restored.getStateDigest()).toBe(game.getStateDigest());
  });

  it("reset after restore returns to the checkpoint RNG initial state and pristine digest", () => {
    const content = createContent();
    const pristine = createGame(content);
    const pristineCheckpoint = pristine.createCheckpoint();
    const progressed = createGame(content);
    arrangeMidWave(progressed);
    const restored = restore(content, jsonRoundTrip(progressed.createCheckpoint()));

    restored.reset();
    const resetCheckpoint = restored.createCheckpoint();

    expect(resetCheckpoint.rng.current).toEqual(resetCheckpoint.rng.initial);
    expect(resetCheckpoint.rng).toEqual(pristineCheckpoint.rng);
    expect(resetCheckpoint.stateDigest).toBe(pristineCheckpoint.stateDigest);
    expect(restored.getStateDigest()).toBe(pristine.getStateDigest());
    expect(restored.getSnapshot()).toEqual(pristine.getSnapshot());
  });
});
