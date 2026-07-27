import { describe, expect, it, vi } from "vitest";
import {
  computeCheckpointStateDigest,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCheckpointV1,
  type GameEvent
} from "../index.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GridCoord, TowerState } from "./types.js";

type AttackKind = "single" | "sniper" | "antiair" | "splash" | "pulse" | "pipeline";
type LogisticsMode = "active" | "absent" | "disabled" | "unselected" | "v1" | "null";

interface AmmoBindingFixture {
  readonly ammoTypeId: string;
  readonly capacity: number;
  readonly startingAmount: number;
  readonly consumptionPerActivation: number;
}

interface PowerFixture {
  readonly generators: Record<string, { output: number; linkRadius: number; coverageRadius: number }>;
  readonly relays: Record<string, { linkRadius: number; coverageRadius: number }>;
  readonly consumers: Record<string, { demand: number; priority: number }>;
}

interface FixtureOptions {
  readonly mode?: LogisticsMode;
  readonly inventories?: Record<string, AmmoBindingFixture>;
  readonly power?: PowerFixture | null;
  readonly unboundTowerTypeId?: string;
  readonly groups?: readonly { enemyId: "ground" | "flyer" | "saboteur"; count?: number }[];
  readonly width?: number;
  readonly height?: number;
  readonly startingCoins?: number;
}

interface AmmunitionRowV1 {
  readonly towerId: string;
  readonly towerTypeId: string;
  readonly ammoTypeId: string;
  readonly amount: number;
  readonly capacity: number;
  readonly consumptionPerActivation: number;
  readonly hasRequiredAmmo: boolean;
}

interface LogisticsSnapshotV2Fixture {
  readonly schemaVersion: 2;
  readonly power: {
    readonly components: readonly {
      readonly id: string;
      readonly output: number;
      readonly demand: number;
      readonly allocated: number;
    }[];
    readonly nodes: readonly { readonly towerId: string }[];
    readonly consumers: readonly {
      readonly towerId: string;
      readonly demand: number;
      readonly powered: boolean;
    }[];
  } | null;
  readonly ammunition: {
    readonly inventories: readonly AmmunitionRowV1[];
  } | null;
}

interface LogisticsCheckpointFixture {
  schemaVersion: 1;
  ammunition: {
    inventories: Array<{ towerId: string; amount: number }>;
  };
}

type MutableCheckpoint = Omit<GameCheckpointV1, "state"> & {
  state: GameCheckpointV1["state"] & {
    towers: TowerState[];
    logistics?: LogisticsCheckpointFixture;
    [key: string]: unknown;
  };
};

const DEFAULT_INVENTORIES: Record<string, AmmoBindingFixture> = {
  single: { ammoTypeId: "shell", capacity: 8, startingAmount: 3, consumptionPerActivation: 1 },
  sniper: { ammoTypeId: "shell", capacity: 8, startingAmount: 3, consumptionPerActivation: 1 },
  antiair: { ammoTypeId: "shell", capacity: 8, startingAmount: 3, consumptionPerActivation: 1 },
  splash: { ammoTypeId: "shell", capacity: 8, startingAmount: 3, consumptionPerActivation: 1 },
  pulse: { ammoTypeId: "charge", capacity: 8, startingAmount: 3, consumptionPerActivation: 1 },
  pipeline: { ammoTypeId: "charge", capacity: 8, startingAmount: 3, consumptionPerActivation: 1 }
};

const NO_POWER: PowerFixture = Object.freeze({ generators: {}, relays: {}, consumers: {} });

function singleAttack(damage = 3, chain = false): Record<string, unknown> {
  return {
    kind: "single",
    fireRate: 4,
    damagePerStack: damage,
    startingStacks: 1,
    maxStacks: 3,
    upgradeCost: 1,
    ...(chain ? { chain: { maxJumps: 2, jumpRadius: 5, damageFalloff: 0.5 } } : {})
  };
}

function attack(kind: AttackKind): Record<string, unknown> {
  if (kind === "single") return singleAttack();
  if (kind === "sniper") return { kind, interval: 0.25, damage: 3, targetPriority: "first" };
  if (kind === "antiair") {
    return { kind, fireRate: 4, damage: 3, maxTargetsByLevel: [3, 3, 3, 3], upgradeCosts: [] };
  }
  if (kind === "splash") {
    return {
      kind,
      interval: 0.25,
      damage: 3,
      splashDamage: 1,
      armoredChipDamage: 0,
      splashRadius: 5,
      slowFactor: 0.5,
      slowDuration: 1
    };
  }
  if (kind === "pulse") {
    return { kind, pulseRate: 4, pulseDamage: 3, dotDamagePerUnit: 2, dotDuration: 2 };
  }
  return {
    kind: "pipeline",
    interval: 0.25,
    targeting: { classes: ["ground"], mode: "first", maxTargets: 1 },
    delivery: { kind: "area", radius: 5, secondaryMultiplier: 0.5 },
    effects: [
      { kind: "damage", amount: 3 },
      { kind: "status", status: { poison: { dps: 1, duration: 2 } } },
      { kind: "resource", resources: { coins: 7 } },
      { kind: "displacement", mode: "push", distance: 1, stopAtBlocker: true }
    ]
  };
}

function tower(id: string, towerAttack: Record<string, unknown>, maxHp?: number): Record<string, unknown> {
  return {
    id,
    label: id,
    cost: { coins: 1 },
    footprintRadius: 0,
    range: 40,
    ...(maxHp === undefined ? {} : { maxHp }),
    attack: towerAttack
  };
}

function fixtureInput(options: FixtureOptions = {}): GameContentInput {
  const mode = options.mode ?? "active";
  const width = options.width ?? 24;
  const height = options.height ?? 12;
  const pathRow = height - 1;
  const startingCoins = options.startingCoins ?? 100_000;
  const inventories = options.inventories ?? DEFAULT_INVENTORIES;
  const power = options.power === undefined ? null : options.power;
  const groups = options.groups ?? [{ enemyId: "ground" as const }];

  const modules: Record<string, unknown> = {
    physics: {
      schemaVersion: 1,
      enabled: true,
      profiles: {
        motion: {
          displacementImmuneEnemyTypeIds: [],
          fallImmuneEnemyTypeIds: [],
          fallHazardTerrainTags: ["fall_hazard"]
        }
      }
    }
  };
  if (mode !== "absent") {
    modules.logistics = mode === "v1"
      ? { schemaVersion: 1, enabled: true, profiles: { grid: { power: power ?? NO_POWER } } }
      : {
          schemaVersion: 2,
          enabled: mode !== "disabled",
          profiles: {
            grid: {
              power,
              ammunition: mode === "null"
                ? null
                : {
                    types: {
                      shell: { label: "Shell" },
                      charge: { label: "Charge" }
                    },
                    towerInventories: inventories
                  }
            }
          }
        };
  }
  const mechanicsProfiles = {
    physics: "motion",
    ...(mode === "absent" || mode === "unselected" ? {} : { logistics: "grid" })
  };
  const towers: Record<string, unknown> = {
    single: tower("single", attack("single"), 10),
    single_chain: tower("single_chain", singleAttack(3, true)),
    sniper: tower("sniper", attack("sniper")),
    antiair: tower("antiair", attack("antiair")),
    splash: tower("splash", attack("splash")),
    pulse: tower("pulse", attack("pulse")),
    pipeline: tower("pipeline", attack("pipeline")),
    generator_attack: tower("generator_attack", attack("single")),
    relay_attack: tower("relay_attack", attack("single")),
    powered_attack: tower("powered_attack", attack("single")),
    legacy: tower("legacy", attack("single"))
  };
  if (options.unboundTowerTypeId !== undefined) {
    Object.defineProperty(towers, options.unboundTowerTypeId, {
      configurable: true,
      enumerable: true,
      value: tower(options.unboundTowerTypeId, attack("single")),
      writable: true
    });
  }

  return {
    balance: {
      defaultMissionId: "ammo",
      constants: {
        timeUnitSeconds: 1,
        startingCoreHp: 100,
        startingCoins,
        startingResources: { coins: startingCoins },
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
          id: "floor",
          label: "Floor",
          buildable: true,
          walkable: true,
          groundSpeedMultiplier: 1,
          tags: []
        }
      },
      abilities: {},
      enemies: {
        ground: {
          id: "ground",
          label: "Ground",
          maxHp: 10_000,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 1
        },
        flyer: {
          id: "flyer",
          label: "Flyer",
          maxHp: 10_000,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 2,
          targetClass: "flying",
          movementKind: "direct_flying"
        },
        saboteur: {
          id: "saboteur",
          label: "Saboteur",
          maxHp: 10_000,
          speed: 0.01,
          reward: { coins: 1 },
          coinReward: 1,
          coreDamage: 1,
          color: 3,
          towerAttack: { interval: 0.01, damage: 100, range: 4 }
        }
      },
      towers: towers as GameContentInput["balance"]["towers"],
      waveSets: {
        one: [{
          id: "wave",
          label: "Wave",
          groups: groups.map((group) => ({
            enemyId: group.enemyId,
            count: group.count ?? 1,
            spawnInterval: 0,
            startDelay: 0,
            routeId: "main"
          }))
        }]
      },
      missions: {
        ammo: {
          id: "ammo",
          label: "Ammo",
          description: "",
          startingCoreHp: 100,
          startingResources: { coins: startingCoins },
          prepTimeUnits: 0,
          mapId: "grid",
          waveSetId: "one",
          buildTowerIds: Object.keys(towers),
          abilityIds: [],
          mechanics: { profiles: mechanicsProfiles }
        }
      }
    },
    maps: {
      grid: {
        id: "grid",
        width,
        height,
        grid: { kind: "square", adjacency: "cardinal" },
        defaultTerrain: "floor",
        spawnCoord: { q: 0, r: pathRow },
        coreCoord: { q: width - 1, r: pathRow },
        pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: pathRow })),
        pathRoutes: [{
          id: "main",
          pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: pathRow }))
        }],
        terrainOverrides: []
      }
    },
    mechanics: { schemaVersion: 1, modules } as unknown as GameContentInput["mechanics"],
    worldMap: {
      width: 10,
      height: 10,
      regions: [{
        id: "region",
        label: "Region",
        description: "",
        biome: "test",
        accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        connections: []
      }],
      missionNodes: [{
        missionId: "ammo",
        regionId: "region",
        x: 5,
        y: 5,
        difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(fixtureInput(options));
}

function game(options: FixtureOptions = {}, seed = "ammo-runtime"): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "ammo", seed });
}

function place(subject: TowerDefenseGame, typeId: string, coord: GridCoord): string {
  expect(subject.placeTower(typeId, coord)).toEqual({ ok: true });
  return subject.towers.at(-1)!.id;
}

function spawn(subject: TowerDefenseGame): void {
  expect(subject.startNextWave()).toEqual({ ok: true });
  subject.tick(0);
  expect(subject.enemies.length).toBeGreaterThan(0);
}

function logistics(subject: TowerDefenseGame): LogisticsSnapshotV2Fixture | undefined {
  return (subject.getSnapshot() as unknown as { logistics?: LogisticsSnapshotV2Fixture }).logistics;
}

function ammoRows(subject: TowerDefenseGame): readonly AmmunitionRowV1[] | undefined {
  return logistics(subject)?.ammunition?.inventories;
}

function ammoRow(subject: TowerDefenseGame, towerId: string): AmmunitionRowV1 | undefined {
  return ammoRows(subject)?.find((row) => row.towerId === towerId);
}

function firedBy(subject: TowerDefenseGame, towerId: string): GameEvent[] {
  return subject.lastEvents.filter((event) =>
    (event.type === "towerFired" || event.type === "areaPulse") && event.towerId === towerId
  );
}

function mutableCheckpoint(checkpoint: GameCheckpointV1): MutableCheckpoint {
  return structuredClone(checkpoint) as unknown as MutableCheckpoint;
}

function resign(checkpoint: MutableCheckpoint): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

function seedAmmunitionCheckpoint(
  checkpoint: MutableCheckpoint,
  inventories: Array<{ towerId: string; amount: number }>
): void {
  checkpoint.state.logistics = {
    schemaVersion: 1,
    ammunition: { inventories: inventories.map((row) => ({ ...row })) }
  };
}

function restore(subjectContent: GameContentRegistry, checkpoint: GameCheckpointV1): TowerDefenseGame {
  return TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
}

function binding(
  typeId: string,
  startingAmount: number,
  consumptionPerActivation = 1,
  capacity = Math.max(startingAmount, consumptionPerActivation, 1)
): Record<string, AmmoBindingFixture> {
  return {
    [typeId]: { ammoTypeId: "shell", capacity, startingAmount, consumptionPerActivation }
  };
}

describe("R5.8A local ammunition activation contract", () => {
  it.each(["absent", "disabled", "unselected", "v1", "null"] as const)(
    "keeps %s Logistics on the literal infinite-ammunition branch",
    (mode) => {
      const subject = game({ mode, inventories: binding("single", 0) });
      const towerId = place(subject, "single", { q: 2, r: 9 });

      spawn(subject);

      expect(firedBy(subject, towerId).length).toBeGreaterThan(0);
      expect(ammoRows(subject)).toBeUndefined();
      expect(subject.createCheckpoint().state).not.toHaveProperty("logistics");
    }
  );

  it.each([
    ["single", "ground"],
    ["sniper", "ground"],
    ["antiair", "flyer"],
    ["splash", "ground"],
    ["pulse", "ground"],
    ["pipeline", "ground"]
  ] as const)("spends once for one successful %s activation", (kind, enemyId) => {
    const subject = game({ inventories: binding(kind, 2), groups: [{ enemyId }] });
    const towerId = place(subject, kind, { q: 2, r: 9 });

    spawn(subject);

    expect(firedBy(subject, towerId).length).toBeGreaterThan(0);
    expect(ammoRow(subject, towerId)).toMatchObject({
      towerId,
      towerTypeId: kind,
      ammoTypeId: "shell",
      amount: 1,
      capacity: 2,
      consumptionPerActivation: 1,
      hasRequiredAmmo: true
    });
  });

  it("charges one round for a primary single shot while all chain hops are free", () => {
    const subject = game({
      inventories: binding("single_chain", 2),
      groups: [{ enemyId: "ground", count: 3 }]
    });
    const towerId = place(subject, "single_chain", { q: 2, r: 9 });

    spawn(subject);

    expect(firedBy(subject, towerId)).toHaveLength(3);
    expect(ammoRow(subject, towerId)?.amount).toBe(1);
  });

  it("charges one round for splash damage across every affected target", () => {
    const subject = game({ inventories: binding("splash", 2), groups: [{ enemyId: "ground", count: 3 }] });
    const towerId = place(subject, "splash", { q: 2, r: 9 });

    spawn(subject);

    expect(subject.enemies.filter((enemy) => enemy.hp < enemy.maxHp)).toHaveLength(3);
    expect(ammoRow(subject, towerId)?.amount).toBe(1);
  });

  it("charges one round for an antiair volley with several targets", () => {
    const subject = game({ inventories: binding("antiair", 2), groups: [{ enemyId: "flyer", count: 3 }] });
    const towerId = place(subject, "antiair", { q: 2, r: 9 });

    spawn(subject);

    expect(firedBy(subject, towerId)).toHaveLength(3);
    expect(ammoRow(subject, towerId)?.amount).toBe(1);
  });

  it("charges one round for a pipeline activation, never for delivery targets or effects", () => {
    const subject = game({ inventories: binding("pipeline", 2), groups: [{ enemyId: "ground", count: 3 }] });
    const towerId = place(subject, "pipeline", { q: 2, r: 9 });
    const coinsAfterPlacement = subject.resources.coins;

    spawn(subject);

    expect(firedBy(subject, towerId)).toHaveLength(3);
    expect(subject.resources.coins).toBe(coinsAfterPlacement! + 21);
    expect(ammoRow(subject, towerId)?.amount).toBe(1);
  });

  it("does not spend when target selection finds no target and retains legacy no-target cooldown", () => {
    const subject = game({ inventories: binding("single", 2) });
    const towerId = place(subject, "single", { q: 2, r: 2 });
    subject.towers[0]!.cooldown = -0.25;

    subject.tick(0.5);

    expect(subject.towers[0]!.cooldown).toBe(0);
    expect(ammoRow(subject, towerId)?.amount).toBe(2);
    expect(firedBy(subject, towerId)).toEqual([]);
  });

  it("rechecks and spends each catch-up activation, then freezes at exact exhaustion", () => {
    const subject = game({ inventories: binding("single", 2) });
    const towerId = place(subject, "single", { q: 2, r: 9 });
    expect(subject.startNextWave()).toEqual({ ok: true });
    subject.towers[0]!.cooldown = -0.6;

    subject.tick(0);

    expect(firedBy(subject, towerId)).toHaveLength(2);
    expect(subject.towers[0]!.cooldown).toBeCloseTo(-0.1, 12);
    expect(ammoRow(subject, towerId)).toMatchObject({ amount: 0, hasRequiredAmmo: false });
  });

  it.each([
    ["single", "ground", "selectTargets"],
    ["sniper", "ground", "selectTargets"],
    ["antiair", "flyer", "selectTargets"],
    ["splash", "ground", "selectTargets"],
    ["pulse", "ground", "enemyInTowerAcquisitionRange"],
    ["pipeline", "ground", "pipelineTargets"]
  ] as const)(
    "stops exhausted %s catch-up before a second target acquisition",
    (kind, enemyId, acquisitionMethod) => {
      const subject = game({ inventories: binding(kind, 1), groups: [{ enemyId }] });
      const towerId = place(subject, kind, { q: 2, r: 9 });
      expect(subject.startNextWave()).toEqual({ ok: true });
      subject.towers[0]!.cooldown = -0.6;
      const acquire = vi.spyOn(
        subject as unknown as Record<typeof acquisitionMethod, (...args: unknown[]) => unknown>,
        acquisitionMethod
      );

      subject.tick(0);

      expect(acquire).toHaveBeenCalledTimes(1);
      expect(firedBy(subject, towerId)).toHaveLength(1);
      expect(ammoRow(subject, towerId)).toMatchObject({ amount: 0, hasRequiredAmmo: false });
      expect(subject.towers[0]!.cooldown).toBeCloseTo(-0.35, 12);
    }
  );

  it("freezes an exact positive cooldown before target acquisition while depleted", () => {
    const subject = game({ inventories: binding("single", 0) });
    const towerId = place(subject, "single", { q: 2, r: 9 });
    subject.towers[0]!.cooldown = 0.75;
    const selectTargets = vi.spyOn(subject as unknown as { selectTargets: (...args: unknown[]) => unknown }, "selectTargets");

    spawn(subject);
    subject.tick(0.2);

    expect(subject.towers[0]!.cooldown).toBe(0.75);
    expect(selectTargets).not.toHaveBeenCalled();
    expect(firedBy(subject, towerId)).toEqual([]);
  });

  it.each([0, -0.125])("freezes an exact ready cooldown %s while depleted", (cooldown) => {
    const subject = game({ inventories: binding("single", 0) });
    const towerId = place(subject, "single", { q: 2, r: 9 });
    subject.towers[0]!.cooldown = cooldown;

    spawn(subject);

    expect(subject.towers[0]!.cooldown).toBe(cooldown);
    expect(firedBy(subject, towerId)).toEqual([]);
    expect(ammoRow(subject, towerId)).toMatchObject({ amount: 0, hasRequiredAmmo: false });
  });

  it("blocks every pipeline event, effect, resource, status, and displacement while depleted", () => {
    const subject = game({ inventories: binding("pipeline", 0) });
    const towerId = place(subject, "pipeline", { q: 0, r: 9 });
    const applyDisplacement = vi.spyOn(
      subject as unknown as { applyDisplacementEffect: (...args: unknown[]) => unknown },
      "applyDisplacementEffect"
    );
    const coins = subject.resources.coins;
    spawn(subject);
    const enemy = subject.enemies[0]!;

    expect(enemy.hp).toBe(enemy.maxHp);
    expect(enemy.statuses).toEqual({});
    expect(applyDisplacement).not.toHaveBeenCalled();
    expect(subject.resources.coins).toBe(coins);
    expect(subject.lastEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "towerFired", towerId }),
      expect.objectContaining({ type: "towerResourcesGranted", towerId }),
      expect.objectContaining({ type: "enemyDisplacementResolved" })
    ]));
  });
});

describe("R5.8A literal infinite-ammunition branch", () => {
  it.each(["constructor", "toString"])(
    "keeps the legal unbound prototype-key tower type %s fully legacy while another tower consumes ammunition",
    (towerTypeId) => {
      const subject = game({
        inventories: binding("single", 2),
        unboundTowerTypeId: towerTypeId
      }, `unbound-prototype-${towerTypeId}`);
      const towerId = place(subject, towerTypeId, { q: 2, r: 9 });

      expect(
        (subject as unknown as { logisticsAmmunitionAmounts: Map<string, number> })
          .logisticsAmmunitionAmounts.has(towerId)
      ).toBe(false);
      expect(ammoRows(subject)).toEqual([]);
      expect((subject.createCheckpoint().state as MutableCheckpoint["state"]).logistics).toEqual({
        schemaVersion: 1,
        ammunition: { inventories: [] }
      });

      spawn(subject);

      expect(firedBy(subject, towerId).length).toBeGreaterThan(0);
      expect(ammoRows(subject)).toEqual([]);
      expect((subject.createCheckpoint().state as MutableCheckpoint["state"]).logistics).toEqual({
        schemaVersion: 1,
        ammunition: { inventories: [] }
      });
    }
  );

  it.each([
    ["absent", "single", "ground"],
    ["absent", "sniper", "ground"],
    ["absent", "antiair", "flyer"],
    ["absent", "splash", "ground"],
    ["absent", "pulse", "ground"],
    ["absent", "pipeline", "ground"],
    ["v1", "single", "ground"],
    ["v1", "sniper", "ground"],
    ["v1", "antiair", "flyer"],
    ["v1", "splash", "ground"],
    ["v1", "pulse", "ground"],
    ["v1", "pipeline", "ground"],
    ["null", "single", "ground"],
    ["null", "sniper", "ground"],
    ["null", "antiair", "flyer"],
    ["null", "splash", "ground"],
    ["null", "pulse", "ground"],
    ["null", "pipeline", "ground"]
  ] as const)(
    "does not execute either ammunition helper for %s Logistics %s attacks",
    (mode, kind, enemyId) => {
      const subject = game({ mode, groups: [{ enemyId }] });
      const towerId = place(subject, kind, { q: 2, r: 9 });
      const ammunitionGate = vi.spyOn(
        subject as unknown as { towerHasRequiredAmmunition: (...args: unknown[]) => boolean },
        "towerHasRequiredAmmunition"
      );
      const ammunitionSpend = vi.spyOn(
        subject as unknown as { consumeTowerAmmunition: (...args: unknown[]) => boolean },
        "consumeTowerAmmunition"
      );

      spawn(subject);

      expect(firedBy(subject, towerId).length).toBeGreaterThan(0);
      expect(ammunitionGate).not.toHaveBeenCalled();
      expect(ammunitionSpend).not.toHaveBeenCalled();
    }
  );

  it.each(["absent", "v1", "null"] as const)(
    "keeps the %s pulse field on a literal branch without ammunition-gate overhead",
    (mode) => {
      const subject = game({ mode, groups: [{ enemyId: "ground" }] });
      place(subject, "pulse", { q: 2, r: 9 });
      const ammunitionGate = vi.spyOn(
        subject as unknown as { towerHasRequiredAmmunition: (...args: unknown[]) => boolean },
        "towerHasRequiredAmmunition"
      );
      const pulseField = vi.spyOn(
        subject as unknown as { logisticsPulseFieldActive: (...args: unknown[]) => boolean },
        "logisticsPulseFieldActive"
      );

      spawn(subject);
      subject.tick(0.1);

      expect(pulseField).toHaveBeenCalled();
      expect(ammunitionGate).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["single", "ground"],
    ["sniper", "ground"],
    ["antiair", "flyer"],
    ["splash", "ground"],
    ["pulse", "ground"],
    ["pipeline", "ground"]
  ] as const)("executes both ammunition helpers for an active v2 %s attack", (kind, enemyId) => {
    const subject = game({ inventories: binding(kind, 1), groups: [{ enemyId }] });
    const towerId = place(subject, kind, { q: 2, r: 9 });
    const ammunitionGate = vi.spyOn(
      subject as unknown as { towerHasRequiredAmmunition: (...args: unknown[]) => boolean },
      "towerHasRequiredAmmunition"
    );
    const ammunitionSpend = vi.spyOn(
      subject as unknown as { consumeTowerAmmunition: (...args: unknown[]) => boolean },
      "consumeTowerAmmunition"
    );

    spawn(subject);

    expect(firedBy(subject, towerId).length).toBeGreaterThan(0);
    expect(ammunitionGate).toHaveBeenCalled();
    expect(ammunitionSpend).toHaveBeenCalled();
  });
});

describe("R5.8A power and ammunition interaction", () => {
  it.each([
    ["unpowered with ammo", false, 2, false, 2],
    ["powered but depleted", true, 0, false, 0],
    ["unpowered and depleted", false, 0, false, 0],
    ["powered with ammo", true, 2, true, 1]
  ] as const)("applies the independent gates: %s", (_label, powered, startingAmount, shouldFire, expectedAmount) => {
    const power: PowerFixture = {
      generators: { generator_attack: { output: 5, linkRadius: 0, coverageRadius: 10 } },
      relays: {},
      consumers: { powered_attack: { demand: 5, priority: 1 } }
    };
    const subject = game({ inventories: binding("powered_attack", startingAmount), power });
    if (powered) place(subject, "generator_attack", { q: 1, r: 7 });
    const towerId = place(subject, "powered_attack", { q: 2, r: 9 });

    spawn(subject);

    expect(firedBy(subject, towerId).length > 0).toBe(shouldFire);
    expect(ammoRow(subject, towerId)?.amount).toBe(expectedAmount);
  });

  it("keeps a depleted attacking generator in the power graph while gating only its attack", () => {
    const power: PowerFixture = {
      generators: { generator_attack: { output: 5, linkRadius: 0, coverageRadius: 10 } },
      relays: {},
      consumers: { powered_attack: { demand: 5, priority: 1 } }
    };
    const subject = game({ inventories: binding("generator_attack", 0), power });
    const generatorId = place(subject, "generator_attack", { q: 1, r: 7 });
    const consumerId = place(subject, "powered_attack", { q: 2, r: 9 });

    spawn(subject);

    expect(logistics(subject)?.power?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ towerId: generatorId })
    ]));
    expect(logistics(subject)?.power?.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ towerId: consumerId, powered: true })
    ]));
    expect(firedBy(subject, generatorId)).toEqual([]);
    expect(firedBy(subject, consumerId).length).toBeGreaterThan(0);
  });

  it("keeps a depleted attacking relay connected and supplying coverage while gating only its attack", () => {
    const power: PowerFixture = {
      generators: { generator_attack: { output: 5, linkRadius: 4, coverageRadius: 0 } },
      relays: { relay_attack: { linkRadius: 4, coverageRadius: 10 } },
      consumers: { powered_attack: { demand: 5, priority: 1 } }
    };
    const subject = game({ inventories: binding("relay_attack", 0), power });
    place(subject, "generator_attack", { q: 1, r: 7 });
    const relayId = place(subject, "relay_attack", { q: 5, r: 7 });
    const consumerId = place(subject, "powered_attack", { q: 8, r: 9 });

    spawn(subject);

    expect(logistics(subject)?.power?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ towerId: relayId })
    ]));
    expect(logistics(subject)?.power?.consumers).toEqual(expect.arrayContaining([
      expect.objectContaining({ towerId: consumerId, powered: true })
    ]));
    expect(firedBy(subject, relayId)).toEqual([]);
  });

  it("does not remove a depleted consumer demand from allocation", () => {
    const power: PowerFixture = {
      generators: { generator_attack: { output: 5, linkRadius: 0, coverageRadius: 10 } },
      relays: {},
      consumers: { powered_attack: { demand: 5, priority: 1 } }
    };
    const subject = game({ inventories: binding("powered_attack", 0), power });
    place(subject, "generator_attack", { q: 1, r: 7 });
    const consumerId = place(subject, "powered_attack", { q: 2, r: 9 });

    const snapshot = logistics(subject)!;

    expect(snapshot.power?.components[0]).toMatchObject({ demand: 5, allocated: 5 });
    expect(snapshot.power?.consumers[0]).toMatchObject({ towerId: consumerId, demand: 5, powered: true });
    expect(ammoRow(subject, consumerId)).toMatchObject({ amount: 0, hasRequiredAmmo: false });
  });

  it("lets an existing pulse DoT decay normally after ammunition exhaustion", () => {
    const subject = game({ inventories: binding("pulse", 1) });
    const towerId = place(subject, "pulse", { q: 2, r: 9 });
    spawn(subject);
    const enemy = subject.enemies[0]!;
    const pulse = subject.towers[0]!;
    const hp = enemy.hp;
    const cooldown = pulse.cooldown;

    expect(ammoRow(subject, towerId)?.amount).toBe(0);
    expect(enemy.dotRemaining).toBe(2);
    subject.tick(0.2);

    expect(enemy.dotRemaining).toBeCloseTo(1.8, 12);
    expect(enemy.hp).toBeCloseTo(hp - 0.4, 12);
    expect(pulse.cooldown).toBe(cooldown);
    expect(subject.lastEvents.some((event) => event.type === "areaPulse")).toBe(false);
  });
});

describe("R5.8A ammunition inventory lifecycle and bound", () => {
  it("creates one authoritative inventory at placement with the authored starting amount", () => {
    const subject = game({ inventories: binding("single", 2, 1, 5) });
    const towerId = place(subject, "single", { q: 2, r: 2 });

    expect(ammoRows(subject)).toEqual([{
      towerId,
      towerTypeId: "single",
      ammoTypeId: "shell",
      amount: 2,
      capacity: 5,
      consumptionPerActivation: 1,
      hasRequiredAmmo: true
    }]);
  });

  it("retains the exact spent amount across move and upgrade without resizing or refill", () => {
    const subject = game({ inventories: binding("single", 3, 1, 8) });
    const towerId = place(subject, "single", { q: 2, r: 9 });
    spawn(subject);
    expect(ammoRow(subject, towerId)?.amount).toBe(2);

    expect(subject.moveTower(towerId, { q: 6, r: 4 })).toEqual({ ok: true });
    expect(subject.upgradeTower(towerId)).toEqual({ ok: true });

    expect(ammoRow(subject, towerId)).toMatchObject({ amount: 2, capacity: 8 });
  });

  it("removes an inventory on sell without refund or drop", () => {
    const subject = game({ inventories: binding("single", 2) });
    const towerId = place(subject, "single", { q: 2, r: 2 });
    const resourcesBefore = structuredClone(subject.resources);

    expect(subject.sellTower(towerId)).toEqual({ ok: true });

    expect(ammoRows(subject)).toEqual([]);
    expect(Object.keys(subject.resources)).toEqual(Object.keys(resourcesBefore));
  });

  it("removes an inventory when an enemy destroys its durable tower", () => {
    const subject = game({ inventories: binding("single", 2), groups: [{ enemyId: "saboteur" }] });
    const towerId = place(subject, "single", { q: 0, r: 9 });

    spawn(subject);
    subject.tick(0.02);

    expect(subject.towers.some((tower) => tower.id === towerId)).toBe(false);
    expect(subject.lastEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "towerDestroyed", towerId })
    ]));
    expect(ammoRows(subject)).toEqual([]);
  });

  it("treats hp=0 checkpoint towers as downed and excludes their inventory", () => {
    const subjectContent = content({ inventories: binding("single", 2) });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "ammo", seed: "downed-ammo" });
    const towerId = place(subject, "single", { q: 2, r: 2 });
    const checkpoint = mutableCheckpoint(subject.createCheckpoint());
    checkpoint.state.towers[0]!.hp = 0;
    seedAmmunitionCheckpoint(checkpoint, []);
    resign(checkpoint);

    const restored = restore(subjectContent, checkpoint as GameCheckpointV1);

    expect(restored.towers.find((tower) => tower.id === towerId)?.hp).toBe(0);
    expect(ammoRows(restored)).toEqual([]);
  });

  it("reset removes all inventories and a new placement starts from authored amount", () => {
    const subject = game({ inventories: binding("single", 2) });
    const first = place(subject, "single", { q: 2, r: 2 });
    expect(ammoRow(subject, first)?.amount).toBe(2);

    subject.reset();
    expect(ammoRows(subject)).toEqual([]);
    const second = place(subject, "single", { q: 3, r: 2 });

    expect(second).toBe("tower_1");
    expect(ammoRow(subject, second)?.amount).toBe(2);
  });

  it("keeps inventory state unchanged after a failed placement", () => {
    const subject = game({ inventories: binding("single", 2) });
    place(subject, "single", { q: 2, r: 2 });
    const before = structuredClone(ammoRows(subject));
    const towerCounter = subject.createCheckpoint().state.towerCounter;

    expect(subject.placeTower("single", { q: 2, r: 2 }).ok).toBe(false);

    expect(ammoRows(subject)).toEqual(before);
    expect(subject.createCheckpoint().state.towerCounter).toBe(towerCounter);
  });

  it("accepts exactly 4096 live inventories and rejects the 4097th transactionally", { timeout: 30_000 }, () => {
    const subject = game({
      inventories: binding("single", 2),
      width: 65,
      height: 65,
      startingCoins: 10_000
    }, "ammo-live-bound");
    const coords = Array.from({ length: 4_097 }, (_, index) => ({
      q: index % 65,
      r: Math.floor(index / 65)
    }));
    for (const coord of coords.slice(0, 4_096)) {
      expect(subject.placeTower("single", coord)).toEqual({ ok: true });
    }
    const before = subject.createCheckpoint();

    const rejected = subject.placeTower("single", coords[4_096]!);

    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/ammunition|inventory|4096|limit|budget/i);
    expect(subject.createCheckpoint()).toEqual(before);
    expect(ammoRows(subject)).toHaveLength(4_096);
  });
});

describe("R5.8A nested Logistics checkpoint contract", () => {
  it("requires the nested state for active ammunition even when no tower is placed", () => {
    const subjectContent = content({ inventories: binding("single", 2) });
    const checkpoint = new TowerDefenseGame({
      content: subjectContent,
      missionId: "ammo",
      seed: "required-empty"
    }).createCheckpoint();

    expect((checkpoint.state as MutableCheckpoint["state"]).logistics).toEqual({
      schemaVersion: 1,
      ammunition: { inventories: [] }
    });
    const missing = mutableCheckpoint(checkpoint);
    delete missing.state.logistics;
    resign(missing);
    expect(() => restore(subjectContent, missing as GameCheckpointV1)).toThrow(/logistics|ammunition|required/i);
  });

  it.each(["absent", "v1", "null"] as const)("forbids nested ammunition state for %s Logistics", (mode) => {
    const subjectContent = content({ mode });
    const checkpoint = new TowerDefenseGame({ content: subjectContent, missionId: "ammo", seed: `forbidden-${mode}` })
      .createCheckpoint();

    expect(checkpoint.state).not.toHaveProperty("logistics");
    const forged = mutableCheckpoint(checkpoint);
    forged.state.logistics = { schemaVersion: 1, ammunition: { inventories: [] } };
    resign(forged);
    expect(() => restore(subjectContent, forged as GameCheckpointV1)).toThrow(/logistics|ammunition|checkpoint|field/i);
  });

  it("publishes exactly one binary-sorted checkpoint row for each live ammo-bound tower", () => {
    const subject = game({ inventories: binding("single", 3) });
    for (let index = 0; index < 10; index += 1) place(subject, "single", { q: index, r: 2 });

    expect((subject.createCheckpoint().state as MutableCheckpoint["state"]).logistics).toEqual({
      schemaVersion: 1,
      ammunition: {
        inventories: ["tower_1", "tower_10", "tower_2", "tower_3", "tower_4", "tower_5", "tower_6", "tower_7", "tower_8", "tower_9"]
          .map((towerId) => ({ towerId, amount: 3 }))
      }
    });
  });

  it.each([
    ["unknown logistics field", (state: MutableCheckpoint["state"]) => {
      (state.logistics as unknown as Record<string, unknown>).extra = true;
    }],
    ["wrong logistics schema", (state: MutableCheckpoint["state"]) => {
      (state.logistics as unknown as { schemaVersion: number }).schemaVersion = 2;
    }],
    ["unknown ammunition field", (state: MutableCheckpoint["state"]) => {
      (state.logistics!.ammunition as unknown as Record<string, unknown>).extra = true;
    }],
    ["unknown row field", (state: MutableCheckpoint["state"]) => {
      (state.logistics!.ammunition.inventories[0] as unknown as Record<string, unknown>).extra = true;
    }],
    ["missing row field", (state: MutableCheckpoint["state"]) => {
      delete (state.logistics!.ammunition.inventories[0] as unknown as Record<string, unknown>).amount;
    }],
    ["duplicate row", (state: MutableCheckpoint["state"]) => {
      state.logistics!.ammunition.inventories.push({ ...state.logistics!.ammunition.inventories[0]! });
    }],
    ["missing row", (state: MutableCheckpoint["state"]) => { state.logistics!.ammunition.inventories = []; }],
    ["unknown tower", (state: MutableCheckpoint["state"]) => {
      state.logistics!.ammunition.inventories[0]!.towerId = "tower_unknown";
    }],
    ["extra legacy tower row", (state: MutableCheckpoint["state"]) => {
      state.logistics!.ammunition.inventories.push({ towerId: "tower_3", amount: 0 });
    }],
    ["noncanonical order", (state: MutableCheckpoint["state"]) => {
      state.logistics!.ammunition.inventories.reverse();
    }],
    ["negative amount", (state: MutableCheckpoint["state"]) => {
      state.logistics!.ammunition.inventories[0]!.amount = -1;
    }],
    ["unsafe amount", (state: MutableCheckpoint["state"]) => {
      state.logistics!.ammunition.inventories[0]!.amount = Number.MAX_SAFE_INTEGER + 1;
    }],
    ["fractional amount", (state: MutableCheckpoint["state"]) => {
      state.logistics!.ammunition.inventories[0]!.amount = 1.5;
    }],
    ["amount above starting", (state: MutableCheckpoint["state"]) => {
      state.logistics!.ammunition.inventories[0]!.amount = 4;
    }],
    ["accessor row", (state: MutableCheckpoint["state"]) => {
      Object.defineProperty(state.logistics!.ammunition.inventories[0]!, "amount", {
        enumerable: true,
        get() { throw new Error("ammunition checkpoint accessor executed"); }
      });
    }]
  ] as const)("rejects digest-valid malformed ammunition checkpoint: %s", (_label, mutate) => {
    const subjectContent = content({ inventories: binding("single", 3) });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "ammo", seed: "malformed-ammo" });
    place(subject, "single", { q: 1, r: 2 });
    place(subject, "single", { q: 2, r: 2 });
    place(subject, "legacy", { q: 3, r: 2 });
    const checkpoint = mutableCheckpoint(subject.createCheckpoint());
    seedAmmunitionCheckpoint(checkpoint, [
      { towerId: "tower_1", amount: 3 },
      { towerId: "tower_2", amount: 3 }
    ]);
    const before = structuredClone(checkpoint);

    mutate(checkpoint.state);
    if (_label !== "accessor row") resign(checkpoint);

    expect(() => restore(subjectContent, checkpoint as GameCheckpointV1)).toThrow(
      /checkpoint|logistics|ammunition|inventory|tower|amount|order|field|schema|accessor/i
    );
    if (_label !== "accessor row") expect(checkpoint).not.toEqual(before);
  });

  it("rejects a downed tower row and accepts the same candidate only when that row is removed", () => {
    const subjectContent = content({ inventories: binding("single", 2) });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "ammo", seed: "downed-row" });
    place(subject, "single", { q: 1, r: 2 });
    const invalid = mutableCheckpoint(subject.createCheckpoint());
    seedAmmunitionCheckpoint(invalid, [{ towerId: "tower_1", amount: 2 }]);
    invalid.state.towers[0]!.hp = 0;
    resign(invalid);
    expect(() => restore(subjectContent, invalid as GameCheckpointV1)).toThrow(/logistics|ammunition|inventory|downed|tower/i);

    invalid.state.logistics!.ammunition.inventories = [];
    resign(invalid);
    expect(() => restore(subjectContent, invalid as GameCheckpointV1)).not.toThrow();
  });

  it("rejects a forged 4097th live inventory row and tower before adopting state", { timeout: 30_000 }, () => {
    const subjectContent = content({
      inventories: binding("single", 2),
      width: 65,
      height: 65,
      startingCoins: 10_000
    });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "ammo", seed: "checkpoint-bound" });
    for (let index = 0; index < 4_096; index += 1) {
      expect(subject.placeTower("single", { q: index % 65, r: Math.floor(index / 65) })).toEqual({ ok: true });
    }
    const checkpoint = mutableCheckpoint(subject.createCheckpoint());
    seedAmmunitionCheckpoint(
      checkpoint,
      Array.from({ length: 4_096 }, (_, index) => ({ towerId: `tower_${index + 1}`, amount: 2 }))
        .sort((left, right) => left.towerId < right.towerId ? -1 : left.towerId > right.towerId ? 1 : 0)
    );
    const sourceTower = checkpoint.state.towers.at(-1)!;
    checkpoint.state.towers.push({
      ...structuredClone(sourceTower),
      id: "tower_4097",
      coord: { q: 1, r: 63 },
      footprint: [{ q: 1, r: 63 }]
    });
    (checkpoint.state as unknown as { towerCounter: number }).towerCounter = 4_097;
    checkpoint.state.logistics!.ammunition.inventories.push({ towerId: "tower_4097", amount: 2 });
    resign(checkpoint);

    expect(() => restore(subjectContent, checkpoint as GameCheckpointV1)).toThrow(/ammunition|inventory|4096|limit|budget/i);
  });

  it("matches continuous and restored suffix state, ammunition, events, and digest", () => {
    const subjectContent = content({ inventories: binding("single", 3) });
    const continuous = new TowerDefenseGame({ content: subjectContent, missionId: "ammo", seed: "restore-ammo" });
    const towerId = place(continuous, "single", { q: 2, r: 9 });
    spawn(continuous);
    expect(ammoRow(continuous, towerId)?.amount).toBe(2);
    const restored = restore(subjectContent, structuredClone(continuous.createCheckpoint()));

    continuous.tick(0.2);
    restored.tick(0.2);

    expect(ammoRows(restored)).toEqual(ammoRows(continuous));
    expect(restored.lastEvents).toEqual(continuous.lastEvents);
    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
  });

  it("replays the same ammunition state and digest through journal v6 commands", () => {
    const subjectContent = content({ inventories: binding("single", 3) });
    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent,
      missionId: "ammo",
      seed: "journal-ammo"
    }));
    const commands = [
      { schemaVersion: 1 as const, type: "placeTower" as const, towerTypeId: "single", coord: { q: 2, r: 9 } },
      { schemaVersion: 1 as const, type: "startWave" as const },
      { schemaVersion: 1 as const, type: "tick" as const, units: 0.2 }
    ];
    for (const command of commands) expect(session.dispatch(command)).toEqual({ ok: true });
    const replay = replayGameCommandJournal({ content: subjectContent, journal: session.exportJournal() });

    expect(ammoRows(replay.game)).toEqual(ammoRows(session.game as TowerDefenseGame));
    expect(ammoRows(replay.game)?.[0]?.amount).toBe(2);
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
  });

  it("includes ammunition amount in the stable state digest", () => {
    const subjectContent = content({ inventories: binding("single", 3) });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "ammo", seed: "ammo-digest" });
    place(subject, "single", { q: 2, r: 2 });
    const original = mutableCheckpoint(subject.createCheckpoint());
    const changed = mutableCheckpoint(subject.createCheckpoint());
    changed.state.logistics!.ammunition.inventories[0]!.amount = 2;
    resign(changed);

    expect(changed.stateDigest).not.toBe(original.stateDigest);
    const restored = restore(subjectContent, changed as GameCheckpointV1);
    expect(ammoRows(restored)?.[0]?.amount).toBe(2);
  });

  it("keeps snapshot and checkpoint reads detached, frozen, RNG-neutral, and event-neutral", () => {
    const subject = game({ inventories: binding("single", 2) }, "read-purity-ammo");
    const towerId = place(subject, "single", { q: 2, r: 2 });
    const before = structuredClone(subject.createCheckpoint());
    const events = structuredClone(subject.lastEvents);
    const first = logistics(subject)!;
    const second = logistics(subject)!;

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.ammunition)).toBe(true);
    expect(Object.isFrozen(first.ammunition!.inventories)).toBe(true);
    expect(ammoRow(subject, towerId)?.amount).toBe(2);
    expect(subject.createCheckpoint()).toEqual(before);
    expect(subject.lastEvents).toEqual(events);
  });
});
