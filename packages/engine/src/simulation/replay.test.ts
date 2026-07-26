import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GAME_COMMAND_JOURNAL_LIMITS,
  GameCommandReplayDivergenceError,
  GameCommandReplayExecutionError,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCommandJournalV1,
  type GameCommandV1
} from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import { dispatchGameCommand } from "./commands.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GridDefinition } from "./types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function replayInput(grid: GridDefinition = { kind: "hex", layout: "odd-r" }): GameContentInput {
  return {
    balance: {
      defaultMissionId: "replay",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 40,
        startingResources: { coins: 40 },
        prepTimeUnits: 2,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5,
        pathWaterDurationUnits: 3,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: 30,
          speed: 0.5,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x778899
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
            fireRate: 1,
            damagePerStack: 2,
            startingStacks: 1,
            maxStacks: 2,
            upgradeCost: 2
          }
        }
      },
      waveSets: {
        one: [{
          id: "wave_1",
          label: "Wave 1",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        replay: {
          id: "replay",
          label: "Replay",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 40 },
          prepTimeUnits: 2,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["pelter"],
          abilityIds: []
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 7,
        height: 3,
        grid,
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 6, r: 1 },
        pathCenterline: Array.from({ length: 7 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
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
        missionId: "replay",
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
  return createGameContentRegistry(replayInput(grid));
}

function createGame(content: GameContentRegistry): TowerDefenseGame {
  return new TowerDefenseGame({ missionId: "replay", content, seed: "replay-seed" });
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const PLACE: GameCommandV1 = {
  schemaVersion: 1,
  type: "placeTower",
  towerTypeId: "pelter",
  coord: { q: 1, r: 0 }
};
const REJECTED: GameCommandV1 = {
  schemaVersion: 1,
  type: "upgradeTower",
  towerId: "missing"
};
const START: GameCommandV1 = { schemaVersion: 1, type: "startWave" };
const TICK: GameCommandV1 = { schemaVersion: 1, type: "tick", units: 0.2 };

function recordJournal(
  content: GameContentRegistry,
  commands: readonly GameCommandV1[] = [PLACE, REJECTED, START, TICK]
): { game: TowerDefenseGame; journal: GameCommandJournalV1 } {
  const game = createGame(content);
  const session = new JournaledGameSession(game);
  for (const command of commands) session.dispatch(command);
  const journal = session.exportJournal();
  if (journal.schemaVersion !== 1) throw new Error("V1-only commands must keep journal v1.");
  return { game, journal };
}

function installMapFactorySpy(content: GameContentRegistry): ReturnType<typeof vi.fn> {
  const mission = content.missions.replay!;
  const originalFactory = mission.mapFactory;
  const spy = vi.fn(() => originalFactory());
  Object.defineProperty(mission, "mapFactory", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: spy
  });
  return spy;
}

function mutableJournal(journal: GameCommandJournalV1): {
  schemaVersion: number;
  engineVersion: string;
  contentDigest: string;
  initialCheckpoint: Record<string, unknown>;
  entries: Array<{
    sequence: number;
    command: Record<string, unknown>;
    result: Record<string, unknown>;
    postStateDigest: string;
  }>;
} {
  return jsonClone(journal) as unknown as ReturnType<typeof mutableJournal>;
}

function caughtError(invoke: () => unknown): unknown {
  let caught: unknown;
  try {
    invoke();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  return caught;
}

describe("replayGameCommandJournal", () => {
  it("restores an empty journal without executing commands", () => {
    const content = createContent();
    const source = createGame(content);
    const journal = new JournaledGameSession(source).exportJournal();
    const result = replayGameCommandJournal({ content, journal });

    expect(Object.keys(result)).toEqual(["game", "entriesReplayed", "stateDigest"]);
    expect(result.game).not.toBe(source);
    expect(result.entriesReplayed).toBe(0);
    expect(result.stateDigest).toBe(source.getStateDigest());
    expect(result.game.getStateDigest()).toBe(source.getStateDigest());
    expect(result.game.getSnapshot()).toEqual(source.getSnapshot());
  });

  it.each([
    ["hex", { kind: "hex", layout: "odd-r" } as const],
    ["square", { kind: "square", adjacency: "cardinal" } as const]
  ])("matches continuous %s simulation including a recorded gameplay rejection", (_label, grid) => {
    const content = createContent(grid);
    const { game: continuous, journal } = recordJournal(content);
    expect(journal.entries[1]!.result).toEqual({ ok: false, reasonKey: "reason.noTowerSelected" });

    const replayed = replayGameCommandJournal({ content, journal });

    expect(replayed.entriesReplayed).toBe(journal.entries.length);
    expect(replayed.stateDigest).toBe(continuous.getStateDigest());
    expect(replayed.game.getStateDigest()).toBe(continuous.getStateDigest());
    expect(replayed.game.getSnapshot()).toEqual(continuous.getSnapshot());
  });

  it("accepts a plain JSON journal round-trip", () => {
    const content = createContent();
    const { game, journal } = recordJournal(content);

    const replayed = replayGameCommandJournal({ content, journal: jsonClone(journal) });

    expect(replayed.stateDigest).toBe(game.getStateDigest());
    expect(replayed.game.getSnapshot()).toEqual(game.getSnapshot());
  });

  it("returns an independent game that can continue through an identical deterministic suffix", () => {
    const content = createContent();
    const { game: continuous, journal } = recordJournal(content, [PLACE, START, TICK]);
    const replayed = replayGameCommandJournal({ content, journal });
    const suffix: GameCommandV1[] = [
      { schemaVersion: 1, type: "upgradeTower", towerId: "tower_1" },
      { schemaVersion: 1, type: "tick", units: 0.2 },
      { schemaVersion: 1, type: "emitSignal", signal: "external.suffix", payload: { stable: true } }
    ];

    for (const command of suffix) {
      expect(dispatchGameCommand(replayed.game, command)).toEqual(dispatchGameCommand(continuous, command));
    }
    expect(replayed.game.getStateDigest()).toBe(continuous.getStateDigest());
    expect(replayed.game.getSnapshot()).toEqual(continuous.getSnapshot());
  });

  it("does not retain caller journal references and returns an independent game on every replay", () => {
    const content = createContent();
    const { journal } = recordJournal(content);
    const pristine = jsonClone(journal);
    const first = replayGameCommandJournal({ content, journal });
    const firstDigest = first.game.getStateDigest();
    const mutable = journal as unknown as ReturnType<typeof mutableJournal>;

    mutable.initialCheckpoint.contentDigest = "tf-content-v1:0000000000000000";
    mutable.entries[0]!.sequence = 999;
    mutable.entries[0]!.command.type = "sellTower";
    mutable.entries[0]!.result.ok = false;
    mutable.entries[0]!.postStateDigest = "tf-state-v1:0000000000000000";

    expect(first.game.getStateDigest()).toBe(firstDigest);
    expect(first.stateDigest).toBe(firstDigest);
    const second = replayGameCommandJournal({ content, journal: pristine });
    expect(second.game).not.toBe(first.game);
    expect(second.game.getStateDigest()).toBe(firstDigest);
    first.game.resources.coins = 0;
    expect(second.game.resources.coins).not.toBe(0);
    expect(pristine).toEqual(jsonClone(pristine));
  });

  it("reports result divergence before digest divergence and stops before the next command", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE, START]);
    const tampered = mutableJournal(journal);
    tampered.entries[0]!.result = { ok: false, reasonKey: "reason.noTowerSelected" };
    tampered.entries[0]!.postStateDigest = "tf-state-v1:0000000000000000";
    const startSpy = vi.spyOn(TowerDefenseGame.prototype, "startNextWave");

    const error = caughtError(() => replayGameCommandJournal({
      content,
      journal: tampered as unknown as GameCommandJournalV1
    }));

    expect(error).toBeInstanceOf(GameCommandReplayDivergenceError);
    expect(error).toMatchObject({
      code: "GAME_COMMAND_REPLAY_DIVERGENCE",
      kind: "result",
      sequence: 0,
      expected: { ok: false, reasonKey: "reason.noTowerSelected" },
      actual: { ok: true }
    });
    expect(startSpy).not.toHaveBeenCalled();

    const detached = error as GameCommandReplayDivergenceError;
    tampered.entries[0]!.result.reasonKey = "reason.changed.after.throw";
    expect(detached.expected).toEqual({ ok: false, reasonKey: "reason.noTowerSelected" });
  });

  it("reports post-state digest divergence after a matching result and stops before the next command", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE, START]);
    const tampered = mutableJournal(journal);
    const actualDigest = tampered.entries[0]!.postStateDigest;
    tampered.entries[0]!.postStateDigest = "tf-state-v1:0000000000000000";
    const startSpy = vi.spyOn(TowerDefenseGame.prototype, "startNextWave");

    const error = caughtError(() => replayGameCommandJournal({
      content,
      journal: tampered as unknown as GameCommandJournalV1
    }));

    expect(error).toBeInstanceOf(GameCommandReplayDivergenceError);
    expect(error).toMatchObject({
      code: "GAME_COMMAND_REPLAY_DIVERGENCE",
      kind: "postStateDigest",
      sequence: 0,
      expected: "tf-state-v1:0000000000000000",
      actual: actualDigest
    });
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("always reports the earliest mismatching sequence", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE, START, TICK]);
    const tampered = mutableJournal(journal);
    tampered.entries[1]!.postStateDigest = "tf-state-v1:0000000000000000";
    tampered.entries[2]!.result = { ok: false, reasonKey: "reason.later" };

    const error = caughtError(() => replayGameCommandJournal({
      content,
      journal: tampered as unknown as GameCommandJournalV1
    }));
    expect(error).toBeInstanceOf(GameCommandReplayDivergenceError);
    expect(error).toMatchObject({ sequence: 1, kind: "postStateDigest" });
  });

  it("wraps an engine exception with its sequence and original cause", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE]);
    const engineFailure = new Error("engine exploded during replay");
    vi.spyOn(TowerDefenseGame.prototype, "placeTower").mockImplementation(() => {
      throw engineFailure;
    });

    const error = caughtError(() => replayGameCommandJournal({ content, journal }));

    expect(error).toBeInstanceOf(GameCommandReplayExecutionError);
    expect(error).toMatchObject({
      code: "GAME_COMMAND_REPLAY_EXECUTION_FAILED",
      sequence: 0,
      cause: engineFailure
    });
  });

  it("fully rejects future journal headers before reading entries, restoring a map, or executing", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE]);
    let entryReads = 0;
    const future = { ...journal, schemaVersion: 4 } as Record<string, unknown>;
    Object.defineProperty(future, "entries", {
      enumerable: true,
      get() {
        entryReads += 1;
        throw new Error("future entries must not be read");
      }
    });
    const mapFactory = installMapFactorySpy(content);
    const placeSpy = vi.spyOn(TowerDefenseGame.prototype, "placeTower");

    expect(() => replayGameCommandJournal({
      content,
      journal: future as unknown as GameCommandJournalV1
    })).toThrow(/journal.*version|version.*journal/i);
    expect(entryReads).toBe(0);
    expect(mapFactory).not.toHaveBeenCalled();
    expect(placeSpy).not.toHaveBeenCalled();
  });

  it("rejects content mismatch before restoring a map or executing", () => {
    const source = createContent();
    const { journal } = recordJournal(source, [PLACE]);
    const changedInput = replayInput();
    changedInput.balance.enemies.grunt!.maxHp += 1;
    const changed = createGameContentRegistry(changedInput);
    const mapFactory = installMapFactorySpy(changed);
    const placeSpy = vi.spyOn(TowerDefenseGame.prototype, "placeTower");

    expect(() => replayGameCommandJournal({ content: changed, journal })).toThrow(/content.*digest|digest.*content/i);
    expect(mapFactory).not.toHaveBeenCalled();
    expect(placeSpy).not.toHaveBeenCalled();
  });

  it("rejects a future initial checkpoint before restoring a map or executing", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE]);
    const future = mutableJournal(journal);
    future.initialCheckpoint.schemaVersion = 2;
    const mapFactory = installMapFactorySpy(content);
    const placeSpy = vi.spyOn(TowerDefenseGame.prototype, "placeTower");

    expect(() => replayGameCommandJournal({
      content,
      journal: future as unknown as GameCommandJournalV1
    })).toThrow(/checkpoint.*version|version.*checkpoint/i);
    expect(mapFactory).not.toHaveBeenCalled();
    expect(placeSpy).not.toHaveBeenCalled();
  });

  it("validates every command before map restore and does not execute a valid prefix", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE, START]);
    const malformed = mutableJournal(journal);
    malformed.entries[1]!.command.timestamp = 123;
    const mapFactory = installMapFactorySpy(content);
    const placeSpy = vi.spyOn(TowerDefenseGame.prototype, "placeTower");

    expect(() => replayGameCommandJournal({
      content,
      journal: malformed as unknown as GameCommandJournalV1
    })).toThrow(/entry 1 contains an invalid command/i);
    expect(mapFactory).not.toHaveBeenCalled();
    expect(placeSpy).not.toHaveBeenCalled();
  });

  it("does not invoke an accessor in a malformed later command before rejecting the whole journal", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE, START]);
    const malformed = mutableJournal(journal);
    let accessorReads = 0;
    const accessorCommand = { type: "startWave" } as Record<string, unknown>;
    Object.defineProperty(accessorCommand, "schemaVersion", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return 1;
      }
    });
    malformed.entries[1]!.command = accessorCommand;
    const mapFactory = installMapFactorySpy(content);
    const placeSpy = vi.spyOn(TowerDefenseGame.prototype, "placeTower");

    expect(() => replayGameCommandJournal({
      content,
      journal: malformed as unknown as GameCommandJournalV1
    })).toThrow(/canonical serialization rejects accessor properties|entry 1 contains an invalid command/i);
    expect(accessorReads).toBe(0);
    expect(mapFactory).not.toHaveBeenCalled();
    expect(placeSpy).not.toHaveBeenCalled();
  });

  it("rejects a representative entry-count limit before restoring or executing", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE]);
    const oversized = mutableJournal(journal);
    const base = oversized.entries[0]!;
    oversized.entries = Array.from(
      { length: GAME_COMMAND_JOURNAL_LIMITS.entries + 1 },
      (_, sequence) => ({ ...base, sequence })
    );
    const mapFactory = installMapFactorySpy(content);
    const placeSpy = vi.spyOn(TowerDefenseGame.prototype, "placeTower");

    expect(() => replayGameCommandJournal({
      content,
      journal: oversized as unknown as GameCommandJournalV1
    })).toThrow(/entries|budget|limit|large/i);
    expect(mapFactory).not.toHaveBeenCalled();
    expect(placeSpy).not.toHaveBeenCalled();
  });

  it("restores the map exactly once and executes each command exactly once", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE]);
    const mapFactory = installMapFactorySpy(content);
    const placeSpy = vi.spyOn(TowerDefenseGame.prototype, "placeTower");

    const replayed = replayGameCommandJournal({ content, journal });

    expect(replayed.entriesReplayed).toBe(1);
    expect(mapFactory).toHaveBeenCalledTimes(1);
    expect(placeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not add replay or journal metadata to the legacy game checkpoint or snapshot", () => {
    const content = createContent();
    const { journal } = recordJournal(content, [PLACE]);
    const replayed = replayGameCommandJournal({ content, journal });
    const snapshot = replayed.game.getSnapshot() as unknown as Record<string, unknown>;
    const checkpoint = replayed.game.createCheckpoint() as unknown as Record<string, unknown>;

    expect(snapshot).not.toHaveProperty("replay");
    expect(snapshot).not.toHaveProperty("journal");
    expect(checkpoint).not.toHaveProperty("replay");
    expect(checkpoint).not.toHaveProperty("journal");
    expect(checkpoint.state).not.toHaveProperty("replay");
    expect(checkpoint.state).not.toHaveProperty("journal");
  });
});
