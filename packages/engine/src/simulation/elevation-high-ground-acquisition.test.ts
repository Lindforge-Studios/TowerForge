import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { DamageResolver, type DamagePacket } from "./damage.js";
import { JournaledGameSession } from "./journal.js";
import { replayGameCommandJournal } from "./replay.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { EnemyState, GameEvent, GridDefinition, TowerType } from "./types.js";

type AttackKind = "single" | "sniper" | "antiair" | "splash" | "pulse" | "pipeline" | "pipeline_aura";
type ElevationMode =
  | "absent"
  | "disabled"
  | "unselected"
  | "v1"
  | "v2"
  | "v3_empty"
  | "v3_los_only"
  | "v3_high_ground"
  | "v3_high_ground_los"
  | "future";

interface FixtureOptions {
  attackKind?: AttackKind;
  elevationMode?: ElevationMode;
  grid?: GridDefinition;
  spawnQ?: number;
  targetElevation?: number;
  dynamicNavigation?: boolean;
  twoLosRoutes?: boolean;
}

const HIGH_GROUND = Object.freeze({
  maximumEffectiveElevationDelta: 3,
  rangeBonusPerElevation: 1,
  damageBonusBasisPointsPerElevation: 1_000
});

function selectedTower(attackKind: AttackKind): TowerType {
  const common = { id: "subject", label: "Subject", cost: { coins: 1 }, footprintRadius: 0, range: 2 };
  if (attackKind === "sniper") {
    return { ...common, attack: { kind: "sniper", interval: 1, damage: 10, targetPriority: "first" } };
  }
  if (attackKind === "antiair") {
    return {
      ...common,
      attack: { kind: "antiair", fireRate: 1, damage: 10, maxTargetsByLevel: [1, 1, 1, 1], upgradeCosts: [] }
    };
  }
  if (attackKind === "splash") {
    return {
      ...common,
      attack: {
        kind: "splash", interval: 1, damage: 10, splashDamage: 5,
        armoredChipDamage: 0, splashRadius: 1, slowFactor: 0.5, slowDuration: 1
      }
    };
  }
  if (attackKind === "pulse") {
    return {
      ...common,
      attack: { kind: "pulse", pulseRate: 1, pulseDamage: 10, dotDamagePerUnit: 2, dotDuration: 2 }
    };
  }
  if (attackKind === "pipeline" || attackKind === "pipeline_aura") {
    return {
      ...common,
      attack: {
        kind: "pipeline", interval: 1,
        targeting: { classes: ["ground"], mode: "first", maxTargets: 4 },
        delivery: attackKind === "pipeline_aura" ? { kind: "aura" } : { kind: "single" },
        effects: [{ kind: "damage", amount: 10 }]
      }
    };
  }
  return {
    ...common,
    attack: {
      kind: "single", fireRate: 1, damagePerStack: 10,
      startingStacks: 1, maxStacks: 1, upgradeCost: 1
    }
  };
}

function elevationModule(mode: ElevationMode): Record<string, unknown> | undefined {
  if (mode === "absent") return undefined;
  const schemaVersion = mode === "v1" ? 1 : mode === "v2" ? 2 : mode === "future" ? 4 : 3;
  const profile = mode === "v1" || mode === "v2" || mode === "v3_empty"
    ? {}
    : mode === "v3_los_only"
      ? { lineOfSight: { terrainBlockerTags: ["opaque"] } }
      : mode === "future"
        ? { highGround: { ...HIGH_GROUND } }
        : mode === "v3_high_ground_los"
          ? {
              lineOfSight: { terrainBlockerTags: ["opaque"] },
              highGround: { ...HIGH_GROUND }
            }
          : { highGround: { ...HIGH_GROUND } };
  return {
    schemaVersion,
    enabled: mode !== "disabled",
    profiles: { plateau: profile }
  };
}

function acquisitionInput(options: FixtureOptions = {}): GameContentInput {
  const attackKind = options.attackKind ?? "single";
  const mode = options.elevationMode ?? "v3_high_ground";
  const spawnQ = options.spawnQ ?? 3;
  const row = 2;
  const blockedRoute = {
    id: "blocked",
    pathCenterline: Array.from({ length: 8 - spawnQ }, (_, index) => ({ q: spawnQ + index, r: row }))
  };
  const visibleRoute = {
    id: "visible",
    pathCenterline: Array.from({ length: 8 - spawnQ }, (_, index) => ({ q: spawnQ + index, r: 4 }))
  };
  const routes = options.twoLosRoutes ? [blockedRoute, visibleRoute] : [blockedRoute];
  const targetEnemyId = attackKind === "antiair" ? "flyer" : "grunt";
  const waveGroups = routes.map((route) => ({
    enemyId: targetEnemyId,
    count: 1,
    spawnInterval: 1,
    startDelay: 0,
    routeId: route.id
  }));
  const elevation = elevationModule(mode);
  const selectedProfiles = {
    ...(mode === "unselected" || mode === "absent" ? {} : { elevation: "plateau" }),
    ...(options.dynamicNavigation ? { navigation: "flow" } : {})
  };
  const mechanicsModules = {
    ...(elevation === undefined ? {} : { elevation }),
    ...(options.dynamicNavigation ? {
      navigation: {
        schemaVersion: 1,
        enabled: true,
        profiles: {
          flow: {
            mode: "dynamic_flow",
            defaultMovementProfileId: "ground",
            movementProfiles: {
              ground: {
                label: "Ground",
                terrainMode: "respect_walkable",
                towerOccupancy: "ignored",
                defaultTerrainCost: 1_000
              },
              air: {
                label: "Air",
                terrainMode: "ignore_walkable",
                towerOccupancy: "ignored",
                defaultTerrainCost: 1_000
              }
            },
            enemyMovementProfiles: { grunt: "ground", flyer: "air" }
          }
        }
      }
    } : {})
  };

  return {
    balance: {
      defaultMissionId: "high_ground",
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
      terrainTypes: {
        floor: {
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        },
        wall: {
          id: "wall", label: "Wall", buildable: false, walkable: true,
          groundSpeedMultiplier: 1, tags: ["opaque"]
        }
      },
      abilities: {
        strike: {
          id: "strike", label: "Strike", cooldown: 1, duration: 0, radius: 2,
          effects: [{ kind: "damage", amount: 10 }]
        }
      },
      enemies: {
        grunt: {
          id: "grunt", label: "Grunt", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        flyer: {
          id: "flyer", label: "Flyer", maxHp: 100, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2,
          targetClass: "flying", movementKind: "direct_flying"
        }
      },
      towers: {
        subject: selectedTower(attackKind),
        support: {
          id: "support", label: "Support", cost: { coins: 1 }, footprintRadius: 0, range: 2,
          attack: { kind: "support", auraRadius: 2, unlocksTowerIds: ["dependent"] }
        },
        dependent: {
          id: "dependent", label: "Dependent", cost: { coins: 1 }, footprintRadius: 0,
          range: 2, requiresAuraFrom: "support",
          attack: {
            kind: "single", fireRate: 1, damagePerStack: 1,
            startingStacks: 1, maxStacks: 1, upgradeCost: 1
          }
        },
        support_buff: {
          id: "support_buff", label: "Support buff", cost: { coins: 1 }, footprintRadius: 0, range: 2,
          attack: {
            kind: "support_buff", auraRadius: 2,
            fireRateMultiplierByLevel: [2, 2, 2], affectsTowerIds: ["subject"]
          }
        }
      },
      waveSets: { wave: [{ id: "wave", label: "Wave", groups: waveGroups }] },
      missions: {
        high_ground: {
          id: "high_ground", label: "High ground", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "field", waveSetId: "wave",
          buildTowerIds: ["subject", "support", "dependent", "support_buff"],
          abilityIds: ["strike"],
          ...(Object.keys(selectedProfiles).length === 0 ? {} : { mechanics: { profiles: selectedProfiles } })
        }
      }
    },
    maps: {
      field: {
        id: "field", width: 8, height: 5,
        grid: options.grid ?? { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { ...blockedRoute.pathCenterline[0]! },
        coreCoord: { ...blockedRoute.pathCenterline.at(-1)! },
        pathCenterline: blockedRoute.pathCenterline.map((coord) => ({ ...coord })),
        pathRoutes: routes.map((route) => ({
          id: route.id,
          pathCenterline: route.pathCenterline.map((coord) => ({ ...coord }))
        })),
        // q=2 blocks the straight r=2 ray without intersecting the deterministic
        // cardinal line to the visible r=4 route.
        terrainOverrides: mode === "v3_high_ground_los" ? [{ q: 2, r: row, terrain: "wall" }] : [],
        elevationOverrides: [
          { q: 0, r: row, elevation: 3 },
          ...(options.targetElevation === undefined || options.targetElevation === 0
            ? []
            : routes.map((route) => ({
                q: route.pathCenterline[0]!.q,
                r: route.pathCenterline[0]!.r,
                elevation: options.targetElevation!
              })))
        ]
      }
    },
    ...(Object.keys(mechanicsModules).length === 0 ? {} : {
      mechanics: { schemaVersion: 1, modules: mechanicsModules }
    }),
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "high_ground", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({
    content: createGameContentRegistry(acquisitionInput(options)),
    missionId: "high_ground",
    seed: "r3.3-high-ground-acquisition"
  });
}

function spawnAndFire(options: FixtureOptions = {}): TowerDefenseGame {
  const subject = game(options);
  expect(subject.placeTower("subject", { q: 0, r: 2 })).toEqual({ ok: true });
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  return subject;
}

function enemyHitIds(subject: TowerDefenseGame): string[] {
  return subject.lastEvents
    .filter((event): event is Extract<GameEvent, { type: "enemyHit" }> => event.type === "enemyHit")
    .map((event) => event.enemyId);
}

type TowerDamageBoundary = {
  applyResolvedTowerDamage(
    towerTypeId: string,
    enemy: EnemyState,
    rawDamage: number,
    options?: { readonly aoe?: boolean; readonly overTime?: boolean },
    towerId?: string
  ): unknown;
};

function damageBoundary(subject: TowerDefenseGame): TowerDamageBoundary {
  return subject as unknown as TowerDamageBoundary;
}

function highGroundModifier(packet: DamagePacket) {
  return packet.modifiers?.filter((modifier) => modifier.id === "elevation:high-ground:damage") ?? [];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R3.3 pairwise range acquisition", () => {
  it.each([
    ["single", "ground"],
    ["sniper", "ground"],
    ["antiair", "flying"],
    ["splash", "ground"],
    ["pulse", "ground"],
    ["pipeline", "ground"]
  ] as const)("expands %s acquisition for the matching %s pair", (attackKind, _targetClass) => {
    const subject = spawnAndFire({ attackKind, spawnQ: 3 });
    expect(enemyHitIds(subject)).toEqual(["enemy_1"]);
    expect(subject.enemies[0]?.hp).toBe(87);
  });

  it("expands offensive pipeline aura coverage", () => {
    const subject = spawnAndFire({ attackKind: "pipeline_aura", spawnQ: 3 });
    expect(enemyHitIds(subject)).toEqual(["enemy_1"]);
    expect(subject.enemies[0]?.hp).toBe(87);
  });

  it("admits extra-range pairs before deterministic target ordering", () => {
    const subject = game({ spawnQ: 3, twoLosRoutes: true });
    expect(subject.placeTower("subject", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(subject.setTowerTargetMode("tower_1", "furthest")).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(enemyHitIds(subject)).toEqual(["enemy_2"]);
  });

  it("applies active LoS after high-ground range admits each pair", () => {
    const subject = spawnAndFire({
      elevationMode: "v3_high_ground_los",
      spawnQ: 3,
      twoLosRoutes: true
    });
    expect(subject.enemies.map((enemy) => [enemy.id, enemy.routeId])).toEqual([
      ["enemy_1", "blocked"],
      ["enemy_2", "visible"]
    ]);
    expect(enemyHitIds(subject)).toEqual(["enemy_2"]);
  });

  it.each([
    ["square", { kind: "square", adjacency: "cardinal" }],
    ["hex", { kind: "hex", layout: "odd-r" }]
  ] as const)("uses topology distance on %s grids", (_label, grid) => {
    const subject = spawnAndFire({ grid, spawnQ: 3 });
    expect(enemyHitIds(subject)).toEqual(["enemy_1"]);
    expect(subject.enemies[0]?.hp).toBe(87);
  });

  it("anchors dynamic-flow ground and flying targets to their deterministic underlying tile", () => {
    for (const attackKind of ["single", "antiair"] as const) {
      const subject = spawnAndFire({ attackKind, spawnQ: 3, dynamicNavigation: true });
      expect(enemyHitIds(subject)).toEqual(["enemy_1"]);
      expect(subject.enemyCoord(subject.enemies[0]!)).toEqual({ q: 3, r: 2 });
      expect(subject.enemies[0]?.navigation).toMatchObject({
        movementProfileId: attackKind === "single" ? "ground" : "air",
        currentCoord: { q: 3, r: 2 }
      });
    }
  });
});

describe("R3.3 inactive-path range and damage compatibility", () => {
  it.each([
    "absent",
    "disabled",
    "unselected",
    "v1",
    "v2",
    "v3_empty",
    "v3_los_only",
    "future"
  ] as const)("keeps %s on exact legacy range and base damage", (elevationMode) => {
    const subject = spawnAndFire({ elevationMode, spawnQ: 2 });
    expect(subject.enemies[0]?.hp).toBe(90);
    expect(subject.lastEvents).toContainEqual({
      type: "towerFired", towerId: "tower_1", enemyId: "enemy_1", damage: 10
    });
    expect(subject.lastEvents).toContainEqual({
      type: "enemyHit", towerId: "tower_1", enemyId: "enemy_1", enemyTypeId: "grunt", damage: 10
    });
    expect(subject.getSnapshot()).not.toHaveProperty("highGround");
  });

  it("does not expand support placement or support_buff aura", () => {
    const support = game({ spawnQ: 7 });
    expect(support.placeTower("support", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(support.placeTower("dependent", { q: 3, r: 2 })).toMatchObject({ ok: false });

    const buff = game({ spawnQ: 2 });
    expect(buff.placeTower("subject", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(buff.placeTower("support_buff", { q: 3, r: 2 })).toEqual({ ok: true });
    expect(buff.startNextWave()).toEqual({ ok: true });
    buff.tick(0);
    expect(buff.towers.find((tower) => tower.typeId === "subject")?.cooldown).toBe(1);
  });
});

describe("R3.3 central high-ground damage boundary", () => {
  it("adds exactly one pairwise spatial modifier to every live tower secondary target", () => {
    const input = acquisitionInput({ attackKind: "splash", spawnQ: 3, twoLosRoutes: true });
    (input.maps.field!.elevationOverrides as Array<{ q: number; r: number; elevation: number }>).push({
      q: 3,
      r: 4,
      elevation: 2
    });
    const subject = new TowerDefenseGame({
      content: createGameContentRegistry(input),
      missionId: "high_ground",
      seed: "r3.3-high-ground-secondary-boundary"
    });
    expect(subject.placeTower("subject", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.enemies.map((enemy) => [enemy.id, subject.enemyCoord(enemy)])).toEqual([
      ["enemy_1", { q: 3, r: 2 }],
      ["enemy_2", { q: 3, r: 4 }]
    ]);

    const resolve = vi.spyOn(DamageResolver, "resolve");
    damageBoundary(subject).applyResolvedTowerDamage(
      "subject", subject.enemies[0]!, 5, { aoe: true }, "tower_1"
    );
    damageBoundary(subject).applyResolvedTowerDamage(
      "subject", subject.enemies[1]!, 5, { aoe: true }, "tower_1"
    );

    const packets = resolve.mock.calls.map(([packet]) => packet);
    expect(packets).toHaveLength(2);
    expect(packets.map((packet) => highGroundModifier(packet))).toEqual([
      [{
        id: "elevation:high-ground:damage",
        target: "damage",
        stage: "spatial",
        operation: "additive_ratio",
        value: 0.3
      }],
      [{
        id: "elevation:high-ground:damage",
        target: "damage",
        stage: "spatial",
        operation: "additive_ratio",
        value: 0.1
      }]
    ]);
  });

  it("keeps the tower-id-free pulse DoT adapter on legacy damage", () => {
    const subject = spawnAndFire({ attackKind: "pulse", spawnQ: 3 });
    const resolve = vi.spyOn(DamageResolver, "resolve");

    damageBoundary(subject).applyResolvedTowerDamage(
      "subject", subject.enemies[0]!, 2, { overTime: true }
    );

    expect(resolve).toHaveBeenCalledOnce();
    const packet = resolve.mock.calls[0]![0];
    expect(packet.source).toEqual({ kind: "tower", towerTypeId: "subject" });
    expect(packet.tags).toEqual(["over_time"]);
    expect(highGroundModifier(packet)).toEqual([]);
  });

  it("keeps over-time packets unmodified even when an internal caller supplies a live tower id", () => {
    const subject = spawnAndFire({ attackKind: "pulse", spawnQ: 3 });
    const resolve = vi.spyOn(DamageResolver, "resolve");

    damageBoundary(subject).applyResolvedTowerDamage(
      "subject", subject.enemies[0]!, 2, { overTime: true }, "tower_1"
    );

    expect(resolve).toHaveBeenCalledOnce();
    expect(highGroundModifier(resolve.mock.calls[0]![0])).toEqual([]);
  });

  it("keeps packets from a downed destructible tower on legacy damage", () => {
    const input = acquisitionInput({ spawnQ: 3 });
    input.balance.towers.subject!.maxHp = 10;
    const subject = new TowerDefenseGame({
      content: createGameContentRegistry(input),
      missionId: "high_ground",
      seed: "r3.3-downed-source"
    });
    expect(subject.placeTower("subject", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    subject.towers[0]!.hp = 0;
    const resolve = vi.spyOn(DamageResolver, "resolve");

    damageBoundary(subject).applyResolvedTowerDamage(
      "subject", subject.enemies[0]!, 2, {}, "tower_1"
    );

    expect(resolve).toHaveBeenCalledOnce();
    expect(highGroundModifier(resolve.mock.calls[0]![0])).toEqual([]);
  });

  it("suppresses pulse DoT inside expanded coverage and applies an unmodified tick after leaving it", () => {
    const subject = game({ attackKind: "pulse", spawnQ: 3 });
    expect(subject.placeTower("subject", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    expect(subject.enemies[0]?.hp).toBe(87);
    expect(subject.enemies[0]?.dotRemaining).toBe(2);

    const resolve = vi.spyOn(DamageResolver, "resolve");
    subject.tick(0.5);
    expect(resolve.mock.calls.filter(([packet]) => packet.tags?.includes("over_time"))).toEqual([]);
    expect(subject.enemies[0]?.hp).toBe(87);
    expect(subject.enemies[0]?.dotRemaining).toBe(2);

    subject.towers[0]!.coord = { q: 7, r: 0 };
    subject.tick(0.5);
    const overTimePackets = resolve.mock.calls
      .map(([packet]) => packet)
      .filter((packet) => packet.tags?.includes("over_time"));
    expect(overTimePackets).toHaveLength(1);
    expect(highGroundModifier(overTimePackets[0]!)).toEqual([]);
    expect(subject.enemies[0]?.hp).toBeCloseTo(86.6, 10);
  });

  it("applies one pairwise modifier per actual legacy chain recipient", () => {
    const input = acquisitionInput({ spawnQ: 3, twoLosRoutes: true });
    const attack = input.balance.towers.subject!.attack;
    if (attack.kind !== "single") throw new Error("Expected the chain fixture to use a single attack.");
    attack.chain = { maxJumps: 1, jumpRadius: 3, damageFalloff: 1 };
    (input.maps.field!.elevationOverrides as Array<{ q: number; r: number; elevation: number }>).push({
      q: 3,
      r: 4,
      elevation: 2
    });
    const subject = new TowerDefenseGame({
      content: createGameContentRegistry(input),
      missionId: "high_ground",
      seed: "r3.3-real-chain"
    });
    expect(subject.placeTower("subject", { q: 0, r: 2 })).toEqual({ ok: true });
    expect(subject.startNextWave()).toEqual({ ok: true });
    const resolve = vi.spyOn(DamageResolver, "resolve");

    subject.tick(0);

    const towerPackets = resolve.mock.calls
      .map(([packet]) => packet)
      .filter((packet) => packet.source.kind === "tower" && packet.source.towerId === "tower_1");
    expect(towerPackets).toHaveLength(2);
    expect(towerPackets.map((packet) => highGroundModifier(packet))).toEqual([
      [expect.objectContaining({ id: "elevation:high-ground:damage", value: 0.3 })],
      [expect.objectContaining({ id: "elevation:high-ground:damage", value: 0.1 })]
    ]);
  });

  it("keeps actual ability damage outside the high-ground modifier boundary", () => {
    const subject = game({ spawnQ: 3 });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.tick(0);
    const resolve = vi.spyOn(DamageResolver, "resolve");

    expect(subject.useAbility("strike", { q: 3, r: 2 })).toEqual({ ok: true });

    expect(resolve).toHaveBeenCalledOnce();
    const packet = resolve.mock.calls[0]![0];
    expect(packet.source).toMatchObject({ kind: "ability", abilityId: "strike" });
    expect(highGroundModifier(packet)).toEqual([]);
  });

  it("keeps checkpoint and journal replay deterministic without a high-ground snapshot or event surface", () => {
    const content = createGameContentRegistry(acquisitionInput({ spawnQ: 3 }));
    const continuous = new TowerDefenseGame({
      content,
      missionId: "high_ground",
      seed: "r3.3-high-ground-journal"
    });
    const session = new JournaledGameSession(continuous);
    expect(session.dispatch({
      schemaVersion: 1,
      type: "placeTower",
      towerTypeId: "subject",
      coord: { q: 0, r: 2 }
    })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "startWave" })).toEqual({ ok: true });
    expect(session.dispatch({ schemaVersion: 1, type: "tick", units: 0 })).toEqual({ ok: true });

    const checkpoint = continuous.createCheckpoint();
    const restored = TowerDefenseGame.fromCheckpoint({ content, checkpoint });
    const replay = replayGameCommandJournal({ content, journal: session.exportJournal() });
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(replay.stateDigest).toBe(continuous.getStateDigest());
    expect(replay.game.getSnapshot()).toEqual(continuous.getSnapshot());

    const snapshot = continuous.getSnapshot();
    expect(snapshot).not.toHaveProperty("highGround");
    expect(checkpoint.state).not.toHaveProperty("highGround");
    for (const event of snapshot.lastEvents) {
      expect(event).not.toHaveProperty("highGround");
      expect(event.type).not.toMatch(/high.?ground/i);
    }
  });
});
