import { describe, expect, it, vi } from "vitest";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import { TERRAFORMING_LIMITS } from "../content/terraforming-mechanics.js";
import {
  computeCheckpointStateDigest,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCheckpointV1
} from "../index.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GameSnapshot, GridCoord, GridDefinition } from "./types.js";

type Activation = "active" | "absent" | "disabled" | "unselected";
type NavigationMode = "authored_routes" | "dynamic_flow";
type ScriptAction = Record<string, unknown>;

interface FixtureOptions {
  readonly activation?: Activation;
  readonly navigation?: NavigationMode;
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly height?: number;
  readonly authoredWalls?: readonly GridCoord[];
  readonly handlers?: Readonly<Record<string, readonly ScriptAction[]>>;
  readonly transitions?: boolean;
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
  readonly runtimeTerrainOverrides: Map<string, {
    q: number;
    r: number;
    terrain: string;
    source: "script" | "ability";
    expiresIn?: number;
  }>;
  readonly navigationResolver?: {
    getStats(): { fieldBuildCount: number; fieldQueryCount: number; generation: number };
  };
  readonly navigationFieldLookupCache?: unknown;
  readonly navigationEnemyFields?: unknown;
  readonly scriptActionsRemaining: number;
  readonly scriptTerrainChangesRemaining: number;
  createNavigationResolver(
    occupiedCoords?: readonly GridCoord[],
    terrainByCoord?: Readonly<Record<string, string>>
  ): unknown;
}

interface TerraformingSnapshotV1 {
  readonly schemaVersion: 1;
  readonly pendingExpiryGroups: readonly {
    readonly sequence: number;
    readonly remaining: number;
    readonly targets: readonly {
      readonly layer: "terrain" | "elevation";
      readonly q: number;
      readonly r: number;
    }[];
  }[];
}

interface MutableCheckpoint extends Omit<GameCheckpointV1, "state" | "stateDigest"> {
  stateDigest: string;
  state: GameCheckpointV1["state"] & {
    terraforming?: unknown;
  };
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

function setTileTerrain(
  target: unknown,
  terrainId: string,
  duration?: unknown
): ScriptAction {
  return {
    action: "setTileTerrain",
    target,
    terrainId,
    ...(duration === undefined ? {} : { duration })
  };
}

function restoreTileTerrain(target: unknown): ScriptAction {
  return { action: "restoreTileTerrain", target };
}

function nativeSet(target: unknown, duration?: unknown): ScriptAction {
  return {
    action: "terraformTiles",
    operations: [{ kind: "set_terrain", target, transitionId: "wet" }],
    ...(duration === undefined ? {} : { duration })
  };
}

function signalHandler(signal: string, actions: readonly ScriptAction[]) {
  return {
    id: signal,
    when: { $op: "eq", args: [{ $get: "event.signal" }, signal] },
    actions: [...actions]
  };
}

function adapterContent(options: FixtureOptions = {}): GameContentRegistry {
  const activation = options.activation ?? "active";
  const navigation = options.navigation ?? "authored_routes";
  const width = options.width ?? 6;
  const height = options.height ?? 3;
  const pathRow = height === 1 ? 0 : 1;
  const route = Array.from({ length: width }, (_, q) => ({ q, r: pathRow }));
  const selectedTerraforming = activation === "active" || activation === "disabled";
  const modulePresent = activation !== "absent";
  const enabled = activation !== "disabled";
  const terrainOverrideByCoord = new Map(
    route.map((coord) => [`${coord.q},${coord.r}`, { ...coord, terrain: "path" }])
  );
  for (const coord of options.authoredWalls ?? []) {
    terrainOverrideByCoord.set(`${coord.q},${coord.r}`, { ...coord, terrain: "wall" });
  }
  const handlers = Object.entries(options.handlers ?? {}).map(([signal, actions]) => (
    signalHandler(signal, actions)
  ));
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "legacy_adapter",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 20,
        startingResources: { coins: 20 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 0.125,
        pathWaterRadius: 0,
        pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: ["dry"]
        },
        path: {
          id: "path", label: "Path", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["dry"]
        },
        water: {
          id: "water", label: "Water", buildable: false, walkable: true,
          groundSpeedMultiplier: 0.5, tags: ["wet"]
        },
        wall: {
          id: "wall", label: "Wall", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: ["blocked"]
        }
      },
      abilities: {
        path_water: {
          id: "path_water", label: "Path water", cooldown: 1, duration: 0.125, radius: 0
        }
      },
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
        legacy_adapter: {
          id: "legacy_adapter", label: "Legacy adapter", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "field", waveSetId: "one", buildTowerIds: [], abilityIds: ["path_water"],
          mechanics: {
            profiles: {
              navigation: navigation === "dynamic_flow" ? "flow" : "authored",
              ...(selectedTerraforming ? { terraforming: "mutable" } : {})
            }
          }
        }
      }
    },
    maps: {
      field: {
        id: "field", width, height, grid: options.grid ?? SQUARE,
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: pathRow },
        coreCoord: { q: width - 1, r: pathRow },
        pathCenterline: route,
        pathRoutes: [{ id: "main", pathCenterline: route }],
        terrainOverrides: [...terrainOverrideByCoord.values()]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
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
        },
        ...(modulePresent ? {
          terraforming: {
            schemaVersion: 1,
            enabled,
            profiles: {
              mutable: {
                terrainTransitions: options.transitions
                  ? { wet: { fromTerrainTags: ["dry"], toTerrainId: "water" } }
                  : {}
              }
            }
          }
        } : {})
      }
    },
    scripts: {
      legacy_adapter: {
        schemaVersion: 6,
        id: "legacy_adapter",
        bindings: [{ scope: "global" }],
        initialState: { committed: 0 },
        handlers: { signal: handlers }
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
        missionId: "legacy_adapter", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "legacy_adapter",
    content: adapterContent(options),
    seed: "terraform-legacy-adapter-c4a"
  });
}

function internals(subject: TowerDefenseGame): RuntimeInternals {
  return subject as unknown as RuntimeInternals;
}

function runtimeAction(subject: TowerDefenseGame, signal: string): ScriptAction {
  const handler = internals(subject).content.scripts.legacy_adapter!.handlers.signal
    .find((candidate) => candidate.when?.args?.[1] === signal);
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

function terrainAt(subject: TowerDefenseGame, coord: GridCoord): string | undefined {
  return subject.getSnapshot().tiles.find((tile) => tile.q === coord.q && tile.r === coord.r)?.terrain;
}

function terraforming(snapshot: GameSnapshot): TerraformingSnapshotV1 | undefined {
  return (snapshot as unknown as { readonly terraforming?: TerraformingSnapshotV1 }).terraforming;
}

function changes(snapshot: GameSnapshot) {
  return snapshot.lastEvents.filter((event) => event.type === "terrainChanged");
}

function newDiagnostics(before: GameSnapshot, after: GameSnapshot) {
  return after.scriptState.diagnostics.slice(before.scriptState.diagnostics.length);
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mutableCheckpoint(subject: TowerDefenseGame): MutableCheckpoint {
  return jsonClone(subject.createCheckpoint()) as unknown as MutableCheckpoint;
}

function resign(checkpoint: MutableCheckpoint): void {
  checkpoint.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

function restore(content: GameContentRegistry, checkpoint: MutableCheckpoint): TowerDefenseGame {
  return TowerDefenseGame.fromCheckpoint({
    content,
    checkpoint: checkpoint as unknown as GameCheckpointV1
  });
}

describe("R3.4b C4A active TowerScript terrain compatibility adapter", () => {
  it("accepts persistent direct set/restore with an empty transition catalog", () => {
    const target = { q: 1, r: 0 };
    const subject = game({
      handlers: {
        set: [setTileTerrain(target, "water")],
        restore: [restoreTileTerrain(target)]
      }
    });

    expect(subject.emitScriptSignal("set")).toEqual({ ok: true });
    expect(terrainAt(subject, target)).toBe("water");
    expect(subject.getSnapshot().terrainOverrides).toEqual([
      { ...target, terrain: "water", source: "script" }
    ]);
    expect(changes(subject.getSnapshot())).toEqual([
      expect.objectContaining({
        coord: target, fromTerrain: "floor", toTerrain: "water", source: "script"
      })
    ]);

    expect(subject.emitScriptSignal("restore")).toEqual({ ok: true });
    expect(terrainAt(subject, target)).toBe("floor");
    expect(subject.getSnapshot().terrainOverrides).toEqual([]);
    expect(changes(subject.getSnapshot()).at(-1)).toEqual(expect.objectContaining({
      coord: target, fromTerrain: "water", toTerrain: "floor", source: "restore"
    }));
    expect(subject.getSnapshot().scriptState.diagnostics).toEqual([]);
  });

  it("treats a persistent direct set to an already-effective blocked authored-route terrain as a true no-op", () => {
    const target = { q: 2, r: 0 };
    const subject = game({
      height: 1,
      handlers: { noop: [setTileTerrain(target, "wall")] }
    });
    const internal = internals(subject);
    internal.runtimeTerrainOverrides.set("2,0", {
      ...target, terrain: "wall", source: "ability"
    });
    subject.map.setTerrain(target, "wall");
    const before = subject.getSnapshot();
    const beforeCheckpoint = mutableCheckpoint(subject);
    const identities = {
      map: subject.map,
      overrides: internal.runtimeTerrainOverrides,
      resolver: internal.navigationResolver,
      lookup: internal.navigationFieldLookupCache,
      fields: internal.navigationEnemyFields
    };

    expect(subject.emitScriptSignal("noop")).toEqual({ ok: true });
    const after = subject.getSnapshot();
    const afterCheckpoint = mutableCheckpoint(subject);

    expect(internal.scriptActionsRemaining).toBe(511);
    expect(internal.scriptTerrainChangesRemaining).toBe(63);
    expect(terrainAt(subject, target)).toBe("wall");
    expect(after.terrainOverrides).toEqual(before.terrainOverrides);
    expect(after.terrainOverrides).toContainEqual({
      ...target, terrain: "wall", source: "ability"
    });
    expect(changes(after).slice(changes(before).length)).toEqual([]);
    expect(newDiagnostics(before, after)).toEqual([]);
    expect(terraforming(after)).toEqual(terraforming(before));
    expect(after.navigation).toEqual(before.navigation);
    expect(afterCheckpoint.state.terraforming).toEqual(beforeCheckpoint.state.terraforming);
    expect(subject.map).toBe(identities.map);
    expect(internal.runtimeTerrainOverrides).toBe(identities.overrides);
    expect(internal.navigationResolver).toBe(identities.resolver);
    expect(internal.navigationFieldLookupCache).toBe(identities.lookup);
    expect(internal.navigationEnemyFields).toBe(identities.fields);
  });

  it("rejects an authored-route-breaking direct set atomically with the native typed reason", () => {
    const target = { q: 2, r: 0 };
    const subject = game({
      height: 1,
      handlers: { block: [setTileTerrain(target, "wall")] }
    });
    const before = subject.getSnapshot();
    const identities = {
      map: subject.map,
      overrides: internals(subject).runtimeTerrainOverrides
    };

    expect(subject.emitScriptSignal("block")).toEqual({ ok: true });
    const after = subject.getSnapshot();

    expect(terrainAt(subject, target)).toBe("path");
    expect(after.terrainOverrides).toEqual(before.terrainOverrides);
    expect(terraforming(after)).toEqual(terraforming(before));
    expect(changes(after)).toEqual([]);
    expect(subject.map).toBe(identities.map);
    expect(internals(subject).runtimeTerrainOverrides).toBe(identities.overrides);
    expect(newDiagnostics(before, after)).toEqual([
      expect.objectContaining({
        code: "invalid_action",
        reasonKey: "terraform.last_authored_route_blocked"
      })
    ]);
  });

  it("uses a detached dynamic proof for both route breaking and baseline repair", () => {
    const target = { q: 2, r: 0 };
    const blocked = game({
      navigation: "dynamic_flow",
      height: 1,
      handlers: { block: [setTileTerrain(target, "wall")] }
    });
    const blockedInternal = internals(blocked);
    const before = blocked.getSnapshot();
    const identities = {
      map: blocked.map,
      overrides: blockedInternal.runtimeTerrainOverrides,
      resolver: blockedInternal.navigationResolver,
      lookup: blockedInternal.navigationFieldLookupCache,
      fields: blockedInternal.navigationEnemyFields,
      stats: blockedInternal.navigationResolver?.getStats()
    };
    const blockedFactory = vi.spyOn(blockedInternal, "createNavigationResolver");

    expect(blocked.emitScriptSignal("block")).toEqual({ ok: true });
    const after = blocked.getSnapshot();
    expect(blockedFactory).toHaveBeenCalledTimes(2);
    expect(terrainAt(blocked, target)).toBe("path");
    expect(after.terrainOverrides).toEqual(before.terrainOverrides);
    expect(changes(after)).toEqual([]);
    expect(blocked.map).toBe(identities.map);
    expect(blockedInternal.runtimeTerrainOverrides).toBe(identities.overrides);
    expect(blockedInternal.navigationResolver).toBe(identities.resolver);
    expect(blockedInternal.navigationFieldLookupCache).toBe(identities.lookup);
    expect(blockedInternal.navigationEnemyFields).toBe(identities.fields);
    expect(blockedInternal.navigationResolver?.getStats()).toEqual(identities.stats);
    expect(newDiagnostics(before, after)).toEqual([
      expect.objectContaining({ code: "invalid_action", reasonKey: "terraform.last_path_blocked" })
    ]);
    blockedFactory.mockRestore();

    const repaired = game({
      navigation: "dynamic_flow",
      height: 1,
      authoredWalls: [target],
      handlers: { repair: [setTileTerrain(target, "water")] }
    });
    const repairedInternal = internals(repaired);
    const oldResolver = repairedInternal.navigationResolver;
    const repairFactory = vi.spyOn(repairedInternal, "createNavigationResolver");

    expect(repaired.emitScriptSignal("repair")).toEqual({ ok: true });
    expect(repairFactory).toHaveBeenCalledTimes(2);
    expect(terrainAt(repaired, target)).toBe("water");
    expect(repaired.getSnapshot().terrainOverrides).toEqual([
      { ...target, terrain: "water", source: "script" }
    ]);
    expect(repairedInternal.navigationResolver).not.toBe(oldResolver);
    expect(repaired.getSnapshot().scriptState.diagnostics).toEqual([]);
    repairFactory.mockRestore();
  });

  it("stores a timed direct set as one native group and preserves checkpoint, replay, and partition equivalence", () => {
    const target = { q: 2, r: 0 };
    const subjectContent = adapterContent({
      handlers: {
        persistent: [setTileTerrain(target, "water")],
        timed: [setTileTerrain(target, "floor", 1)]
      }
    });
    const subject = new TowerDefenseGame({
      missionId: "legacy_adapter", content: subjectContent, seed: "terraform-legacy-adapter-c4a"
    });
    expect(subject.emitScriptSignal("persistent")).toEqual({ ok: true });
    expect(subject.emitScriptSignal("timed")).toEqual({ ok: true });

    const checkpoint = mutableCheckpoint(subject);
    expect(checkpoint.state.runtimeTerrainOverrides).not.toContainEqual(
      expect.objectContaining(target)
    );
    expect(checkpoint.state.runtimeTerrainOverrides.every((entry) => !("expiresIn" in entry))).toBe(true);
    expect(checkpoint.state.terraforming).toEqual({
      schemaVersion: 2,
      runtimeElevationOverrides: [],
      nextExpiryGroupSequence: 2,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: 1,
        entries: [{
          layer: "terrain",
          order: 0,
          q: target.q,
          r: target.r,
          appliedTerrain: "floor",
          previousOverride: { terrain: "water", source: "script" }
        }]
      }]
    });
    expect(terraforming(subject.getSnapshot())).toEqual({
      schemaVersion: 1,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: 1,
        targets: [{ layer: "terrain", ...target }]
      }]
    });

    const resumed = restore(subjectContent, checkpoint);
    const journaled = new JournaledGameSession(restore(subjectContent, checkpoint));
    for (let index = 0; index < 8; index += 1) subject.tick(0.125);
    for (let index = 0; index < 16; index += 1) resumed.tick(0.0625);
    for (let index = 0; index < 8; index += 1) {
      expect(journaled.dispatch({ schemaVersion: 1, type: "tick", units: 0.125 })).toEqual({ ok: true });
    }

    expect(terrainAt(subject, target)).toBe("water");
    expect(subject.getSnapshot().terrainOverrides).toContainEqual({
      ...target, terrain: "water", source: "script"
    });
    expect(subject.getSnapshot()).toEqual(resumed.getSnapshot());
    expect(subject.getStateDigest()).toBe(resumed.getStateDigest());
    expect(journaled.game.getSnapshot()).toEqual(subject.getSnapshot());
    expect(journaled.game.getStateDigest()).toBe(subject.getStateDigest());
    const replay = replayGameCommandJournal({ content: subjectContent, journal: journaled.exportJournal() });
    expect(replay.game.getSnapshot()).toEqual(journaled.game.getSnapshot());
    expect(replay.stateDigest).toBe(journaled.game.getStateDigest());
  });

  it("keeps timed no-ops allocation-free and rejects native or residual-legacy ownership", () => {
    const target = { q: 1, r: 0 };
    const subjectContent = adapterContent({
      transitions: true,
      handlers: {
        noop: [setTileTerrain(target, "floor", 10)],
        timed: [setTileTerrain(target, "water", 10)],
        native: [nativeSet({ q: 2, r: 0 }, 10)],
        hit_native: [setTileTerrain({ q: 2, r: 0 }, "floor")],
        restore_native: [restoreTileTerrain({ q: 2, r: 0 })],
        hit_legacy: [setTileTerrain({ q: 3, r: 0 }, "floor")],
        restore_legacy: [restoreTileTerrain({ q: 3, r: 0 })]
      }
    });
    const form0 = mutableCheckpoint(new TowerDefenseGame({
      missionId: "legacy_adapter", content: subjectContent, seed: "terraform-legacy-adapter-c4a"
    }));
    delete form0.state.terraforming;
    resign(form0);
    const subject = restore(subjectContent, form0);

    const beforeNoop = subject.getSnapshot();
    expect(subject.emitScriptSignal("noop")).toEqual({ ok: true });
    expect(subject.getSnapshot().terrainOverrides).toEqual([]);
    expect(terraforming(subject.getSnapshot())).toEqual({ schemaVersion: 1, pendingExpiryGroups: [] });
    expect(changes(subject.getSnapshot())).toEqual([]);
    expect(subject.getSnapshot().scriptState.diagnostics).toEqual(beforeNoop.scriptState.diagnostics);
    expect(mutableCheckpoint(subject).state).not.toHaveProperty("terraforming");

    expect(subject.emitScriptSignal("timed")).toEqual({ ok: true });
    expect(terraforming(subject.getSnapshot())?.pendingExpiryGroups).toEqual([{
      sequence: 1,
      remaining: 10,
      targets: [{ layer: "terrain", ...target }]
    }]);

    expect(subject.emitScriptSignal("native")).toEqual({ ok: true });
    for (const signal of ["hit_native", "restore_native"] as const) {
      const before = subject.getSnapshot();
      expect(subject.emitScriptSignal(signal)).toEqual({ ok: true });
      expect(newDiagnostics(before, subject.getSnapshot())).toEqual([
        expect.objectContaining({ code: "invalid_action", reasonKey: "terraform.target_owned" })
      ]);
    }

    const legacyCoord = { q: 3, r: 0 };
    internals(subject).runtimeTerrainOverrides.set("3,0", {
      ...legacyCoord, terrain: "water", source: "script", expiresIn: 10
    });
    subject.map.setTerrain(legacyCoord, "water");
    for (const signal of ["hit_legacy", "restore_legacy"] as const) {
      const before = subject.getSnapshot();
      expect(subject.emitScriptSignal(signal)).toEqual({ ok: true });
      expect(terrainAt(subject, legacyCoord)).toBe("water");
      expect(internals(subject).runtimeTerrainOverrides.get("3,0")).toEqual({
        ...legacyCoord, terrain: "water", source: "script", expiresIn: 10
      });
      expect(newDiagnostics(before, subject.getSnapshot())).toEqual([
        expect.objectContaining({ code: "invalid_action", reasonKey: "terraform.target_owned" })
      ]);
    }
  });

  it("reserves one terrain slot and evaluates group-cap, then duration once, then q/r", () => {
    const width = TERRAFORMING_LIMITS.pendingExpiryGroups + 2;
    const subject = game({
      transitions: true,
      width,
      handlers: {
        fill: [nativeSet({ q: { $get: "event.payload.q" }, r: 0 }, 100)],
        direct: [setTileTerrain(
          { q: { $get: "event.payload.q" }, r: { $get: "event.payload.r" } },
          "water",
          { $get: "event.payload.duration" }
        )],
        invalid: [setTileTerrain(
          { q: { $get: "event.payload.q" }, r: { $get: "event.payload.r" } },
          "water",
          { $get: "event.payload.duration" }
        )]
      }
    });

    const validOrder: string[] = [];
    const validAction = runtimeAction(subject, "direct");
    Object.defineProperty(validAction, "duration", {
      value: probeExpression("duration", validOrder, "event.payload.duration"),
      enumerable: true, configurable: true, writable: true
    });
    const validTarget = validAction.target as Record<string, unknown>;
    validTarget.q = probeExpression("q", validOrder, "event.payload.q");
    validTarget.r = probeExpression("r", validOrder, "event.payload.r");
    expect(subject.emitScriptSignal("direct", { q: width - 1, r: 0, duration: 0.25 })).toEqual({ ok: true });
    expect(validOrder).toEqual(["duration", "q", "r"]);

    const invalidOrder: string[] = [];
    const invalidAction = runtimeAction(subject, "invalid");
    Object.defineProperty(invalidAction, "duration", {
      value: probeExpression("duration", invalidOrder, "event.payload.duration"),
      enumerable: true, configurable: true, writable: true
    });
    const invalidTarget = invalidAction.target as Record<string, unknown>;
    invalidTarget.q = probeExpression("q", invalidOrder, "event.payload.q");
    invalidTarget.r = probeExpression("r", invalidOrder, "event.payload.r");
    const beforeInvalid = subject.getSnapshot();
    expect(subject.emitScriptSignal("invalid", { q: width - 2, r: 0, duration: 0 })).toEqual({ ok: true });
    expect(invalidOrder).toEqual(["duration"]);
    expect(newDiagnostics(beforeInvalid, subject.getSnapshot())).toEqual([
      expect.objectContaining({ code: "invalid_action", reasonKey: "terraform.duration_out_of_range" })
    ]);

    subject.tick(0.2);
    for (let q = 0; q < TERRAFORMING_LIMITS.pendingExpiryGroups; q += 1) {
      expect(subject.emitScriptSignal("fill", { q })).toEqual({ ok: true });
    }
    expect(terraforming(subject.getSnapshot())?.pendingExpiryGroups).toHaveLength(
      TERRAFORMING_LIMITS.pendingExpiryGroups
    );

    const cappedOrder: string[] = [];
    Object.defineProperty(validAction, "duration", {
      value: probeExpression("duration", cappedOrder, "event.payload.duration"),
      enumerable: true, configurable: true, writable: true
    });
    validTarget.q = probeExpression("q", cappedOrder, "event.payload.q");
    validTarget.r = probeExpression("r", cappedOrder, "event.payload.r");
    const beforeCapped = subject.getSnapshot();
    expect(subject.emitScriptSignal("direct", { q: width - 1, r: 0, duration: 0.25 })).toEqual({ ok: true });
    const afterCapped = subject.getSnapshot();

    expect(cappedOrder).toEqual([]);
    expect(internals(subject).scriptTerrainChangesRemaining).toBe(63);
    expect(afterCapped.terrainOverrides).toEqual(beforeCapped.terrainOverrides);
    expect(terraforming(afterCapped)).toEqual(terraforming(beforeCapped));
    expect(changes(afterCapped).slice(changes(beforeCapped).length)).toEqual([]);
    expect(newDiagnostics(beforeCapped, afterCapped)).toEqual([
      expect.objectContaining({
        code: "budget_exceeded",
        reasonKey: "terraform.expiry_group_budget_exceeded"
      })
    ]);
  });

  it.each(["absent", "disabled", "unselected"] as const)(
    "keeps the literal %s legacy order, repeat-max timer, snapshot, checkpoint, and digest",
    (activation) => {
      const target = { q: 1, r: 0 };
      const subjectContent = adapterContent({
        activation,
        handlers: {
          legacy: [setTileTerrain(
            { q: { $get: "event.payload.q" }, r: { $get: "event.payload.r" } },
            "water",
            { $get: "event.payload.duration" }
          )]
        }
      });
      const subject = new TowerDefenseGame({
        missionId: "legacy_adapter", content: subjectContent, seed: "terraform-legacy-adapter-c4a"
      });
      const action = runtimeAction(subject, "legacy");
      const order: string[] = [];
      Object.defineProperty(action, "duration", {
        value: probeExpression("duration", order, "event.payload.duration"),
        enumerable: true, configurable: true, writable: true
      });
      const targetExpression = action.target as Record<string, unknown>;
      targetExpression.q = probeExpression("q", order, "event.payload.q");
      targetExpression.r = probeExpression("r", order, "event.payload.r");

      expect(subject.emitScriptSignal("legacy", { ...target, duration: 0.25 })).toEqual({ ok: true });
      expect(subject.emitScriptSignal("legacy", { ...target, duration: 0.1 })).toEqual({ ok: true });
      expect(order).toEqual(["q", "r", "duration", "q", "r", "duration"]);
      const snapshot = subject.getSnapshot();
      expect(snapshot.terrainOverrides).toEqual([
        { ...target, terrain: "water", source: "script", expiresIn: 0.25 }
      ]);
      expect(terraforming(snapshot)).toBeUndefined();
      expect(snapshot.scriptState.diagnostics).toEqual([]);

      const checkpoint = mutableCheckpoint(subject);
      expect(checkpoint.state).not.toHaveProperty("terraforming");
      expect(checkpoint.state.runtimeTerrainOverrides).toEqual([
        { ...target, terrain: "water", source: "script", expiresIn: 0.25 }
      ]);
      const resumed = restore(subjectContent, checkpoint);
      expect(resumed.createCheckpoint()).toEqual(checkpoint);
      expect(resumed.getStateDigest()).toBe(checkpoint.stateDigest);
      resumed.tick(0.2);
      resumed.tick(0.05);
      expect(terrainAt(resumed, target)).toBe("floor");
      expect(resumed.getSnapshot().terrainOverrides).toEqual([]);
      expect(terraforming(resumed.getSnapshot())).toBeUndefined();
    }
  );

  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("keeps compat-direct and native/path-water timers deterministic on %s", (_label, grid) => {
    const directTarget = { q: 1, r: 0 };
    const nativeTarget = { q: 2, r: 0 };
    const abilityTarget = { q: 3, r: 1 };
    const subject = game({
      grid,
      transitions: true,
      handlers: {
        direct: [setTileTerrain(directTarget, "water", 0.125)],
        native: [nativeSet(nativeTarget, 0.125)]
      }
    });

    expect(subject.emitScriptSignal("native")).toEqual({ ok: true });
    expect(subject.useAbility("path_water", abilityTarget)).toEqual({ ok: true });
    expect(terraforming(subject.getSnapshot())?.pendingExpiryGroups).toEqual([
      {
        sequence: 1,
        remaining: 0.125,
        targets: [{ layer: "terrain", ...nativeTarget }]
      },
      {
        sequence: 2,
        remaining: 0.125,
        targets: [{ layer: "terrain", ...abilityTarget }]
      }
    ]);
    expect(subject.getSnapshot().terrainOverrides).toEqual(expect.arrayContaining([
      { ...nativeTarget, terrain: "water", source: "script" },
      { ...abilityTarget, terrain: "water", source: "ability" }
    ]));

    expect(subject.emitScriptSignal("direct")).toEqual({ ok: true });
    expect(terraforming(subject.getSnapshot())?.pendingExpiryGroups).toEqual([
      {
        sequence: 1,
        remaining: 0.125,
        targets: [{ layer: "terrain", ...nativeTarget }]
      },
      {
        sequence: 2,
        remaining: 0.125,
        targets: [{ layer: "terrain", ...abilityTarget }]
      },
      {
        sequence: 3,
        remaining: 0.125,
        targets: [{ layer: "terrain", ...directTarget }]
      }
    ]);
    expect(subject.getSnapshot().terrainOverrides).toEqual(expect.arrayContaining([
      { ...directTarget, terrain: "water", source: "script" },
      { ...nativeTarget, terrain: "water", source: "script" },
      { ...abilityTarget, terrain: "water", source: "ability" }
    ]));

    subject.tick(0.125);
    expect(terrainAt(subject, directTarget)).toBe("floor");
    expect(terrainAt(subject, nativeTarget)).toBe("floor");
    expect(terrainAt(subject, abilityTarget)).toBe("path");
    expect(terraforming(subject.getSnapshot())).toEqual({ schemaVersion: 1, pendingExpiryGroups: [] });
    expect(subject.getSnapshot().terrainOverrides).toEqual([]);
  });
});
