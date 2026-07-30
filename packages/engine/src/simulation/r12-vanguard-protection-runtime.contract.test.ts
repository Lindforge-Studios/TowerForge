import { describe, expect, it } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { TOWER_SCRIPT_EVENTS } from "../scripting/schema-descriptor.js";
import { computeCheckpointStateDigest, type GameCheckpointV1 } from "./checkpoint.js";
import type { DamagePacket, DamageSourceRef } from "./damage.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { EnemyState, GridCoord } from "./types.js";

type Activation = "active" | "disabled" | "unselected";
type SourceKind = "tower" | "ability" | "tower_script" | "status" | "reaction" | "enemy";

interface FixtureOptions {
  readonly activation?: Activation;
  readonly protected?: boolean;
  readonly sourceKinds?: readonly SourceKind[];
  readonly guardCount?: number;
  readonly shieldCapacity?: number;
}

interface ProtectionStatsContract {
  readonly transactionsThisTick: number;
  readonly candidatesInspected: number;
  readonly maximumCandidateCount: number;
}

const SOURCES: Readonly<Record<DamageSourceRef["kind"], DamageSourceRef>> = {
  tower: { kind: "tower", towerId: "tower_1", towerTypeId: "probe" },
  ability: { kind: "ability", abilityId: "strike" },
  tower_script: { kind: "tower_script", scriptId: "test" },
  status: { kind: "status", statusId: "poison" },
  reaction: { kind: "reaction", reactionId: "combustion" },
  enemy: { kind: "enemy", enemyId: "enemy_source", enemyTypeId: "grunt" },
  leak: { kind: "leak", enemyId: "enemy_source", enemyTypeId: "grunt" }
};

function enemy(id: string) {
  return {
    id, label: id, maxHp: 100, speed: 0.01, reward: { coins: 1 }, coinReward: 1,
    coreDamage: 1, color: 1
  };
}

function input(options: FixtureOptions = {}): GameContentInput {
  const activation = options.activation ?? "active";
  const protectedCohort = options.protected ?? true;
  const shieldCapacity = options.shieldCapacity ?? 50;
  const selected = activation !== "unselected";
  return {
    balance: {
      defaultMissionId: "vanguard_lab",
      constants: {
        timeUnitSeconds: 1, startingCoreHp: 100, startingCoins: 100,
        startingResources: { coins: 100 }, prepTimeUnits: 0, moveTowerCost: { coins: 1 },
        waterGroundSpeedFactor: 0.5, pathWaterCooldownUnits: 1,
        pathWaterDurationUnits: 1, pathWaterRadius: 1, pathWaterGroundSpeedFactor: 0.5
      },
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {},
      enemies: Object.fromEntries(["guard", "guard_alt", "grunt", "medic"].map((id) => [id, enemy(id)])),
      towers: {
        probe: {
          id: "probe", label: "Probe", cost: { coins: 1 }, footprintRadius: 0,
          range: 10, attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        }
      },
      waveSets: {
        wave: [{ id: "wave_1", label: "Wave", groups: [
          { enemyId: "guard", count: options.guardCount ?? 1, spawnInterval: 0, startDelay: 0 },
          { enemyId: "guard_alt", count: 1, spawnInterval: 0, startDelay: 0 },
          { enemyId: "grunt", count: 1, spawnInterval: 0, startDelay: 0 },
          { enemyId: "medic", count: 1, spawnInterval: 0, startDelay: 0 }
        ] }]
      },
      missions: {
        vanguard_lab: {
          id: "vanguard_lab", label: "Vanguard Lab", description: "",
          startingCoreHp: 100, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "arena", waveSetId: "wave", buildTowerIds: ["probe"], abilityIds: [],
          mechanics: { profiles: {
            navigation: "flow", combat: "shielded",
            ...(selected ? { enemyBehaviors: "formations" } : {})
          } }
        }
      }
    },
    maps: {
      arena: {
        id: "arena", width: 9, height: 5, grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor", spawnCoord: { q: 0, r: 2 }, coreCoord: { q: 8, r: 2 },
        pathCenterline: Array.from({ length: 9 }, (_, q) => ({ q, r: 2 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    mechanics: {
      schemaVersion: 1,
      modules: {
        navigation: {
          schemaVersion: 1, enabled: true,
          profiles: { flow: {
            mode: "dynamic_flow", defaultMovementProfileId: "ground",
            movementProfiles: { ground: {
              label: "Ground", terrainMode: "respect_walkable", towerOccupancy: "blocked",
              defaultTerrainCost: 1_000
            } }
          } }
        },
        combat: {
          schemaVersion: 1, enabled: true,
          profiles: { shielded: { shields: { enemies: {
            guard: { capacity: shieldCapacity }, guard_alt: { capacity: shieldCapacity }
          } } } }
        },
        enemyBehaviors: {
          schemaVersion: 1,
          enabled: activation !== "disabled",
          profiles: { formations: {
            bosses: { grunt: { components: { weakpoint: {
              maxHp: 10,
              hitRegion: { kind: "circle", offsetX: 0, offsetY: 0, radius: 0.2 },
              tags: ["weakpoint"]
            } } } },
            formations: { cohorts: { alpha: {
              members: { guard: "vanguard", guard_alt: "vanguard", grunt: "body", medic: "support" },
              steering: {
                neighborRadius: 2, cohesionWeight: 1, separationWeight: 1, roleWeight: 1
              },
              ...(protectedCohort ? { protection: {
                radius: 2,
                sourceKinds: [...(options.sourceKinds ?? ["tower", "ability", "tower_script", "status", "reaction", "enemy"])]
              } } : {})
            } } }
          } }
        }
      }
    },
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "vanguard_lab", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function fixture(options: FixtureOptions = {}) {
  const content = createGameContentRegistry(input(options));
  const game = new TowerDefenseGame({ content, missionId: "vanguard_lab", seed: "r12-vanguard" });
  expect(game.startNextWave()).toEqual({ ok: true });
  game.tick(0);
  return { content, game };
}

function byType(game: TowerDefenseGame, typeId: string): EnemyState[] {
  return game.enemies.filter((enemy) => enemy.typeId === typeId);
}

function move(enemy: EnemyState, coord: GridCoord): void {
  const navigation = (enemy as any).navigation;
  navigation.currentCoord = { ...coord };
  navigation.nextCoord = coord.q < 8
    ? { q: coord.q + 1, r: coord.r }
    : coord.r < 2
      ? { q: coord.q, r: coord.r + 1 }
      : coord.r > 2
        ? { q: coord.q, r: coord.r - 1 }
        : undefined;
  navigation.edgeProgress = 0;
}

function arrange(game: TowerDefenseGame): {
  guard: EnemyState;
  guardAlt: EnemyState;
  target: EnemyState;
} {
  const guard = byType(game, "guard")[0]!;
  const guardAlt = byType(game, "guard_alt")[0]!;
  const target = byType(game, "grunt")[0]!;
  move(target, { q: 3, r: 2 });
  move(guard, { q: 2, r: 2 });
  move(guardAlt, { q: 4, r: 2 });
  return { guard, guardAlt, target };
}

function apply(
  game: TowerDefenseGame,
  target: EnemyState,
  source: DamageSourceRef = SOURCES.tower,
  amount = 20,
  ...componentIdArgument: readonly [componentId?: string]
): unknown {
  const componentId = componentIdArgument.length === 0 ? "weakpoint" : componentIdArgument[0];
  const packet: DamagePacket = {
    amount,
    source,
    target: {
      kind: "enemy", enemyId: target.id, enemyTypeId: target.typeId,
      ...(componentId === undefined ? {} : { componentId })
    }
  };
  return (game as unknown as {
    resolveAndApplyDamage(packet: DamagePacket, context: undefined, mutableTarget: unknown): unknown;
  }).resolveAndApplyDamage(packet, undefined, { kind: "enemy", enemy: target });
}

function shield(game: TowerDefenseGame, enemyId: string): number {
  return (game.getSnapshot().combat as any).shields.enemies[enemyId].current;
}

function componentHp(game: TowerDefenseGame, enemyId: string): number {
  return (game.getSnapshot().enemyBehaviors as any).components[enemyId].weakpoint.hp;
}

function events(game: TowerDefenseGame) {
  return game.getSnapshot().lastEvents.filter((event) => String(event.type) === "vanguardDamageIntercepted") as any[];
}

function stats(game: TowerDefenseGame): ProtectionStatsContract {
  const value = (game as unknown as { getVanguardProtectionStats(): ProtectionStatsContract })
    .getVanguardProtectionStats();
  expect(Object.isFrozen(value)).toBe(true);
  return value;
}

function protectionMetadata(game: TowerDefenseGame): unknown {
  return (game.getSnapshot().enemyBehaviors as any)?.formations?.protection;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("R12.4 vanguard protection TowerDefenseGame contract (RED)", () => {
  it("publishes exact derived snapshot/checkpoint metadata and restores it without mutable history", () => {
    const { content, game } = fixture();
    const expected = {
      schemaVersion: 1,
      cohorts: { alpha: {
        radius: 2,
        sourceKinds: ["tower", "ability", "tower_script", "status", "reaction", "enemy"]
      } }
    };
    expect(protectionMetadata(game)).toEqual(expected);
    const checkpoint = jsonClone(game.createCheckpoint());
    expect((checkpoint.state as any).enemyBehaviors.formations.protection).toEqual(expected);
    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    expect(protectionMetadata(restored)).toEqual(expected);
    expect(restored.getStateDigest()).toBe(game.getStateDigest());

    const malformed = jsonClone(checkpoint);
    (malformed.state as any).enemyBehaviors.formations.protection.cohorts.alpha.radius = 5;
    (malformed as any).stateDigest = computeCheckpointStateDigest(
      malformed.contentDigest, malformed.identity, malformed.rng, malformed.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: malformed }))
      .toThrow(/protection|radius|checkpoint/i);
  });

  it("redirects the whole component-targeted packet once to nearest/binary vanguard before shield events", () => {
    const { game } = fixture();
    const { guard, target } = arrange(game);
    const targetHp = target.hp;
    apply(game, target);

    expect(shield(game, guard.id)).toBe(30);
    expect(target.hp).toBe(targetHp);
    expect(componentHp(game, target.id)).toBe(10);
    expect(events(game)).toEqual([{
      type: "vanguardDamageIntercepted",
      cohortId: "alpha",
      protectedEnemyId: target.id,
      protectedEnemyTypeId: "grunt",
      vanguardEnemyId: guard.id,
      vanguardEnemyTypeId: "guard",
      sourceKind: "tower",
      requestedAmount: 20,
      originalComponentId: "weakpoint"
    }]);
    const types = game.getSnapshot().lastEvents.map((event) => String(event.type));
    expect(types.indexOf("vanguardDamageIntercepted")).toBeLessThan(types.indexOf("enemyShieldChanged"));
    expect(stats(game).transactionsThisTick).toBe(1);
  });

  it("does not split overflow, chain through a vanguard, or settle the protected target", () => {
    const { game } = fixture();
    const { guard, guardAlt, target } = arrange(game);
    (game as any).enemyShields[guard.id].current = 5;
    const coins = game.coins;
    apply(game, target, SOURCES.ability, 20, undefined);
    expect(shield(game, guard.id)).toBe(0);
    expect(guard.hp).toBe(85);
    expect(shield(game, guardAlt.id)).toBe(50);
    expect(target.hp).toBe(100);
    expect(game.coins).toBe(coins);
    expect(events(game)).toHaveLength(1);

    apply(game, guardAlt, SOURCES.ability, 5, undefined);
    expect(events(game)).toHaveLength(1);
    expect(shield(game, guardAlt.id)).toBe(45);
  });

  it("honors every allowlisted source kind and precedes the legacy enemyHit caller event", () => {
    for (const sourceKind of ["tower", "ability", "tower_script", "status", "reaction", "enemy"] as const) {
      const { game } = fixture();
      const { target } = arrange(game);
      apply(game, target, SOURCES[sourceKind], 1, undefined);
      expect(events(game)).toEqual([expect.objectContaining({ sourceKind })]);
    }

    const { game } = fixture();
    const { guard, target } = arrange(game);
    (game as any).enemyShields[guard.id].current = 0.5;
    expect(game.placeTower("probe", { q: 1, r: 0 })).toEqual({ ok: true });
    const tower = game.towers[0]!;
    (game as unknown as {
      applyTowerDamage(
        tower: TowerDefenseGame["towers"][number],
        enemy: EnemyState,
        amount: number
      ): unknown;
    }).applyTowerDamage(tower, target, 1);
    const types = game.getSnapshot().lastEvents.map((event) => String(event.type));
    expect(types.indexOf("vanguardDamageIntercepted")).toBeLessThan(types.indexOf("enemyShieldChanged"));
    expect(types.indexOf("vanguardDamageIntercepted")).toBeLessThan(types.indexOf("enemyHit"));
  });

  it("excludes non-allowlisted/leak packets and atomically falls back when no live in-radius vanguard exists", () => {
    const restricted = fixture({ sourceKinds: ["tower"] }).game;
    let arranged = arrange(restricted);
    apply(restricted, arranged.target, SOURCES.ability, 4);
    apply(restricted, arranged.target, SOURCES.leak, 3);
    expect(events(restricted)).toEqual([]);
    expect(componentHp(restricted, arranged.target.id)).toBe(3);

    const unavailable = fixture().game;
    arranged = arrange(unavailable);
    arranged.guard.hp = 0;
    arranged.guardAlt.hp = 0;
    apply(unavailable, arranged.target, SOURCES.tower, 4);
    expect(events(unavailable)).toEqual([]);
    expect(componentHp(unavailable, arranged.target.id)).toBe(6);

    const distant = fixture().game;
    arranged = arrange(distant);
    move(arranged.guard, { q: 0, r: 0 });
    move(arranged.guardAlt, { q: 8, r: 4 });
    apply(distant, arranged.target, SOURCES.tower, 4);
    expect(events(distant)).toEqual([]);
    expect(componentHp(distant, arranged.target.id)).toBe(6);
  });

  it("caps candidate inspection at sixteen with deterministic selection independent of enemy iteration order", () => {
    const left = fixture({ guardCount: 20 }).game;
    const right = fixture({ guardCount: 20 }).game;
    const leftTarget = byType(left, "grunt")[0]!;
    const rightTarget = byType(right, "grunt")[0]!;
    move(leftTarget, { q: 3, r: 2 });
    move(rightTarget, { q: 3, r: 2 });
    for (const candidate of byType(left, "guard")) move(candidate, { q: 3, r: 2 });
    for (const candidate of byType(right, "guard")) move(candidate, { q: 3, r: 2 });
    right.enemies.reverse();

    apply(left, leftTarget, SOURCES.tower, 1, undefined);
    apply(right, rightTarget, SOURCES.tower, 1, undefined);
    expect(events(left)[0]?.vanguardEnemyId).toBe("enemy_1");
    expect(events(right)[0]?.vanguardEnemyId).toBe("enemy_1");
    expect(stats(left).maximumCandidateCount).toBe(16);
    expect(stats(left).candidatesInspected).toBeLessThanOrEqual(16);
  });

  it("allows exactly 512 redirects per tick and atomically falls back on the next packet", () => {
    const { game } = fixture({ shieldCapacity: 1_000_000 });
    const { guard, target } = arrange(game);
    for (let index = 0; index < 513; index += 1) apply(game, target, SOURCES.tower, 1, undefined);
    expect(events(game)).toHaveLength(512);
    expect(stats(game).transactionsThisTick).toBe(512);
    expect(shield(game, guard.id)).toBe(1_000_000 - 512);
    expect(target.hp).toBe(99);
    game.tick(0);
    expect(stats(game).transactionsThisTick).toBe(0);
  });

  it("checkpoints only the active gameplay transaction counter in a closed v1 field", () => {
    const { game } = fixture({ shieldCapacity: 1_000_000 });
    const { target } = arrange(game);
    for (let index = 0; index < 17; index += 1) apply(game, target, SOURCES.tower, 1, undefined);

    const checkpoint = jsonClone(game.createCheckpoint());
    expect((checkpoint.state as any).enemyBehaviors.protectionRuntime).toEqual({
      schemaVersion: 1,
      transactionsThisTick: 17
    });
    expect(Object.keys((checkpoint.state as any).enemyBehaviors.protectionRuntime)).toEqual([
      "schemaVersion", "transactionsThisTick"
    ]);
    expect((checkpoint.state as any).enemyBehaviors.protectionRuntime).not.toHaveProperty("candidatesInspected");
    expect((checkpoint.state as any).enemyBehaviors.protectionRuntime).not.toHaveProperty("maximumCandidateCount");
    expect((game.getSnapshot().enemyBehaviors as any)).not.toHaveProperty("protectionRuntime");
  });

  it.each([
    ["future schema", { schemaVersion: 2, transactionsThisTick: 1 }, /protectionRuntime.*schema|schema.*protectionRuntime/i],
    ["negative counter", { schemaVersion: 1, transactionsThisTick: -1 }, /transactionsThisTick.*(?:0|negative|range)/i],
    ["over-limit counter", { schemaVersion: 1, transactionsThisTick: 513 }, /transactionsThisTick.*512/i],
    ["extra diagnostic", {
      schemaVersion: 1, transactionsThisTick: 1, candidatesInspected: 1
    }, /protectionRuntime.*(?:closed|unknown).*candidatesInspected|candidatesInspected.*(?:closed|unknown)/i]
  ] as const)("rejects malformed protectionRuntime checkpoint state: %s", (_label, runtime, message) => {
    const { content, game } = fixture({ shieldCapacity: 1_000_000 });
    const checkpoint = jsonClone(game.createCheckpoint());
    (checkpoint.state as any).enemyBehaviors.protectionRuntime = runtime;
    (checkpoint as any).stateDigest = computeCheckpointStateDigest(
      checkpoint.contentDigest, checkpoint.identity, checkpoint.rng, checkpoint.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint })).toThrow(message);
  });

  it("restores the 511/512 transaction boundary before accepting more packets without a tick", () => {
    const { content, game: continuous } = fixture({ shieldCapacity: 1_000_000 });
    const continuousTargets = arrange(continuous);
    for (let index = 0; index < 511; index += 1) {
      apply(continuous, continuousTargets.target, SOURCES.tower, 1, undefined);
    }
    const checkpoint = jsonClone(continuous.createCheckpoint());
    expect((checkpoint.state as any).enemyBehaviors.protectionRuntime).toEqual({
      schemaVersion: 1,
      transactionsThisTick: 511
    });

    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    const restoredTarget = restored.enemies.find((enemy) => enemy.id === continuousTargets.target.id)!;
    const restoredGuard = restored.enemies.find((enemy) => enemy.id === continuousTargets.guard.id)!;
    expect(restoredTarget).toBeTruthy();
    expect(restoredGuard).toBeTruthy();

    for (let packetIndex = 0; packetIndex < 2; packetIndex += 1) {
      apply(continuous, continuousTargets.target, SOURCES.tower, 1, undefined);
      apply(restored, restoredTarget, SOURCES.tower, 1, undefined);
      expect(restored.getSnapshot()).toEqual(continuous.getSnapshot());
      expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
      expect(shield(restored, restoredGuard.id)).toBe(shield(continuous, continuousTargets.guard.id));
      expect(componentHp(restored, restoredTarget.id)).toBe(componentHp(continuous, continuousTargets.target.id));
    }
    expect(stats(continuous).transactionsThisTick).toBe(512);
    expect(stats(restored).transactionsThisTick).toBe(512);
  });

  it("forbids protectionRuntime when authored protection is inactive and preserves legacy shape", () => {
    const { content, game } = fixture({ protected: false });
    const checkpoint = jsonClone(game.createCheckpoint());
    expect((checkpoint.state as any).enemyBehaviors?.protectionRuntime).toBeUndefined();
    expect((game.getSnapshot().enemyBehaviors as any)?.protectionRuntime).toBeUndefined();

    const forged = jsonClone(checkpoint);
    (forged.state as any).enemyBehaviors.protectionRuntime = {
      schemaVersion: 1,
      transactionsThisTick: 0
    };
    (forged as any).stateDigest = computeCheckpointStateDigest(
      forged.contentDigest, forged.identity, forged.rng, forged.state
    );
    expect(() => TowerDefenseGame.fromCheckpoint({ content, checkpoint: forged }))
      .toThrow(/protectionRuntime|inactive|unexpected|closed|unknown/i);
  });

  it("keeps old/inactive formation snapshots, checkpoints, digests and TowerScript grammar free of protection", () => {
    expect(TOWER_SCRIPT_EVENTS).not.toContain("vanguardDamageIntercepted");
    for (const options of [
      { protected: false },
      { activation: "disabled" as const },
      { activation: "unselected" as const }
    ]) {
      const { game } = fixture(options);
      const digestBeforeDiagnostics = game.getStateDigest();
      expect(protectionMetadata(game)).toBeUndefined();
      expect((game.createCheckpoint().state as any).enemyBehaviors?.formations?.protection).toBeUndefined();
      expect(events(game)).toEqual([]);
      expect(stats(game)).toEqual({
        transactionsThisTick: 0,
        candidatesInspected: 0,
        maximumCandidateCount: 0
      });
      expect(game.getStateDigest()).toBe(digestBeforeDiagnostics);
    }
  });
});
