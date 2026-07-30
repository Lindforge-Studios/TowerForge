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

interface TerraformingCheckpointContract {
  schemaVersion: number;
  runtimeElevationOverrides: RuntimeElevationOverrideContract[];
  nextExpiryGroupSequence?: number;
  pendingExpiryGroups?: unknown[];
  extra?: unknown;
}

interface MutableCheckpointContract {
  schemaVersion: number;
  engineVersion: string;
  contentDigest: string;
  identity: GameCheckpointV1["identity"];
  rng: GameCheckpointV1["rng"];
  state: Omit<GameCheckpointV1["state"], "lastEvents" | "runtimeTerrainOverrides" | "terraforming" | "scriptEventCursor"> & {
    lastEvents: Array<Record<string, unknown>>;
    runtimeTerrainOverrides: Array<Record<string, unknown>>;
    terraforming?: TerraformingCheckpointContract;
    scriptEventCursor: number;
  };
  stateDigest: string;
}

type Phase = { readonly verify?: () => void; readonly resign?: boolean };
type HostileMutation = (checkpoint: MutableCheckpointContract) => Phase | void;

const WIDTH = 40;
const HEIGHT = 30;
const STATIC_ELEVATION = { q: 1, r: 0, elevation: 1 } as const;
const RUNTIME_COORD = { q: 2, r: 0 } as const;

function terraformTiles(operations: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { action: "terraformTiles", operations };
}

function signalHandler(signal: string, operations: readonly Record<string, unknown>[]) {
  return {
    when: { $op: "eq", args: [{ $get: "event.signal" }, signal] },
    actions: [terraformTiles(operations)]
  };
}

function checkpointInput(activation: Activation = "active"): GameContentInput {
  const selected = activation === "active" || activation === "disabled";
  const modulesPresent = activation !== "absent";
  const enabled = activation !== "disabled";
  const route = Array.from({ length: 5 }, (_, q) => ({ q, r: 1 }));
  return {
    balance: {
      defaultMissionId: "terraform_checkpoint",
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
        }
      },
      abilities: {},
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 10, speed: 0.1,
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
        terraform_checkpoint: {
          id: "terraform_checkpoint",
          label: "Terraform checkpoint",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 20 },
          prepTimeUnits: 0,
          mapId: "field",
          waveSetId: "one",
          buildTowerIds: [],
          abilityIds: [],
          ...(selected ? {
            mechanics: { profiles: { elevation: "base", terraforming: "mutable" } }
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
        terrainOverrides: [],
        elevationOverrides: [{ ...STATIC_ELEVATION }]
      }
    },
    scripts: {
      terraform_checkpoint: {
        schemaVersion: 6,
        id: "terraform_checkpoint",
        bindings: [{ scope: "global" }],
        handlers: {
          signal: [
            signalHandler("set", [{
              kind: "set_elevation", target: { ...RUNTIME_COORD }, elevation: 2
            }]),
            signalHandler("restore", [{
              kind: "restore_elevation", target: { ...RUNTIME_COORD }
            }]),
            signalHandler("mixed", [
              { kind: "set_terrain", target: { q: 3, r: 0 }, transitionId: "flood" },
              { kind: "set_elevation", target: { ...RUNTIME_COORD }, elevation: 2 }
            ])
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
        missionId: "terraform_checkpoint", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    },
    ...(modulesPresent ? {
      mechanics: {
        schemaVersion: 1,
        modules: {
          elevation: {
            schemaVersion: 1,
            enabled,
            profiles: { base: {} }
          },
          terraforming: {
            schemaVersion: 1,
            enabled,
            profiles: {
              mutable: {
                terrainTransitions: {
                  flood: { fromTerrainTags: ["dry"], toTerrainId: "water" }
                },
                elevation: { minimum: -4, maximum: 4, maximumDeltaPerOperation: 4 }
              }
            }
          }
        }
      }
    } : {})
  };
}

function content(activation: Activation = "active"): GameContentRegistry {
  return createGameContentRegistry(checkpointInput(activation));
}

function terrainOnlyContent(elevationActivation: "disabled" | "unselected"): GameContentRegistry {
  const input = checkpointInput("active") as unknown as {
    balance: {
      missions: Record<string, {
        mechanics: { profiles: Record<string, string> };
      }>;
    };
    mechanics: {
      modules: {
        elevation: { enabled: boolean };
        terraforming: {
          profiles: Record<string, {
            elevation?: unknown;
          }>;
        };
      };
    };
  };
  delete input.mechanics.modules.terraforming.profiles.mutable!.elevation;
  if (elevationActivation === "disabled") {
    input.mechanics.modules.elevation.enabled = false;
  } else {
    delete input.balance.missions.terraform_checkpoint!.mechanics.profiles.elevation;
  }
  return createGameContentRegistry(input as unknown as GameContentInput);
}

function game(subjectContent: GameContentRegistry): TowerDefenseGame {
  return new TowerDefenseGame({
    missionId: "terraform_checkpoint",
    content: subjectContent,
    seed: "terraform-elevation-checkpoint"
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

function section(
  runtimeElevationOverrides: RuntimeElevationOverrideContract[] = []
): TerraformingCheckpointContract {
  return { schemaVersion: 1, runtimeElevationOverrides };
}

function override(q: number, r: number, elevation = 2): RuntimeElevationOverrideContract {
  return { q, r, elevation };
}

function canonicalOverrides(count: number): RuntimeElevationOverrideContract[] {
  return Array.from({ length: count }, (_, index) => (
    override(index % WIDTH, Math.floor(index / WIDTH))
  ));
}

function mapFactorySpy(subjectContent: GameContentRegistry): ReturnType<typeof vi.fn> {
  const mission = subjectContent.missions.terraform_checkpoint!;
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

function restore(
  subjectContent: GameContentRegistry,
  checkpoint: MutableCheckpointContract
): TowerDefenseGame {
  return TowerDefenseGame.fromCheckpoint({
    content: subjectContent,
    checkpoint: checkpoint as unknown as GameCheckpointV1
  });
}

function effectiveElevation(subject: TowerDefenseGame, q: number, r: number): number | undefined {
  const elevation = subject.getSnapshot().elevation as unknown as {
    defaultElevation: number;
    overrides: readonly { q: number; r: number; elevation: number }[];
  } | undefined;
  return elevation?.overrides.find((entry) => entry.q === q && entry.r === r)?.elevation
    ?? elevation?.defaultElevation;
}

describe("R3.4b C3A terraforming elevation checkpoint codec", () => {
  it("requires one exact empty active section while inactive and legacy checkpoints omit and reject it", () => {
    const activeContent = content("active");
    const activeCheckpoint = mutable(game(activeContent).createCheckpoint());
    expect(activeCheckpoint.state.terraforming).toEqual({
      schemaVersion: 2,
      runtimeElevationOverrides: [],
      nextExpiryGroupSequence: 1,
      pendingExpiryGroups: []
    });
    const missing = mutable(jsonClone(activeCheckpoint as unknown as GameCheckpointV1));
    delete missing.state.terraforming;
    resign(missing);
    expect(() => restore(activeContent, missing)).toThrow(/terraforming.*missing|missing.*terraforming/i);

    const legacyV1 = mutable(jsonClone(activeCheckpoint as unknown as GameCheckpointV1));
    legacyV1.state.terraforming = section();
    resign(legacyV1);
    const restoredV1 = restore(activeContent, legacyV1);
    expect(mutable(restoredV1.createCheckpoint()).state.terraforming).toEqual(section());
    expect(restoredV1.getStateDigest()).toBe(legacyV1.stateDigest);

    for (const activation of ["absent", "disabled", "unselected"] as const) {
      const legacyContent = content(activation);
      const legacy = mutable(game(legacyContent).createCheckpoint());
      expect(Object.prototype.hasOwnProperty.call(legacy.state, "terraforming"), activation).toBe(false);
      legacy.state.terraforming = section();
      resign(legacy);
      expect(() => restore(legacyContent, legacy), activation).toThrow(/terraforming|unsupported/i);
    }
  });

  it.each(["disabled", "unselected"] as const)(
    "rejects hidden runtime elevation rows semantically for terrain-only v2 with %s elevation",
    (elevationActivation) => {
      const subjectContent = terrainOnlyContent(elevationActivation);
      const checkpoint = mutable(jsonClone(game(subjectContent).createCheckpoint()));
      expect(checkpoint.state.terraforming).toEqual({
        schemaVersion: 2,
        runtimeElevationOverrides: [],
        nextExpiryGroupSequence: 1,
        pendingExpiryGroups: []
      });
      checkpoint.state.terraforming!.runtimeElevationOverrides = [override(2, 0)];
      resign(checkpoint);
      const factory = mapFactorySpy(subjectContent);

      let failure: unknown;
      try {
        restore(subjectContent, checkpoint);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(TypeError);
      expect((failure as Error).message).toMatch(
        /elevation.*(?:active|inactive|unsupported|forbidden|disabled|unselected)/i
      );
      expect(factory).not.toHaveBeenCalled();
    }
  );

  it("round-trips effective elevation and continues with the same checkpoint, journal, and replay digest", () => {
    const subjectContent = content("active");
    const continuous = game(subjectContent);
    expect(continuous.emitScriptSignal("set")).toEqual({ ok: true });
    expect(effectiveElevation(continuous, RUNTIME_COORD.q, RUNTIME_COORD.r)).toBe(2);

    const checkpoint = mutable(jsonClone(continuous.createCheckpoint()));
    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.stateDigest).toBe(continuous.getStateDigest());
    expect(checkpoint.state.terraforming?.runtimeElevationOverrides).toEqual([{
      q: RUNTIME_COORD.q,
      r: RUNTIME_COORD.r,
      elevation: 2
    }]);
    const resumed = restore(subjectContent, checkpoint);
    expect(resumed.getSnapshot()).toEqual(continuous.getSnapshot());
    expect(resumed.getStateDigest()).toBe(continuous.getStateDigest());

    const session = new JournaledGameSession(resumed);
    expect(session.dispatch({ schemaVersion: 1, type: "emitSignal", signal: "restore" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "emitSignal", signal: "set" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.25 })).toEqual({ ok: true });
    const journal = jsonClone(session.exportJournal());
    expect(journal.schemaVersion).toBe(1);
    expect(journal.engineVersion).toBe("towerforge-sim-v2");
    const replay = replayGameCommandJournal({ content: subjectContent, journal });
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
  });

  const hostileCases: readonly [string, HostileMutation][] = [
    ["accessor section", (checkpoint) => {
      let getterReads = 0;
      checkpoint.state.terraforming = Object.defineProperties({}, {
        schemaVersion: { value: 1, enumerable: true },
        runtimeElevationOverrides: {
          enumerable: true,
          get(): never {
            getterReads += 1;
            throw new Error("ELEVATION_CHECKPOINT_ACCESSOR_READ");
          }
        }
      }) as TerraformingCheckpointContract;
      return { resign: false, verify: () => expect(getterReads).toBe(0) };
    }],
    ["sparse override array", (checkpoint) => {
      const sparse = new Array<RuntimeElevationOverrideContract>(2);
      sparse[1] = override(2, 0);
      checkpoint.state.terraforming = section(sparse);
      return { resign: false };
    }],
    ["extra section field", (checkpoint) => {
      checkpoint.state.terraforming = { ...section(), extra: true };
    }],
    ["future nested schema", (checkpoint) => {
      checkpoint.state.terraforming = { ...section(), schemaVersion: 3 };
    }],
    ["noncanonical override order", (checkpoint) => {
      checkpoint.state.terraforming = section([override(3, 0), override(2, 0)]);
    }],
    ["duplicate coordinate", (checkpoint) => {
      checkpoint.state.terraforming = section([override(2, 0), override(2, 0, 3)]);
    }],
    ["outside-map coordinate", (checkpoint) => {
      checkpoint.state.terraforming = section([override(WIDTH, 0)]);
    }],
    ["fractional elevation", (checkpoint) => {
      checkpoint.state.terraforming = section([override(2, 0, 1.5)]);
    }],
    ["policy out of range", (checkpoint) => {
      checkpoint.state.terraforming = section([override(2, 0, 5)]);
    }],
    ["base-equal override", (checkpoint) => {
      checkpoint.state.terraforming = section([override(
        STATIC_ELEVATION.q,
        STATIC_ELEVATION.r,
        STATIC_ELEVATION.elevation
      )]);
    }],
    ["elevation override budget", (checkpoint) => {
      checkpoint.state.terraforming = section(canonicalOverrides(513));
    }],
    ["combined runtime override budget", (checkpoint) => {
      checkpoint.state.runtimeTerrainOverrides = canonicalOverrides(512).map(({ q, r }) => ({
        q, r, terrain: "water", source: "script" as const
      }));
      checkpoint.state.terraforming = section(canonicalOverrides(513));
    }]
  ];

  it.each(hostileCases)("rejects hostile %s before constructing or publishing a game", (_label, mutate) => {
    const subjectContent = content("active");
    const checkpoint = mutable(jsonClone(game(subjectContent).createCheckpoint()));
    checkpoint.state.terraforming = section();
    resign(checkpoint);
    const phase = mutate(checkpoint) ?? {};
    if (phase.resign !== false) resign(checkpoint);
    const factory = mapFactorySpy(subjectContent);

    expect(() => restore(subjectContent, checkpoint)).toThrow(
      /terraform|elevation|override|canonical|budget|map|policy|dense|sparse|accessor|unsupported/i
    );
    phase.verify?.();
    expect(factory).not.toHaveBeenCalled();
  });

  it("round-trips mixed terrain/elevation events and treats elevationChanged as one strict codec", () => {
    const subjectContent = content("active");
    const codecCheckpoint = mutable(jsonClone(game(subjectContent).createCheckpoint()));
    codecCheckpoint.state.terraforming = section([override(2, 0)]);
    codecCheckpoint.state.lastEvents.push({
      type: "elevationChanged",
      coord: { q: 2, r: 0 },
      fromElevation: 0,
      toElevation: 2,
      source: "script"
    });
    codecCheckpoint.state.scriptEventCursor = codecCheckpoint.state.lastEvents.length;
    resign(codecCheckpoint);
    const codecRestored = restore(subjectContent, codecCheckpoint);
    expect(codecRestored.lastEvents.at(-1)).toEqual(codecCheckpoint.state.lastEvents.at(-1));

    const invalidEvent = mutable(jsonClone(codecCheckpoint as unknown as GameCheckpointV1));
    invalidEvent.state.lastEvents.at(-1)!.unexpected = true;
    resign(invalidEvent);
    expect(() => restore(subjectContent, invalidEvent)).toThrow(/elevationChanged|last event|unsupported/i);

    const mixed = game(subjectContent);
    expect(mixed.emitScriptSignal("mixed")).toEqual({ ok: true });
    const mixedEvents = mixed.lastEvents as unknown as Array<{ type: string } & Record<string, unknown>>;
    expect(mixedEvents.filter(({ type }) => (
      type === "terrainChanged" || type === "elevationChanged"
    )).map(({ type }) => type)).toEqual(["terrainChanged", "elevationChanged"]);
    expect(mixedEvents).toContainEqual({
      type: "elevationChanged",
      coord: { q: 2, r: 0 },
      fromElevation: 0,
      toElevation: 2,
      source: "script"
    });
    const restored = restore(subjectContent, mutable(jsonClone(mixed.createCheckpoint())));
    expect(restored.getSnapshot()).toEqual(mixed.getSnapshot());
    expect(restored.lastEvents).toEqual(mixed.lastEvents);
  });
});
