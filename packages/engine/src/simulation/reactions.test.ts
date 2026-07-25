import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { validateGameContentRegistry } from "../content/validate.js";
import {
  computeCheckpointStateDigest,
  type GameCheckpointV1
} from "./checkpoint.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";

interface ReactionStateFixture {
  schemaVersion: 1;
  exposures: {
    enemies: Record<string, Record<string, { stacks: number; remaining: number }>>;
  };
}

interface RuntimeOptions {
  enabled?: boolean;
  selected?: boolean;
  authorReactions?: boolean;
  exposureDuration?: number;
  shieldCapacity?: number;
  armorMultiplier?: number;
  enemyHp?: number;
}

const CENTER = { q: 0, r: 1 } as const;

function ability(id: string, amount: number) {
  return {
    id,
    label: id,
    cooldown: 0.01,
    duration: 0,
    radius: 6,
    effects: [{ kind: "damage" as const, amount }]
  };
}

function runtimeInput(options: RuntimeOptions = {}): GameContentInput {
  const combatProfile: Record<string, unknown> = {
    ...(options.shieldCapacity === undefined
      ? {}
      : { shields: { enemies: { grunt: { capacity: options.shieldCapacity } } } }),
    damageTypes: { physical: { label: "Physical" } },
    armorTypes: options.armorMultiplier === undefined
      ? {}
      : {
          plated: {
            label: "Plated",
            multipliers: { physical: options.armorMultiplier }
          }
        },
    armorAssignments: options.armorMultiplier === undefined
      ? {}
      : { enemies: { grunt: "plated" } },
    marks: { definitions: {} }
  };
  const profile = {
    exposures: {
      definitions: {
        burning: {
          label: "Burning",
          duration: options.exposureDuration ?? 0.2,
          maxStacks: 3
        },
        charged: {
          label: "Charged",
          duration: options.exposureDuration ?? 0.2,
          maxStacks: 3
        }
      },
      applications: {
        damageTypes: {
          physical: [{ exposureId: "charged", stacks: 1 }]
        }
      }
    },
    reactions: {
      charged_burst: {
        label: "Charged burst",
        trigger: { damageTypes: ["physical"] },
        requirements: [{
          kind: "exposure",
          exposureId: "charged",
          minStacks: 1,
          consume: "all"
        }],
        suppressTriggerExposureApplications: true,
        effects: {
          burst: {
            kind: "damage",
            amount: { kind: "flat", value: 5 },
            damageType: "physical",
            target: { kind: "primary" },
            allowReactions: false
          }
        }
      }
    }
  };
  const selection = {
    combat: "base",
    ...((options.selected ?? true) && (options.authorReactions ?? true)
      ? { reactions: "burst" }
      : {})
  };
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "reactions",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 20,
        startingCoins: 100,
        startingResources: { coins: 100 },
        prepTimeUnits: 0,
        moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5,
        pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1,
        pathWaterRadius: 1,
        pathWaterGroundSpeedFactor: 0.5
      },
      abilities: {
        hit_a: ability("hit_a", 10),
        hit_b: ability("hit_b", 10),
        hit_c: ability("hit_c", 10)
      },
      enemies: {
        grunt: {
          id: "grunt",
          label: "Grunt",
          maxHp: options.enemyHp ?? 100,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1
        }
      },
      towers: {
        probe: {
          id: "probe",
          label: "Probe",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 2,
          attack: {
            kind: "single",
            fireRate: 10,
            damagePerStack: 1,
            startingStacks: 1,
            maxStacks: 1,
            upgradeCost: 1
          }
        }
      },
      waveSets: {
        one: [{
          id: "one",
          label: "One",
          groups: [{ enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0 }]
        }]
      },
      missions: {
        reactions: {
          id: "reactions",
          label: "Reactions",
          description: "",
          startingCoreHp: 20,
          startingResources: { coins: 100 },
          prepTimeUnits: 0,
          mapId: "lane",
          waveSetId: "one",
          buildTowerIds: ["probe"],
          abilityIds: ["hit_a", "hit_b", "hit_c"],
          mechanics: { profiles: selection }
        }
      }
    },
    maps: {
      lane: {
        id: "lane",
        width: 8,
        height: 3,
        defaultTerrain: "path",
        spawnCoord: CENTER,
        coreCoord: { q: 7, r: 1 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 1 })),
        pathRoutes: [],
        terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        combat: {
          schemaVersion: 3,
          enabled: true,
          profiles: { base: combatProfile }
        },
        ...((options.authorReactions ?? true)
          ? {
              reactions: {
                schemaVersion: 1,
                enabled: options.enabled ?? true,
                profiles: { burst: profile }
              }
            }
          : {})
      }
    } as unknown as GameContentInput["mechanics"],
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        accent: "#fff",
        biome: "test",
        connections: []
      }],
      missionNodes: [{
        missionId: "reactions",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
  return input;
}

function content(options: RuntimeOptions = {}) {
  const registry = createGameContentRegistry(runtimeInput(options));
  expect(validateGameContentRegistry(registry).ok).toBe(true);
  return registry;
}

function game(options: RuntimeOptions = {}) {
  return new TowerDefenseGame({
    missionId: "reactions",
    content: content(options),
    seed: "reaction-runtime"
  });
}

function spawn(instance: TowerDefenseGame): void {
  expect(instance.startNextWave().ok).toBe(true);
  instance.tick(0.01);
  expect(instance.getSnapshot().enemies).toHaveLength(1);
}

function reactionState(instance: TowerDefenseGame): ReactionStateFixture | undefined {
  return (instance.getSnapshot() as unknown as { reactions?: ReactionStateFixture }).reactions;
}

function exposure(instance: TowerDefenseGame) {
  return reactionState(instance)?.exposures.enemies.enemy_1?.charged;
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type MutableReactionCheckpoint = GameCheckpointV1 & {
  state: GameCheckpointV1["state"] & { reactions: ReactionStateFixture };
};

function resignCheckpoint(checkpoint: MutableReactionCheckpoint): void {
  (checkpoint as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

describe("R1.5 exposure and reaction runtime", () => {
  it("adds, clamps, refreshes, no-ops, and expires exposure state on the fixed tick boundary", () => {
    const instance = game();
    spawn(instance);

    expect(instance.useAbility("hit_a", CENTER).ok).toBe(true);
    expect(exposure(instance)).toEqual({ stacks: 1, remaining: 0.2 });
    expect(reactionState(instance)?.schemaVersion).toBe(1);
    expect(instance.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyExposureChanged",
      exposureId: "charged",
      previousStacks: 0,
      currentStacks: 1,
      cause: "damage"
    }));

    instance.tick(0);
    expect(exposure(instance)?.remaining).toBe(0.2);
    instance.tick(0.199);
    expect(exposure(instance)?.remaining).toBeCloseTo(0.001, 8);
    instance.tick(0.001);
    expect(reactionState(instance)).toBeUndefined();
    expect(instance.lastEvents).toContainEqual(expect.objectContaining({
      type: "enemyExposureChanged",
      exposureId: "charged",
      currentStacks: 0,
      remaining: 0,
      cause: "expiration"
    }));
  });

  it("consumes prior exposure, emits the typed trigger, suppresses current application, and resolves secondary damage", () => {
    const instance = game();
    spawn(instance);
    expect(instance.useAbility("hit_a", CENTER).ok).toBe(true);
    expect(instance.useAbility("hit_b", CENTER).ok).toBe(true);

    expect(instance.getSnapshot().enemies[0]?.hp).toBe(75);
    expect(reactionState(instance)).toBeUndefined();
    const relevant = (instance.lastEvents as unknown as Array<{ type: string }>).filter((event) => (
      event.type === "enemyExposureChanged" || event.type === "enemyReactionTriggered"
    )) as unknown as Array<Record<string, unknown>>;
    expect(relevant.slice(-2)).toEqual([
      expect.objectContaining({
        type: "enemyExposureChanged",
        exposureId: "charged",
        previousStacks: 1,
        currentStacks: 0,
        cause: "consume"
      }),
      {
        type: "enemyReactionTriggered",
        reactionId: "charged_burst",
        originEnemyId: "enemy_1",
        originEnemyTypeId: "grunt",
        originCoord: { q: 0, r: 1 },
        triggerDamageType: "physical",
        depth: 0,
        scheduledTargetIds: ["enemy_1"]
      }
    ]);
  });

  it("treats a full shield as eligible but an armor-zero packet as ineligible", () => {
    const shielded = game({ shieldCapacity: 100 });
    spawn(shielded);
    expect(shielded.useAbility("hit_a", CENTER).ok).toBe(true);
    expect(exposure(shielded)).toBeDefined();
    expect(shielded.useAbility("hit_b", CENTER).ok).toBe(true);
    expect(shielded.getSnapshot().enemies[0]?.hp).toBe(100);
    expect((shielded.getSnapshot() as unknown as {
      combat?: { shields: { enemies: Record<string, { current: number }> } };
    }).combat?.shields.enemies.enemy_1?.current).toBe(75);
    expect(shielded.lastEvents as unknown as Array<Record<string, unknown>>).toContainEqual(expect.objectContaining({
      type: "enemyReactionTriggered",
      reactionId: "charged_burst"
    }));

    const immune = game({ armorMultiplier: 0 });
    spawn(immune);
    expect(immune.useAbility("hit_a", CENTER).ok).toBe(true);
    expect(reactionState(immune)).toBeUndefined();
    expect((immune.lastEvents as unknown as Array<{ type: string }>).some(
      (event) => event.type === "enemyReactionTriggered"
    )).toBe(false);
  });

  it("keeps absent, disabled, and unselected reactions on the exact legacy snapshot path", () => {
    const variants = [
      game({ authorReactions: false }),
      game({ enabled: false }),
      game({ selected: false })
    ];
    for (const instance of variants) {
      spawn(instance);
      expect(instance.useAbility("hit_a", CENTER).ok).toBe(true);
      expect(instance.getSnapshot()).not.toHaveProperty("reactions");
      expect(instance.createCheckpoint().state).not.toHaveProperty("reactions");
    }
    expect(variants[1]!.getSnapshot()).toEqual(variants[0]!.getSnapshot());
    expect(variants[2]!.getSnapshot()).toEqual(variants[0]!.getSnapshot());
  });
});

describe("R1.5 reaction checkpoint and replay", () => {
  it("round-trips live exposures in reactions state v1 and continues to the same digest", () => {
    const registry = content();
    const continuous = new TowerDefenseGame({ missionId: "reactions", content: registry, seed: "reaction-checkpoint" });
    spawn(continuous);
    expect(continuous.useAbility("hit_a", CENTER).ok).toBe(true);
    const checkpoint = jsonRoundTrip(continuous.createCheckpoint());

    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect((checkpoint.state as unknown as { reactions?: ReactionStateFixture }).reactions).toEqual(reactionState(continuous));
    const restored = TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint });
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());

    expect(continuous.useAbility("hit_b", CENTER).ok).toBe(true);
    expect(restored.useAbility("hit_b", CENTER).ok).toBe(true);
    continuous.tick(0.01);
    restored.tick(0.01);
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());
  });

  it("replays exposure application and reaction consumption to the continuous journal digest", () => {
    const registry = content();
    const session = new JournaledGameSession(new TowerDefenseGame({
      missionId: "reactions",
      content: registry,
      seed: "reaction-journal"
    }));
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0.01 }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "useAbility", abilityId: "hit_a", center: CENTER }).ok).toBe(true);
    expect(session.dispatch({ schemaVersion: 1, type: "useAbility", abilityId: "hit_b", center: CENTER }).ok).toBe(true);

    const replay = replayGameCommandJournal({
      content: registry,
      journal: jsonRoundTrip(session.exportJournal())
    });
    expect(replay.entriesReplayed).toBe(4);
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(reactionState(replay.game)).toBeUndefined();
  });

  it.each([
    ["future reaction schema", (state: ReactionStateFixture) => {
      (state as { schemaVersion: number }).schemaVersion = 2;
    }],
    ["zero stacks", (state: ReactionStateFixture) => {
      state.exposures.enemies.enemy_1!.charged!.stacks = 0;
    }],
    ["stacks above definition", (state: ReactionStateFixture) => {
      state.exposures.enemies.enemy_1!.charged!.stacks = 4;
    }],
    ["remaining above duration", (state: ReactionStateFixture) => {
      state.exposures.enemies.enemy_1!.charged!.remaining = 1;
    }],
    ["unknown exposure", (state: ReactionStateFixture) => {
      state.exposures.enemies.enemy_1!.ghost = { stacks: 1, remaining: 0.1 };
    }],
    ["unknown enemy", (state: ReactionStateFixture) => {
      state.exposures.enemies.enemy_404 = { charged: { stacks: 1, remaining: 0.1 } };
    }],
    ["noncanonical exposure order", (state: ReactionStateFixture) => {
      state.exposures.enemies.enemy_1 = {
        charged: { stacks: 1, remaining: 0.1 },
        burning: { stacks: 1, remaining: 0.1 }
      };
    }]
  ] as const)("rejects digest-valid malformed reaction checkpoint state: %s", (_label, mutate) => {
    const registry = content();
    const instance = new TowerDefenseGame({ missionId: "reactions", content: registry, seed: "reaction-malformed" });
    spawn(instance);
    expect(instance.useAbility("hit_a", CENTER).ok).toBe(true);
    const checkpoint = jsonRoundTrip(instance.createCheckpoint()) as MutableReactionCheckpoint;
    mutate(checkpoint.state.reactions);
    resignCheckpoint(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint }))
      .toThrow(/reaction|exposure|stack|remaining|enemy|version|canonical|order/i);
  });

  it.each([
    ["unknown exposure event", {
      type: "enemyExposureChanged", enemyId: "enemy_1", enemyTypeId: "grunt",
      exposureId: "ghost", previousStacks: 0, currentStacks: 1,
      previousRemaining: 0, remaining: 0.1, cause: "damage"
    }],
    ["invalid exposure cause", {
      type: "enemyExposureChanged", enemyId: "enemy_1", enemyTypeId: "grunt",
      exposureId: "charged", previousStacks: 0, currentStacks: 1,
      previousRemaining: 0, remaining: 0.1, cause: "host"
    }],
    ["unknown reaction trigger", {
      type: "enemyReactionTriggered", reactionId: "ghost", originEnemyId: "enemy_1",
      originEnemyTypeId: "grunt", originCoord: CENTER, triggerDamageType: "physical",
      depth: 0, scheduledTargetIds: ["enemy_1"]
    }],
    ["reaction depth beyond the runtime budget", {
      type: "enemyReactionTriggered", reactionId: "charged_burst", originEnemyId: "enemy_1",
      originEnemyTypeId: "grunt", originCoord: CENTER, triggerDamageType: "physical",
      depth: 5, scheduledTargetIds: ["enemy_1"]
    }],
    ["unknown reaction trigger damage type", {
      type: "enemyReactionTriggered", reactionId: "charged_burst", originEnemyId: "enemy_1",
      originEnemyTypeId: "grunt", originCoord: CENTER, triggerDamageType: "void",
      depth: 0, scheduledTargetIds: ["enemy_1"]
    }],
    ["reaction target list beyond the per-root packet budget", {
      type: "enemyReactionTriggered", reactionId: "charged_burst", originEnemyId: "enemy_1",
      originEnemyTypeId: "grunt", originCoord: CENTER, triggerDamageType: "physical",
      depth: 0,
      scheduledTargetIds: Array.from({ length: 257 }, (_, index) => `enemy_${index + 1}`)
    }],
    ["unknown reaction budget kind", {
      type: "reactionBudgetExceeded", rootEnemyId: "enemy_1", rootEnemyTypeId: "grunt",
      budget: "host", limit: 4, dropped: 1
    }]
  ] as const)("[verifier] rejects digest-valid malformed reaction checkpoint event: %s", (_label, event) => {
    const registry = content();
    const instance = new TowerDefenseGame({ missionId: "reactions", content: registry, seed: "reaction-event-codec" });
    spawn(instance);
    expect(instance.useAbility("hit_a", CENTER).ok).toBe(true);
    const checkpoint = jsonRoundTrip(instance.createCheckpoint()) as MutableReactionCheckpoint;
    const mutableState = checkpoint.state as unknown as { lastEvents: unknown[]; scriptEventCursor: number };
    mutableState.lastEvents = [event];
    mutableState.scriptEventCursor = 1;
    resignCheckpoint(checkpoint);

    expect(() => TowerDefenseGame.fromCheckpoint({ content: registry, checkpoint }))
      .toThrow(/reaction|exposure|event|cause|depth|budget|unknown/i);
  });
});
