import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { TERRAFORMING_LIMITS } from "../content/terraforming-mechanics.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GameSnapshot, GridCoord, GridDefinition } from "./types.js";

type ScriptAction = Record<string, unknown>;

interface FixtureOptions {
  readonly active?: boolean;
  readonly navigation?: "authored_routes" | "dynamic_flow";
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly handlers?: Readonly<Record<string, readonly ScriptAction[]>>;
  readonly tickHandlers?: readonly Record<string, unknown>[];
}

interface RuntimeInternals {
  readonly content: {
    readonly scripts: Record<string, {
      readonly handlers: {
        readonly signal: Array<{
          readonly when?: { readonly args?: readonly unknown[] };
          readonly actions: ScriptAction[];
        }>;
      };
    }>;
  };
  readonly navigationResolver?: { getStats(): unknown };
  readonly navigationFieldLookupCache?: unknown;
  readonly navigationEnemyFields?: unknown;
  createNavigationResolver(occupiedCoords?: readonly GridCoord[]): unknown;
  runScriptEvent(eventName: string, event: Record<string, unknown>): void;
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

function terraformTiles(
  operations: readonly Record<string, unknown>[],
  duration?: unknown
): ScriptAction {
  return {
    action: "terraformTiles",
    operations,
    ...(duration === undefined ? {} : { duration })
  };
}

function setTerrain(transitionId: string, target: unknown): Record<string, unknown> {
  return { kind: "set_terrain", target, transitionId };
}

function restoreTerrain(target: unknown): Record<string, unknown> {
  return { kind: "restore_terrain", target };
}

function setElevation(target: unknown, elevation: unknown): Record<string, unknown> {
  return { kind: "set_elevation", target, elevation };
}

function restoreElevation(target: unknown): Record<string, unknown> {
  return { kind: "restore_elevation", target };
}

function runtimeContent(options: FixtureOptions = {}) {
  const active = options.active ?? true;
  const navigation = options.navigation ?? "authored_routes";
  const width = options.width ?? 6;
  const signalHandlers = Object.entries(options.handlers ?? {}).map(([signal, actions]) => ({
    when: { $op: "eq", args: [{ $get: "event.signal" }, signal] },
    actions: [...actions]
  }));
  const selectedProfiles = {
    elevation: "plateau",
    navigation: navigation === "dynamic_flow" ? "flow" : "authored",
    ...(active ? { terraforming: "mutable" } : {})
  };
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "duration_runtime",
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
          groundSpeedMultiplier: 1, tags: ["mutable", "dry"]
        },
        water: {
          id: "water", label: "Water", buildable: false, walkable: true,
          groundSpeedMultiplier: 0.5, tags: ["wet"]
        },
        stone: {
          id: "stone", label: "Stone", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["stone"]
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 20, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{
            enemyId: "walker", count: 1, spawnInterval: 0, startDelay: 0,
            routeId: "main"
          }]
        }]
      },
      missions: {
        duration_runtime: {
          id: "duration_runtime", label: "Duration runtime", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "field", waveSetId: "one", buildTowerIds: [], abilityIds: [],
          mechanics: { profiles: selectedProfiles }
        }
      }
    },
    maps: {
      field: {
        id: "field", width, height: 3, grid: options.grid ?? SQUARE,
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: width - 1, r: 1 },
        pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [{
          id: "main",
          pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: 1 }))
        }],
        terrainOverrides: [],
        elevationOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        terraforming: {
          schemaVersion: 1,
          enabled: true,
          profiles: {
            mutable: {
              terrainTransitions: {
                flood: { fromTerrainTags: ["dry"], toTerrainId: "water" },
                dry_out: { fromTerrainTags: ["wet"], toTerrainId: "stone" },
                drain: { fromTerrainTags: ["wet"], toTerrainId: "floor" },
                stay_floor: { fromTerrainTags: ["dry"], toTerrainId: "floor" }
              },
              elevation: {
                minimum: -4,
                maximum: 4,
                maximumDeltaPerOperation: 4
              }
            }
          }
        },
        elevation: {
          schemaVersion: 3,
          enabled: true,
          profiles: {
            plateau: {
              lineOfSight: { terrainBlockerTags: [] },
              highGround: {
                maximumEffectiveElevationDelta: 4,
                rangeBonusPerElevation: 1,
                damageBonusBasisPointsPerElevation: 1_000
              }
            }
          }
        },
        navigation: {
          schemaVersion: 1,
          enabled: true,
          profiles: navigation === "dynamic_flow"
            ? {
                flow: {
                  mode: "dynamic_flow",
                  defaultMovementProfileId: "ground",
                  movementProfiles: {
                    ground: {
                      label: "Ground", terrainMode: "respect_walkable",
                      towerOccupancy: "ignored", defaultTerrainCost: 1_000
                    }
                  }
                }
              }
            : { authored: { mode: "authored_routes" } }
        }
      }
    },
    scripts: {
      duration_runtime: {
        schemaVersion: 6,
        id: "duration_runtime",
        bindings: [{ scope: "global" }],
        initialState: { armed: 0 },
        handlers: {
          signal: signalHandlers,
          ...(options.tickHandlers ? { tick: [...options.tickHandlers] } : {})
        }
      }
    } as never,
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "duration_runtime", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "duration_runtime",
    content: runtimeContent(options),
    seed: "terraform-duration-c3b"
  });
}

function terrainAt(subject: TowerDefenseGame, coord: GridCoord): string | undefined {
  return subject.getSnapshot().tiles.find((tile) => tile.q === coord.q && tile.r === coord.r)?.terrain;
}

function changeEvents(subject: TowerDefenseGame, start = 0): Array<Record<string, unknown>> {
  return subject.lastEvents.slice(start).filter((event) => (
    event.type === "terrainChanged" || event.type === "elevationChanged"
  )) as unknown as Array<Record<string, unknown>>;
}

function expectDiagnostic(
  before: GameSnapshot,
  after: GameSnapshot,
  code: "invalid_action" | "budget_exceeded",
  reasonKey: string
): void {
  expect(after.scriptState.diagnostics.slice(before.scriptState.diagnostics.length)).toEqual([
    expect.objectContaining({
      scriptId: "duration_runtime",
      code,
      reasonKey
    })
  ]);
}

function runtimeAction(subject: TowerDefenseGame, signal: string): ScriptAction {
  const handlers = (subject as unknown as RuntimeInternals)
    .content.scripts.duration_runtime!.handlers.signal;
  const handler = handlers.find((candidate) => candidate.when?.args?.[1] === signal);
  if (!handler?.actions[0]) throw new Error(`Missing runtime action for signal ${signal}.`);
  return handler.actions[0];
}

function probeExpression(label: string, observations: string[], path: string): Record<string, unknown> {
  return new Proxy({ $get: path }, {
    get(target, key, receiver) {
      if (key === "$get") observations.push(label);
      return Reflect.get(target, key, receiver);
    }
  });
}

function terraformingCheckpointState(subject: TowerDefenseGame): unknown {
  return (subject.createCheckpoint() as unknown as {
    readonly state: { readonly terraforming?: unknown };
  }).state.terraforming;
}

describe("R3.4b C3B timed terraforming runtime", () => {
  it("enforces duration bounds and fractional/clamped tick timing", () => {
    const accepted = game({
      handlers: {
        maximum: [terraformTiles([setTerrain("flood", { q: 1, r: 0 })], TERRAFORMING_LIMITS.duration)],
        fractional: [terraformTiles([setTerrain("flood", { q: 2, r: 0 })], 0.125)]
      }
    });
    expect(accepted.emitScriptSignal("maximum")).toEqual({ ok: true });
    expect(accepted.emitScriptSignal("fractional")).toEqual({ ok: true });
    expect(terrainAt(accepted, { q: 1, r: 0 })).toBe("water");
    expect(terrainAt(accepted, { q: 2, r: 0 })).toBe("water");
    accepted.tick(0.124);
    expect(terrainAt(accepted, { q: 2, r: 0 })).toBe("water");
    accepted.tick(0.002);
    expect(terrainAt(accepted, { q: 2, r: 0 })).toBe("floor");
    expect(terrainAt(accepted, { q: 1, r: 0 })).toBe("water");

    for (const duration of [
      0,
      -1,
      TERRAFORMING_LIMITS.duration + 1,
      Number.POSITIVE_INFINITY,
      "not-a-duration"
    ]) {
      const subject = game({
        handlers: { invalid: [terraformTiles([setTerrain("flood", { q: 1, r: 0 })], 1)] }
      });
      Object.defineProperty(runtimeAction(subject, "invalid"), "duration", {
        value: duration, enumerable: true, configurable: true, writable: true
      });
      const before = subject.getSnapshot();
      expect(subject.emitScriptSignal("invalid")).toEqual({ ok: true });
      expect(terrainAt(subject, { q: 1, r: 0 })).toBe("floor");
      expectDiagnostic(before, subject.getSnapshot(), "invalid_action", "terraform.duration_out_of_range");
    }

    const fromTickHandler = game({
      tickHandlers: [{
        when: { $op: "eq", args: [{ $get: "state.armed" }, 0] },
        actions: [
          terraformTiles([setTerrain("flood", { q: 1, r: 0 })], 0.3),
          { action: "setState", key: "armed", value: 1 }
        ]
      }]
    });
    fromTickHandler.tick(99);
    expect(terrainAt(fromTickHandler, { q: 1, r: 0 })).toBe("water");
    fromTickHandler.tick(99);
    expect(terrainAt(fromTickHandler, { q: 1, r: 0 })).toBe("water");
    fromTickHandler.tick(99);
    expect(terrainAt(fromTickHandler, { q: 1, r: 0 })).toBe("floor");
  });

  it("evaluates duration once before fields, rejects restore batches, and preserves inactive no-inspection", () => {
    const order: string[] = [];
    const subject = game({
      handlers: {
        ordered: [terraformTiles([setElevation({ q: 1, r: 0 }, 1)], 1)],
        invalid: [terraformTiles([setElevation({ q: 2, r: 0 }, 1)], 1)],
        restore: [terraformTiles([setTerrain("flood", { q: 3, r: 0 })], 1)]
      }
    });
    const ordered = runtimeAction(subject, "ordered");
    Object.defineProperty(ordered, "duration", {
      value: probeExpression("duration", order, "event.payload.duration"),
      enumerable: true, configurable: true, writable: true
    });
    const orderedOperation = (ordered.operations as Array<Record<string, unknown>>)[0]!;
    orderedOperation.target = {
      q: probeExpression("target", order, "event.payload.q"),
      r: 0
    };
    orderedOperation.elevation = probeExpression("elevation", order, "event.payload.elevation");

    expect(subject.emitScriptSignal("ordered", { duration: 1, q: 1, elevation: 1 })).toEqual({ ok: true });
    expect(order).toEqual(["duration", "target", "elevation"]);

    const invalidOrder: string[] = [];
    const invalid = runtimeAction(subject, "invalid");
    Object.defineProperty(invalid, "duration", {
      value: probeExpression("duration", invalidOrder, "event.payload.duration"),
      enumerable: true, configurable: true, writable: true
    });
    const invalidOperation = (invalid.operations as Array<Record<string, unknown>>)[0]!;
    invalidOperation.target = {
      q: probeExpression("target", invalidOrder, "event.payload.q"),
      r: 0
    };
    invalidOperation.elevation = probeExpression("elevation", invalidOrder, "event.payload.elevation");
    const beforeInvalid = subject.getSnapshot();
    expect(subject.emitScriptSignal("invalid", { duration: 0, q: 2, elevation: 1 })).toEqual({ ok: true });
    expect(invalidOrder).toEqual(["duration"]);
    expectDiagnostic(beforeInvalid, subject.getSnapshot(), "invalid_action", "terraform.duration_out_of_range");

    const restore = runtimeAction(subject, "restore");
    Object.defineProperty(restore, "operations", {
      value: [restoreTerrain({ q: 3, r: 0 })],
      enumerable: true, configurable: true, writable: true
    });
    const beforeRestore = subject.getSnapshot();
    expect(subject.emitScriptSignal("restore")).toEqual({ ok: true });
    expect(terrainAt(subject, { q: 3, r: 0 })).toBe("floor");
    expectDiagnostic(beforeRestore, subject.getSnapshot(), "invalid_action", "terraform.invalid_operation");

    const inactive = game({
      active: false,
      handlers: {
        inactive: [terraformTiles([setTerrain("flood", { q: 1, r: 0 })], 1)]
      }
    });
    const action = runtimeAction(inactive, "inactive");
    let reads = 0;
    Object.defineProperty(action, "duration", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("SECRET_INACTIVE_DURATION");
      }
    });
    Object.defineProperty(action, "operations", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        throw new Error("SECRET_INACTIVE_OPERATIONS");
      }
    });
    const before = inactive.getSnapshot();

    expect(inactive.emitScriptSignal("inactive")).toEqual({ ok: true });
    expect(reads).toBe(0);
    expect(terrainAt(inactive, { q: 1, r: 0 })).toBe("floor");
    expect(inactive.getSnapshot().scriptState.diagnostics).toEqual(before.scriptState.diagnostics);
    expect(Object.prototype.hasOwnProperty.call(
      inactive.getSnapshot() as unknown as { readonly terraforming?: unknown },
      "terraforming"
    )).toBe(false);
  });

  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("restores a mixed timed batch to its exact persistent before-image on %s", (_label, grid) => {
    const subject = game({
      grid,
      handlers: {
        persistent: [terraformTiles([
          setTerrain("flood", { q: 1, r: 0 }),
          setElevation({ q: 1, r: 0 }, 1)
        ])],
        timed: [terraformTiles([
          setTerrain("dry_out", { q: 1, r: 0 }),
          setElevation({ q: 1, r: 0 }, 2)
        ], 0.2)]
      }
    });
    expect(subject.emitScriptSignal("persistent")).toEqual({ ok: true });
    const timedEventStart = subject.lastEvents.length;
    const internal = subject as unknown as RuntimeInternals;
    const originalRunScriptEvent = internal.runScriptEvent.bind(subject);
    const observed: Array<{ event: string; terrain: string | undefined; elevation: number | undefined }> = [];
    const dispatch = vi.spyOn(internal, "runScriptEvent").mockImplementation((eventName, event) => {
      if (eventName === "terrainChanged" || eventName === "elevationChanged") {
        observed.push({
          event: eventName,
          terrain: terrainAt(subject, { q: 1, r: 0 }),
          elevation: subject.map.elevationAt({ q: 1, r: 0 })
        });
      }
      originalRunScriptEvent(eventName, event);
    });

    try {
      expect(subject.emitScriptSignal("timed")).toEqual({ ok: true });
      expect(terrainAt(subject, { q: 1, r: 0 })).toBe("stone");
      expect(subject.map.elevationAt({ q: 1, r: 0 })).toBe(2);
      expect(changeEvents(subject, timedEventStart).map((event) => [event.type, event.source])).toEqual([
        ["terrainChanged", "script"],
        ["elevationChanged", "script"]
      ]);
      expect(observed).toEqual([
        { event: "terrainChanged", terrain: "stone", elevation: 2 },
        { event: "elevationChanged", terrain: "stone", elevation: 2 }
      ]);

      observed.length = 0;
      subject.tick(0.2);
      expect(terrainAt(subject, { q: 1, r: 0 })).toBe("water");
      expect(subject.map.elevationAt({ q: 1, r: 0 })).toBe(1);
      expect(subject.getSnapshot().terrainOverrides).toEqual([
        { q: 1, r: 0, terrain: "water", source: "script" }
      ]);
      expect(subject.getSnapshot().elevation?.overrides).toEqual([
        { q: 1, r: 0, elevation: 1 }
      ]);
      expect(changeEvents(subject).map((event) => [event.type, event.source])).toEqual([
        ["terrainChanged", "restore"],
        ["elevationChanged", "restore"]
      ]);
      expect(observed).toEqual([
        { event: "terrainChanged", terrain: "water", elevation: 1 },
        { event: "elevationChanged", terrain: "water", elevation: 1 }
      ]);
    } finally {
      dispatch.mockRestore();
    }
  });

  it("prechecks the 512-group slot ceiling before evaluating any field of the 513th timed action", () => {
    const subject = game({
      width: TERRAFORMING_LIMITS.pendingExpiryGroups + 2,
      handlers: {
        fill: [terraformTiles([
          setTerrain("flood", { q: { $get: "event.payload.q" }, r: 0 })
        ], { $get: "event.payload.duration" })]
      }
    });
    for (let q = 0; q < TERRAFORMING_LIMITS.pendingExpiryGroups; q += 1) {
      expect(subject.emitScriptSignal("fill", { q, duration: 10 })).toEqual({ ok: true });
    }
    expect(subject.getSnapshot().terrainOverrides).toHaveLength(TERRAFORMING_LIMITS.pendingExpiryGroups);
    expect(subject.getSnapshot().scriptState.diagnostics).toEqual([]);

    const observations: string[] = [];
    const action = runtimeAction(subject, "fill");
    Object.defineProperty(action, "duration", {
      value: probeExpression("duration", observations, "event.payload.duration"),
      enumerable: true, configurable: true, writable: true
    });
    const operation = (action.operations as Array<Record<string, unknown>>)[0]!;
    operation.target = {
      q: probeExpression("target", observations, "event.payload.q"),
      r: 0
    };
    const before = subject.getSnapshot();

    expect(subject.emitScriptSignal("fill", {
      q: TERRAFORMING_LIMITS.pendingExpiryGroups,
      duration: 10
    })).toEqual({ ok: true });
    expect(observations).toEqual([]);
    expect(subject.getSnapshot().terrainOverrides).toEqual(before.terrainOverrides);
    expectDiagnostic(
      before,
      subject.getSnapshot(),
      "budget_exceeded",
      "terraform.expiry_group_budget_exceeded"
    );
  });

  it("reserves the native terrain ownership ceiling even when timed writes erase override rows", () => {
    const targetAtOffset = (index: number) => ({
      q: { $op: "add", args: [{ $get: "event.payload.offset" }, index] },
      r: 0
    });
    const batchTargets = Array.from(
      { length: TERRAFORMING_LIMITS.operationsPerBatch },
      (_, index) => targetAtOffset(index)
    );
    const subject = game({
      width: TERRAFORMING_LIMITS.activeTerrainOverrides + 2,
      handlers: {
        persistBatch: [terraformTiles(batchTargets.map((target) => setTerrain("flood", target)))],
        ownBatch: [terraformTiles(batchTargets.map((target) => setTerrain("drain", target)), 100)],
        persistOne: [terraformTiles([setTerrain("flood", targetAtOffset(0))])],
        ownOne: [terraformTiles([setTerrain("drain", targetAtOffset(0))], 100)]
      }
    });

    for (
      let offset = 0;
      offset < TERRAFORMING_LIMITS.activeTerrainOverrides;
      offset += TERRAFORMING_LIMITS.operationsPerBatch
    ) {
      expect(subject.emitScriptSignal("persistBatch", { offset })).toEqual({ ok: true });
      expect(subject.getSnapshot().terrainOverrides).toHaveLength(TERRAFORMING_LIMITS.operationsPerBatch);
      expect(subject.emitScriptSignal("ownBatch", { offset })).toEqual({ ok: true });
      expect(subject.getSnapshot().terrainOverrides).toEqual([]);
    }

    const atLimit = subject.getSnapshot();
    const atLimitTerraforming = atLimit.terraforming!;
    expect(atLimitTerraforming.pendingExpiryGroups).toHaveLength(
      TERRAFORMING_LIMITS.activeTerrainOverrides / TERRAFORMING_LIMITS.operationsPerBatch
    );
    expect(atLimitTerraforming.pendingExpiryGroups.reduce(
      (count, group) => count + group.targets.length,
      0
    )).toBe(TERRAFORMING_LIMITS.activeTerrainOverrides);
    expect(atLimitTerraforming.pendingExpiryGroups.map((group) => group.sequence))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const overflowQ = TERRAFORMING_LIMITS.activeTerrainOverrides;
    expect(subject.emitScriptSignal("persistOne", { offset: overflowQ })).toEqual({ ok: true });
    expect(terrainAt(subject, { q: overflowQ, r: 0 })).toBe("water");
    const before = subject.getSnapshot();
    const beforeCheckpoint = subject.createCheckpoint();
    expect(beforeCheckpoint.state.terraforming?.schemaVersion).toBe(2);
    if (beforeCheckpoint.state.terraforming?.schemaVersion !== 2) {
      throw new Error("Expected terraforming checkpoint v2 at native ownership limit.");
    }
    expect(beforeCheckpoint.state.terraforming.pendingExpiryGroups.reduce(
      (count, group) => count + group.entries.length,
      0
    )).toBe(TERRAFORMING_LIMITS.activeTerrainOverrides);
    expect(beforeCheckpoint.state.terraforming.nextExpiryGroupSequence).toBe(9);

    expect(subject.emitScriptSignal("ownOne", { offset: overflowQ })).toEqual({ ok: true });
    const after = subject.getSnapshot();
    expect(terrainAt(subject, { q: overflowQ, r: 0 })).toBe("water");
    expect(after.terrainOverrides).toEqual(before.terrainOverrides);
    expect(after.terraforming).toEqual(before.terraforming);
    expectDiagnostic(before, after, "invalid_action", "terraform.override_budget_exceeded");

    const afterCheckpoint = subject.createCheckpoint();
    expect({
      runtimeTerrainOverrides: afterCheckpoint.state.runtimeTerrainOverrides,
      terraforming: afterCheckpoint.state.terraforming
    }).toEqual({
      runtimeTerrainOverrides: beforeCheckpoint.state.runtimeTerrainOverrides,
      terraforming: beforeCheckpoint.state.terraforming
    });
  });

  it("treats timed ownership per layer, rejects every same-layer writer, and frees ownership on expiry", () => {
    const subject = game({
      handlers: {
        ownTerrain: [terraformTiles([setTerrain("flood", { q: 1, r: 0 })], 0.2)],
        terrainTimed: [terraformTiles([setTerrain("dry_out", { q: 1, r: 0 })], 0.1)],
        terrainPersistent: [terraformTiles([setTerrain("dry_out", { q: 1, r: 0 })])],
        terrainRestore: [terraformTiles([restoreTerrain({ q: 1, r: 0 })])],
        crossElevation: [terraformTiles([setElevation({ q: 1, r: 0 }, 1)])],
        ownElevation: [terraformTiles([setElevation({ q: 2, r: 0 }, 1)], 0.2)],
        elevationTimed: [terraformTiles([setElevation({ q: 2, r: 0 }, 2)], 0.1)],
        elevationPersistent: [terraformTiles([setElevation({ q: 2, r: 0 }, 2)])],
        elevationRestore: [terraformTiles([restoreElevation({ q: 2, r: 0 })])],
        crossTerrain: [terraformTiles([setTerrain("flood", { q: 2, r: 0 })])],
        terrainAfterExpiry: [terraformTiles([setTerrain("flood", { q: 1, r: 0 })])],
        elevationAfterExpiry: [terraformTiles([setElevation({ q: 2, r: 0 }, 1)])]
      }
    });
    expect(subject.emitScriptSignal("ownTerrain")).toEqual({ ok: true });
    expect(subject.emitScriptSignal("crossElevation")).toEqual({ ok: true });
    expect(subject.emitScriptSignal("ownElevation")).toEqual({ ok: true });
    expect(subject.emitScriptSignal("crossTerrain")).toEqual({ ok: true });
    expect(terrainAt(subject, { q: 1, r: 0 })).toBe("water");
    expect(subject.map.elevationAt({ q: 1, r: 0 })).toBe(1);
    expect(terrainAt(subject, { q: 2, r: 0 })).toBe("water");
    expect(subject.map.elevationAt({ q: 2, r: 0 })).toBe(1);

    for (const signal of [
      "terrainTimed", "terrainPersistent", "terrainRestore",
      "elevationTimed", "elevationPersistent", "elevationRestore"
    ]) {
      const before = subject.getSnapshot();
      expect(subject.emitScriptSignal(signal)).toEqual({ ok: true });
      expectDiagnostic(before, subject.getSnapshot(), "invalid_action", "terraform.target_owned");
    }
    expect(terrainAt(subject, { q: 1, r: 0 })).toBe("water");
    expect(subject.map.elevationAt({ q: 2, r: 0 })).toBe(1);

    subject.tick(0.2);
    expect(terrainAt(subject, { q: 1, r: 0 })).toBe("floor");
    expect(subject.map.elevationAt({ q: 2, r: 0 })).toBe(0);
    expect(terrainAt(subject, { q: 2, r: 0 })).toBe("water");
    expect(subject.map.elevationAt({ q: 1, r: 0 })).toBe(1);

    expect(subject.emitScriptSignal("terrainAfterExpiry")).toEqual({ ok: true });
    expect(subject.emitScriptSignal("elevationAfterExpiry")).toEqual({ ok: true });
    expect(terrainAt(subject, { q: 1, r: 0 })).toBe("water");
    expect(subject.map.elevationAt({ q: 2, r: 0 })).toBe(1);
  });

  it("keeps timed no-ops allocation-free and expires elevation without navigation work", () => {
    const noOp = game({
      handlers: {
        noop: [terraformTiles([
          setTerrain("stay_floor", { q: 1, r: 0 }),
          setElevation({ q: 1, r: 0 }, 0)
        ], 10)]
      }
    });
    const beforeTerraforming = terraformingCheckpointState(noOp);
    const before = noOp.getSnapshot();

    expect(noOp.emitScriptSignal("noop")).toEqual({ ok: true });
    expect(terrainAt(noOp, { q: 1, r: 0 })).toBe("floor");
    expect(noOp.map.elevationAt({ q: 1, r: 0 })).toBe(0);
    expect(changeEvents(noOp)).toEqual([]);
    expect(noOp.getSnapshot().scriptState.diagnostics).toEqual(before.scriptState.diagnostics);
    expect(terraformingCheckpointState(noOp)).toEqual(beforeTerraforming);

    const subject = game({
      navigation: "dynamic_flow",
      handlers: {
        raise: [terraformTiles([setElevation({ q: 1, r: 0 }, 2)], 0.2)]
      }
    });
    const internal = subject as unknown as RuntimeInternals;
    const resolver = internal.navigationResolver;
    const cache = internal.navigationFieldLookupCache;
    const enemyFields = internal.navigationEnemyFields;
    const stats = resolver?.getStats();
    const resolverFactory = vi.spyOn(internal, "createNavigationResolver");

    try {
      expect(subject.emitScriptSignal("raise")).toEqual({ ok: true });
      expect(subject.map.elevationAt({ q: 1, r: 0 })).toBe(2);
      expect(internal.navigationResolver).toBe(resolver);
      expect(internal.navigationFieldLookupCache).toBe(cache);
      expect(internal.navigationEnemyFields).toBe(enemyFields);
      expect(resolver?.getStats()).toEqual(stats);

      subject.tick(0.2);
      expect(subject.map.elevationAt({ q: 1, r: 0 })).toBe(0);
      expect(internal.navigationResolver).toBe(resolver);
      expect(internal.navigationFieldLookupCache).toBe(cache);
      expect(internal.navigationEnemyFields).toBe(enemyFields);
      expect(resolver?.getStats()).toEqual(stats);
      expect(resolverFactory).not.toHaveBeenCalled();
    } finally {
      resolverFactory.mockRestore();
    }
  });
});
