import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { TowerDefenseGame } from "../simulation/TowerDefenseGame.js";
import type { TowerScriptDefinition } from "./types.js";
import {
  createTowerScriptTraceCollector,
  type TowerScriptTraceEntryV1
} from "./trace.js";

function traceInput(scripts: Record<string, TowerScriptDefinition>): GameContentInput {
  return {
    balance: {
      defaultMissionId: "trace",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 10,
        startingResources: { coins: 10 },
        prepTimeUnits: 1,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 5,
        pathWaterDurationUnits: 3,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {},
      enemies: {},
      towers: {},
      waveSets: { empty: [] },
      missions: {
        trace: {
          id: "trace",
          label: "Trace contract",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 10 },
          prepTimeUnits: 1,
          mapId: "lane",
          waveSetId: "empty",
          buildTowerIds: [],
          abilityIds: []
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 3,
        height: 1,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "buildable",
        spawnCoord: { q: 0, r: 0 },
        coreCoord: { q: 2, r: 0 },
        pathCenterline: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }],
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    scripts,
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
        missionId: "trace",
        regionId: "test",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function traceScript(): TowerScriptDefinition {
  return {
    schemaVersion: 6,
    id: "trace_rules",
    bindings: [{ scope: "global" }],
    initialState: { count: 0, skipped: 0 },
    handlers: {
      signal: [
        {
          id: "skipped",
          when: { $op: "eq", args: [{ $get: "event.signal" }, "never"] },
          actions: [{ action: "incrementState", key: "skipped" }]
        },
        {
          id: "applied",
          when: { $op: "eq", args: [{ $get: "event.signal" }, "run"] },
          actions: [
            { action: "incrementState", key: "count" },
            { action: "setState", key: "lastPayload", value: { $get: "event.payload" } }
          ]
        }
      ]
    }
  };
}

function createPair(maxEntries = 128) {
  const content = createGameContentRegistry(traceInput({ trace_rules: traceScript() }));
  const collector = createTowerScriptTraceCollector({ maxEntries });
  const traced = new TowerDefenseGame({
    missionId: "trace",
    content,
    seed: "r6-trace",
    towerScriptTrace: collector
  });
  const plain = new TowerDefenseGame({ missionId: "trace", content, seed: "r6-trace" });
  collector.clear();
  return { collector, traced, plain };
}

describe("R6A structured TowerScript trace contract", () => {
  it("records the deterministic event -> binding -> handler -> condition -> action -> state diff chain", () => {
    const { collector, traced } = createPair();

    expect(traced.emitScriptSignal("run", { amount: 3 }).ok).toBe(true);
    const snapshot = collector.getSnapshot();

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      maxEntries: 128,
      droppedEntries: 0,
      entries: expect.any(Array)
    });
    expect(snapshot.entries.map((entry) => entry.sequence)).toEqual(
      snapshot.entries.map((_, index) => index)
    );
    expect(snapshot.entries.map((entry) => entry.phase)).toEqual([
      "event",
      "binding",
      "handler",
      "condition",
      "handler",
      "condition",
      "action",
      "state_diff",
      "action",
      "state_diff"
    ]);

    const event = snapshot.entries[0]!;
    expect(event).toMatchObject({
      schemaVersion: 1,
      phase: "event",
      eventName: "signal",
      event: { type: "signal", signal: "run", payload: { amount: 3 }, sourceScriptId: "external" }
    });
    expect(snapshot.entries.filter((entry) => entry.phase === "condition")).toEqual([
      expect.objectContaining({ scriptId: "trace_rules", handlerId: "skipped", result: false }),
      expect.objectContaining({ scriptId: "trace_rules", handlerId: "applied", result: true })
    ]);
    expect(snapshot.entries.filter((entry) => entry.phase === "action")).toEqual([
      expect.objectContaining({
        scriptId: "trace_rules",
        handlerId: "applied",
        actionIndex: 0,
        action: { action: "incrementState", key: "count" }
      }),
      expect.objectContaining({
        scriptId: "trace_rules",
        handlerId: "applied",
        actionIndex: 1,
        action: { action: "setState", key: "lastPayload", value: { $get: "event.payload" } }
      })
    ]);
    expect(snapshot.entries.filter((entry) => entry.phase === "state_diff")).toEqual([
      expect.objectContaining({
        scriptId: "trace_rules",
        handlerId: "applied",
        actionIndex: 0,
        changes: [{ op: "replace", path: "/count", before: 0, after: 1 }]
      }),
      expect.objectContaining({
        scriptId: "trace_rules",
        handlerId: "applied",
        actionIndex: 1,
        changes: [{ op: "add", path: "/lastPayload", after: { amount: 3 } }]
      })
    ]);
    expect(traced.getSnapshot().scriptState.values.trace_rules?.["global:global"]).toEqual({
      count: 1,
      skipped: 0,
      lastPayload: { amount: 3 }
    });
  });

  it("is bounded, retains stable absolute sequences, and reports dropped entries", () => {
    const { collector, traced } = createPair(7);

    for (let index = 0; index < 4; index += 1) {
      expect(traced.emitScriptSignal("run", { index }).ok).toBe(true);
    }
    const snapshot = collector.getSnapshot();

    expect(snapshot.entries).toHaveLength(7);
    expect(snapshot.droppedEntries).toBeGreaterThan(0);
    expect(snapshot.totalEntries).toBe(snapshot.droppedEntries + snapshot.entries.length);
    expect(snapshot.entries.map((entry) => entry.sequence)).toEqual(
      Array.from(
        { length: snapshot.entries.length },
        (_, offset) => snapshot.droppedEntries + offset
      )
    );
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("is observational: opting in changes neither gameplay snapshots, checkpoints, nor state digests", () => {
    const { collector, traced, plain } = createPair();

    expect(traced.emitScriptSignal("run", { stable: true })).toEqual(
      plain.emitScriptSignal("run", { stable: true })
    );
    traced.tick(0.1);
    plain.tick(0.1);

    expect(collector.getSnapshot().entries.length).toBeGreaterThan(0);
    expect(traced.getStateDigest()).toBe(plain.getStateDigest());
    expect(traced.getSnapshot()).toEqual(plain.getSnapshot());
    expect(traced.createCheckpoint()).toEqual(plain.createCheckpoint());
    expect(traced.getSnapshot()).not.toHaveProperty("scriptTrace");
    expect(traced.createCheckpoint()).not.toHaveProperty("scriptTrace");
  });

  it("links a runtime diagnostic to the exact failing action without mutating legacy diagnostics", () => {
    const invalid: TowerScriptDefinition = {
      schemaVersion: 6,
      id: "invalid_runtime",
      bindings: [{ scope: "global" }],
      handlers: {
        signal: [{
          id: "bad_currency",
          actions: [
            { action: "grantResource", resourceId: "missing_currency", amount: 1 },
            { action: "damageCore", amount: 1 }
          ]
        }]
      }
    };
    const content = createGameContentRegistry(traceInput({ invalid_runtime: invalid }));
    const collector = createTowerScriptTraceCollector({ maxEntries: 64 });
    const game = new TowerDefenseGame({
      missionId: "trace",
      content,
      seed: "r6-diagnostic",
      towerScriptTrace: collector
    });
    collector.clear();

    expect(game.emitScriptSignal("run").ok).toBe(true);
    const legacy = game.getSnapshot().scriptState.diagnostics[0]!;
    const diagnostic = collector.getSnapshot().entries.find((entry) => entry.phase === "diagnostic");

    expect(legacy).toMatchObject({
      scriptId: "invalid_runtime",
      handlerId: "bad_currency",
      event: "signal",
      code: "runtime_error"
    });
    expect(diagnostic).toMatchObject({
      phase: "diagnostic",
      scriptId: "invalid_runtime",
      handlerId: "bad_currency",
      actionIndex: 0,
      diagnostic: legacy
    });
    expect(game.coreHp).toBe(game.getSnapshot().maxCoreHp);
  });

  it("links a pre-action budget diagnostic to its handler instead of leaving an orphan trace entry", () => {
    const actions = Array.from(
      { length: 64 },
      () => ({ action: "incrementState", key: "count" } as const)
    );
    const budgeted: TowerScriptDefinition = {
      schemaVersion: 6,
      id: "budgeted",
      bindings: [{ scope: "global" }],
      initialState: { count: 0 },
      handlers: {
        signal: Array.from({ length: 9 }, (_, index) => ({
          id: `budget_${index}`,
          actions
        }))
      }
    };
    const content = createGameContentRegistry(traceInput({ budgeted }));
    const collector = createTowerScriptTraceCollector({ maxEntries: 2_048 });
    const game = new TowerDefenseGame({
      missionId: "trace",
      content,
      seed: "r6-budget-parent",
      towerScriptTrace: collector
    });
    collector.clear();

    expect(game.emitScriptSignal("run").ok).toBe(true);
    const entries = collector.getSnapshot().entries;
    const diagnostic = entries.find((entry) => (
      entry.phase === "diagnostic" && entry.diagnostic?.code === "budget_exceeded"
    ));
    const handler = entries.find((entry) => (
      entry.phase === "handler" && entry.handlerId === diagnostic?.handlerId
    ));

    expect(diagnostic).toBeDefined();
    expect(handler).toBeDefined();
    expect(diagnostic?.parentSequence).toBe(handler?.sequence);
  });

  it("returns detached trace data rather than references owned by the runtime", () => {
    const { collector, traced } = createPair();
    traced.emitScriptSignal("run", { nested: { value: 1 } });
    const first = collector.getSnapshot();
    const mutable = first.entries[0] as unknown as {
      event?: { payload?: { nested?: { value?: number } } };
    };
    if (mutable.event?.payload?.nested) mutable.event.payload.nested.value = 999;

    const second = collector.getSnapshot();
    expect(second.entries[0]).toMatchObject({ event: { payload: { nested: { value: 1 } } } });
    expect(second.entries).not.toBe(first.entries);
    const publicEntry: TowerScriptTraceEntryV1 = second.entries[0]!;
    expect(publicEntry.schemaVersion).toBe(1);
  });
});
