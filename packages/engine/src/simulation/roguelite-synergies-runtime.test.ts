import { afterEach, describe, expect, it, vi } from "vitest";
import { createGameContentRegistry, type GameContentInput } from "../content/registry.js";
import { DamageResolver, type DamagePacket, type DamageSourceRef } from "./damage.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { EnemyState } from "./types.js";

type RogueliteMode = "absent" | "disabled" | "unselected" | "active" | "future";

type SynergySnapshot = Readonly<{
  synergyId: string;
  label: string;
  tag: string;
  towerCount: number;
  tierMode: "highest" | "cumulative";
  activeTierRequiredCounts: readonly number[];
}>;

type RogueliteSnapshot = Readonly<{
  schemaVersion: 1;
  synergies: readonly SynergySnapshot[];
}>;

type DamageHarness = {
  applyResolvedTowerDamage(
    towerTypeId: string,
    enemy: EnemyState,
    amount: number,
    options?: { aoe?: boolean; overTime?: boolean; armorPiercing?: boolean; damageType?: string },
    towerId?: string
  ): unknown;
  applyResolvedEnemyDamage(
    enemy: EnemyState,
    amount: number,
    source: DamageSourceRef
  ): unknown;
};

function tier(requiredCount: number, value = 1.1): Record<string, unknown> {
  return {
    requiredCount,
    modifiers: [{ target: "damage", operation: "multiplier", value }]
  };
}

function countingProfile(): Record<string, unknown> {
  return {
    synergies: {
      z_highest: {
        label: "Highest Tech",
        tag: "tech",
        tiers: [tier(1), tier(2), tier(3)]
      },
      a_cumulative: {
        label: "Cumulative Tech",
        tag: "tech",
        tierMode: "cumulative",
        tiers: [tier(1), tier(2), tier(3)]
      }
    }
  };
}

function damageProfile(): Record<string, unknown> {
  return {
    synergies: {
      double_tower_damage: {
        label: "Double tower damage",
        tag: "tech",
        tiers: [tier(1, 2)]
      }
    }
  };
}

function runtimeInput(
  mode: RogueliteMode = "active",
  profile: Record<string, unknown> = countingProfile()
): GameContentInput {
  const pulseTower = {
    id: "pulse",
    label: "Pulse",
    tags: ["tech"],
    cost: { coins: 1 },
    footprintRadius: 0,
    range: 6,
    attack: {
      kind: "pulse" as const,
      pulseRate: 1,
      pulseDamage: 10,
      dotDamagePerUnit: 2,
      dotDuration: 2
    }
  };
  return {
    balance: {
      defaultMissionId: "rogue",
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
        }
      },
      abilities: {},
      enemies: {
        target: {
          id: "target", label: "Target", maxHp: 1_000, speed: 0.001,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        }
      },
      towers: { pulse: pulseTower },
      waveSets: {
        one: [{
          id: "one", label: "One",
          groups: [{ enemyId: "target", count: 1, spawnInterval: 1, startDelay: 0 }]
        }]
      },
      missions: {
        rogue: {
          id: "rogue", label: "Rogue", description: "",
          startingCoreHp: 20, startingResources: { coins: 100 }, prepTimeUnits: 0,
          mapId: "lane", waveSetId: "one", buildTowerIds: ["pulse"], abilityIds: [],
          ...(mode === "unselected" || mode === "absent"
            ? {}
            : { mechanics: { profiles: { roguelite: "core" } } })
        }
      }
    },
    maps: {
      lane: {
        id: "lane", width: 8, height: 4,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: 0 }, coreCoord: { q: 7, r: 0 },
        pathCenterline: Array.from({ length: 8 }, (_, q) => ({ q, r: 0 })),
        pathRoutes: [], terrainOverrides: []
      }
    },
    ...(mode === "absent" ? {} : {
      mechanics: {
        schemaVersion: 1,
        modules: {
          roguelite: {
            schemaVersion: mode === "future" ? 3 : 1,
            enabled: mode !== "disabled",
            profiles: { core: profile }
          }
        }
      }
    }),
    worldMap: {
      width: 10, height: 10,
      regions: [{
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "rogue", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  } as unknown as GameContentInput;
}

function game(mode: RogueliteMode = "active", profile = countingProfile()): TowerDefenseGame {
  return new TowerDefenseGame({
    content: createGameContentRegistry(runtimeInput(mode, profile)),
    missionId: "rogue",
    seed: "r4.1a-synergies"
  });
}

function snapshot(subject: TowerDefenseGame): RogueliteSnapshot | undefined {
  return (subject.getSnapshot() as unknown as { roguelite?: RogueliteSnapshot }).roguelite;
}

function placeTechTowers(subject: TowerDefenseGame, count: number): void {
  const coords = [
    { q: 1, r: 1 },
    { q: 2, r: 1 },
    { q: 3, r: 1 }
  ];
  for (let index = 0; index < count; index += 1) {
    expect(subject.placeTower("pulse", coords[index]!).ok).toBe(true);
  }
}

function runModifiers(packet: DamagePacket): readonly Record<string, unknown>[] {
  return (packet.modifiers ?? [])
    .filter((modifier) => modifier.stage === "run")
    .map((modifier) => ({
      target: modifier.target,
      stage: modifier.stage,
      operation: modifier.operation,
      value: modifier.value
    }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("R4.1A global tower-tag synergy runtime", () => {
  it("counts live placed towers globally and distinguishes highest from cumulative tiers", () => {
    const subject = game();
    placeTechTowers(subject, 3);

    expect(snapshot(subject)).toEqual({
      schemaVersion: 1,
      synergies: [
        {
          synergyId: "a_cumulative",
          label: "Cumulative Tech",
          tag: "tech",
          towerCount: 3,
          tierMode: "cumulative",
          activeTierRequiredCounts: [1, 2, 3]
        },
        {
          synergyId: "z_highest",
          label: "Highest Tech",
          tag: "tech",
          towerCount: 3,
          tierMode: "highest",
          activeTierRequiredCounts: [3]
        }
      ]
    });

    expect(subject.sellTower("tower_3").ok).toBe(true);
    expect(snapshot(subject)?.synergies.map(({ towerCount, activeTierRequiredCounts }) => ({
      towerCount,
      activeTierRequiredCounts
    }))).toEqual([
      { towerCount: 2, activeTierRequiredCounts: [1, 2] },
      { towerCount: 2, activeTierRequiredCounts: [2] }
    ]);
  });

  it("exposes a deeply frozen snapshot section only while the capability is active", () => {
    const subject = game();
    placeTechTowers(subject, 1);
    const active = snapshot(subject);
    expect(active).toBeDefined();
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active?.synergies)).toBe(true);
    expect(Object.isFrozen(active?.synergies[0])).toBe(true);
    expect(Object.isFrozen(active?.synergies[0]?.activeTierRequiredCounts)).toBe(true);

    for (const mode of ["absent", "disabled", "unselected", "future"] as const) {
      const inactive = game(mode);
      placeTechTowers(inactive, 1);
      expect(snapshot(inactive), mode).toBeUndefined();
    }
  });

  it("applies run-stage synergy modifiers to direct and over-time tower packets only", () => {
    const subject = game("active", damageProfile());
    placeTechTowers(subject, 1);
    expect(subject.startNextWave().ok).toBe(true);
    subject.tick(0);
    const target = subject.enemies[0]!;
    expect(target).toBeDefined();

    const resolve = vi.spyOn(DamageResolver, "resolve");
    const harness = subject as unknown as DamageHarness;
    harness.applyResolvedTowerDamage("pulse", target, 10, {}, "tower_1");
    harness.applyResolvedTowerDamage("pulse", target, 2, { overTime: true });
    harness.applyResolvedEnemyDamage(target, 10, { kind: "ability", abilityId: "blast" });
    harness.applyResolvedEnemyDamage(target, 10, { kind: "tower_script", scriptId: "script" });
    harness.applyResolvedEnemyDamage(target, 10, { kind: "status", statusId: "poison" });
    harness.applyResolvedEnemyDamage(target, 10, { kind: "reaction", reactionId: "combustion" });
    harness.applyResolvedEnemyDamage(target, 10, {
      kind: "enemy", enemyId: "enemy_source", enemyTypeId: "target"
    });

    const packets = resolve.mock.calls.map(([packet]) => packet);
    expect(packets).toHaveLength(7);
    expect(packets.slice(0, 2).map(runModifiers)).toEqual([
      [{ target: "damage", stage: "run", operation: "multiplier", value: 2 }],
      [{ target: "damage", stage: "run", operation: "multiplier", value: 2 }]
    ]);
    expect(packets[1]).toMatchObject({
      source: { kind: "tower", towerTypeId: "pulse" },
      tags: ["over_time"]
    });
    expect(packets.slice(2).map(runModifiers)).toEqual([[], [], [], [], []]);
    expect(resolve.mock.results.slice(0, 2).map(({ value }) => (
      value as { afterModifiers: number }
    ).afterModifiers)).toEqual([20, 4]);
    expect(resolve.mock.results.slice(2).map(({ value }) => (
      value as { afterModifiers: number }
    ).afterModifiers)).toEqual([10, 10, 10, 10, 10]);
  });

  it("keeps synergy state derived across checkpoint restore without adding a checkpoint field", () => {
    const subject = game();
    placeTechTowers(subject, 3);
    const before = snapshot(subject);
    const checkpoint = subject.createCheckpoint();

    expect(Object.prototype.hasOwnProperty.call(checkpoint.state, "roguelite")).toBe(false);
    expect(JSON.stringify(checkpoint.state)).not.toContain("roguelite");

    const restored = TowerDefenseGame.fromCheckpoint({ content: subject.content, checkpoint });
    expect(snapshot(restored)).toEqual(before);
    expect(restored.sellTower("tower_3").ok).toBe(true);
    expect(snapshot(restored)?.synergies.map((entry) => entry.towerCount)).toEqual([2, 2]);
  });
});
