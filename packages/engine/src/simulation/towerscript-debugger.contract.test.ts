import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import type { TowerScriptDefinition } from "../scripting/types.js";
import { dispatchGameCommand, type GameCommandV1 } from "./commands.js";
import type { GameCheckpointV1 } from "./checkpoint.js";
import { JournaledGameSession } from "./journal.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import {
  TowerScriptDebugSession,
  type TowerScriptDebugStepMode,
  type TowerScriptDebugStepResultV1
} from "./towerscript-debugger.js";

const TICK: GameCommandV1 = { schemaVersion: 1, type: "tick", units: 0.1 };

function debugScript(): TowerScriptDefinition {
  return {
    schemaVersion: 6,
    id: "debug_clock",
    bindings: [{ scope: "global" }],
    initialState: { count: 0 },
    handlers: {
      tick: [{
        id: "two_actions",
        when: { $op: "gte", args: [{ $get: "event.delta" }, 0] },
        actions: [
          { action: "incrementState", key: "count" },
          { action: "incrementState", key: "count" }
        ]
      }]
    }
  };
}

function debugInput(enemyHp = 10): GameContentInput {
  return {
    balance: {
      defaultMissionId: "debug",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 10,
        startingResources: { coins: 10 },
        prepTimeUnits: 5,
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
          maxHp: enemyHp,
          speed: 0.25,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 0x778899
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "wave_1",
          label: "Wave 1",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        debug: {
          id: "debug",
          label: "Debugger contract",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 10 },
          prepTimeUnits: 5,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: [],
          abilityIds: []
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 4,
        height: 1,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 0 },
        coreCoord: { q: 3, r: 0 },
        pathCenterline: [
          { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }
        ],
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    scripts: { debug_clock: debugScript() },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "test",
        label: "Test",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#778899",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "debug",
        regionId: "test",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(enemyHp = 10): GameContentRegistry {
  return createGameContentRegistry(debugInput(enemyHp));
}

function game(registry: GameContentRegistry): TowerDefenseGame {
  return new TowerDefenseGame({ missionId: "debug", content: registry, seed: "r6-debugger" });
}

function session(options: {
  registry?: GameContentRegistry;
  initial?: TowerDefenseGame | GameCheckpointV1;
  checkpointRingCapacity?: number;
  trace?: boolean;
} = {}): TowerScriptDebugSession {
  const registry = options.registry ?? content();
  return new TowerScriptDebugSession({
    content: registry,
    initial: options.initial ?? game(registry),
    checkpointRingCapacity: options.checkpointRingCapacity ?? 8,
    ...(options.trace === false ? {} : { trace: { maxEntries: 256 } })
  });
}

function count(snapshot: ReturnType<TowerDefenseGame["getSnapshot"]>): number {
  return Number(snapshot.scriptState.values.debug_clock?.["global:global"]?.count ?? 0);
}

function allSteps(subject: TowerScriptDebugSession, mode: TowerScriptDebugStepMode) {
  const steps: TowerScriptDebugStepResultV1[] = [];
  for (;;) {
    const next = subject.step(mode);
    if (next === null) return steps;
    steps.push(next);
  }
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("R6B TowerScriptDebugSession contract", () => {
  it("does not clone and validate the complete journal on every debug dispatch", () => {
    const exportSpy = vi.spyOn(JournaledGameSession.prototype, "exportJournal")
      .mockImplementation(() => { throw new Error("full journal export used in the dispatch hot path"); });
    const debug = session();
    try {
      expect(debug.dispatch(TICK)).toEqual({ ok: true });
      expect(debug.dispatch(TICK)).toEqual({ ok: true });
    } finally {
      exportSpy.mockRestore();
    }
    expect(exportSpy).not.toHaveBeenCalled();
    expect(debug.exportJournal().entries).toHaveLength(2);
  });

  it("dispatches ordinary versioned commands and remains digest-equivalent to continuous simulation", () => {
    const registry = content();
    const continuous = game(registry);
    const debug = session({ registry });
    const commands: GameCommandV1[] = [TICK, TICK, { schemaVersion: 1, type: "emitSignal", signal: "noop" }];

    for (const command of commands) {
      expect(debug.dispatch(command)).toEqual(dispatchGameCommand(continuous, command));
    }

    expect(debug.game.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(debug.game.getStateDigest()).toBe(continuous.getStateDigest());
    expect(debug.exportJournal().entries.map((entry) => entry.command)).toEqual(commands);
    expect(debug.getTrace()?.entries.length).toBeGreaterThan(0);
  });

  it.each([
    ["tick", 2, "state_diff"],
    ["event", 2, "event"],
    ["handler", 2, "handler"],
    ["action", 4, "action"]
  ] as const)("steps by %s over the same opt-in trace and resumes to the live deterministic tail", (mode, expectedCount, phase) => {
    const registry = content();
    const continuous = game(registry);
    const debug = session({ registry });
    for (const command of [TICK, TICK]) {
      debug.dispatch(command);
      dispatchGameCommand(continuous, command);
    }
    const liveDigest = debug.game.getStateDigest();

    const steps = allSteps(debug, mode);

    expect(steps).toHaveLength(expectedCount);
    expect(steps.map((step) => step.mode)).toEqual(Array(expectedCount).fill(mode));
    expect(steps.map((step) => step.cursor.sequence)).toEqual(
      Array.from({ length: expectedCount }, (_, index) => index)
    );
    expect(steps.every((step) => step.traceEntry.phase === phase)).toBe(true);
    expect(steps.every((step) => step.live === false)).toBe(true);
    expect(debug.game.getStateDigest()).toBe(liveDigest);

    const resumed = debug.resume();
    expect(resumed).toMatchObject({ ok: true, stateDigest: liveDigest });
    expect(debug.game.getStateDigest()).toBe(continuous.getStateDigest());
    expect(debug.game.getSnapshot()).toEqual(continuous.getSnapshot());
  });

  it.each([
    ["tick", [2, 4]],
    ["event", [0, 2]],
    ["handler", [0, 2]],
    ["action", [1, 2, 3, 4]]
  ] as const)("replays historical %s frames instead of projecting every cursor onto the live tail", (mode, expectedCounts) => {
    const debug = session();
    debug.dispatch(TICK);
    debug.dispatch(TICK);
    const liveDigest = debug.game.getStateDigest();

    expect(allSteps(debug, mode).map((step) => count(step.snapshot))).toEqual(expectedCounts);
    expect(debug.game.getStateDigest()).toBe(liveDigest);
  });

  it("stops an event replay at a nested signal boundary before that signal's handlers mutate state", () => {
    const input = debugInput();
    const nested: TowerScriptDefinition = {
      schemaVersion: 6,
      id: "debug_clock",
      bindings: [{ scope: "global" }],
      initialState: { count: 0 },
      handlers: {
        tick: [{
          id: "outer",
          actions: [
            { action: "incrementState", key: "count" },
            { action: "emitSignal", signal: "nested" }
          ]
        }],
        signal: [{
          id: "inner",
          actions: [{ action: "incrementState", key: "count", amount: 10 }]
        }]
      }
    };
    const registry = createGameContentRegistry({ ...input, scripts: { debug_clock: nested } });
    const debug = session({ registry });
    debug.dispatch(TICK);

    const events = allSteps(debug, "event");
    expect(events.map((step) => step.traceEntry.eventName)).toEqual(["tick", "signal"]);
    expect(events.map((step) => count(step.snapshot))).toEqual([0, 1]);
    expect(count(debug.game.getSnapshot())).toBe(11);
  });

  it("replays action previews to their cursor without publishing partial handler state as the live game", () => {
    const debug = session();
    debug.dispatch(TICK);
    const liveDigest = debug.game.getStateDigest();
    expect(count(debug.game.getSnapshot())).toBe(2);

    const first = debug.step("action")!;
    const second = debug.step("action")!;

    expect(count(first.snapshot)).toBe(1);
    expect(count(second.snapshot)).toBe(2);
    expect(first.stateDigest).not.toBe(liveDigest);
    expect(second.stateDigest).toBe(liveDigest);
    expect(debug.game.getStateDigest()).toBe(liveDigest);
    expect(debug.step("action")).toBeNull();
    expect(debug.resume()).toMatchObject({ ok: true, stateDigest: liveDigest });
  });

  it("keeps action replay cursors correct after the bounded trace evicts an earlier action prefix", () => {
    const input = debugInput();
    const manyActions: TowerScriptDefinition = {
      schemaVersion: 6,
      id: "debug_clock",
      bindings: [{ scope: "global" }],
      initialState: { count: 0 },
      handlers: {
        tick: [{
          id: "four_actions",
          actions: Array.from({ length: 4 }, () => ({ action: "incrementState", key: "count" } as const))
        }]
      }
    };
    const registry = createGameContentRegistry({ ...input, scripts: { debug_clock: manyActions } });
    const debug = new TowerScriptDebugSession({
      content: registry,
      initial: game(registry),
      checkpointRingCapacity: 4,
      trace: { maxEntries: 4 }
    });
    debug.dispatch(TICK);

    const retained = debug.getTrace()!.entries.filter((entry) => entry.phase === "action");
    expect(retained.map((entry) => entry.actionIndex)).toEqual([2, 3]);
    expect(count(debug.step("action")!.snapshot)).toBe(3);
    expect(count(debug.step("action")!.snapshot)).toBe(4);
  });

  it("retains full replay checkpoints only for commands represented by the bounded trace", () => {
    const debug = new TowerScriptDebugSession({
      content: content(),
      initial: game(content()),
      checkpointRingCapacity: 3,
      trace: { maxEntries: 4 }
    });
    for (let index = 0; index < 100; index += 1) debug.dispatch(TICK);

    const records = (debug as unknown as {
      commandRecords: Array<{ preCheckpoint?: GameCheckpointV1; postCheckpoint?: GameCheckpointV1 }>;
      replayCheckpointPruneCursor: number;
    }).commandRecords;
    expect(records.filter((record) => record.preCheckpoint || record.postCheckpoint).length).toBeLessThanOrEqual(4);
    expect(debug.getCheckpointRing().size).toBe(3);
    expect((debug as unknown as { replayCheckpointPruneCursor: number }).replayCheckpointPruneCursor).toBeGreaterThan(90);

    debug.dispatch({ schemaVersion: 1, type: "upgradeTower", towerId: "missing" });
    expect(records.at(-1)).not.toHaveProperty("preCheckpoint");
    expect(records.at(-1)).not.toHaveProperty("postCheckpoint");
  });

  it("keeps tracing opt-in and refuses trace stepping when no collector was requested", () => {
    const debug = session({ trace: false });
    debug.dispatch(TICK);

    expect(debug.getTrace()).toBeNull();
    expect(() => debug.step("action")).toThrow(/trace|debug.*disabled|not enabled/i);
  });

  it("bounds the checkpoint ring and rejects rewind beyond the retained tick history without mutation", () => {
    const debug = session({ checkpointRingCapacity: 3 });
    const digests: string[] = [debug.game.getStateDigest()];
    for (let index = 0; index < 5; index += 1) {
      debug.dispatch(TICK);
      digests.push(debug.game.getStateDigest());
    }
    const beforeRejectedRewind = debug.game.getStateDigest();

    expect(debug.getCheckpointRing()).toEqual({
      capacity: 3,
      size: 3,
      oldestTick: 3,
      newestTick: 5
    });
    expect(debug.rewindTicks(4)).toEqual({
      ok: false,
      reasonKey: "debug.rewind_out_of_range",
      oldestTick: 3,
      currentTick: 5
    });
    expect(debug.game.getStateDigest()).toBe(beforeRejectedRewind);

    expect(debug.rewindTicks(2)).toMatchObject({
      ok: true,
      ticksRewound: 2,
      currentTick: 3,
      stateDigest: digests[3]
    });
    expect(debug.game.getStateDigest()).toBe(digests[3]);
  });

  it("truncates the abandoned command/trace suffix when a new branch is dispatched after rewind", () => {
    const debug = session({ checkpointRingCapacity: 8 });
    for (let index = 0; index < 4; index += 1) debug.dispatch(TICK);
    const abandonedTailDigest = debug.game.getStateDigest();
    const abandonedJournal = debug.exportJournal();

    expect(debug.rewindTicks(2).ok).toBe(true);
    const branchCommand: GameCommandV1 = { schemaVersion: 1, type: "tick", units: 0.25 };
    expect(debug.dispatch(branchCommand).ok).toBe(true);
    const branchJournal = debug.exportJournal();

    expect(branchJournal.entries).toHaveLength(3);
    expect(branchJournal.entries.map((entry) => entry.command)).toEqual([TICK, TICK, branchCommand]);
    expect(branchJournal.entries[2]!.command).not.toEqual(abandonedJournal.entries[2]!.command);
    // The replacement third command may converge to the abandoned third digest
    // during setup, while the abandoned fourth command must remain truncated.
    expect(debug.game.getStateDigest()).not.toBe(abandonedTailDigest);
    expect(debug.getCheckpointRing().newestTick).toBe(3);
    expect(debug.resume().stateDigest).toBe(debug.game.getStateDigest());
    expect(debug.exportJournal()).toEqual(branchJournal);
  });

  it.each(["contentDigest", "engineVersion"] as const)(
    "rejects an initial checkpoint %s mismatch before invoking mapFactory",
    (mismatch) => {
      const source = content();
      const checkpoint = jsonClone(game(source).createCheckpoint()) as unknown as {
        engineVersion: string;
      } & Omit<GameCheckpointV1, "engineVersion">;
      const target = mismatch === "contentDigest" ? content(11) : source;
      if (mismatch === "engineVersion") checkpoint.engineVersion = "towerforge-sim-future";
      const mapFactory = vi.fn(target.missions.debug!.mapFactory);
      Object.defineProperty(target.missions.debug!, "mapFactory", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: mapFactory
      });

      expect(() => new TowerScriptDebugSession({
        content: target,
        initial: checkpoint as unknown as GameCheckpointV1,
        checkpointRingCapacity: 4,
        trace: { maxEntries: 64 }
      })).toThrow(mismatch === "contentDigest" ? /content.*digest|digest.*content/i : /engine.*version|version.*engine/i);
      expect(mapFactory).not.toHaveBeenCalled();
    }
  );
});
