import { describe, expect, it } from "vitest";
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
  type GameCheckpointV1,
  type GameCommandV1
} from "../index.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GameEvent, GameSnapshot, GridCoord, GridDefinition } from "./types.js";

type Activation = "active" | "absent" | "disabled" | "unselected";
type NavigationMode = "authored_routes" | "dynamic_flow";
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CheckpointVersionStaysOne = Assert<Equal<GameCheckpointV1["schemaVersion"], 1>>;
type CommandVersionStaysOne = Assert<Equal<GameCommandV1["schemaVersion"], 1>>;
type EngineVersionStaysV2 = Assert<Equal<GameCheckpointV1["engineVersion"], "towerforge-sim-v2">>;
type SnapshotTerraformingVersionStaysOne = Assert<Equal<
  NonNullable<GameSnapshot["terraforming"]>["schemaVersion"],
  1
>>;
type WaterAbilityEventShapeStaysLegacy = Assert<Equal<
  Extract<GameEvent, { type: "waterAbilityUsed" }>,
  {
    type: "waterAbilityUsed";
    abilityId: string;
    center: GridCoord;
    coords: GridCoord[];
    duration: number;
  }
>>;
const publicVersionsAndShapeStayPut: [
  CheckpointVersionStaysOne,
  CommandVersionStaysOne,
  EngineVersionStaysV2,
  SnapshotTerraformingVersionStaysOne,
  WaterAbilityEventShapeStaysLegacy
] = [true, true, true, true, true];
void publicVersionsAndShapeStayPut;

type ScriptAction = Record<string, unknown>;

interface FixtureOptions {
  readonly activation?: Activation;
  readonly navigation?: NavigationMode;
  readonly grid?: GridDefinition;
  readonly width?: number;
  readonly height?: number;
  readonly radius?: number;
  readonly duration?: number;
  readonly cooldown?: number;
  readonly waterWalkable?: boolean;
  readonly waterSpeed?: number;
  readonly pathWaterSlow?: number;
  readonly dynamicWaterBlocked?: boolean;
  readonly elevation?: boolean;
  readonly handlers?: Readonly<Record<string, readonly ScriptAction[]>>;
}

interface NativeExpiryTarget {
  layer: "terrain" | "elevation";
  q: number;
  r: number;
  order: number;
  appliedTerrain?: string;
  appliedElevation?: number;
  previousOverride?: { terrain: string; source: "script" | "ability" } | null;
  previousElevationOverride?: number | null;
}

interface NativeExpiryGroup {
  sequence: number;
  remaining: number;
  targets: NativeExpiryTarget[];
}

interface RuntimeInternals {
  pendingTerraformExpiryGroups: NativeExpiryGroup[];
  nextTerraformExpirySequence: number;
}

interface MutableCheckpoint extends Omit<GameCheckpointV1, "state" | "stateDigest"> {
  stateDigest: string;
  state: GameCheckpointV1["state"] & {
    abilityCooldowns: Record<string, number>;
    runtimeTerrainOverrides: Array<{
      q: number;
      r: number;
      terrain: string;
      source: "script" | "ability";
      expiresIn?: number;
    }>;
    terraforming?: unknown;
  };
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });
const CENTER = Object.freeze({ q: 1, r: 0 });

function terraformTiles(
  operations: readonly Record<string, unknown>[],
  duration?: number
): ScriptAction {
  return {
    action: "terraformTiles",
    operations: [...operations],
    ...(duration === undefined ? {} : { duration })
  };
}

function setTerrain(target: GridCoord): Record<string, unknown> {
  return { kind: "set_terrain", target: { ...target }, transitionId: "wet" };
}

function setElevation(target: GridCoord): Record<string, unknown> {
  return { kind: "set_elevation", target: { ...target }, elevation: 1 };
}

function signalHandler(signal: string, actions: readonly ScriptAction[]) {
  return {
    id: signal,
    when: { $op: "eq", args: [{ $get: "event.signal" }, signal] },
    actions: [...actions]
  };
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  const activation = options.activation ?? "active";
  const navigation = options.navigation ?? "authored_routes";
  const width = options.width ?? 4;
  const mapWidth = width + 2;
  const height = options.height ?? 1;
  const route = Array.from({ length: mapWidth }, (_, q) => ({ q, r: 0 }));
  const selectedTerraforming = activation === "active" || activation === "disabled";
  const modulePresent = activation !== "absent";
  const handlers = Object.entries(options.handlers ?? {}).map(([signal, actions]) => (
    signalHandler(signal, actions)
  ));
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "path_water_adapter",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 20,
        startingResources: { coins: 20 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: options.waterSpeed ?? 1,
        pathWaterCooldownUnits: options.cooldown ?? 0,
        pathWaterDurationUnits: options.duration ?? 0.5,
        pathWaterRadius: options.radius ?? Math.max(0, width - 1),
        pathWaterGroundSpeedFactor: options.pathWaterSlow ?? 0.25
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
          id: "water", label: "Water", buildable: false,
          walkable: options.waterWalkable ?? true,
          groundSpeedMultiplier: options.waterSpeed ?? 1, tags: ["wet"]
        }
      },
      abilities: {
        path_water: {
          id: "path_water",
          label: "Path water",
          cooldown: options.cooldown ?? 0,
          duration: options.duration ?? 0.5,
          radius: options.radius ?? Math.max(0, width - 1)
        }
      },
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 20, speed: 1,
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
        path_water_adapter: {
          id: "path_water_adapter", label: "Path water adapter", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "field", waveSetId: "one", buildTowerIds: [], abilityIds: ["path_water"],
          mechanics: {
            profiles: {
              navigation: navigation === "dynamic_flow" ? "flow" : "authored",
              ...(options.elevation ? { elevation: "flat" } : {}),
              ...(selectedTerraforming ? { terraforming: "mutable" } : {})
            }
          }
        }
      }
    },
    maps: {
      field: {
        id: "field", width: mapWidth, height, grid: options.grid ?? SQUARE,
        defaultTerrain: "floor",
        spawnCoord: { ...route[0]! },
        coreCoord: { ...route.at(-1)! },
        pathCenterline: route,
        pathRoutes: [{ id: "main", pathCenterline: route }],
        terrainOverrides: route.map((coord) => ({ ...coord, terrain: "path" }))
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
                      towerOccupancy: "ignored", defaultTerrainCost: 1_000,
                      ...(options.dynamicWaterBlocked ? { terrainCosts: { water: null } } : {})
                    }
                  }
                }
              }
            : { authored: { mode: "authored_routes" } }
        },
        elevation: {
          schemaVersion: 1,
          enabled: true,
          profiles: { flat: {} }
        },
        ...(modulePresent ? {
          terraforming: {
            schemaVersion: 1,
            enabled: activation !== "disabled",
            profiles: {
              mutable: {
                terrainTransitions: {
                  wet: { fromTerrainTags: ["dry"], toTerrainId: "water" }
                },
                elevation: { minimum: -4, maximum: 4, maximumDeltaPerOperation: 4 }
              }
            }
          }
        } : {})
      }
    },
    scripts: {
      path_water_adapter: {
        schemaVersion: 6,
        id: "path_water_adapter",
        bindings: [{ scope: "global" }],
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
        missionId: "path_water_adapter", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function game(options: FixtureOptions = {}, fixtureContent = content(options)): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "path_water_adapter",
    content: fixtureContent,
    seed: "terraform-path-water-c4b"
  });
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

function restore(fixtureContent: GameContentRegistry, checkpoint: MutableCheckpoint): TowerDefenseGame {
  return TowerDefenseGame.fromCheckpoint({
    content: fixtureContent,
    checkpoint: checkpoint as unknown as GameCheckpointV1
  });
}

function internals(subject: TowerDefenseGame): RuntimeInternals {
  return subject as unknown as RuntimeInternals;
}

function routeCoords(width: number): GridCoord[] {
  return Array.from({ length: width }, (_, index) => ({ q: index + 1, r: 0 }));
}

function terrainChanges(snapshot: GameSnapshot) {
  return snapshot.lastEvents.filter((event) => event.type === "terrainChanged");
}

function waterEvents(snapshot: GameSnapshot) {
  return snapshot.lastEvents.filter((event) => event.type === "waterAbilityUsed");
}

function terrainAt(subject: TowerDefenseGame, coord: GridCoord): string | undefined {
  return subject.getSnapshot().tiles.find((tile) => tile.q === coord.q && tile.r === coord.r)?.terrain;
}

function injectNativeGroups(subject: TowerDefenseGame, count: number, owned?: GridCoord): void {
  // Deliberate runtime-state seam: checkpoint validation already covers native group shape/depth.
  // These synthetic empty groups isolate path_water's validation priority at the 512-group cap.
  internals(subject).pendingTerraformExpiryGroups = Array.from({ length: count }, (_, index) => ({
    sequence: index + 1,
    remaining: 10,
    targets: index === 0 && owned
      ? [{
          layer: "terrain", ...owned, order: 0, appliedTerrain: "water", previousOverride: null
        }]
      : []
  }));
  internals(subject).nextTerraformExpirySequence = count + 1;
}

function historicLegacyOwner(
  fixtureContent: GameContentRegistry,
  target: GridCoord,
  expiresIn = 0.5
): TowerDefenseGame {
  const checkpoint = mutableCheckpoint(game({}, fixtureContent));
  // Deliberate historical-form fixture: pre-C3B checkpoints stored ability timers only on the
  // terrain override and had no terraforming section.
  checkpoint.state.runtimeTerrainOverrides = [{
    ...target, terrain: "water", source: "ability", expiresIn
  }];
  delete checkpoint.state.terraforming;
  resign(checkpoint);
  return restore(fixtureContent, checkpoint);
}

function historicPersistentWater(
  fixtureContent: GameContentRegistry,
  targets: readonly GridCoord[]
): TowerDefenseGame {
  const checkpoint = mutableCheckpoint(game({}, fixtureContent));
  // Deliberate historical-form fixture: active v0 projects may already contain persistent
  // compatibility overrides while still omitting the native terraforming checkpoint section.
  checkpoint.state.runtimeTerrainOverrides = targets.map((target) => ({
    ...target, terrain: "water", source: "script"
  }));
  delete checkpoint.state.terraforming;
  resign(checkpoint);
  return restore(fixtureContent, checkpoint);
}

describe("R3.4b C4B active path_water compatibility adapter", () => {
  it.each([
    ["absent", "square", SQUARE],
    ["disabled", "square", SQUARE],
    ["unselected", "square", SQUARE],
    ["absent", "hex", HEX],
    ["disabled", "hex", HEX],
    ["unselected", "hex", HEX]
  ] as const)("keeps %s terraforming literal legacy on %s", (activation, _gridLabel, grid) => {
    const subject = game({ activation, grid, width: 65, radius: 64, duration: 0.5 });
    expect(subject.useAbility("path_water", CENTER)).toEqual({ ok: true });
    const snapshot = subject.getSnapshot();

    expect(snapshot.terrainOverrides).toHaveLength(65);
    expect(snapshot.terrainOverrides.every((entry) => (
      entry.terrain === "water" && entry.source === "ability" && entry.expiresIn === 0.5
    ))).toBe(true);
    expect(snapshot.temporaryWaterTiles).toEqual(routeCoords(65).map((coord) => ({ ...coord, expiresIn: 0.5 })));
    expect(snapshot).not.toHaveProperty("terraforming");
    expect(mutableCheckpoint(subject).state).not.toHaveProperty("terraforming");

    subject.tick(0.2);
    subject.tick(0.2);
    subject.tick(0.1);
    expect(subject.getSnapshot().terrainOverrides).toEqual([]);
    expect(subject.getSnapshot().temporaryWaterTiles).toEqual([]);
  });

  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("commits the active 64-cell boundary as one native ability group on %s", (_label, grid) => {
    const coords = routeCoords(64);
    const subject = game({ grid, width: 64, radius: 63, duration: 0.5, cooldown: 2 });
    const beforeEvents = subject.getSnapshot().lastEvents.length;

    expect(subject.useAbility("path_water", CENTER)).toEqual({ ok: true });
    const snapshot = subject.getSnapshot();
    expect(snapshot.terrainOverrides).toEqual(coords.map((coord) => ({
      ...coord, terrain: "water", source: "ability"
    })));
    expect(snapshot.terrainOverrides.every((entry) => !Object.hasOwn(entry, "expiresIn"))).toBe(true);
    expect(snapshot.temporaryWaterTiles).toEqual(coords.map((coord) => ({ ...coord, expiresIn: 0.5 })));
    expect(snapshot.terraforming).toEqual({
      schemaVersion: 1,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: 0.5,
        targets: coords.map((coord) => ({ layer: "terrain", ...coord }))
      }]
    });

    const deltaEvents = snapshot.lastEvents.slice(beforeEvents);
    expect(deltaEvents.slice(0, 64)).toEqual(coords.map((coord) => expect.objectContaining({
      type: "terrainChanged", coord, fromTerrain: "path", toTerrain: "water", source: "ability"
    })));
    expect(deltaEvents[64]).toEqual({
      type: "waterAbilityUsed", abilityId: "path_water", center: CENTER, coords, duration: 0.5
    });
    expect(deltaEvents).toHaveLength(65);

    const checkpoint = mutableCheckpoint(subject);
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.state.terraforming).toMatchObject({
      schemaVersion: 2,
      nextExpiryGroupSequence: 2,
      pendingExpiryGroups: [{ sequence: 1, remaining: 0.5 }]
    });
    const section = checkpoint.state.terraforming as unknown as {
      readonly pendingExpiryGroups: readonly [{ readonly entries: readonly Record<string, unknown>[] }];
    };
    expect(section.pendingExpiryGroups[0]!.entries).toHaveLength(64);
    expect(section.pendingExpiryGroups[0]!.entries.every((entry) => (
      entry.appliedTerrain === "water" && entry.previousOverride === null
    ))).toBe(true);

    subject.tick(0.2);
    subject.tick(0.2);
    subject.tick(0.1);
    expect(subject.getSnapshot().terrainOverrides).toEqual([]);
    expect(subject.getSnapshot().temporaryWaterTiles).toEqual([]);
    expect(subject.getSnapshot().terraforming?.pendingExpiryGroups).toEqual([]);
    expect(terrainChanges(subject.getSnapshot())).toEqual(coords.map((coord) => expect.objectContaining({
      type: "terrainChanged", coord, fromTerrain: "water", toTerrain: "path", source: "restore"
    })));
  });

  it("rejects a 65-cell authored selection before ownership, even when only one cell would change", () => {
    const coords = routeCoords(65);
    const prewet = terraformTiles(coords.slice(0, 64).map(setTerrain));
    const subject = game({
      width: 65, radius: 64,
      handlers: { prewet: [prewet] }
    });
    expect(subject.emitScriptSignal("prewet")).toEqual({ ok: true });
    const before = mutableCheckpoint(subject);

    expect(subject.useAbility("path_water", CENTER)).toEqual(expect.objectContaining({
      ok: false,
      reasonKey: "terraform.operation_budget_exceeded"
    }));
    expect(subject.createCheckpoint()).toEqual(before);

    const owned = game({ width: 65, radius: 64 });
    injectNativeGroups(owned, 1, coords[32]);
    const ownedBefore = owned.getSnapshot();
    expect(owned.useAbility("path_water", CENTER)).toEqual(expect.objectContaining({
      ok: false,
      reasonKey: "terraform.operation_budget_exceeded"
    }));
    expect(owned.getSnapshot()).toEqual(ownedBefore);
  });

  it("prioritizes the native group cap over invalid duration, ownership, and an all-no-op candidate", () => {
    const target = { q: 1, r: 0 };
    const invalid = game({ width: 1, radius: 0, duration: 0 });
    injectNativeGroups(invalid, TERRAFORMING_LIMITS.pendingExpiryGroups, target);
    expect(invalid.useAbility("path_water", target)).toEqual(expect.objectContaining({
      ok: false,
      reasonKey: "terraform.expiry_group_budget_exceeded"
    }));

    const noOp = game({
      width: 1,
      radius: 0,
      handlers: { prewet: [terraformTiles([setTerrain(target)])] }
    });
    expect(noOp.emitScriptSignal("prewet")).toEqual({ ok: true });
    injectNativeGroups(noOp, TERRAFORMING_LIMITS.pendingExpiryGroups);
    const before = noOp.getSnapshot();
    expect(noOp.useAbility("path_water", target)).toEqual(expect.objectContaining({
      ok: false,
      reasonKey: "terraform.expiry_group_budget_exceeded"
    }));
    expect(noOp.getSnapshot()).toEqual(before);
  });

  it.each([
    [0],
    [-1],
    [Number.POSITIVE_INFINITY],
    [TERRAFORMING_LIMITS.duration + 1]
  ])("rejects invalid active duration %s without mutation", (duration) => {
    const subject = game({ width: 1, radius: 0, duration });
    const before = subject.getSnapshot();
    expect(subject.useAbility("path_water", CENTER)).toEqual(expect.objectContaining({
      ok: false,
      reasonKey: "terraform.duration_out_of_range"
    }));
    expect(subject.getSnapshot()).toEqual(before);
  });

  it("rejects a missing water definition as an active invalid operation", () => {
    const fixtureContent = content({ width: 1, radius: 0 });
    // Deliberate untrusted-registry seam: normalizeTerrainTypes supplies bundled water, so delete
    // it after registry construction to prove the runtime fails closed before candidate writes.
    delete fixtureContent.terrainTypes.water;
    const subject = game({}, fixtureContent);
    const before = subject.getSnapshot();
    expect(subject.useAbility("path_water", CENTER)).toEqual(expect.objectContaining({
      ok: false,
      reasonKey: "terraform.invalid_operation"
    }));
    expect(subject.getSnapshot()).toEqual(before);
  });

  it("rejects native-terrain and historical legacy owners but not a same-cell elevation owner", () => {
    const target = { q: 1, r: 0 };
    const terrainOwned = game({
      width: 1, radius: 0,
      handlers: { own: [terraformTiles([setTerrain(target)], 1)] }
    });
    expect(terrainOwned.emitScriptSignal("own")).toEqual({ ok: true });
    expect(terrainOwned.useAbility("path_water", target)).toEqual(expect.objectContaining({
      ok: false,
      reasonKey: "terraform.target_owned"
    }));

    const fixtureContent = content({ width: 1, radius: 0 });
    const legacyOwned = historicLegacyOwner(fixtureContent, target);
    expect(legacyOwned.useAbility("path_water", target)).toEqual(expect.objectContaining({
      ok: false,
      reasonKey: "terraform.target_owned"
    }));
    expect(legacyOwned.getSnapshot().temporaryWaterTiles).toEqual([{ ...target, expiresIn: 0.5 }]);

    const elevationOwned = game({
      width: 1, radius: 0, elevation: true,
      handlers: { own: [terraformTiles([setElevation(target)], 1)] }
    });
    expect(elevationOwned.emitScriptSignal("own")).toEqual({ ok: true });
    expect(elevationOwned.useAbility("path_water", target)).toEqual({ ok: true });
    expect(elevationOwned.getSnapshot().terraforming?.pendingExpiryGroups).toEqual([
      { sequence: 1, remaining: 1, targets: [{ layer: "elevation", ...target }] },
      { sequence: 2, remaining: 0.5, targets: [{ layer: "terrain", ...target }] }
    ]);
  });

  it("keeps all-no-op use successful without promotion and groups only changed cells for a partial no-op", () => {
    const both = routeCoords(2);
    const allNoOpContent = content({ width: 2, radius: 1, cooldown: 2 });
    const allNoOp = historicPersistentWater(allNoOpContent, both);
    const beforeAll = allNoOp.getSnapshot();
    expect(mutableCheckpoint(allNoOp).state).not.toHaveProperty("terraforming");
    expect(allNoOp.useAbility("path_water", CENTER)).toEqual({ ok: true });
    const afterAll = allNoOp.getSnapshot();
    expect(afterAll.abilities.path_water?.cooldownRemaining).toBe(2);
    expect(afterAll.terrainOverrides).toEqual(beforeAll.terrainOverrides);
    expect(afterAll.temporaryWaterTiles).toEqual([]);
    expect(afterAll.terraforming?.pendingExpiryGroups).toEqual([]);
    expect(mutableCheckpoint(allNoOp).state).not.toHaveProperty("terraforming");
    expect(terrainChanges(afterAll).slice(terrainChanges(beforeAll).length)).toEqual([]);
    expect(waterEvents(afterAll).at(-1)).toEqual({
      type: "waterAbilityUsed", abilityId: "path_water", center: CENTER, coords: both, duration: 0.5
    });

    const partial = game({
      width: 2, radius: 1, cooldown: 2,
      handlers: { prewet: [terraformTiles([setTerrain(both[0]!)])] }
    });
    expect(partial.emitScriptSignal("prewet")).toEqual({ ok: true });
    const beforePartialChanges = terrainChanges(partial.getSnapshot()).length;
    expect(partial.useAbility("path_water", CENTER)).toEqual({ ok: true });
    const afterPartial = partial.getSnapshot();
    expect(afterPartial.abilities.path_water?.cooldownRemaining).toBe(2);
    expect(afterPartial.terrainOverrides).toEqual([
      { ...both[0]!, terrain: "water", source: "script" },
      { ...both[1]!, terrain: "water", source: "ability" }
    ]);
    expect(afterPartial.temporaryWaterTiles).toEqual([{ ...both[1]!, expiresIn: 0.5 }]);
    expect(afterPartial.terraforming?.pendingExpiryGroups).toEqual([{
      sequence: 1,
      remaining: 0.5,
      targets: [{ layer: "terrain", ...both[1]! }]
    }]);
    expect(terrainChanges(afterPartial).slice(beforePartialChanges)).toEqual([
      expect.objectContaining({ coord: both[1], source: "ability" })
    ]);
    expect(waterEvents(afterPartial).at(-1)?.coords).toEqual(both);
  });

  it("derives detached temporary-water rows from group remaining in sequence/target order", () => {
    const subject = game({ width: 3, radius: 0, duration: 0.5, cooldown: 0 });
    expect(subject.useAbility("path_water", { q: 3, r: 0 })).toEqual({ ok: true });
    subject.tick(0.1);
    expect(subject.useAbility("path_water", { q: 1, r: 0 })).toEqual({ ok: true });

    const snapshot = subject.getSnapshot();
    expect(snapshot.temporaryWaterTiles).toEqual([
      { q: 3, r: 0, expiresIn: 0.4 },
      { q: 1, r: 0, expiresIn: 0.5 }
    ]);
    expect(snapshot.terrainOverrides.every((entry) => !Object.hasOwn(entry, "expiresIn"))).toBe(true);
    snapshot.temporaryWaterTiles[0]!.q = 999;
    snapshot.temporaryWaterTiles[0]!.expiresIn = 999;
    expect(subject.getSnapshot().temporaryWaterTiles).toEqual([
      { q: 3, r: 0, expiresIn: 0.4 },
      { q: 1, r: 0, expiresIn: 0.5 }
    ]);
  });

  it("keeps path-water slow tied to the derived native timer rather than terrain source", () => {
    const slowed = game({ width: 4, radius: 0, duration: 2, pathWaterSlow: 0.25, waterSpeed: 1 });
    const persistent = game({
      width: 4, radius: 0, duration: 2, pathWaterSlow: 0.25, waterSpeed: 1,
      handlers: { prewet: [terraformTiles([setTerrain(CENTER)])] }
    });
    expect(slowed.useAbility("path_water", CENTER)).toEqual({ ok: true });
    expect(persistent.emitScriptSignal("prewet")).toEqual({ ok: true });
    expect(slowed.startNextWave()).toEqual({ ok: true });
    expect(persistent.startNextWave()).toEqual({ ok: true });
    slowed.tick(0);
    persistent.tick(0);
    for (let index = 0; index < 5; index += 1) {
      slowed.tick(0.2);
      persistent.tick(0.2);
    }
    slowed.tick(0.2);
    persistent.tick(0.2);

    const slowedProgress = slowed.getSnapshot().enemies[0]!.pathProgress;
    const persistentProgress = persistent.getSnapshot().enemies[0]!.pathProgress;
    expect(persistentProgress).toBeCloseTo(1.2, 10);
    expect(slowedProgress).toBeGreaterThan(0);
    expect(slowedProgress).toBeLessThan(persistentProgress);
  });

  it.each([
    ["authored", { navigation: "authored_routes" as const, waterWalkable: false }, "terraform.last_authored_route_blocked"],
    ["dynamic", { navigation: "dynamic_flow" as const, dynamicWaterBlocked: true }, "terraform.last_path_blocked"]
  ])("rejects an unsafe %s candidate atomically", (_label, variant, reasonKey) => {
    const subject = game({ width: 3, radius: 2, ...variant });
    const before = subject.getSnapshot();
    expect(subject.useAbility("path_water", CENTER)).toEqual(expect.objectContaining({ ok: false, reasonKey }));
    expect(subject.getSnapshot()).toEqual(before);
  });

  it("round-trips checkpoint/journal replay and expires identically across tick partitions", () => {
    const fixtureContent = content({ width: 3, radius: 2, duration: 0.5, cooldown: 0 });
    const continuous = game({}, fixtureContent);
    const partitioned = game({}, fixtureContent);
    expect(continuous.useAbility("path_water", CENTER)).toEqual({ ok: true });
    expect(partitioned.useAbility("path_water", CENTER)).toEqual({ ok: true });
    continuous.tick(0.2);
    continuous.tick(0.2);
    continuous.tick(0.1);
    for (let index = 0; index < 5; index += 1) partitioned.tick(0.1);
    expect(partitioned.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(partitioned.getStateDigest()).toBe(continuous.getStateDigest());

    const session = new JournaledGameSession(game({}, fixtureContent));
    expect(session.dispatch({
      schemaVersion: 1, type: "useAbility", abilityId: "path_water", center: CENTER
    })).toEqual({ ok: true });
    for (const units of [0.2, 0.2, 0.1]) {
      expect(session.dispatch({ schemaVersion: 1, type: "tick", units })).toEqual({ ok: true });
    }
    const replay = replayGameCommandJournal({ content: fixtureContent, journal: session.exportJournal() });
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(replay.stateDigest).toBe(session.game.getStateDigest());

    const mid = game({}, fixtureContent);
    expect(mid.useAbility("path_water", CENTER)).toEqual({ ok: true });
    mid.tick(0.2);
    const resumed = restore(fixtureContent, mutableCheckpoint(mid));
    expect(resumed.getSnapshot()).toEqual(mid.getSnapshot());
    expect(resumed.getStateDigest()).toBe(mid.getStateDigest());
  });

  it("keeps historical form-0 timers legacy, then promotes a fresh use and resets native state", () => {
    const fixtureContent = content({ width: 1, radius: 0, duration: 0.5, cooldown: 0 });
    const subject = historicLegacyOwner(fixtureContent, CENTER, 0.5);
    expect(mutableCheckpoint(subject).state).not.toHaveProperty("terraforming");
    expect(subject.getSnapshot().temporaryWaterTiles).toEqual([{ ...CENTER, expiresIn: 0.5 }]);

    subject.tick(0.2);
    subject.tick(0.2);
    subject.tick(0.1);
    expect(subject.getSnapshot().temporaryWaterTiles).toEqual([]);
    expect(mutableCheckpoint(subject).state).not.toHaveProperty("terraforming");

    expect(subject.useAbility("path_water", CENTER)).toEqual({ ok: true });
    expect(mutableCheckpoint(subject).state.terraforming).toMatchObject({
      schemaVersion: 2,
      nextExpiryGroupSequence: 2,
      pendingExpiryGroups: [{ sequence: 1, remaining: 0.5 }]
    });

    subject.reset();
    expect(subject.getSnapshot().terrainOverrides).toEqual([]);
    expect(subject.getSnapshot().temporaryWaterTiles).toEqual([]);
    expect(subject.getSnapshot().terraforming).toEqual({ schemaVersion: 1, pendingExpiryGroups: [] });
    expect(subject.getSnapshot().abilities.path_water?.ready).toBe(true);
    expect(mutableCheckpoint(subject).state.terraforming).toEqual({
      schemaVersion: 2,
      runtimeElevationOverrides: [],
      nextExpiryGroupSequence: 1,
      pendingExpiryGroups: []
    });
  });
});
