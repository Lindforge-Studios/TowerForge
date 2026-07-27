import { describe, expect, it, vi } from "vitest";
import * as Engine from "../index.js";
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
type GridKind = "square" | "hex";

interface AmmunitionBindingFixture {
  readonly ammoTypeId: string;
  readonly capacity: number;
  readonly startingAmount: number;
  readonly consumptionPerActivation: number;
}

interface ProductionRecipeFixture {
  readonly label: string;
  readonly ammoTypeId: string;
  readonly outputAmount: number;
  readonly interval: number;
}

interface ProducerFixture {
  readonly recipeId: string;
  readonly capacity: number;
  readonly startingAmount: number;
  readonly transferRadius: number;
  readonly transferAmount: number;
  readonly transferInterval: number;
}

interface StorageFixture {
  readonly ammoTypeId: string;
  readonly capacity: number;
  readonly startingAmount: number;
  readonly transferRadius: number;
  readonly transferAmount: number;
  readonly transferInterval: number;
}

interface SupplyFixture {
  readonly productionRecipes: Record<string, ProductionRecipeFixture>;
  readonly producers: Record<string, ProducerFixture>;
  readonly storages: Record<string, StorageFixture>;
}

interface PowerFixture {
  readonly generators: Record<string, { output: number; linkRadius: number; coverageRadius: number }>;
  readonly relays: Record<string, { linkRadius: number; coverageRadius: number }>;
  readonly consumers: Record<string, { demand: number; priority: number }>;
}

interface SupplyFixtureOptions {
  readonly gridKind?: GridKind;
  readonly width?: number;
  readonly height?: number;
  readonly startingCoins?: number;
  readonly ammunition?: {
    readonly types: Record<string, { label: string }>;
    readonly towerInventories: Record<string, AmmunitionBindingFixture>;
  } | null;
  readonly supply?: SupplyFixture | null;
  readonly power?: PowerFixture | null;
  readonly enabled?: boolean;
  readonly selected?: boolean;
  readonly groups?: readonly { enemyId: "ground" | "flyer" | "saboteur"; count?: number }[];
}

interface SupplyProducerSnapshotFixture {
  readonly towerId: string;
  readonly towerTypeId: string;
  readonly recipeId: string;
  readonly ammoTypeId: string;
  readonly amount: number;
  readonly capacity: number;
  readonly productionProgress: number;
  readonly productionInterval: number;
  readonly transferProgress: number;
  readonly transferInterval: number;
  readonly transferAmount: number;
  readonly transferRadius: number;
  readonly powered: boolean;
  readonly operational: boolean;
}

interface SupplyStorageSnapshotFixture {
  readonly towerId: string;
  readonly towerTypeId: string;
  readonly ammoTypeId: string;
  readonly amount: number;
  readonly capacity: number;
  readonly transferProgress: number;
  readonly transferInterval: number;
  readonly transferAmount: number;
  readonly transferRadius: number;
  readonly powered: boolean;
  readonly operational: boolean;
}

interface SupplyEdgeSnapshotFixture {
  readonly sourceTowerId: string;
  readonly sourceTowerTypeId: string;
  readonly sourceKind: "producer" | "storage";
  readonly destinationTowerId: string;
  readonly destinationTowerTypeId: string;
  readonly destinationKind: "consumer" | "storage";
  readonly ammoTypeId: string;
  readonly distance: number;
}

interface LogisticsSnapshotV3Fixture {
  readonly schemaVersion: 3;
  readonly power: unknown | null;
  readonly ammunition: {
    readonly inventories: readonly {
      readonly towerId: string;
      readonly towerTypeId: string;
      readonly ammoTypeId: string;
      readonly amount: number;
      readonly capacity: number;
      readonly consumptionPerActivation: number;
      readonly hasRequiredAmmo: boolean;
    }[];
  } | null;
  readonly supply: {
    readonly producers: readonly SupplyProducerSnapshotFixture[];
    readonly storages: readonly SupplyStorageSnapshotFixture[];
    readonly edges: readonly SupplyEdgeSnapshotFixture[];
  } | null;
}

interface LogisticsCheckpointV2Fixture {
  schemaVersion: 2;
  ammunition: { inventories: Array<{ towerId: string; amount: number }> } | null;
  supply: {
    producers: Array<{
      towerId: string;
      amount: number;
      productionProgress: number;
      transferProgress: number;
    }>;
    storages: Array<{ towerId: string; amount: number; transferProgress: number }>;
  } | null;
}

type MutableCheckpoint = Omit<GameCheckpointV1, "state"> & {
  state: Omit<GameCheckpointV1["state"], "logistics" | "towers"> & {
    towers: TowerState[];
    logistics?: LogisticsCheckpointV2Fixture;
    [key: string]: unknown;
  };
};

const DEFAULT_AMMUNITION = Object.freeze({
  types: Object.freeze({ shell: Object.freeze({ label: "Shell" }) }),
  towerInventories: Object.freeze({
    consumer_single: Object.freeze({ ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }),
    consumer_sniper: Object.freeze({ ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }),
    consumer_antiair: Object.freeze({ ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }),
    consumer_splash: Object.freeze({ ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }),
    consumer_pulse: Object.freeze({ ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }),
    consumer_pipeline: Object.freeze({ ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 })
  })
});

const DEFAULT_SUPPLY: SupplyFixture = Object.freeze({
  productionRecipes: Object.freeze({
    forge_shell: Object.freeze({ label: "Forge shell", ammoTypeId: "shell", outputAmount: 2, interval: 0.2 })
  }),
  producers: Object.freeze({
    factory: Object.freeze({
      recipeId: "forge_shell",
      capacity: 20,
      startingAmount: 4,
      transferRadius: 12,
      transferAmount: 4,
      transferInterval: 0.2
    })
  }),
  storages: Object.freeze({
    depot: Object.freeze({
      ammoTypeId: "shell",
      capacity: 20,
      startingAmount: 0,
      transferRadius: 12,
      transferAmount: 4,
      transferInterval: 0.2
    })
  })
});

function attack(kind: AttackKind): Record<string, unknown> {
  if (kind === "single") {
    return { kind, fireRate: 4, damagePerStack: 3, startingStacks: 1, maxStacks: 3, upgradeCost: 1 };
  }
  if (kind === "sniper") return { kind, interval: 0.25, damage: 3, targetPriority: "first" };
  if (kind === "antiair") {
    return { kind, fireRate: 4, damage: 3, maxTargetsByLevel: [3, 3, 3], upgradeCosts: [] };
  }
  if (kind === "splash") {
    return {
      kind,
      interval: 0.25,
      damage: 3,
      splashDamage: 1,
      armoredChipDamage: 0,
      splashRadius: 3,
      slowFactor: 0.5,
      slowDuration: 1
    };
  }
  if (kind === "pulse") {
    return { kind, pulseRate: 4, pulseDamage: 3, dotDamagePerUnit: 1, dotDuration: 1 };
  }
  return {
    kind: "pipeline",
    interval: 0.25,
    targeting: { classes: ["ground"], mode: "first", maxTargets: 3 },
    delivery: { kind: "multi" },
    effects: [{ kind: "damage", amount: 3 }, { kind: "status", status: { poison: { dps: 1, duration: 1 } } }]
  };
}

function tower(
  id: string,
  towerAttack: Record<string, unknown>,
  options: { footprintRadius?: number; maxHp?: number } = {}
): Record<string, unknown> {
  return {
    id,
    label: id,
    cost: { coins: 1 },
    footprintRadius: options.footprintRadius ?? 0,
    range: 40,
    ...(options.maxHp === undefined ? {} : { maxHp: options.maxHp }),
    attack: towerAttack
  };
}

function supportTower(id: string, options: { footprintRadius?: number; maxHp?: number } = {}): Record<string, unknown> {
  return tower(id, { kind: "support", auraRadius: 0, unlocksTowerIds: [] }, options);
}

function fixtureInput(options: SupplyFixtureOptions = {}): GameContentInput {
  const gridKind = options.gridKind ?? "square";
  const width = options.width ?? 24;
  const height = options.height ?? 12;
  const pathRow = height - 1;
  const startingCoins = options.startingCoins ?? 100_000;
  const ammunition = options.ammunition === undefined ? DEFAULT_AMMUNITION : options.ammunition;
  const supply = options.supply === undefined ? DEFAULT_SUPPLY : options.supply;
  const power = options.power ?? null;
  const groups = options.groups ?? [{ enemyId: "ground" as const }];
  const towers: Record<string, unknown> = {
    factory: supportTower("factory", { maxHp: 10 }),
    factory_big: supportTower("factory_big", { footprintRadius: 1, maxHp: 10 }),
    factory_second: supportTower("factory_second", { maxHp: 10 }),
    powered_factory: tower("powered_factory", attack("single"), { maxHp: 10 }),
    depot: supportTower("depot", { maxHp: 10 }),
    depot_big: supportTower("depot_big", { footprintRadius: 1, maxHp: 10 }),
    depot_second: supportTower("depot_second", { maxHp: 10 }),
    generator: supportTower("generator", { maxHp: 10 }),
    hybrid_factory_consumer: tower("hybrid_factory_consumer", attack("single"), { maxHp: 10 }),
    hybrid_storage_consumer: tower("hybrid_storage_consumer", attack("single"), { maxHp: 10 }),
    consumer_single: tower("consumer_single", attack("single"), { maxHp: 10 }),
    consumer_sniper: tower("consumer_sniper", attack("sniper"), { maxHp: 10 }),
    consumer_antiair: tower("consumer_antiair", attack("antiair"), { maxHp: 10 }),
    consumer_splash: tower("consumer_splash", attack("splash"), { maxHp: 10 }),
    consumer_pulse: tower("consumer_pulse", attack("pulse"), { maxHp: 10 }),
    consumer_pipeline: tower("consumer_pipeline", attack("pipeline"), { maxHp: 10 }),
    consumer_big: tower("consumer_big", attack("single"), { footprintRadius: 1, maxHp: 10 }),
    consumer_near: tower("consumer_near", attack("single"), { maxHp: 10 }),
    consumer_far: tower("consumer_far", attack("single"), { maxHp: 10 }),
    consumer_binary_a: tower("consumer_binary_a", attack("single"), { maxHp: 10 }),
    consumer_binary_b: tower("consumer_binary_b", attack("single"), { maxHp: 10 })
  };
  const mechanicsProfiles = options.selected === false ? {} : { logistics: "supply" };
  const modules = {
    logistics: {
      schemaVersion: 3,
      enabled: options.enabled !== false,
      profiles: { supply: { power, ammunition, supply } }
    }
  };
  const topology = gridKind === "hex"
    ? { kind: "hex" as const, layout: "odd-r" as const }
    : { kind: "square" as const, adjacency: "cardinal" as const };

  return {
    balance: {
      defaultMissionId: "supply",
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
          id: "floor", label: "Floor", buildable: true, walkable: true,
          groundSpeedMultiplier: 1, tags: []
        }
      },
      abilities: {},
      enemies: {
        ground: {
          id: "ground", label: "Ground", maxHp: 100_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        flyer: {
          id: "flyer", label: "Flyer", maxHp: 100_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2,
          targetClass: "flying", movementKind: "direct_flying"
        },
        saboteur: {
          id: "saboteur", label: "Saboteur", maxHp: 100_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 3,
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
        supply: {
          id: "supply",
          label: "Supply",
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
        grid: topology,
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
        id: "region", label: "Region", description: "", biome: "test", accent: "#fff",
        bounds: { x: 0, y: 0, width: 10, height: 10 }, connections: []
      }],
      missionNodes: [{
        missionId: "supply", regionId: "region", x: 5, y: 5, difficulty: 1,
        unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(options: SupplyFixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(fixtureInput(options));
}

function ammunitionV2Content(): GameContentRegistry {
  const input = structuredClone(fixtureInput({ supply: null })) as GameContentInput & {
    mechanics: {
      schemaVersion: 1;
      modules: Record<string, {
        schemaVersion: number;
        enabled: boolean;
        profiles: Record<string, Record<string, unknown>>;
      }>;
    };
  };
  const logisticsModule = input.mechanics.modules.logistics! as unknown as {
    schemaVersion: number;
    profiles: Record<string, Record<string, unknown>>;
  };
  logisticsModule.schemaVersion = 2;
  delete logisticsModule.profiles.supply!.supply;
  return createGameContentRegistry(input);
}

function game(options: SupplyFixtureOptions = {}, seed = "supply-runtime"): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "supply", seed });
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

function logistics(subject: TowerDefenseGame): LogisticsSnapshotV3Fixture | undefined {
  return (subject.getSnapshot() as unknown as { logistics?: LogisticsSnapshotV3Fixture }).logistics;
}

function producerRow(subject: TowerDefenseGame, towerId: string): SupplyProducerSnapshotFixture | undefined {
  return logistics(subject)?.supply?.producers.find((row) => row.towerId === towerId);
}

function storageRow(subject: TowerDefenseGame, towerId: string): SupplyStorageSnapshotFixture | undefined {
  return logistics(subject)?.supply?.storages.find((row) => row.towerId === towerId);
}

function ammunitionRow(subject: TowerDefenseGame, towerId: string) {
  return logistics(subject)?.ammunition?.inventories.find((row) => row.towerId === towerId);
}

function firedBy(subject: TowerDefenseGame, towerId: string): GameEvent[] {
  return subject.lastEvents.filter((event) => (
    event.type === "towerFired" || event.type === "areaPulse"
  ) && event.towerId === towerId);
}

function mutableCheckpoint(checkpoint: GameCheckpointV1): MutableCheckpoint {
  return structuredClone(checkpoint) as unknown as MutableCheckpoint;
}

function restore(
  subjectContent: GameContentRegistry,
  checkpoint: MutableCheckpoint | GameCheckpointV1
): TowerDefenseGame {
  return TowerDefenseGame.fromCheckpoint({
    content: subjectContent,
    checkpoint: checkpoint as GameCheckpointV1
  });
}

function resign(checkpoint: MutableCheckpoint): void {
  (checkpoint as unknown as { stateDigest: string }).stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state as unknown as GameCheckpointV1["state"]
  );
}

function totalStock(snapshot: LogisticsSnapshotV3Fixture): number {
  return (snapshot.ammunition?.inventories.reduce((sum, row) => sum + row.amount, 0) ?? 0)
    + (snapshot.supply?.producers.reduce((sum, row) => sum + row.amount, 0) ?? 0)
    + (snapshot.supply?.storages.reduce((sum, row) => sum + row.amount, 0) ?? 0);
}

function supplyFixture(overrides: Partial<SupplyFixture> = {}): SupplyFixture {
  return {
    productionRecipes: overrides.productionRecipes ?? DEFAULT_SUPPLY.productionRecipes,
    producers: overrides.producers ?? DEFAULT_SUPPLY.producers,
    storages: overrides.storages ?? DEFAULT_SUPPLY.storages
  };
}

describe("R5.8B production, transfer cadence, and attack refill RED", () => {
  it("publishes exact Logistics v3 source stock and progress while tick(0) never produces", () => {
    const subject = game();
    const factoryId = place(subject, "factory", { q: 2, r: 2 });

    subject.tick(0);

    expect(logistics(subject)).toMatchObject({
      schemaVersion: 3,
      power: null,
      ammunition: { inventories: [] },
      supply: {
        producers: [{
          towerId: factoryId,
          towerTypeId: "factory",
          recipeId: "forge_shell",
          ammoTypeId: "shell",
          amount: 4,
          capacity: 20,
          productionProgress: 0,
          productionInterval: 0.2,
          transferProgress: 0.2,
          transferInterval: 0.2,
          transferAmount: 4,
          transferRadius: 12,
          powered: true,
          operational: true
        }],
        storages: [],
        edges: []
      }
    });
  });

  it("accumulates production progress and emits only full batches at the authored interval", () => {
    const subject = game({
      supply: supplyFixture({
        productionRecipes: {
          forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 3, interval: 0.4 }
        },
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 10, startingAmount: 0,
            transferRadius: 0, transferAmount: 2, transferInterval: 0.4
          }
        },
        storages: {}
      })
    });
    const factoryId = place(subject, "factory", { q: 2, r: 2 });

    subject.tick(0.2);
    expect(producerRow(subject, factoryId)).toMatchObject({ amount: 0, productionProgress: 0.2 });
    subject.tick(0.2);
    expect(producerRow(subject, factoryId)).toMatchObject({ amount: 3, productionProgress: 0 });
  });

  it("freezes production progress instead of creating a partial batch when capacity cannot fit output", () => {
    const subject = game({
      supply: supplyFixture({
        productionRecipes: {
          forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 3, interval: 0.2 }
        },
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 5, startingAmount: 3,
            transferRadius: 0, transferAmount: 1, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    const factoryId = place(subject, "factory", { q: 2, r: 2 });

    subject.tick(0.2);

    expect(producerRow(subject, factoryId)).toMatchObject({ amount: 3, productionProgress: 0 });
  });

  it("counts a partial transfer as one activation and resets transfer progress", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 3, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 10,
            transferRadius: 12, transferAmount: 8, transferInterval: 0.4
          }
        },
        storages: {}
      })
    });
    const factoryId = place(subject, "factory", { q: 2, r: 2 });
    const consumerId = place(subject, "consumer_single", { q: 3, r: 2 });

    subject.tick(0);

    expect(producerRow(subject, factoryId)).toMatchObject({ amount: 7, transferProgress: 0 });
    expect(ammunitionRow(subject, consumerId)).toMatchObject({ amount: 3, hasRequiredAmmo: true });
  });

  it("starts transfer ready, then respects transferInterval across later ticks", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 6,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.4
          }
        },
        storages: {}
      })
    });
    const factoryId = place(subject, "factory", { q: 2, r: 2 });
    const consumerId = place(subject, "consumer_single", { q: 3, r: 2 });

    subject.tick(0);
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(2);
    expect(producerRow(subject, factoryId)?.transferProgress).toBe(0);
    subject.tick(0.2);
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(2);
    expect(producerRow(subject, factoryId)?.transferProgress).toBe(0.2);
    subject.tick(0.2);
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(4);
    expect(producerRow(subject, factoryId)?.transferProgress).toBe(0);
  });

  it("plans transfers from post-production stock so a full new batch can refill in that same tick", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 4, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        productionRecipes: {
          forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount: 2, interval: 0.2 }
        },
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 0,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    const factoryId = place(subject, "factory", { q: 1, r: 2 });
    const consumerId = place(subject, "consumer_single", { q: 2, r: 2 });

    subject.tick(0.2);

    expect(producerRow(subject, factoryId)).toMatchObject({ amount: 0, productionProgress: 0, transferProgress: 0 });
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(2);
  });

  it("uses no RNG, resources, events, or target state while producing without a transfer destination", () => {
    const subject = game();
    const factoryId = place(subject, "factory", { q: 2, r: 2 });
    const before = subject.createCheckpoint();
    const resources = structuredClone(subject.resources);
    const eventCount = subject.lastEvents.length;

    subject.tick(0.2);
    const after = subject.createCheckpoint();

    expect(producerRow(subject, factoryId)?.amount).toBe(6);
    expect(subject.resources).toEqual(resources);
    expect(eventCount).toBeGreaterThan(0);
    expect(subject.lastEvents).toEqual([]);
    expect(after.rng.current).toEqual(before.rng.current);
  });

  it.each([
    ["single", "ground"],
    ["sniper", "ground"],
    ["antiair", "flyer"],
    ["splash", "ground"],
    ["pulse", "ground"],
    ["pipeline", "ground"]
  ] as const)("refills and resumes the same depleted %s instance before attacks in the same tick", (kind, enemyId) => {
    const towerTypeId = `consumer_${kind}`;
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          [towerTypeId]: { ammoTypeId: "shell", capacity: 2, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 1,
            transferRadius: 12, transferAmount: 1, transferInterval: 0.2
          }
        },
        storages: {}
      }),
      groups: [{ enemyId }]
    });
    const factoryId = place(subject, "factory", { q: 1, r: 9 });
    const consumerId = place(subject, towerTypeId, { q: 2, r: 9 });
    subject.towers.find((towerState) => towerState.id === consumerId)!.cooldown = -0.125;

    spawn(subject);

    expect(firedBy(subject, consumerId).length).toBeGreaterThan(0);
    expect(ammunitionRow(subject, consumerId)).toMatchObject({ amount: 0, hasRequiredAmmo: false });
    expect(producerRow(subject, factoryId)?.amount).toBe(0);
  });

  it("preserves exact cooldown when a partial refill remains below activation cost", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 3, startingAmount: 0, consumptionPerActivation: 2 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 1,
            transferRadius: 12, transferAmount: 1, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    place(subject, "factory", { q: 1, r: 9 });
    const consumerId = place(subject, "consumer_single", { q: 2, r: 9 });
    const consumer = subject.towers.find((towerState) => towerState.id === consumerId)!;
    consumer.cooldown = -0.125;

    spawn(subject);

    expect(ammunitionRow(subject, consumerId)).toMatchObject({ amount: 1, hasRequiredAmmo: false });
    expect(consumer.cooldown).toBe(-0.125);
    expect(firedBy(subject, consumerId)).toEqual([]);
  });
});

describe("R5.8B deterministic transfer topology and planning RED", () => {
  it.each(["square", "hex"] as const)(
    "uses %s topology footprint-edge distance and exposes only authored in-range edges",
    (gridKind) => {
      const subject = game({
        gridKind,
        ammunition: {
          types: { shell: { label: "Shell" } },
          towerInventories: {
            consumer_big: { ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }
          }
        },
        supply: supplyFixture({
          producers: {
            factory_big: {
              recipeId: "forge_shell", capacity: 20, startingAmount: 4,
              transferRadius: 2, transferAmount: 1, transferInterval: 0.2
            }
          },
          storages: {}
        })
      });
      const sourceId = place(subject, "factory_big", { q: 2, r: 2 });
      const destinationId = place(subject, "consumer_big", { q: 6, r: 2 });

      expect(logistics(subject)?.supply?.edges).toEqual([{
        sourceTowerId: sourceId,
        sourceTowerTypeId: "factory_big",
        sourceKind: "producer",
        destinationTowerId: destinationId,
        destinationTowerTypeId: "consumer_big",
        destinationKind: "consumer",
        ammoTypeId: "shell",
        distance: 2
      }]);
    }
  );

  it("allows a zero-distance self-edge only between distinct producer and consumer compartments", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          hybrid_factory_consumer: { ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          hybrid_factory_consumer: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 0, transferAmount: 1, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    const hybridId = place(subject, "hybrid_factory_consumer", { q: 2, r: 2 });

    expect(logistics(subject)?.supply?.edges).toEqual([
      expect.objectContaining({
        sourceTowerId: hybridId,
        sourceKind: "producer",
        destinationTowerId: hybridId,
        destinationKind: "consumer",
        distance: 0
      })
    ]);
  });

  it("forbids storage-to-storage edges and every transfer into a producer", () => {
    const subject = game({
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.2
          }
        },
        storages: {
          depot: {
            ammoTypeId: "shell", capacity: 20, startingAmount: 4,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.2
          },
          depot_second: {
            ammoTypeId: "shell", capacity: 20, startingAmount: 0,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.2
          }
        }
      })
    });
    const producerId = place(subject, "factory", { q: 1, r: 2 });
    place(subject, "depot", { q: 2, r: 2 });
    place(subject, "depot_second", { q: 3, r: 2 });
    const edges = logistics(subject)?.supply?.edges ?? [];

    expect(edges.some((edge) => edge.destinationTowerId === producerId)).toBe(false);
    expect(edges.some((edge) => edge.sourceKind === "storage" && edge.destinationKind === "storage")).toBe(false);
    expect(edges.filter((edge) => edge.sourceKind === "producer" && edge.destinationKind === "storage")).toHaveLength(2);
  });

  it("publishes edges in canonical source/kind/destination-kind/distance/binary-id order", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_binary_a: { ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 },
          consumer_binary_b: { ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory_second: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 12, transferAmount: 1, transferInterval: 0.2
          },
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 12, transferAmount: 1, transferInterval: 0.2
          }
        },
        storages: {
          depot: {
            ammoTypeId: "shell", capacity: 20, startingAmount: 0,
            transferRadius: 12, transferAmount: 1, transferInterval: 0.2
          }
        }
      })
    });
    const sourceSecond = place(subject, "factory_second", { q: 1, r: 2 });
    const sourceFirst = place(subject, "factory", { q: 2, r: 2 });
    const storageId = place(subject, "depot", { q: 3, r: 2 });
    const consumerB = place(subject, "consumer_binary_b", { q: 5, r: 2 });
    const consumerA = place(subject, "consumer_binary_a", { q: 4, r: 2 });

    const order = logistics(subject)?.supply?.edges.map((edge) => [
      edge.sourceTowerId, edge.sourceKind, edge.destinationKind, edge.distance, edge.destinationTowerId
    ]);
    expect(order).toEqual([
      [sourceSecond, "producer", "consumer", 3, consumerA],
      [sourceSecond, "producer", "consumer", 4, consumerB],
      [sourceSecond, "producer", "storage", 2, storageId],
      [sourceFirst, "producer", "consumer", 2, consumerA],
      [sourceFirst, "producer", "consumer", 3, consumerB],
      [sourceFirst, "producer", "storage", 1, storageId],
      [storageId, "storage", "consumer", 1, consumerA],
      [storageId, "storage", "consumer", 2, consumerB]
    ]);
  });

  it("serves consumers before nearer storage, then consumers by distance and binary id", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_near: { ammoTypeId: "shell", capacity: 1, startingAmount: 0, consumptionPerActivation: 1 },
          consumer_far: { ammoTypeId: "shell", capacity: 1, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 2,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.2
          }
        },
        storages: {
          depot: {
            ammoTypeId: "shell", capacity: 20, startingAmount: 0,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.2
          }
        }
      })
    });
    const sourceId = place(subject, "factory", { q: 1, r: 2 });
    const storageId = place(subject, "depot", { q: 2, r: 2 });
    const farId = place(subject, "consumer_far", { q: 5, r: 2 });
    const nearId = place(subject, "consumer_near", { q: 4, r: 2 });

    subject.tick(0);

    expect(ammunitionRow(subject, nearId)?.amount).toBe(1);
    expect(ammunitionRow(subject, farId)?.amount).toBe(1);
    expect(storageRow(subject, storageId)?.amount).toBe(0);
    expect(producerRow(subject, sourceId)?.amount).toBe(0);
  });

  it("lets the binary-lowest source reserve destination headroom first", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 2, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 2,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.2
          },
          factory_second: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 2,
            transferRadius: 12, transferAmount: 2, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    const firstSource = place(subject, "factory", { q: 1, r: 2 });
    const secondSource = place(subject, "factory_second", { q: 2, r: 2 });
    const consumerId = place(subject, "consumer_single", { q: 3, r: 2 });

    subject.tick(0);

    expect(ammunitionRow(subject, consumerId)?.amount).toBe(2);
    expect(producerRow(subject, firstSource)?.amount).toBe(0);
    expect(producerRow(subject, secondSource)?.amount).toBe(2);
  });

  it("does not forward incoming storage stock in the same tick", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 8, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 2, transferAmount: 4, transferInterval: 0.2
          }
        },
        storages: {
          depot: {
            ammoTypeId: "shell", capacity: 20, startingAmount: 0,
            transferRadius: 3, transferAmount: 4, transferInterval: 0.2
          }
        }
      })
    });
    const factoryId = place(subject, "factory", { q: 1, r: 2 });
    const depotId = place(subject, "depot", { q: 3, r: 2 });
    const consumerId = place(subject, "consumer_single", { q: 6, r: 2 });

    subject.tick(0);
    expect(producerRow(subject, factoryId)?.amount).toBe(0);
    expect(storageRow(subject, depotId)?.amount).toBe(4);
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(0);
    subject.tick(0);
    expect(storageRow(subject, depotId)?.amount).toBe(0);
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(4);
  });

  it("does not reuse storage headroom freed by outgoing stock in the same tick", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 4, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 2, transferAmount: 4, transferInterval: 0.2
          }
        },
        storages: {
          depot: {
            ammoTypeId: "shell", capacity: 4, startingAmount: 4,
            transferRadius: 3, transferAmount: 4, transferInterval: 0.2
          }
        }
      })
    });
    const factoryId = place(subject, "factory", { q: 1, r: 2 });
    const depotId = place(subject, "depot", { q: 3, r: 2 });
    const consumerId = place(subject, "consumer_single", { q: 6, r: 2 });

    subject.tick(0);

    expect(ammunitionRow(subject, consumerId)?.amount).toBe(4);
    expect(storageRow(subject, depotId)?.amount).toBe(0);
    expect(producerRow(subject, factoryId)?.amount).toBe(4);
  });
});

describe("R5.8B power, disruption, and stock conservation RED", () => {
  const poweredFactorySupply = supplyFixture({
    producers: {
      powered_factory: {
        recipeId: "forge_shell", capacity: 20, startingAmount: 4,
        transferRadius: 12, transferAmount: 2, transferInterval: 0.2
      }
    },
    storages: {}
  });
  const poweredFactoryGrid: PowerFixture = {
    generators: { generator: { output: 5, linkRadius: 0, coverageRadius: 12 } },
    relays: {},
    consumers: { powered_factory: { demand: 5, priority: 1 } }
  };

  it("freezes both production and outgoing transfer progress for a brownout source", () => {
    const subject = game({ supply: poweredFactorySupply, power: poweredFactoryGrid });
    const sourceId = place(subject, "powered_factory", { q: 3, r: 2 });

    subject.tick(0.2);

    expect(producerRow(subject, sourceId)).toMatchObject({
      amount: 4,
      productionProgress: 0,
      transferProgress: 0.2,
      powered: false,
      operational: false
    });
  });

  it("uses authoritative power allocation and resumes a source after a generator joins coverage", () => {
    const subject = game({ supply: poweredFactorySupply, power: poweredFactoryGrid });
    const sourceId = place(subject, "powered_factory", { q: 3, r: 2 });
    subject.tick(0.2);
    expect(producerRow(subject, sourceId)).toMatchObject({ amount: 4, productionProgress: 0, powered: false });

    place(subject, "generator", { q: 1, r: 2 });
    subject.tick(0.2);

    expect(producerRow(subject, sourceId)).toMatchObject({ amount: 6, productionProgress: 0, powered: true });
  });

  it("freezes a disrupted source but still decrements disruption through the existing tower phase", () => {
    const subject = game({ supply: poweredFactorySupply });
    const sourceId = place(subject, "powered_factory", { q: 2, r: 2 });
    const source = subject.towers.find((towerState) => towerState.id === sourceId)!;
    source.disabledFor = 0.5;

    subject.tick(0.2);

    expect(producerRow(subject, sourceId)).toMatchObject({
      amount: 4,
      productionProgress: 0,
      transferProgress: 0.2,
      powered: true,
      operational: false
    });
    expect(source.disabledFor).toBeCloseTo(0.3, 12);
  });

  it.each(["brownout", "disrupted"] as const)(
    "allows passive incoming refill into a %s destination without enabling its outgoing work",
    (mode) => {
      const power: PowerFixture | null = mode === "brownout"
        ? { generators: {}, relays: {}, consumers: { consumer_single: { demand: 5, priority: 1 } } }
        : null;
      const subject = game({
        power,
        ammunition: {
          types: { shell: { label: "Shell" } },
          towerInventories: {
            consumer_single: { ammoTypeId: "shell", capacity: 4, startingAmount: 0, consumptionPerActivation: 1 }
          }
        },
        supply: supplyFixture({
          producers: {
            factory: {
              recipeId: "forge_shell", capacity: 20, startingAmount: 2,
              transferRadius: 12, transferAmount: 2, transferInterval: 0.2
            }
          },
          storages: {}
        })
      });
      place(subject, "factory", { q: 1, r: 2 });
      const destinationId = place(subject, "consumer_single", { q: 2, r: 2 });
      if (mode === "disrupted") {
        subject.towers.find((towerState) => towerState.id === destinationId)!.disabledFor = 0.5;
      }

      subject.tick(0);

      expect(ammunitionRow(subject, destinationId)).toMatchObject({ amount: 2, hasRequiredAmmo: true });
      if (mode === "brownout") {
        expect((logistics(subject)?.power as { consumers?: Array<{ towerId: string; powered: boolean }> })
          ?.consumers?.find((row) => row.towerId === destinationId)).toMatchObject({ powered: false });
      }
    }
  );

  it("conserves total stock across a multi-source split transfer", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_near: { ammoTypeId: "shell", capacity: 3, startingAmount: 1, consumptionPerActivation: 1 },
          consumer_far: { ammoTypeId: "shell", capacity: 5, startingAmount: 2, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 5,
            transferRadius: 12, transferAmount: 4, transferInterval: 0.2
          },
          factory_second: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 6,
            transferRadius: 12, transferAmount: 4, transferInterval: 0.2
          }
        },
        storages: {
          depot: {
            ammoTypeId: "shell", capacity: 8, startingAmount: 3,
            transferRadius: 12, transferAmount: 4, transferInterval: 0.2
          }
        }
      })
    });
    place(subject, "factory", { q: 1, r: 2 });
    place(subject, "factory_second", { q: 2, r: 2 });
    place(subject, "depot", { q: 3, r: 2 });
    place(subject, "consumer_near", { q: 4, r: 2 });
    place(subject, "consumer_far", { q: 5, r: 2 });
    const before = totalStock(logistics(subject)!);

    subject.tick(0);

    expect(totalStock(logistics(subject)!)).toBe(before);
  });

  it.each([1, 2, 4, 8] as const)("adds exactly one authored production batch of %s to total stock", (outputAmount) => {
    const subject = game({
      supply: supplyFixture({
        productionRecipes: {
          forge_shell: { label: "Forge shell", ammoTypeId: "shell", outputAmount, interval: 0.2 }
        },
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 0,
            transferRadius: 0, transferAmount: 1, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    place(subject, "factory", { q: 1, r: 2 });
    const before = totalStock(logistics(subject)!);

    subject.tick(0.2);

    expect(totalStock(logistics(subject)!)).toBe(before + outputAmount);
  });

  it("decreases total stock only by the one successful attack consumption", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 2, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 1,
            transferRadius: 12, transferAmount: 1, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    place(subject, "factory", { q: 1, r: 9 });
    const consumerId = place(subject, "consumer_single", { q: 2, r: 9 });
    const before = totalStock(logistics(subject)!);

    spawn(subject);

    expect(firedBy(subject, consumerId)).toHaveLength(1);
    expect(totalStock(logistics(subject)!)).toBe(before - 1);
  });
});

describe("R5.8B supply lifecycle, topology dirtiness, and preflight RED", () => {
  it("preserves stock and progress across move and upgrade without resizing or refill", () => {
    const subject = game({
      supply: supplyFixture({
        producers: {
          powered_factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 2, transferAmount: 2, transferInterval: 0.4
          }
        },
        storages: {}
      })
    });
    const sourceId = place(subject, "powered_factory", { q: 1, r: 2 });
    subject.tick(0.2);
    const before = producerRow(subject, sourceId)!;

    expect(subject.moveTower(sourceId, { q: 5, r: 2 })).toEqual({ ok: true });
    expect(subject.upgradeTower(sourceId)).toEqual({ ok: true });

    expect(producerRow(subject, sourceId)).toMatchObject({
      amount: before.amount,
      capacity: before.capacity,
      productionProgress: before.productionProgress,
      transferProgress: before.transferProgress
    });
  });

  it("rebuilds topology after successful movement while retaining compartments", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 4, startingAmount: 0, consumptionPerActivation: 1 }
        }
      },
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 2,
            transferRadius: 2, transferAmount: 2, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    const sourceId = place(subject, "factory", { q: 1, r: 2 });
    const consumerId = place(subject, "consumer_single", { q: 8, r: 2 });
    expect(logistics(subject)?.supply?.edges).toEqual([]);

    expect(subject.moveTower(sourceId, { q: 6, r: 2 })).toEqual({ ok: true });
    expect(logistics(subject)?.supply?.edges).toEqual([
      expect.objectContaining({ sourceTowerId: sourceId, destinationTowerId: consumerId, distance: 2 })
    ]);
    subject.tick(0);
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(2);
  });

  it("removes source stock and edges on sell without refunding supply stock", () => {
    const subject = game({
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: { ammoTypeId: "shell", capacity: 4, startingAmount: 0, consumptionPerActivation: 1 }
        }
      }
    });
    const sourceId = place(subject, "factory", { q: 1, r: 2 });
    const consumerId = place(subject, "consumer_single", { q: 2, r: 2 });
    const resourceKeys = Object.keys(subject.resources);
    expect(producerRow(subject, sourceId)?.amount).toBe(4);

    expect(subject.sellTower(sourceId)).toEqual({ ok: true });

    expect(logistics(subject)?.supply?.producers).toEqual([]);
    expect(logistics(subject)?.supply?.edges).toEqual([]);
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(0);
    expect(Object.keys(subject.resources)).toEqual(resourceKeys);
  });

  it("removes a destroyed source before supply can produce or transfer that tick", () => {
    const subject = game({
      groups: [{ enemyId: "saboteur" }],
      supply: supplyFixture({
        producers: {
          factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 0,
            transferRadius: 12, transferAmount: 4, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    const sourceId = place(subject, "factory", { q: 0, r: 9 });
    const consumerId = place(subject, "consumer_single", { q: 2, r: 9 });

    spawn(subject);
    subject.tick(0.02);

    expect(subject.towers.some((towerState) => towerState.id === sourceId)).toBe(false);
    expect(producerRow(subject, sourceId)).toBeUndefined();
    expect(ammunitionRow(subject, consumerId)?.amount).toBe(0);
  });

  it("reset clears every compartment and progress; a new instance starts from authored values", () => {
    const subject = game();
    const firstId = place(subject, "factory", { q: 1, r: 2 });
    subject.tick(0.2);
    expect(producerRow(subject, firstId)?.amount).toBe(6);

    subject.reset();
    expect(logistics(subject)?.supply?.producers).toEqual([]);
    const secondId = place(subject, "factory", { q: 2, r: 2 });

    expect(secondId).toBe("tower_1");
    expect(producerRow(subject, secondId)).toMatchObject({
      amount: 4,
      productionProgress: 0,
      transferProgress: 0.2
    });
  });

  it("keeps stock, progress, resources, occupancy, events, and topology unchanged after failed actions", () => {
    const subject = game();
    const sourceId = place(subject, "factory", { q: 1, r: 2 });
    const beforeCheckpoint = subject.createCheckpoint();
    const beforeSnapshot = structuredClone(logistics(subject));

    expect(subject.placeTower("factory", { q: 1, r: 2 }).ok).toBe(false);
    expect(subject.moveTower(sourceId, { q: 999, r: 999 }).ok).toBe(false);

    expect(subject.createCheckpoint()).toEqual(beforeCheckpoint);
    expect(logistics(subject)).toEqual(beforeSnapshot);
  });

  it("keeps topology cached across reads, production, transfer, consumption, upgrades, and failed actions", () => {
    const subject = game({
      supply: supplyFixture({
        producers: {
          powered_factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 12, transferAmount: 4, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    const sourceId = place(subject, "powered_factory", { q: 1, r: 2 });
    place(subject, "consumer_single", { q: 2, r: 2 });
    logistics(subject);
    const distance = vi.spyOn(subject.map, "distance");

    logistics(subject);
    subject.getRenderSnapshot();
    subject.tick(0.2);
    expect(subject.upgradeTower(sourceId).ok).toBe(true);
    expect(subject.placeTower("powered_factory", { q: 1, r: 2 }).ok).toBe(false);
    logistics(subject);

    expect(distance).not.toHaveBeenCalled();
  });

  it("exposes bounded topology preflight and rejects source/edge overflow before mutation", () => {
    const preflight = (Engine as unknown as {
      preflightLogisticsSupplyTopologyV3?: (
        supply: SupplyFixture,
        ammunition: NonNullable<SupplyFixtureOptions["ammunition"]>,
        towers: readonly TowerState[],
        towerTypes: GameContentRegistry["towers"],
        map: TowerDefenseGame["map"]
      ) => { liveSources: number; directedTransferEdges: number };
    }).preflightLogisticsSupplyTopologyV3;
    expect(preflight).toBeTypeOf("function");
    const subject = game({ width: 80, height: 80 });
    const active = (Engine as unknown as {
      resolveActiveLogisticsMechanics: (
        contentRegistry: GameContentRegistry,
        missionId: string
      ) => { ammunition: NonNullable<SupplyFixtureOptions["ammunition"]>; supply: SupplyFixture } | undefined;
    }).resolveActiveLogisticsMechanics(subject.content, "supply");
    expect(active?.supply).toBeDefined();
    const sourceTemplate = {
      typeId: "factory",
      coord: { q: 1, r: 1 },
      footprint: [{ q: 1, r: 1 }],
      level: 1,
      stacks: 0,
      cooldown: 0,
      investedResources: { coins: 1 }
    };
    const tooManySources = Array.from({ length: 1_025 }, (_, index) => ({
      ...sourceTemplate,
      id: `source_${String(index).padStart(4, "0")}`
    })) as TowerState[];

    expect(() => preflight!(active!.supply, active!.ammunition, tooManySources, subject.content.towers, subject.map))
      .toThrow(/source|1024|limit|budget/i);

    const edgeSupply = supplyFixture({
      producers: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
        `source_type_${index}`,
        {
          recipeId: "forge_shell", capacity: 10, startingAmount: 1,
          transferRadius: 64, transferAmount: 1, transferInterval: 0.2
        }
      ])),
      storages: {}
    });
    const edgeAmmunition = {
      types: { shell: { label: "Shell" } },
      towerInventories: Object.fromEntries(Array.from({ length: 4_096 }, (_, index) => [
        `consumer_type_${index}`,
        { ammoTypeId: "shell", capacity: 1, startingAmount: 0, consumptionPerActivation: 1 }
      ]))
    };
    expect((Engine as unknown as { LOGISTICS_SUPPLY_LIMITS?: unknown }).LOGISTICS_SUPPLY_LIMITS).toMatchObject({
      liveSources: 1_024,
      liveAmmunitionInventories: 4_096,
      directedTransferEdges: 65_536
    });
    const syntheticTowerTypes: Record<string, unknown> = {};
    const edgeTowers: TowerState[] = [];
    for (let index = 0; index < 17; index += 1) {
      const typeId = `source_type_${index}`;
      syntheticTowerTypes[typeId] = supportTower(typeId);
      edgeTowers.push({
        ...sourceTemplate,
        id: `source_${String(index).padStart(2, "0")}`,
        typeId
      } as TowerState);
    }
    for (let index = 0; index < 4_096; index += 1) {
      const typeId = `consumer_type_${index}`;
      syntheticTowerTypes[typeId] = tower(typeId, attack("single"));
      edgeTowers.push({
        ...sourceTemplate,
        id: `consumer_${String(index).padStart(4, "0")}`,
        typeId
      } as TowerState);
    }
    expect(() => preflight!(
      edgeSupply,
      edgeAmmunition,
      edgeTowers,
      syntheticTowerTypes as GameContentRegistry["towers"],
      subject.map
    )).toThrow(/edge|65536|limit|budget/i);
  });
});

describe("R5.8B nested checkpoint v2, restore, digest, and replay RED", () => {
  it("requires exact empty checkpoint v2 state whenever a v3 supply profile is active", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "supply", seed: "required-v2" });
    const checkpoint = subject.createCheckpoint();

    expect((checkpoint.state as unknown as MutableCheckpoint["state"]).logistics).toEqual({
      schemaVersion: 2,
      ammunition: { inventories: [] },
      supply: { producers: [], storages: [] }
    });
    const missing = mutableCheckpoint(checkpoint);
    delete missing.state.logistics;
    resign(missing);
    expect(() => restore(subjectContent, missing)).toThrow(/logistics|supply|required|checkpoint/i);
  });

  it("uses checkpoint v2 with supply:null for a v3 ammunition-only profile", () => {
    const subjectContent = content({ supply: null });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "supply", seed: "v3-ammo-only" });
    place(subject, "consumer_single", { q: 2, r: 2 });

    expect((subject.createCheckpoint().state as unknown as MutableCheckpoint["state"]).logistics).toEqual({
      schemaVersion: 2,
      ammunition: { inventories: [{ towerId: "tower_1", amount: 0 }] },
      supply: null
    });
  });

  it("rejects unreachable ammunition above startingAmount when v3 supply is null", () => {
    const subjectContent = content({
      supply: null,
      ammunition: {
        types: { shell: { label: "Shell" } },
        towerInventories: {
          consumer_single: {
            ammoTypeId: "shell", capacity: 8, startingAmount: 1, consumptionPerActivation: 1
          }
        }
      }
    });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "supply", seed: "v3-ammo-only-limit" });
    place(subject, "consumer_single", { q: 2, r: 2 });
    const forged = mutableCheckpoint(subject.createCheckpoint());
    forged.state.logistics!.ammunition!.inventories[0]!.amount = 2;
    resign(forged);

    expect(() => restore(subjectContent, forged)).toThrow(/starting amount/i);
  });

  it("keeps the existing checkpoint v1 contract for a schema-v2 ammunition profile", () => {
    const subjectContent = ammunitionV2Content();
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "supply", seed: "v2-ammo" });
    place(subject, "consumer_single", { q: 2, r: 2 });

    expect((subject.createCheckpoint().state as unknown as { logistics?: unknown }).logistics).toEqual({
      schemaVersion: 1,
      ammunition: { inventories: [{ towerId: "tower_1", amount: 0 }] }
    });
  });

  it("keeps all-null v3 Logistics on the literal no-snapshot/no-checkpoint branch", () => {
    const subject = game({ ammunition: null, supply: null, power: null });

    expect(logistics(subject)).toBeUndefined();
    expect(subject.createCheckpoint().state).not.toHaveProperty("logistics");
  });

  it("serializes exact binary-sorted producer, storage, and inventory rows without derived edges", () => {
    const subject = game({
      supply: supplyFixture({
        producers: {
          factory: DEFAULT_SUPPLY.producers.factory!,
          factory_second: DEFAULT_SUPPLY.producers.factory!
        },
        storages: { depot: DEFAULT_SUPPLY.storages.depot! }
      })
    });
    for (let index = 0; index < 10; index += 1) place(subject, "factory", { q: index, r: 2 });
    place(subject, "factory_second", { q: 10, r: 2 });
    place(subject, "depot", { q: 11, r: 2 });
    place(subject, "consumer_single", { q: 12, r: 2 });
    const logisticsState = (subject.createCheckpoint().state as unknown as MutableCheckpoint["state"]).logistics;

    expect(logisticsState).toEqual({
      schemaVersion: 2,
      ammunition: { inventories: [{ towerId: "tower_13", amount: 0 }] },
      supply: {
        producers: [
          "tower_1", "tower_10", "tower_11", "tower_2", "tower_3", "tower_4",
          "tower_5", "tower_6", "tower_7", "tower_8", "tower_9"
        ].map((towerId) => ({
          towerId,
          amount: 4,
          productionProgress: 0,
          transferProgress: 0.2
        })),
        storages: [{ towerId: "tower_12", amount: 0, transferProgress: 0.2 }]
      }
    });
    expect(logisticsState?.supply).not.toHaveProperty("edges");
  });

  it.each([
    ["unknown logistics field", (state: MutableCheckpoint["state"]) => {
      (state.logistics as unknown as Record<string, unknown>).extra = true;
    }],
    ["wrong logistics schema", (state: MutableCheckpoint["state"]) => {
      (state.logistics as unknown as { schemaVersion: number }).schemaVersion = 1;
    }],
    ["supply unexpectedly null", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply = null;
    }],
    ["unknown supply field", (state: MutableCheckpoint["state"]) => {
      (state.logistics!.supply as unknown as Record<string, unknown>).extra = true;
    }],
    ["duplicate producer", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.producers.push({ ...state.logistics!.supply!.producers[0]! });
    }],
    ["missing producer", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.producers = [];
    }],
    ["unknown producer tower", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.producers[0]!.towerId = "tower_unknown";
    }],
    ["producer amount above capacity", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.producers[0]!.amount = 21;
    }],
    ["negative production progress", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.producers[0]!.productionProgress = -0.01;
    }],
    ["production progress reaches interval", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.producers[0]!.productionProgress = 0.2;
    }],
    ["transfer progress exceeds interval", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.producers[0]!.transferProgress = 0.21;
    }],
    ["missing storage", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.storages = [];
    }],
    ["storage amount above capacity", (state: MutableCheckpoint["state"]) => {
      state.logistics!.supply!.storages[0]!.amount = 21;
    }],
    ["unknown storage row field", (state: MutableCheckpoint["state"]) => {
      (state.logistics!.supply!.storages[0] as unknown as Record<string, unknown>).extra = true;
    }]
  ] as const)("rejects digest-valid malformed checkpoint v2 atomically: %s", (_label, mutate) => {
    const subjectContent = content();
    const live = new TowerDefenseGame({ content: subjectContent, missionId: "supply", seed: "malformed-v2" });
    place(live, "factory", { q: 1, r: 2 });
    place(live, "depot", { q: 2, r: 2 });
    place(live, "consumer_single", { q: 3, r: 2 });
    const valid = live.createCheckpoint();
    expect(() => restore(subjectContent, valid)).not.toThrow();
    const forged = mutableCheckpoint(valid);
    mutate(forged.state);
    resign(forged);
    const forgedBefore = structuredClone(forged);
    const liveBefore = live.createCheckpoint();

    expect(() => restore(subjectContent, forged)).toThrow(
      /checkpoint|logistics|supply|producer|storage|tower|amount|progress|order|field|schema|required/i
    );
    expect(forged).toEqual(forgedBefore);
    expect(live.createCheckpoint()).toEqual(liveBefore);
  });

  it("rejects rows for downed sources and accepts the same checkpoint after the derived row is removed", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "supply", seed: "downed-source" });
    place(subject, "factory", { q: 1, r: 2 });
    const checkpoint = mutableCheckpoint(subject.createCheckpoint());
    checkpoint.state.towers[0]!.hp = 0;
    resign(checkpoint);
    expect(() => restore(subjectContent, checkpoint)).toThrow(/logistics|supply|producer|downed|tower/i);

    checkpoint.state.logistics!.supply!.producers = [];
    resign(checkpoint);
    expect(() => restore(subjectContent, checkpoint)).not.toThrow();
  });

  it("matches continuous and checkpoint-restored suffix stock, progress, events, snapshots, and digest", () => {
    const subjectContent = content({
      supply: supplyFixture({
        producers: {
          powered_factory: {
            recipeId: "forge_shell", capacity: 20, startingAmount: 4,
            transferRadius: 12, transferAmount: 4, transferInterval: 0.2
          }
        },
        storages: {}
      })
    });
    const continuous = new TowerDefenseGame({ content: subjectContent, missionId: "supply", seed: "restore-supply" });
    place(continuous, "powered_factory", { q: 1, r: 9 });
    place(continuous, "consumer_single", { q: 2, r: 9 });
    continuous.tick(0.1);
    const restored = restore(subjectContent, continuous.createCheckpoint());

    for (const units of [0, 0.1, 0.2, 0.4]) {
      continuous.tick(units);
      restored.tick(units);
      expect(logistics(restored)).toEqual(logistics(continuous));
      expect(restored.lastEvents).toEqual(continuous.lastEvents);
      expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    }
  });

  it("replays identical supply state and digest through the unchanged v1 command journal", () => {
    const subjectContent = content();
    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent,
      missionId: "supply",
      seed: "journal-supply"
    }));
    const commands = [
      { schemaVersion: 1 as const, type: "placeTower" as const, towerTypeId: "factory", coord: { q: 1, r: 9 } },
      { schemaVersion: 1 as const, type: "placeTower" as const, towerTypeId: "depot", coord: { q: 4, r: 9 } },
      { schemaVersion: 1 as const, type: "placeTower" as const, towerTypeId: "consumer_single", coord: { q: 2, r: 9 } },
      { schemaVersion: 1 as const, type: "startWave" as const },
      { schemaVersion: 1 as const, type: "tick" as const, units: 0 },
      { schemaVersion: 1 as const, type: "tick" as const, units: 0.2 }
    ];
    for (const command of commands) expect(session.dispatch(command)).toEqual({ ok: true });
    const journal = session.exportJournal();
    const replay = replayGameCommandJournal({ content: subjectContent, journal });

    expect(journal.schemaVersion).toBe(1);
    expect((journal.initialCheckpoint.state as unknown as MutableCheckpoint["state"]).logistics?.schemaVersion).toBe(2);
    expect(replay.entriesReplayed).toBe(commands.length);
    expect(logistics(replay.game)).toEqual(logistics(session.game as TowerDefenseGame));
    expect(replay.game.getSnapshot()).toEqual(session.game.getSnapshot());
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
  });

  it.each(["amount", "productionProgress", "transferProgress"] as const)(
    "includes producer %s in the stable state digest and restores its exact value",
    (field) => {
      const subjectContent = content();
      const subject = new TowerDefenseGame({ content: subjectContent, missionId: "supply", seed: `digest-${field}` });
      place(subject, "factory", { q: 1, r: 2 });
      const original = mutableCheckpoint(subject.createCheckpoint());
      const changed = mutableCheckpoint(subject.createCheckpoint());
      const producer = changed.state.logistics!.supply!.producers[0]!;
      if (field === "amount") producer.amount = 3;
      else if (field === "productionProgress") producer.productionProgress = 0.05;
      else producer.transferProgress = 0.1;
      resign(changed);

      expect(changed.stateDigest).not.toBe(original.stateDigest);
      const restored = restore(subjectContent, changed);
      expect(producerRow(restored, "tower_1")?.[field]).toBe(producer[field]);
    }
  );

  it("keeps supply snapshot/checkpoint reads detached, deeply frozen, bounded, RNG-neutral, and event-neutral", () => {
    const subject = game({}, "read-purity-supply");
    place(subject, "factory", { q: 1, r: 2 });
    place(subject, "depot", { q: 2, r: 2 });
    place(subject, "consumer_single", { q: 3, r: 2 });
    const checkpointBefore = subject.createCheckpoint();
    const digestBefore = subject.getStateDigest();
    const eventsBefore = structuredClone(subject.lastEvents);

    const first = logistics(subject)!;
    const second = logistics(subject)!;

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.supply).not.toBe(second.supply);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.supply)).toBe(true);
    expect(Object.isFrozen(first.supply!.producers)).toBe(true);
    expect(Object.isFrozen(first.supply!.producers[0])).toBe(true);
    expect(Object.isFrozen(first.supply!.storages)).toBe(true);
    expect(Object.isFrozen(first.supply!.edges)).toBe(true);
    expect(first.supply!.producers.length + first.supply!.storages.length).toBeLessThanOrEqual(subject.towers.length);
    expect(first.supply!.edges.length).toBeLessThanOrEqual(65_536);
    expect(() => (first.supply!.producers as SupplyProducerSnapshotFixture[]).push(first.supply!.producers[0]!)).toThrow();
    expect(subject.createCheckpoint()).toEqual(checkpointBefore);
    expect(subject.getStateDigest()).toBe(digestBefore);
    expect(subject.lastEvents).toEqual(eventsBefore);
  });
});
