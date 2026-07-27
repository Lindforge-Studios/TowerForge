import { describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput, type GameContentRegistry } from "../content/registry.js";
import { validateGameContentRegistry } from "../content/validate.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { stableDigest } from "./stable-digest.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type {
  AbilityEffect,
  EnemyState,
  GameEvent,
  GridCoord,
  TowerEffectSpec,
  TowerPipelineDeliverySpec,
  TowerType
} from "./types.js";

type PhysicsActivation = "active" | "absent" | "disabled" | "unselected" | "future";
type NavigationMode = "authored_routes" | "dynamic_flow";

interface DisplacementEffectContract {
  readonly kind: "displacement";
  readonly mode: "push" | "pull";
  readonly distance: number;
  readonly stopAtBlocker: boolean;
}

interface FixtureOptions {
  readonly activation?: PhysicsActivation;
  readonly navigationMode?: NavigationMode;
  readonly effect?: DisplacementEffectContract;
  readonly abilityEffects?: readonly (DisplacementEffectContract | { kind: "damage"; amount: number })[];
  readonly towerEffects?: readonly (DisplacementEffectContract | { kind: "damage"; amount: number })[];
  readonly enemyIds?: readonly ("walker" | "immune" | "flyer" | "parent")[];
  readonly enemyCount?: number;
  readonly displacementImmuneEnemyTypeIds?: readonly string[];
  readonly fallImmuneEnemyTypeIds?: readonly string[];
  readonly walkerMovementProfileId?: string;
  readonly navigationTowerOccupancy?: "blocked" | "ignored";
  readonly towerMaxTargets?: number;
  readonly towerDeliveryKind?: "single" | "multi";
  readonly towerDelivery?: TowerPipelineDeliverySpec;
  readonly route?: readonly GridCoord[];
  readonly hazardQ?: number;
  readonly blockNorthOfSpawn?: boolean;
}

const PUSH_ONE: DisplacementEffectContract = Object.freeze({
  kind: "displacement",
  mode: "push",
  distance: 1,
  stopAtBlocker: true
});

function asAbilityEffects(
  effects: readonly (DisplacementEffectContract | { kind: "damage"; amount: number })[]
): AbilityEffect[] {
  return effects.map((effect) => ({ ...effect })) as unknown as AbilityEffect[];
}

function asTowerEffects(
  effects: readonly (DisplacementEffectContract | { kind: "damage"; amount: number })[]
): TowerEffectSpec[] {
  return effects.map((effect) => ({ ...effect })) as unknown as TowerEffectSpec[];
}

function runtimeContent(options: FixtureOptions = {}): GameContentRegistry {
  const activation = options.activation ?? "active";
  const navigationMode = options.navigationMode ?? "authored_routes";
  const abilityEffects = options.abilityEffects ?? [options.effect ?? PUSH_ONE];
  const enemyIds = options.enemyIds ?? ["walker"];
  // Keep the happy-path lane on r=1. With source (0,0), square stable geometry selects E as the
  // first strict push neighbor; tests that exercise no-slide use the in-bounds off-lane N cell.
  const route = options.route?.map((coord) => ({ ...coord }))
    ?? Array.from({ length: 6 }, (_, index) => ({ q: index + 1, r: 1 }));
  const selectedProfiles = {
    ...(activation === "absent" || activation === "unselected" ? {} : { physics: "motion" }),
    ...(navigationMode === "dynamic_flow" ? { navigation: "flow" } : {})
  };
  const physicsProfile = {
    displacementImmuneEnemyTypeIds: [...(options.displacementImmuneEnemyTypeIds ?? ["immune"])],
    fallImmuneEnemyTypeIds: [...(options.fallImmuneEnemyTypeIds ?? ["immune"])],
    fallHazardTerrainTags: ["fall_hazard"]
  };
  const towers: Record<string, TowerType> = options.towerEffects
    ? {
        pusher: {
          id: "pusher",
          label: "Pusher",
          cost: { coins: 1 },
          footprintRadius: 0,
          range: 10,
          attack: {
            kind: "pipeline",
            interval: 10,
            targeting: { classes: ["ground"], maxTargets: options.towerMaxTargets ?? 1 },
            delivery: options.towerDelivery ?? { kind: options.towerDeliveryKind ?? "single" },
            effects: asTowerEffects(options.towerEffects)
          }
        }
      }
    : {};
  const input: GameContentInput = {
    balance: {
      defaultMissionId: "physics_runtime",
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
          groundSpeedMultiplier: 1, tags: []
        },
        chasm: {
          id: "chasm", label: "Chasm", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: ["fall_hazard"]
        },
        wall: {
          id: "wall", label: "Wall", buildable: false, walkable: false,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {
        shove: {
          id: "shove", label: "Shove", cooldown: 0, duration: 0, radius: 10,
          effects: asAbilityEffects(abilityEffects)
        }
      },
      enemies: {
        walker: {
          id: "walker", label: "Walker", maxHp: 100, speed: 1,
          reward: { coins: 2 }, coinReward: 2, coreDamage: 3, color: 1
        },
        immune: {
          id: "immune", label: "Immune", maxHp: 100, speed: 1,
          reward: { coins: 2 }, coinReward: 2, coreDamage: 3, color: 2
        },
        flyer: {
          id: "flyer", label: "Flyer", maxHp: 100, speed: 1,
          reward: { coins: 2 }, coinReward: 2, coreDamage: 3, color: 3,
          targetClass: "flying", movementKind: "direct_flying"
        },
        parent: {
          id: "parent", label: "Parent", maxHp: 100, speed: 1,
          reward: { coins: 7 }, coinReward: 7, coreDamage: 9, color: 4,
          spawnOnDeath: { enemyId: "walker", count: 1, forwardPathSteps: 0 }
        }
      },
      towers,
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: enemyIds.map((enemyId, index) => ({
            enemyId,
            count: index === 0 ? (options.enemyCount ?? 1) : 1,
            spawnInterval: 0,
            startDelay: 0,
            routeId: "main"
          }))
        }]
      },
      missions: {
        physics_runtime: {
          id: "physics_runtime", label: "Physics runtime", description: "",
          startingCoreHp: 20, startingResources: { coins: 20 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: Object.keys(towers), abilityIds: ["shove"],
          objectives: { victory: [{ id: "kill_parent", kind: "killCount", count: 1, enemyTypeId: "parent" }] },
          ...(Object.keys(selectedProfiles).length === 0 ? {} : { mechanics: { profiles: selectedProfiles } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 7, height: 3,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor", spawnCoord: { ...route[0]! }, coreCoord: { ...route.at(-1)! },
        pathCenterline: route.map((coord) => ({ ...coord })),
        pathRoutes: [{ id: "main", pathCenterline: route.map((coord) => ({ ...coord })) }],
        terrainOverrides: [
          ...(options.hazardQ === undefined ? [] : [{ q: options.hazardQ, r: 1, terrain: "chasm" }]),
          ...(options.blockNorthOfSpawn ? [{ q: 1, r: 0, terrain: "wall" }] : [])
        ]
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        ...(activation === "absent" ? {} : {
          physics: {
            schemaVersion: activation === "future" ? 2 : 1,
            enabled: activation !== "disabled",
            profiles: { motion: physicsProfile }
          }
        }),
        ...(navigationMode === "dynamic_flow" ? {
          navigation: {
            schemaVersion: 1,
            enabled: true,
            profiles: {
              flow: {
                mode: "dynamic_flow",
                defaultMovementProfileId: "ground",
                movementProfiles: {
                  ground: {
                    label: "Ground", terrainMode: "respect_walkable",
                    towerOccupancy: options.navigationTowerOccupancy ?? "ignored", defaultTerrainCost: 1_000
                  },
                  air: {
                    label: "Air", terrainMode: "ignore_walkable",
                    towerOccupancy: "ignored", defaultTerrainCost: 1_000
                  },
                  ...(options.walkerMovementProfileId ? {
                    [options.walkerMovementProfileId]: {
                      label: "Custom ground profile", terrainMode: "respect_walkable",
                      towerOccupancy: "ignored", defaultTerrainCost: 1_000
                    }
                  } : {})
                },
                enemyMovementProfiles: {
                  flyer: "air",
                  ...(options.walkerMovementProfileId ? { walker: options.walkerMovementProfileId } : {})
                }
              }
            }
          }
        } : {})
      }
    },
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "physics_runtime", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
  return createGameContentRegistry(input);
}

function spawn(content: GameContentRegistry): TowerDefenseGame {
  const subject = new TowerDefenseGame({ missionId: "physics_runtime", content, seed: "physics-runtime" });
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.enemies.length).toBeGreaterThan(0);
  return subject;
}

function coordOf(subject: TowerDefenseGame, enemy: EnemyState): GridCoord {
  return subject.enemyCoord(enemy);
}

function eventsOfType(subject: TowerDefenseGame, type: string): Array<GameEvent & Record<string, unknown>> {
  return subject.lastEvents.filter((event) => event.type === type) as Array<GameEvent & Record<string, unknown>>;
}

function navigationStats(subject: TowerDefenseGame): { fieldBuildCount: number; fieldQueryCount: number } {
  const stats = (subject as unknown as {
    navigationResolver?: { getStats(): { fieldBuildCount: number; fieldQueryCount: number } };
  }).navigationResolver?.getStats();
  expect(stats).toBeDefined();
  return stats!;
}

function legacyBehaviorDigest(subject: TowerDefenseGame): string {
  const legacyBehavior = JSON.parse(JSON.stringify({
    snapshot: subject.getSnapshot(),
    events: subject.lastEvents
  })) as unknown;
  return stableDigest(legacyBehavior);
}

describe("R3.4a TowerDefenseGame displacement integration", () => {
  it("moves only with an active selected v1 module and keeps every inactive capability path a deterministic no-op", () => {
    for (const activation of ["active", "absent", "disabled", "unselected", "future"] as const) {
      const subject = spawn(runtimeContent({ activation }));
      const enemy = subject.enemies[0]!;
      const before = coordOf(subject, enemy);

      expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
      expect(coordOf(subject, enemy), activation).toEqual(
        activation === "active" ? { q: 2, r: 1 } : before
      );
      expect(eventsOfType(subject, "enemyDisplacementResolved"), activation).toHaveLength(
        activation === "active" ? 1 : 0
      );
    }
  });

  it.each(["absent", "disabled"] as const)(
    "keeps the exact legacy ability digest when inactive requested displacement exceeds the activation budget (%s)",
    (activation) => {
      const distanceEight: DisplacementEffectContract = {
        kind: "displacement",
        mode: "push",
        distance: 8,
        stopAtBlocker: true
      };
      const run = (effects: FixtureOptions["abilityEffects"]): TowerDefenseGame => {
        const subject = spawn(runtimeContent({ activation, abilityEffects: effects }));
        expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
        return subject;
      };
      const withInactivePhysics = run([
        ...Array.from({ length: 513 }, () => distanceEight),
        { kind: "damage", amount: 1 }
      ]);
      const baseline = run([{ kind: "damage", amount: 1 }]);

      expect(withInactivePhysics.enemies[0]!.hp).toBe(99);
      expect(eventsOfType(withInactivePhysics, "enemyDisplacementResolved")).toHaveLength(0);
      expect(legacyBehaviorDigest(withInactivePhysics)).toBe(legacyBehaviorDigest(baseline));
    }
  );

  it.each(["authored_routes", "dynamic_flow"] as const)(
    "classifies the first global strict neighbor for %s and never slides past an off-route/off-field blocker",
    (navigationMode) => {
      const subject = spawn(runtimeContent({ navigationMode, blockNorthOfSpawn: true }));
      const enemy = subject.enemies[0]!;
      const before = coordOf(subject, enemy);

      // From source (0,1), both N and E increase the square distance from the source. Stable
      // topology order chooses N first; N is off the authored route and absent from the flow field.
      expect(subject.useAbility("shove", { q: 0, r: 1 })).toEqual({ ok: true });
      expect(coordOf(subject, enemy)).toEqual(before);
      expect(eventsOfType(subject, "enemyDisplacementResolved")).toEqual([
        expect.objectContaining({
          from: { q: 1, r: 1 },
          to: { q: 1, r: 1 },
          movedDistance: 0,
          stopReason: "blocked"
        })
      ]);
    }
  );

  it.each([
    [
      "corner",
      [
        { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 2, r: 2 },
        { q: 3, r: 2 }, { q: 4, r: 2 }, { q: 5, r: 2 }
      ],
      1,
      { q: 1, r: 1 }
    ],
    [
      "near-loop",
      [
        { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 2, r: 2 },
        { q: 1, r: 2 }, { q: 0, r: 2 }, { q: 0, r: 1 }
      ],
      3,
      { q: 0, r: 2 }
    ]
  ] as const)(
    "does not slide from an authored %s when the first strict neighbor is a non-next route coordinate",
    (_label, route, pathProgress, sourceCoord) => {
      const subject = spawn(runtimeContent({ route }));
      const enemy = subject.enemies[0]!;
      enemy.pathProgress = pathProgress;
      const before = coordOf(subject, enemy);

      expect(subject.useAbility("shove", sourceCoord)).toEqual({ ok: true });
      expect(coordOf(subject, enemy)).toEqual(before);
      expect(eventsOfType(subject, "enemyDisplacementResolved")).toEqual([
        expect.objectContaining({
          from: before,
          to: before,
          movedDistance: 0,
          stopReason: "blocked"
        })
      ]);
    }
  );

  it("fails closed when the authored current anchor coordinate is repeated, even if the first candidate is unique", () => {
    const route = [
      { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 2, r: 2 },
      { q: 1, r: 2 }, { q: 1, r: 1 }, { q: 0, r: 1 }
    ];
    const subject = spawn(runtimeContent({
      route,
      effect: { kind: "displacement", mode: "pull", distance: 1, stopAtBlocker: true }
    }));
    const enemy = subject.enemies[0]!;
    const before = coordOf(subject, enemy);

    expect(subject.useAbility("shove", { q: 3, r: 1 })).toEqual({ ok: true });
    expect(coordOf(subject, enemy)).toEqual(before);
    expect(eventsOfType(subject, "enemyDisplacementResolved")).toEqual([
      expect.objectContaining({
        from: before,
        to: before,
        movedDistance: 0,
        stopReason: "blocked"
      })
    ]);
  });

  it("inherits dynamic towerOccupancy blocked membership and does not slide around an occupied first candidate", () => {
    const content = runtimeContent({
      navigationMode: "dynamic_flow",
      navigationTowerOccupancy: "blocked",
      towerEffects: [{ kind: "damage", amount: 1 }]
    });
    const subject = new TowerDefenseGame({ missionId: "physics_runtime", content, seed: "physics-occupancy" });
    expect(subject.placeTower("pusher", { q: 2, r: 1 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    const enemy = subject.enemies[0]!;
    const before = coordOf(subject, enemy);

    expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
    expect(coordOf(subject, enemy)).toEqual(before);
    expect(eventsOfType(subject, "enemyDisplacementResolved")).toEqual([
      expect.objectContaining({ movedDistance: 0, from: before, to: before, stopReason: "blocked" })
    ]);
  });

  it("anchors authored-route fractional progress, preserves partial steps, and rolls back atomic movement at the goal blocker", () => {
    const partial = spawn(runtimeContent({
      effect: { kind: "displacement", mode: "push", distance: 6, stopAtBlocker: true }
    }));
    expect(partial.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
    expect(coordOf(partial, partial.enemies[0]!)).toEqual({ q: 5, r: 1 });
    expect(partial.enemies[0]!.pathProgress).toBe(4);
    expect(eventsOfType(partial, "enemyDisplacementResolved")[0]).toMatchObject({
      requestedDistance: 6,
      movedDistance: 4,
      stopReason: "goal_blocked",
      from: { q: 1, r: 1 },
      to: { q: 5, r: 1 }
    });
    partial.tick(0.2);
    expect(partial.enemies[0]!.pathProgress).toBeGreaterThan(4);

    const atomic = spawn(runtimeContent({
      effect: { kind: "displacement", mode: "push", distance: 6, stopAtBlocker: false }
    }));
    expect(atomic.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
    expect(coordOf(atomic, atomic.enemies[0]!)).toEqual({ q: 1, r: 1 });
    expect(atomic.enemies[0]!.pathProgress).toBe(0);
    expect(eventsOfType(atomic, "enemyDisplacementResolved")[0]).toMatchObject({
      requestedDistance: 6,
      movedDistance: 0,
      stopReason: "goal_blocked"
    });
  });

  it("uses the dynamic <0.5 anchor, writes canonical cached-field state, and resumes without a field rebuild command", () => {
    const subject = spawn(runtimeContent({ navigationMode: "dynamic_flow" }));
    subject.tick(0.2);
    const before = subject.enemies[0]!;
    expect(before.navigation).toMatchObject({
      currentCoord: { q: 1, r: 1 },
      nextCoord: { q: 2, r: 1 },
      edgeProgress: 0.2,
      stepsEntered: 0
    });

    expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
    const displaced = subject.enemies[0]!;
    expect(displaced.navigation).toEqual({
      schemaVersion: 1,
      movementProfileId: "ground",
      currentCoord: { q: 2, r: 1 },
      nextCoord: { q: 3, r: 1 },
      edgeProgress: 0,
      stepsEntered: 0
    });
    expect(displaced.pathProgress).toBe(0);
    subject.tick(0.2);
    expect(subject.enemies[0]!.navigation?.edgeProgress).toBeGreaterThan(0);
  });

  it("uses the dynamic >=0.5 next-cell anchor and keeps canonical cached-field state", () => {
    const subject = spawn(runtimeContent({ navigationMode: "dynamic_flow" }));
    subject.tick(0.2);
    subject.tick(0.2);
    subject.tick(0.2);
    expect(subject.enemies[0]!.navigation).toMatchObject({
      currentCoord: { q: 1, r: 1 },
      nextCoord: { q: 2, r: 1 }
    });
    expect(subject.enemies[0]!.navigation?.edgeProgress).toBeCloseTo(0.6);
    const buildsBefore = navigationStats(subject).fieldBuildCount;

    // Relative to source (2,0), E is the first strict push neighbor from the >=0.5 anchor (2,1).
    expect(subject.useAbility("shove", { q: 2, r: 0 })).toEqual({ ok: true });
    expect(eventsOfType(subject, "enemyDisplacementResolved")).toEqual([
      expect.objectContaining({
        from: { q: 2, r: 1 },
        to: { q: 3, r: 1 },
        movedDistance: 1,
        stopReason: "completed"
      })
    ]);
    expect(subject.enemies[0]!.navigation).toEqual({
      schemaVersion: 1,
      movementProfileId: "ground",
      currentCoord: { q: 3, r: 1 },
      nextCoord: { q: 4, r: 1 },
      edgeProgress: 0,
      stepsEntered: 0
    });
    expect(navigationStats(subject).fieldBuildCount).toBe(buildsBefore);
  });

  it("does not infer flying immunity from a custom movement-profile name", () => {
    const subject = spawn(runtimeContent({
      navigationMode: "dynamic_flow",
      walkerMovementProfileId: "airborne_named_but_ground"
    }));
    expect(subject.enemies[0]!.navigation?.movementProfileId).toBe("airborne_named_but_ground");

    expect(subject.useAbility("shove", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(coordOf(subject, subject.enemies[0]!)).toEqual({ q: 2, r: 1 });
    expect(eventsOfType(subject, "enemyDisplacementResolved")[0]).toMatchObject({
      movedDistance: 1,
      stopReason: "completed"
    });
  });

  it("never displaces flying or explicitly immune enemies while a ground peer moves", () => {
    const subject = spawn(runtimeContent({ enemyIds: ["walker", "immune", "flyer"] }));
    const before = new Map(subject.enemies.map((enemy) => [enemy.typeId, coordOf(subject, enemy)]));

    expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
    const after = new Map(subject.enemies.map((enemy) => [enemy.typeId, coordOf(subject, enemy)]));
    expect(after.get("walker")).toEqual({ q: 2, r: 1 });
    expect(after.get("immune")).toEqual(before.get("immune"));
    expect(after.get("flyer")).toEqual(before.get("flyer"));
  });

  it("treats fall immunity independently from displacement immunity", () => {
    const subject = spawn(runtimeContent({
      enemyIds: ["immune"],
      hazardQ: 2,
      displacementImmuneEnemyTypeIds: [],
      fallImmuneEnemyTypeIds: ["immune"]
    }));
    const enemy = subject.enemies[0]!;

    expect(subject.useAbility("shove", { q: 1, r: 0 })).toEqual({ ok: true });
    expect(enemy.hp).toBe(enemy.maxHp);
    expect(coordOf(subject, enemy)).toEqual({ q: 1, r: 1 });
    expect(eventsOfType(subject, "enemyFell")).toHaveLength(0);
    expect(eventsOfType(subject, "enemyDisplacementResolved")[0]).toMatchObject({
      movedDistance: 0,
      stopReason: "blocked"
    });
  });

  it.each([500, 1_000])(
    "reuses cached dynamic fields while resolving displacement for %i enemies",
    (enemyCount) => {
      const subject = spawn(runtimeContent({ navigationMode: "dynamic_flow", enemyCount }));
      expect(subject.enemies).toHaveLength(enemyCount);
      const before = navigationStats(subject);

      expect(subject.useAbility("shove", { q: 1, r: 0 })).toEqual({ ok: true });
      const after = navigationStats(subject);
      expect(after.fieldBuildCount).toBe(before.fieldBuildCount);
      expect(after.fieldQueryCount).toBeGreaterThan(before.fieldQueryCount);
    }
  );

  it("commits a tagged fall before walkability, then settles kill, reward, objective, and death spawn exactly once without damage or leak", () => {
    const subject = spawn(runtimeContent({
      enemyIds: ["parent"],
      hazardQ: 2,
      abilityEffects: [PUSH_ONE, { kind: "damage", amount: 999 }]
    }));
    const parentId = subject.enemies[0]!.id;
    const coreBefore = subject.coreHp;
    const coinsBefore = subject.coins;

    expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
    expect(eventsOfType(subject, "enemyFell")).toEqual([
      expect.objectContaining({
        enemyId: parentId,
        from: { q: 1, r: 1 },
        to: { q: 2, r: 1 },
        terrainTag: "fall_hazard"
      })
    ]);
    expect(subject.enemies[0]!.hp).toBe(0);
    expect(subject.lastEvents.some((event) => [
      "enemyHit", "enemyShieldChanged", "enemyReactionTriggered", "enemyLeaked"
    ].includes(event.type))).toBe(false);

    subject.tick(0);
    expect(subject.coreHp).toBe(coreBefore);
    expect(subject.coins).toBe(coinsBefore + 7);
    expect(eventsOfType(subject, "enemyKilled")).toHaveLength(1);
    expect(eventsOfType(subject, "enemySpawnedOnDeath")).toHaveLength(1);
    expect(eventsOfType(subject, "objectiveCompleted")).toHaveLength(1);
    expect(eventsOfType(subject, "enemyLeaked")).toHaveLength(0);
    expect(subject.enemies).toHaveLength(1);
    expect(subject.enemies[0]!.typeId).toBe("walker");

    subject.tick(0);
    expect(subject.coins).toBe(coinsBefore + 7);
    expect(eventsOfType(subject, "enemyKilled")).toHaveLength(0);
    expect(eventsOfType(subject, "enemySpawnedOnDeath")).toHaveLength(0);
    expect(eventsOfType(subject, "enemyLeaked")).toHaveLength(0);
  });

  it("applies ordered pipeline effects from the live tower coordinate and keeps checkpoint plus journal replay deterministic", () => {
    const content = runtimeContent({ towerEffects: [PUSH_ONE, { kind: "damage", amount: 10 }] });
    const subject = new TowerDefenseGame({ missionId: "physics_runtime", content, seed: "physics-runtime" });
    expect(subject.placeTower("pusher", { q: 0, r: 0 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(coordOf(subject, subject.enemies[0]!)).toEqual({ q: 2, r: 1 });
    expect(subject.enemies[0]!.hp).toBe(90);
    expect(subject.lastEvents
      .map((event) => String((event as { type: string }).type))
      .filter((type) => type === "enemyDisplacementResolved" || type === "enemyHit"))
      .toEqual(["enemyDisplacementResolved", "enemyHit"]);

    const checkpoint = subject.createCheckpoint();
    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
    subject.tick(0.2);
    restored.tick(0.2);
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());

    const journalGame = new TowerDefenseGame({ missionId: "physics_runtime", content, seed: "physics-runtime" });
    const session = new JournaledGameSession(journalGame);
    expect(session.dispatch({
      schemaVersion: 1, type: "placeTower", towerTypeId: "pusher", coord: { q: 0, r: 0 }
    })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });
    const journal = session.exportJournal();
    const replay = replayGameCommandJournal({ content, journal });
    expect(replay.stateDigest).toBe(journalGame.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(journalGame.getSnapshot());
  });

  it.each([
    ["area", { kind: "area", radius: 1, secondaryMultiplier: 1 }],
    ["chain", { kind: "chain", maxJumps: 1, jumpRadius: 1, damageFalloff: 1 }]
  ] as const)(
    "keeps the initially acquired %s recipient set fixed while ordered displacement changes live coordinates",
    (_label, towerDelivery) => {
      const content = runtimeContent({
        enemyCount: 3,
        towerEffects: [PUSH_ONE, { kind: "damage", amount: 10 }],
        towerDelivery
      });
      const subject = new TowerDefenseGame({ missionId: "physics_runtime", content, seed: `fixed-${_label}` });
      expect(subject.startNextWave()).toEqual({ ok: true });
      subject.tick(0);
      expect(subject.enemies).toHaveLength(3);
      subject.enemies[0]!.pathProgress = 2;
      subject.enemies[1]!.pathProgress = 1;
      subject.enemies[2]!.pathProgress = 0;
      expect(subject.placeTower("pusher", { q: 0, r: 0 })).toEqual({ ok: true });

      subject.tick(0);

      expect(subject.enemies.map((enemy) => enemy.hp)).toEqual([90, 90, 100]);
      expect(eventsOfType(subject, "enemyDisplacementResolved").map((event) => event.enemyId))
        .toEqual(subject.enemies.slice(0, 2).map((enemy) => enemy.id));
    }
  );
});

describe("R3.4a displacement effect validation hardening", () => {
  const displacementBudgetIssue = (result: ReturnType<typeof validateGameContentRegistry>): boolean => (
    result.issues.some((issue) => (
      /effects/.test(issue.fieldPath)
      && /displacement/i.test(issue.message)
      && /8|limit|maximum|budget/i.test(issue.message)
    ))
  );

  it.each(["ability", "pipeline"] as const)(
    "caps active reachable %s sources at eight displacement effects without changing inactive legacy content",
    (surface) => {
      const nine = Array.from({ length: 9 }, () => PUSH_ONE);
      const optionsFor = (activation: PhysicsActivation): FixtureOptions => ({
        activation,
        ...(surface === "ability"
          ? { abilityEffects: nine }
          : { towerEffects: nine })
      });
      const active = validateGameContentRegistry(runtimeContent(optionsFor("active")));
      expect(active.ok).toBe(false);
      expect(displacementBudgetIssue(active)).toBe(true);

      for (const activation of ["absent", "disabled", "unselected", "future"] as const) {
        const legacy = validateGameContentRegistry(runtimeContent(optionsFor(activation)));
        expect(displacementBudgetIssue(legacy), activation).toBe(false);
      }
    }
  );

  it("counts pipeline displacement effects reachable through transitive support unlocks", () => {
    const content = runtimeContent({ towerEffects: Array.from({ length: 9 }, () => PUSH_ONE) });
    content.towers.gateway = {
      id: "gateway",
      label: "Gateway",
      cost: { coins: 1 },
      footprintRadius: 0,
      range: 1,
      attack: { kind: "support", auraRadius: 1, unlocksTowerIds: ["pusher"] }
    };
    (content.missions.physics_runtime!.buildTowerIds as string[]).splice(0, Infinity, "gateway");

    const result = validateGameContentRegistry(content);
    expect(result.ok).toBe(false);
    expect(displacementBudgetIssue(result)).toBe(true);
  });

  it.each(["ability", "pipeline"] as const)(
    "inspects %s displacement effects as closed own-data records without invoking accessors",
    (surface) => {
      const installEffect = (content: GameContentRegistry, effect: object): void => {
        if (surface === "ability") {
          (content.abilities.shove as unknown as { effects: object[] }).effects = [effect];
        } else {
          const attack = content.towers.pusher!.attack as unknown as { effects: object[] };
          attack.effects = [effect];
        }
      };
      const contentFor = (activation: PhysicsActivation): GameContentRegistry => runtimeContent({
        activation,
        abilityEffects: [PUSH_ONE],
        towerEffects: [PUSH_ONE]
      });

      for (const activation of ["active", "absent", "disabled", "unselected", "future"] as const) {
        const inherited = Object.create({
          kind: "displacement",
          mode: "push",
          distance: 1,
          stopAtBlocker: true
        }) as object;
        const inheritedContent = contentFor(activation);
        installEffect(inheritedContent, inherited);
        expect(validateGameContentRegistry(inheritedContent).issues, activation).toEqual(expect.arrayContaining([
          expect.objectContaining({
            fieldPath: expect.stringMatching(/effects\[0\]/),
            message: expect.stringMatching(/own data|plain object|data propert|inspect/i)
          })
        ]));

        const getter = vi.fn(() => {
          throw new Error("SYNTHETIC_SECRET_DISPLACEMENT_GETTER");
        });
        const accessor: Record<string, unknown> = {
          mode: "push",
          distance: 1,
          stopAtBlocker: true
        };
        Object.defineProperty(accessor, "kind", { enumerable: true, get: getter });
        const accessorContent = contentFor(activation);
        installEffect(accessorContent, accessor);
        let result: ReturnType<typeof validateGameContentRegistry> | undefined;
        let thrown: unknown;
        try {
          result = validateGameContentRegistry(accessorContent);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, activation).toBeUndefined();
        expect(getter, activation).not.toHaveBeenCalled();
        expect(result?.ok, activation).toBe(false);
        expect(result?.issues.some((issue) => (
          /effects\[0\]/.test(issue.fieldPath)
          && /own data|accessor|data propert|inspect/i.test(issue.message)
        )), activation).toBe(true);
        expect(JSON.stringify(result), activation).not.toContain("SYNTHETIC_SECRET_DISPLACEMENT_GETTER");
      }
    }
  );
});

describe("R3.4a runtime malformed-effect containment", () => {
  it.each([
    ["ability", "absent"],
    ["ability", "disabled"],
    ["pipeline", "absent"],
    ["pipeline", "disabled"]
  ] as const)(
    "does not run the extra displacement-ranking pass for an inactive %s surface (%s) and preserves the exact legacy behavior digest",
    (surface, activation) => {
      const getter = vi.fn(() => {
        throw new Error("SYNTHETIC_INACTIVE_DISPLACEMENT_GETTER");
      });
      const hostileTarget: Record<string, unknown> = {
        mode: "push",
        distance: 8,
        stopAtBlocker: true
      };
      Object.defineProperty(hostileTarget, "kind", { enumerable: true, get: getter });
      let descriptorPasses = 0;
      const hostile = new Proxy(hostileTarget, {
        ownKeys(target) {
          descriptorPasses += 1;
          return Reflect.ownKeys(target);
        }
      });
      const damage = { kind: "damage", amount: 1 } as const;

      const run = (withHostile: boolean): string => {
        const content = runtimeContent({
          activation,
          ...(surface === "pipeline" ? { towerEffects: [PUSH_ONE] } : {})
        });
        const effects: object[] = [...(withHostile ? [hostile] : []), damage];
        if (surface === "ability") {
          (content.abilities.shove as unknown as { effects: object[] }).effects = effects;
        } else {
          (content.towers.pusher!.attack as unknown as { effects: object[] }).effects = effects;
        }

        const subject = new TowerDefenseGame({
          missionId: "physics_runtime",
          content,
          seed: `inactive-${surface}-${activation}`
        });
        if (surface === "pipeline") {
          expect(subject.placeTower("pusher", { q: 0, r: 0 })).toEqual({ ok: true });
        }
        expect(subject.startNextWave()).toEqual({ ok: true });
        subject.tick(0);
        if (surface === "ability") {
          expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
        }
        return legacyBehaviorDigest(subject);
      };

      const hostileDigest = run(true);
      const baselineDigest = run(false);

      expect(getter).not.toHaveBeenCalled();
      expect(hostileDigest).toBe(baselineDigest);
      // One generic dispatch inspection plus one public-event/expected-damage projection is
      // sufficient. A third pass is the opt-in displacement rank scan and is forbidden here.
      expect(descriptorPasses).toBe(2);
    }
  );

  it.each(["ability", "pipeline"] as const)(
    "treats a hostile %s displacement accessor as a no-op and still applies the later valid damage effect",
    (surface) => {
      const getter = vi.fn(() => {
        throw new Error("SYNTHETIC_RUNTIME_DISPLACEMENT_GETTER");
      });
      const hostile: Record<string, unknown> = {
        mode: "push",
        distance: 1,
        stopAtBlocker: true
      };
      Object.defineProperty(hostile, "kind", { enumerable: true, get: getter });
      const content = runtimeContent({
        ...(surface === "pipeline" ? { towerEffects: [PUSH_ONE] } : {})
      });
      const effects = [hostile, { kind: "damage", amount: 1 }];
      if (surface === "ability") {
        (content.abilities.shove as unknown as { effects: object[] }).effects = effects;
      } else {
        (content.towers.pusher!.attack as unknown as { effects: object[] }).effects = effects;
      }

      const subject = new TowerDefenseGame({ missionId: "physics_runtime", content, seed: `hostile-${surface}` });
      if (surface === "pipeline") {
        expect(subject.placeTower("pusher", { q: 0, r: 0 })).toEqual({ ok: true });
      }
      expect(subject.startNextWave()).toEqual({ ok: true });
      let action: unknown;
      let thrown: unknown;
      try {
        subject.tick(0);
        action = surface === "ability"
          ? subject.useAbility("shove", { q: 0, r: 0 })
          : { ok: true };
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeUndefined();
      expect(action).toEqual({ ok: true });
      expect(getter).not.toHaveBeenCalled();
      expect(subject.enemies[0]!.hp).toBe(99);
      expect(eventsOfType(subject, "enemyDisplacementResolved")).toHaveLength(0);
    }
  );
});

describe("R3.4a displacement activation budgets", () => {
  it("admits the deterministic first 64 targets and first 8 displacement effects while preserving later non-displacement effects", () => {
    const effects = [
      ...Array.from({ length: 10 }, () => PUSH_ONE),
      { kind: "damage" as const, amount: 1 }
    ];
    const makeGame = (): TowerDefenseGame => spawn(runtimeContent({
      navigationMode: "dynamic_flow",
      enemyCount: 70,
      abilityEffects: effects
    }));
    const first = makeGame();
    const second = makeGame();

    for (const subject of [first, second]) {
      expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
      const displacementEvents = eventsOfType(subject, "enemyDisplacementResolved");
      expect(displacementEvents).toHaveLength(64 * 8);
      const admittedIds = [...new Set(displacementEvents.map((event) => event.enemyId))];
      expect(admittedIds).toEqual(subject.enemies.slice(0, 64).map((enemy) => enemy.id));
      for (const enemyId of admittedIds) {
        expect(displacementEvents.filter((event) => event.enemyId === enemyId)).toHaveLength(8);
      }
      expect(subject.enemies.every((enemy) => enemy.hp === 99)).toBe(true);
    }

    expect(second.lastEvents).toEqual(first.lastEvents);
    expect(second.getStateDigest()).toBe(first.getStateDigest());
    const checkpoint = first.createCheckpoint();
    const restored = TowerDefenseGame.fromCheckpoint({
      content: runtimeContent({
        navigationMode: "dynamic_flow",
        enemyCount: 70,
        abilityEffects: effects
      }),
      checkpoint
    });
    expect(restored.getStateDigest()).toBe(first.getStateDigest());
    expect(restored.getSnapshot()).toEqual(first.getSnapshot());
  });

  it("reserves requested distance against a fresh 4,096-step ability activation budget without checkpoint state", () => {
    const distanceEight: DisplacementEffectContract = {
      kind: "displacement",
      mode: "push",
      distance: 8,
      stopAtBlocker: true
    };
    const content = runtimeContent({
      navigationMode: "dynamic_flow",
      enemyCount: 64,
      abilityEffects: Array.from({ length: 8 }, () => distanceEight)
    });
    const subject = spawn(content);

    for (let activation = 0; activation < 2; activation += 1) {
      const before = eventsOfType(subject, "enemyDisplacementResolved").length;
      expect(subject.useAbility("shove", { q: 0, r: 0 })).toEqual({ ok: true });
      expect(eventsOfType(subject, "enemyDisplacementResolved")).toHaveLength(before + 64 * 8);
    }
    const checkpoint = subject.createCheckpoint();
    expect(checkpoint.state).not.toHaveProperty("physicsBudget");
    expect(checkpoint.state).not.toHaveProperty("physicsBudgets");
    expect(checkpoint.state).not.toHaveProperty("displacementStepAttempts");
    expect(TowerDefenseGame.fromCheckpoint({ content, checkpoint }).getStateDigest())
      .toBe(subject.getStateDigest());
  });

  it("gives each pipeline activation a local 4,096-step budget and enforces the 32,768-step tick aggregate", () => {
    const distanceEight: DisplacementEffectContract = {
      kind: "displacement",
      mode: "push",
      distance: 8,
      stopAtBlocker: true
    };
    const content = runtimeContent({
      enemyCount: 64,
      towerMaxTargets: 64,
      towerDeliveryKind: "multi",
      towerEffects: Array.from({ length: 8 }, () => distanceEight)
    });
    const subject = new TowerDefenseGame({ missionId: "physics_runtime", content, seed: "physics-tick-budget" });
    const positions = [
      { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
      { q: 3, r: 0 }, { q: 4, r: 0 }, { q: 5, r: 0 },
      { q: 6, r: 0 }, { q: 0, r: 2 }, { q: 1, r: 2 }
    ];
    for (const coord of positions) expect(subject.placeTower("pusher", coord)).toEqual({ ok: true });
    const towerIds = subject.towers.map((tower) => tower.id);
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);

    const displacementEvents = eventsOfType(subject, "enemyDisplacementResolved");
    expect(displacementEvents).toHaveLength(8 * 64 * 8);
    expect([...new Set(displacementEvents.map((event) => event.sourceId))]).toEqual(towerIds.slice(0, 8));
    expect(displacementEvents.some((event) => event.sourceId === towerIds[8])).toBe(false);
  });
});
