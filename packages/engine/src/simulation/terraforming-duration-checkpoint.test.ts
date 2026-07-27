import { describe, expect, it, vi } from "vitest";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import {
  computeCheckpointStateDigest,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCheckpointV1
} from "../index.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

type Activation = "active" | "absent" | "disabled" | "unselected";

interface RuntimeElevationOverrideContract {
  q: number;
  r: number;
  elevation: number;
}

interface PreviousTerrainOverrideContract {
  terrain: string;
  source: "script" | "ability";
  expiresIn?: number;
}

interface TerrainExpiryEntryContract {
  layer: "terrain";
  order: number;
  q: number;
  r: number;
  appliedTerrain: string;
  previousOverride: PreviousTerrainOverrideContract | null;
  extra?: unknown;
}

interface ElevationExpiryEntryContract {
  layer: "elevation";
  order: number;
  q: number;
  r: number;
  appliedElevation: number;
  previousElevationOverride: number | null;
  extra?: unknown;
}

type ExpiryEntryContract = TerrainExpiryEntryContract | ElevationExpiryEntryContract;

interface ExpiryGroupContract {
  sequence: number;
  remaining: number;
  entries: ExpiryEntryContract[];
  extra?: unknown;
}

interface TerraformingCheckpointV1Contract {
  schemaVersion: 1;
  runtimeElevationOverrides: RuntimeElevationOverrideContract[];
}

interface TerraformingCheckpointV2Contract {
  schemaVersion: 2;
  runtimeElevationOverrides: RuntimeElevationOverrideContract[];
  nextExpiryGroupSequence: number;
  pendingExpiryGroups: ExpiryGroupContract[];
  extra?: unknown;
}

type TerraformingCheckpointContract = TerraformingCheckpointV1Contract | TerraformingCheckpointV2Contract;

interface MutableCheckpointContract {
  schemaVersion: number;
  engineVersion: string;
  contentDigest: string;
  identity: GameCheckpointV1["identity"];
  rng: GameCheckpointV1["rng"];
  state: Omit<GameCheckpointV1["state"], "runtimeTerrainOverrides" | "terraforming"> & {
    runtimeTerrainOverrides: Array<{
      q: number;
      r: number;
      terrain: string;
      source: "script" | "ability";
      expiresIn?: number;
    }>;
    terraforming?: TerraformingCheckpointContract;
  };
  stateDigest: string;
}

interface TerraformingSnapshotContract {
  schemaVersion: number;
  pendingExpiryGroups: Array<{
    sequence: number;
    remaining: number;
    targets: Array<{ layer: "terrain" | "elevation"; q: number; r: number }>;
  }>;
}

type HostileMutation = (checkpoint: MutableCheckpointContract) => { resign?: boolean; verify?: () => void } | void;

const WIDTH = 40;
const HEIGHT = 30;
const DURATION_LIMIT = 1_000_000_000;
const RUNTIME_ELEVATION = { q: 2, r: 0, elevation: 2 } as const;
const RUNTIME_TERRAIN = { q: 3, r: 0, terrain: "water", source: "script" as const };

function terraformTiles(
  operations: readonly Record<string, unknown>[],
  duration?: number
): Record<string, unknown> {
  return {
    action: "terraformTiles",
    operations,
    ...(duration === undefined ? {} : { duration })
  };
}

function signalHandler(signal: string, action: Record<string, unknown>) {
  return {
    when: { $op: "eq", args: [{ $get: "event.signal" }, signal] },
    actions: [action]
  };
}

function checkpointInput(
  activation: Activation = "active",
  options: { readonly elevation?: boolean; readonly blockedRoute?: boolean } = {}
): GameContentInput {
  const elevation = options.elevation !== false;
  const selected = activation === "active" || activation === "disabled";
  const modulesPresent = activation !== "absent";
  const enabled = activation !== "disabled";
  const route = Array.from({ length: 5 }, (_, q) => ({ q, r: 1 }));
  return {
    balance: {
      defaultMissionId: "terraform_duration_checkpoint",
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
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 10, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 0
        }
      },
      towers: {},
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "walker", count: 1, spawnInterval: 0, startDelay: 0, routeId: "main" }]
        }]
      },
      missions: {
        terraform_duration_checkpoint: {
          id: "terraform_duration_checkpoint",
          label: "Terraform duration checkpoint",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 20 },
          prepTimeUnits: 0,
          mapId: "field",
          waveSetId: "one",
          buildTowerIds: [],
          abilityIds: [],
          ...(selected ? {
            mechanics: {
              profiles: {
                terraforming: "mutable",
                ...(elevation ? { elevation: "base" } : {})
              }
            }
          } : {})
        }
      }
    },
    maps: {
      field: {
        id: "field",
        width: WIDTH,
        height: HEIGHT,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 1 },
        coreCoord: { q: 4, r: 1 },
        pathCenterline: route,
        pathRoutes: [{ id: "main", pathCenterline: route }],
        terrainOverrides: options.blockedRoute ? [{ q: 2, r: 1, terrain: "wall" }] : [],
        elevationOverrides: elevation ? [{ q: 1, r: 0, elevation: 1 }] : []
      }
    },
    scripts: {
      terraform_duration_checkpoint: {
        schemaVersion: 6,
        id: "terraform_duration_checkpoint",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [
            signalHandler("timed_mixed", terraformTiles([
              { kind: "set_terrain", target: { q: 3, r: 0 }, transitionId: "flood" },
              { kind: "set_elevation", target: { q: 2, r: 0 }, elevation: 2 }
            ], 1)),
            signalHandler("timed_elevation", terraformTiles([
              { kind: "set_elevation", target: { q: 2, r: 0 }, elevation: 2 }
            ], 1)),
            signalHandler("timed_terrain", terraformTiles([
              { kind: "set_terrain", target: { q: 3, r: 0 }, transitionId: "flood" }
            ], 1)),
            signalHandler("persistent_elevation", terraformTiles([
              { kind: "set_elevation", target: { q: 2, r: 0 }, elevation: 2 }
            ])),
            signalHandler("persistent_terrain", terraformTiles([
              { kind: "set_terrain", target: { q: 3, r: 0 }, transitionId: "flood" }
            ])),
            signalHandler("timed_authored_base", terraformTiles([
              { kind: "set_terrain", target: { q: 3, r: 0 }, transitionId: "dryout" },
              { kind: "set_elevation", target: { q: 2, r: 0 }, elevation: 0 }
            ], 1)),
            signalHandler("timed_repair", terraformTiles([
              { kind: "set_terrain", target: { q: 2, r: 1 }, transitionId: "repair" }
            ], 0.2))
          ]
        }
      } as never
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "terraform_duration_checkpoint", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    },
    ...(modulesPresent ? {
      mechanics: {
        schemaVersion: 1,
        modules: {
          ...(elevation ? {
            elevation: { schemaVersion: 1, enabled, profiles: { base: {} } }
          } : {}),
          terraforming: {
            schemaVersion: 1,
            enabled,
            profiles: {
              mutable: {
                terrainTransitions: {
                  flood: { fromTerrainTags: ["dry"], toTerrainId: "water" },
                  dryout: { fromTerrainTags: ["wet"], toTerrainId: "floor" },
                  repair: { fromTerrainTags: ["blocked"], toTerrainId: "water" }
                },
                ...(elevation ? {
                  elevation: { minimum: -4, maximum: 4, maximumDeltaPerOperation: 4 }
                } : {})
              }
            }
          }
        }
      }
    } : {})
  };
}

function content(
  activation: Activation = "active",
  options: { readonly elevation?: boolean; readonly blockedRoute?: boolean } = {}
): GameContentRegistry {
  return createGameContentRegistry(checkpointInput(activation, options));
}

function game(subjectContent: GameContentRegistry): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "terraform_duration_checkpoint",
    content: subjectContent,
    seed: "terraform-duration-checkpoint"
  });
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function restore(
  subjectContent: GameContentRegistry,
  checkpoint: MutableCheckpointContract
): TowerDefenseGame {
  return TowerDefenseGame.fromCheckpoint({
    content: subjectContent,
    checkpoint: checkpoint as unknown as GameCheckpointV1
  });
}

function mapFactorySpy(subjectContent: GameContentRegistry): ReturnType<typeof vi.fn> {
  const mission = subjectContent.missions.terraform_duration_checkpoint!;
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

function advance(subject: TowerDefenseGame, units: number): void {
  const wholeSteps = Math.floor(units / 0.2 + 1e-9);
  for (let index = 0; index < wholeSteps; index += 1) subject.tick(0.2);
  const remainder = units - wholeSteps * 0.2;
  if (remainder > 1e-9) subject.tick(remainder);
}

function terrainEntry(q: number, r: number, order = 0): TerrainExpiryEntryContract {
  return {
    layer: "terrain",
    order,
    q,
    r,
    appliedTerrain: "water",
    previousOverride: null
  };
}

function elevationEntry(q: number, r: number, order = 0): ElevationExpiryEntryContract {
  return {
    layer: "elevation",
    order,
    q,
    r,
    appliedElevation: 2,
    previousElevationOverride: null
  };
}

function group(
  sequence = 1,
  remaining = 1,
  entries: ExpiryEntryContract[] = [terrainEntry(3, 0), elevationEntry(2, 0, 1)]
): ExpiryGroupContract {
  return { sequence, remaining, entries };
}

function v2Section(
  pendingExpiryGroups: ExpiryGroupContract[] = [],
  nextExpiryGroupSequence = (pendingExpiryGroups.at(-1)?.sequence ?? 0) + 1
): TerraformingCheckpointV2Contract {
  return {
    schemaVersion: 2,
    runtimeElevationOverrides: [],
    nextExpiryGroupSequence,
    pendingExpiryGroups
  };
}

function setV2Projection(
  checkpoint: MutableCheckpointContract,
  groups: ExpiryGroupContract[],
  nextSequence = (groups.at(-1)?.sequence ?? 0) + 1
): void {
  const terrain = new Map<string, MutableCheckpointContract["state"]["runtimeTerrainOverrides"][number]>();
  const elevation = new Map<string, RuntimeElevationOverrideContract>();
  for (const pending of groups) {
    for (const entry of pending.entries) {
      const key = `${entry.r},${entry.q}`;
      if (entry.layer === "terrain") {
        terrain.set(key, {
          q: entry.q,
          r: entry.r,
          terrain: entry.appliedTerrain,
          source: "script"
        });
      } else {
        elevation.set(key, { q: entry.q, r: entry.r, elevation: entry.appliedElevation });
      }
    }
  }
  checkpoint.state.runtimeTerrainOverrides = [...terrain.values()]
    .sort((left, right) => left.r - right.r || left.q - right.q);
  checkpoint.state.terraforming = {
    ...v2Section(groups, nextSequence),
    runtimeElevationOverrides: [...elevation.values()]
      .sort((left, right) => left.r - right.r || left.q - right.q)
  };
  resign(checkpoint);
}

function syntheticV2(subjectContent: GameContentRegistry): MutableCheckpointContract {
  const checkpoint = mutable(jsonClone(game(subjectContent).createCheckpoint()));
  setV2Projection(checkpoint, [group()]);
  return checkpoint;
}

function targetEntries(count: number): ExpiryEntryContract[] {
  return Array.from({ length: count }, (_, index) => {
    const cell = Math.floor(index / 2);
    const q = cell % WIDTH;
    const r = Math.floor(cell / WIDTH);
    return index % 2 === 0
      ? terrainEntry(q, r, index % 64)
      : elevationEntry(q, r, index % 64);
  });
}

function groupsForEntries(entries: readonly ExpiryEntryContract[]): ExpiryGroupContract[] {
  const groups: ExpiryGroupContract[] = [];
  for (let offset = 0; offset < entries.length; offset += 64) {
    groups.push(group(
      groups.length + 1,
      1,
      entries.slice(offset, offset + 64).map((entry, order) => ({ ...entry, order }))
    ));
  }
  return groups;
}

function snapshotTerraforming(subject: TowerDefenseGame): TerraformingSnapshotContract | undefined {
  return (subject.getSnapshot() as unknown as { terraforming?: TerraformingSnapshotContract }).terraforming;
}

describe("R3.4b C3B duration checkpoint and snapshot contracts", () => {
  it("keeps outer version domains fixed and emits the exact fresh active v2 state", () => {
    const checkpoint = mutable(game(content()).createCheckpoint());
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.state.terraforming).toEqual({
      schemaVersion: 2,
      runtimeElevationOverrides: [],
      nextExpiryGroupSequence: 1,
      pendingExpiryGroups: []
    });

    const session = new JournaledGameSession(game(content()));
    const journal = session.exportJournal();
    expect(journal.schemaVersion).toBe(1);
    expect(journal.engineVersion).toBe("towerforge-sim-v2");
  });

  it("preserves restored v1 and form-0 bytes until the first successful non-noop timed batch", () => {
    const elevationContent = content();
    const c3aSource = game(elevationContent);
    expect(c3aSource.emitScriptSignal("persistent_elevation")).toEqual({ ok: true });
    const legacyV1 = mutable(jsonClone(c3aSource.createCheckpoint()));
    legacyV1.state.terraforming = {
      schemaVersion: 1,
      runtimeElevationOverrides: [{ ...RUNTIME_ELEVATION }]
    };
    resign(legacyV1);
    const restoredV1 = restore(elevationContent, legacyV1);
    expect(mutable(restoredV1.createCheckpoint()).state.terraforming).toEqual(legacyV1.state.terraforming);
    expect(restoredV1.getStateDigest()).toBe(legacyV1.stateDigest);
    expect(restoredV1.emitScriptSignal("persistent_elevation")).toEqual({ ok: true });
    expect(mutable(restoredV1.createCheckpoint()).state.terraforming?.schemaVersion).toBe(1);
    expect(restoredV1.emitScriptSignal("timed_mixed")).toEqual({ ok: true });
    expect(mutable(restoredV1.createCheckpoint()).state.terraforming).toMatchObject({
      schemaVersion: 2,
      nextExpiryGroupSequence: 2,
      pendingExpiryGroups: [{ sequence: 1 }]
    });

    const terrainContent = content("active", { elevation: false });
    const legacyForm0 = mutable(jsonClone(game(terrainContent).createCheckpoint()));
    expect(legacyForm0.state.terraforming?.schemaVersion).toBe(2);
    delete legacyForm0.state.terraforming;
    resign(legacyForm0);
    const restoredForm0 = restore(terrainContent, legacyForm0);
    expect(Object.prototype.hasOwnProperty.call(restoredForm0.createCheckpoint().state, "terraforming")).toBe(false);
    expect(restoredForm0.emitScriptSignal("persistent_terrain")).toEqual({ ok: true });
    expect(Object.prototype.hasOwnProperty.call(restoredForm0.createCheckpoint().state, "terraforming")).toBe(false);
    restoredForm0.reset();
    expect(restoredForm0.emitScriptSignal("timed_terrain")).toEqual({ ok: true });
    expect(mutable(restoredForm0.createCheckpoint()).state.terraforming).toMatchObject({
      schemaVersion: 2,
      nextExpiryGroupSequence: 2,
      pendingExpiryGroups: [{ sequence: 1 }]
    });
  });

  it("round-trips and replays a mid-duration mixed group to the continuous digest and snapshot", () => {
    const subjectContent = content();
    const continuous = game(subjectContent);
    expect(continuous.emitScriptSignal("timed_mixed")).toEqual({ ok: true });
    advance(continuous, 0.4);
    const checkpoint = mutable(jsonClone(continuous.createCheckpoint()));
    expect(checkpoint.state.terraforming).toEqual({
      schemaVersion: 2,
      runtimeElevationOverrides: [{ ...RUNTIME_ELEVATION }],
      nextExpiryGroupSequence: 2,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: expect.closeTo(0.6),
        entries: [
          {
            layer: "terrain", order: 0, q: 3, r: 0,
            appliedTerrain: "water", previousOverride: null
          },
          {
            layer: "elevation", order: 1, q: 2, r: 0,
            appliedElevation: 2, previousElevationOverride: null
          }
        ]
      }]
    });

    const resumed = restore(subjectContent, checkpoint);
    const session = new JournaledGameSession(resumed);
    for (let index = 0; index < 4; index += 1) {
      continuous.tick(0.2);
      expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    }
    expect(session.game.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(session.game.getStateDigest()).toBe(continuous.getStateDigest());
    expect(mutable(session.game.createCheckpoint()).state.terraforming).toMatchObject({
      schemaVersion: 2,
      nextExpiryGroupSequence: 2,
      pendingExpiryGroups: []
    });

    const replay = replayGameCommandJournal({ content: subjectContent, journal: jsonClone(session.exportJournal()) });
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
  });

  it("round-trips a timed authored-base projection and restores its persistent before-images", () => {
    const subjectContent = content();
    const continuous = game(subjectContent);
    expect(continuous.emitScriptSignal("persistent_terrain")).toEqual({ ok: true });
    expect(continuous.emitScriptSignal("persistent_elevation")).toEqual({ ok: true });
    expect(continuous.emitScriptSignal("timed_authored_base")).toEqual({ ok: true });

    const checkpoint = mutable(jsonClone(continuous.createCheckpoint()));
    expect(checkpoint.state.runtimeTerrainOverrides).not.toContainEqual(
      expect.objectContaining({ q: 3, r: 0 })
    );
    expect(checkpoint.state.terraforming).toEqual({
      schemaVersion: 2,
      runtimeElevationOverrides: [],
      nextExpiryGroupSequence: 2,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: 1,
        entries: [
          {
            layer: "terrain", order: 0, q: 3, r: 0,
            appliedTerrain: "floor",
            previousOverride: { terrain: "water", source: "script" }
          },
          {
            layer: "elevation", order: 1, q: 2, r: 0,
            appliedElevation: 0,
            previousElevationOverride: 2
          }
        ]
      }]
    });

    const resumed = restore(subjectContent, checkpoint);
    expect(resumed.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(resumed.getStateDigest()).toBe(continuous.getStateDigest());
    const session = new JournaledGameSession(resumed);
    for (let index = 0; index < 5; index += 1) {
      continuous.tick(0.2);
      expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    }
    const expired = mutable(session.game.createCheckpoint());
    expect(expired.state.runtimeTerrainOverrides).toContainEqual(RUNTIME_TERRAIN);
    expect(expired.state.terraforming).toMatchObject({
      schemaVersion: 2,
      runtimeElevationOverrides: [{ ...RUNTIME_ELEVATION }],
      pendingExpiryGroups: []
    });
    expect(session.game.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(session.game.getStateDigest()).toBe(continuous.getStateDigest());

    const replay = replayGameCommandJournal({ content: subjectContent, journal: jsonClone(session.exportJournal()) });
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
  });

  it("round-trips a deferred-due unsafe expiry and retries deterministically through journal replay", () => {
    const subjectContent = content("active", { blockedRoute: true });
    const continuous = game(subjectContent);
    expect(continuous.emitScriptSignal("timed_repair")).toEqual({ ok: true });
    continuous.tick(0.2);
    const due = mutable(jsonClone(continuous.createCheckpoint()));
    expect((due.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups).toMatchObject([{
      sequence: 1,
      remaining: 0,
      entries: [{ layer: "terrain", q: 2, r: 1, appliedTerrain: "water" }]
    }]);

    const resumed = restore(subjectContent, due);
    const session = new JournaledGameSession(resumed);
    continuous.tick(0.2);
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.2 })).toEqual({ ok: true });
    expect(session.game.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(session.game.getStateDigest()).toBe(continuous.getStateDigest());
    const replay = replayGameCommandJournal({ content: subjectContent, journal: jsonClone(session.exportJournal()) });
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
  });

  it("exposes only detached canonical pending targets in the active snapshot", () => {
    for (const activation of ["absent", "disabled", "unselected"] as const) {
      expect(snapshotTerraforming(game(content(activation))), activation).toBeUndefined();
    }
    expect(snapshotTerraforming(game(content()))).toEqual({
      schemaVersion: 1,
      pendingExpiryGroups: []
    });

    const subject = game(content());
    expect(subject.emitScriptSignal("timed_mixed")).toEqual({ ok: true });
    const first = snapshotTerraforming(subject)!;
    expect(first).toEqual({
      schemaVersion: 1,
      pendingExpiryGroups: [{
        sequence: 1,
        remaining: 1,
        targets: [
          { layer: "terrain", q: 3, r: 0 },
          { layer: "elevation", q: 2, r: 0 }
        ]
      }]
    });
    expect(JSON.stringify(first)).not.toMatch(/previous|applied/i);
    first.pendingExpiryGroups[0]!.targets[0]!.q = 39;
    expect(snapshotTerraforming(subject)!.pendingExpiryGroups[0]!.targets[0]).toEqual({
      layer: "terrain", q: 3, r: 0
    });
  });

  const hostileCases: readonly [string, HostileMutation][] = [
    ["accessor pendingExpiryGroups", (checkpoint) => {
      let reads = 0;
      checkpoint.state.terraforming = Object.defineProperties({}, {
        schemaVersion: { value: 2, enumerable: true },
        runtimeElevationOverrides: { value: [], enumerable: true },
        nextExpiryGroupSequence: { value: 1, enumerable: true },
        pendingExpiryGroups: {
          enumerable: true,
          get(): never {
            reads += 1;
            throw new Error("EXPIRY_ACCESSOR_READ");
          }
        }
      }) as TerraformingCheckpointV2Contract;
      return { resign: false, verify: () => expect(reads).toBe(0) };
    }],
    ["sparse group array", (checkpoint) => {
      const groups = new Array<ExpiryGroupContract>(2);
      groups[1] = group(1);
      checkpoint.state.terraforming = v2Section(groups, 2);
      return { resign: false };
    }],
    ["sparse entry array", (checkpoint) => {
      const entries = new Array<ExpiryEntryContract>(2);
      entries[1] = elevationEntry(2, 0, 1);
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.entries = entries;
      return { resign: false };
    }],
    ["extra section field", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).extra = true;
    }],
    ["extra group field", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.extra = true;
    }],
    ["extra entry field", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.entries[0]!.extra = true;
    }],
    ["future inner schema", (checkpoint) => {
      (checkpoint.state.terraforming as unknown as { schemaVersion: number }).schemaVersion = 3;
    }],
    ["noncanonical next sequence", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).nextExpiryGroupSequence = 1;
    }],
    ["noncanonical sequence order", (checkpoint) => {
      const groups = [group(2, 1, [terrainEntry(3, 0)]), group(1, 1, [elevationEntry(2, 0)])];
      setV2Projection(checkpoint, groups, 3);
    }],
    ["duplicate sequence", (checkpoint) => {
      const groups = [group(1, 1, [terrainEntry(3, 0)]), group(1, 1, [elevationEntry(2, 0)])];
      setV2Projection(checkpoint, groups, 2);
    }],
    ["negative remaining", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.remaining = -1;
    }],
    ["over-limit remaining", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.remaining = DURATION_LIMIT + 1;
    }],
    ["nonfinite remaining", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.remaining = Number.POSITIVE_INFINITY;
      return { resign: false };
    }],
    ["duplicate entry order", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.entries[1]!.order = 0;
    }],
    ["noncanonical entry order", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.entries.reverse();
    }],
    ["65 entries in one group", (checkpoint) => {
      setV2Projection(checkpoint, [group(1, 1, targetEntries(65).map((entry, order) => ({ ...entry, order })))], 2);
    }],
    ["duplicate global target ownership", (checkpoint) => {
      const groups = [group(1, 1, [terrainEntry(3, 0)]), group(2, 1, [terrainEntry(3, 0)])];
      setV2Projection(checkpoint, groups, 3);
    }],
    ["outside-map entry", (checkpoint) => {
      (checkpoint.state.terraforming as TerraformingCheckpointV2Contract).pendingExpiryGroups[0]!.entries[0]!.q = WIDTH;
    }],
    ["unknown applied terrain", (checkpoint) => {
      const entry = (checkpoint.state.terraforming as TerraformingCheckpointV2Contract)
        .pendingExpiryGroups[0]!.entries[0] as TerrainExpiryEntryContract;
      entry.appliedTerrain = "missing";
    }],
    ["fractional applied elevation", (checkpoint) => {
      const entry = (checkpoint.state.terraforming as TerraformingCheckpointV2Contract)
        .pendingExpiryGroups[0]!.entries[1] as ElevationExpiryEntryContract;
      entry.appliedElevation = 1.5;
    }],
    ["native previous terrain expiry", (checkpoint) => {
      const entry = (checkpoint.state.terraforming as TerraformingCheckpointV2Contract)
        .pendingExpiryGroups[0]!.entries[0] as TerrainExpiryEntryContract;
      entry.previousOverride = { terrain: "floor", source: "ability", expiresIn: 1 };
    }],
    ["invalid previous elevation override", (checkpoint) => {
      const entry = (checkpoint.state.terraforming as TerraformingCheckpointV2Contract)
        .pendingExpiryGroups[0]!.entries[1] as ElevationExpiryEntryContract;
      entry.previousElevationOverride = 5;
    }],
    ["applied projection mismatch", (checkpoint) => {
      const entry = (checkpoint.state.terraforming as TerraformingCheckpointV2Contract)
        .pendingExpiryGroups[0]!.entries[1] as ElevationExpiryEntryContract;
      entry.appliedElevation = 3;
    }],
    ["513 pending groups", (checkpoint) => {
      const entries = targetEntries(513);
      const groups = entries.map((entry, index) => group(index + 1, 1, [{ ...entry, order: 0 }]));
      setV2Projection(checkpoint, groups, 514);
    }],
    ["1025 globally owned targets", (checkpoint) => {
      const groups = groupsForEntries(targetEntries(1_025));
      setV2Projection(checkpoint, groups, groups.length + 1);
    }]
  ];

  it.each(hostileCases)("rejects hostile %s before map construction", (_label, mutate) => {
    const subjectContent = content();
    const checkpoint = syntheticV2(subjectContent);
    const phase = mutate(checkpoint) ?? {};
    if (phase.resign !== false) resign(checkpoint);
    const factory = mapFactorySpy(subjectContent);

    expect(() => restore(subjectContent, checkpoint)).toThrow(
      /terraform|expiry|pending|sequence|remaining|entry|target|terrain|elevation|canonical|dense|sparse|budget|accessor|projection|unsupported/i
    );
    phase.verify?.();
    expect(factory).not.toHaveBeenCalled();
  });
});
