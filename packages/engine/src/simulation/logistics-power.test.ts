import { describe, expect, it, vi } from "vitest";
import {
  computeCheckpointStateDigest,
  JournaledGameSession,
  replayGameCommandJournal,
  type GameCheckpointV1,
  type GameEvent
} from "../index.js";
import {
  buildLogisticsPowerSnapshotV1,
  preflightLogisticsPowerTopologyV1
} from "./logistics-power.js";
import {
  createGameContentRegistry,
  type GameContentInput,
  type GameContentRegistry
} from "../content/registry.js";
import { TowerDefenseGame } from "./TowerDefenseGame.js";
import type { GridCoord, GridDefinition, TowerState } from "./types.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;
type Assert<T extends true> = T;
type CheckpointHasNoLogisticsState = Assert<
  Equal<Extract<keyof GameCheckpointV1["state"], "logistics">, never>
>;
type GameEventsHaveNoPowerEvent = Assert<
  Equal<Extract<GameEvent["type"], `power${string}` | `logistics${string}`>, never>
>;
const checkpointHasNoLogisticsState: CheckpointHasNoLogisticsState = true;
const gameEventsHaveNoPowerEvent: GameEventsHaveNoPowerEvent = true;
void checkpointHasNoLogisticsState;
void gameEventsHaveNoPowerEvent;

type AttackKind = "single" | "sniper" | "antiair" | "splash" | "pulse" | "pipeline";
type Mode = "active" | "absent" | "disabled" | "unselected" | "null" | "future";

interface GeneratorFixture {
  readonly output: number;
  readonly linkRadius: number;
  readonly coverageRadius: number;
}

interface RelayFixture {
  readonly linkRadius: number;
  readonly coverageRadius: number;
}

interface ConsumerFixture {
  readonly demand: number;
  readonly priority: number;
}

interface PowerFixture {
  readonly generators: Record<string, GeneratorFixture>;
  readonly relays: Record<string, RelayFixture>;
  readonly consumers: Record<string, ConsumerFixture>;
}

interface FixtureOptions {
  readonly mode?: Mode;
  readonly grid?: GridDefinition;
  readonly power?: PowerFixture;
  readonly groups?: readonly { enemyId: "ground" | "flyer" | "saboteur"; count?: number }[];
  readonly width?: number;
  readonly height?: number;
  readonly startingCoins?: number;
  readonly reversePowerRecords?: boolean;
  readonly groundMaxHp?: number;
}

interface LogisticsComponentSnapshotV1 {
  readonly id: string;
  readonly output: number;
  readonly demand: number;
  readonly allocated: number;
  readonly nodeIds: readonly string[];
  readonly consumerIds: readonly string[];
}

interface LogisticsNodeSnapshotV1 {
  readonly towerId: string;
  readonly towerTypeId: string;
  readonly role: "generator" | "relay";
  readonly componentId: string;
  readonly output: number;
  readonly linkTowerIds: readonly string[];
  readonly coveredConsumerIds: readonly string[];
}

interface LogisticsConsumerSnapshotV1 {
  readonly towerId: string;
  readonly towerTypeId: string;
  readonly demand: number;
  readonly priority: number;
  readonly nodeId: string | null;
  readonly componentId: string | null;
  readonly powered: boolean;
}

interface LogisticsSnapshotV1 {
  readonly schemaVersion: 1;
  readonly power: {
    readonly components: readonly LogisticsComponentSnapshotV1[];
    readonly nodes: readonly LogisticsNodeSnapshotV1[];
    readonly consumers: readonly LogisticsConsumerSnapshotV1[];
  };
}

const SQUARE: GridDefinition = Object.freeze({ kind: "square", adjacency: "cardinal" });
const HEX: GridDefinition = Object.freeze({ kind: "hex", layout: "odd-r" });

const DEFAULT_POWER: PowerFixture = {
  generators: {
    gen: { output: 10, linkRadius: 4, coverageRadius: 4 },
    gen_attack: { output: 10, linkRadius: 4, coverageRadius: 4 },
    gen_big: { output: 20, linkRadius: 4, coverageRadius: 5 },
    gen_wide: { output: 10, linkRadius: 3, coverageRadius: 2 }
  },
  relays: {
    relay: { linkRadius: 4, coverageRadius: 4 },
    relay_attack: { linkRadius: 4, coverageRadius: 4 },
    relay_wide: { linkRadius: 3, coverageRadius: 2 }
  },
  consumers: {
    consumer_single: { demand: 6, priority: 10 },
    consumer_single_b: { demand: 5, priority: 10 },
    consumer_small: { demand: 1, priority: 10 },
    consumer_low_priority: { demand: 8, priority: 1 },
    consumer_high_priority: { demand: 8, priority: 20 },
    consumer_sniper: { demand: 4, priority: 10 },
    consumer_antiair: { demand: 4, priority: 10 },
    consumer_splash: { demand: 4, priority: 10 },
    consumer_pulse: { demand: 4, priority: 10 },
    consumer_pipeline: { demand: 4, priority: 10 },
    consumer_wide: { demand: 4, priority: 10 }
  }
};

function singleAttack(damage = 1): Record<string, unknown> {
  return {
    kind: "single", fireRate: 4, damagePerStack: damage,
    startingStacks: 1, maxStacks: 1, upgradeCost: 1
  };
}

function attack(kind: AttackKind): Record<string, unknown> {
  if (kind === "single") return singleAttack(3);
  if (kind === "sniper") return { kind, interval: 0.25, damage: 3, targetPriority: "first" };
  if (kind === "antiair") {
    return { kind, fireRate: 4, damage: 3, maxTargetsByLevel: [1, 1, 1, 1], upgradeCosts: [] };
  }
  if (kind === "splash") {
    return {
      kind, interval: 0.25, damage: 3, splashDamage: 1, armoredChipDamage: 0,
      splashRadius: 2, slowFactor: 0.5, slowDuration: 1
    };
  }
  if (kind === "pulse") {
    return { kind, pulseRate: 4, pulseDamage: 3, dotDamagePerUnit: 2, dotDuration: 2 };
  }
  return {
    kind: "pipeline", interval: 0.25,
    targeting: { classes: ["ground"], mode: "first", maxTargets: 1 },
    delivery: { kind: "single" },
    effects: [
      { kind: "damage", amount: 3 },
      { kind: "status", status: { poison: { dps: 1, duration: 2 } } },
      { kind: "resource", resources: { coins: 7 } },
      { kind: "displacement", mode: "push", distance: 1, stopAtBlocker: true }
    ]
  };
}

function tower(
  id: string,
  towerAttack: Record<string, unknown>,
  footprintRadius = 0,
  maxHp?: number
): Record<string, unknown> {
  return {
    id,
    label: id,
    cost: { coins: 1 },
    footprintRadius,
    range: 30,
    ...(maxHp === undefined ? {} : { maxHp }),
    attack: towerAttack
  };
}

function reversedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).reverse());
}

function input(options: FixtureOptions = {}): GameContentInput {
  const mode = options.mode ?? "active";
  const width = options.width ?? 24;
  const height = options.height ?? 12;
  const pathRow = height - 1;
  const power = options.power ?? DEFAULT_POWER;
  const authoredPower = options.reversePowerRecords
    ? {
        generators: reversedRecord(power.generators),
        relays: reversedRecord(power.relays),
        consumers: reversedRecord(power.consumers)
      }
    : power;
  const modules: Record<string, unknown> = {};
  if (mode !== "absent") {
    modules.logistics = {
      schemaVersion: mode === "future" ? 2 : 1,
      enabled: mode !== "disabled",
      profiles: { grid: { power: mode === "null" ? null : authoredPower } }
    };
  }
  const mechanicsProfiles = mode === "absent" || mode === "unselected"
    ? undefined
    : { logistics: "grid" };
  const groups = options.groups ?? [{ enemyId: "ground" as const }];
  const startingCoins = options.startingCoins ?? 100_000;

  const towers: Record<string, unknown> = {
    gen: tower("gen", singleAttack(0), 0, 10),
    gen_attack: tower("gen_attack", singleAttack()),
    gen_big: tower("gen_big", singleAttack(0)),
    gen_durable: tower("gen_durable", singleAttack(0), 0, 10),
    gen_wide: tower("gen_wide", singleAttack(0), 1),
    relay: tower("relay", singleAttack(0)),
    relay_attack: tower("relay_attack", singleAttack()),
    relay_durable: tower("relay_durable", singleAttack(0), 0, 10),
    relay_wide: tower("relay_wide", singleAttack(0), 1),
    consumer_durable: tower("consumer_durable", attack("single"), 0, 10),
    consumer_single: tower("consumer_single", attack("single")),
    consumer_single_b: tower("consumer_single_b", attack("single")),
    consumer_small: tower("consumer_small", attack("single")),
    consumer_low_priority: tower("consumer_low_priority", attack("single")),
    consumer_high_priority: tower("consumer_high_priority", attack("single")),
    consumer_sniper: tower("consumer_sniper", attack("sniper")),
    consumer_antiair: tower("consumer_antiair", attack("antiair")),
    consumer_splash: tower("consumer_splash", attack("splash")),
    consumer_pulse: tower("consumer_pulse", attack("pulse")),
    consumer_pipeline: tower("consumer_pipeline", attack("pipeline")),
    consumer_pulse_durable: tower("consumer_pulse_durable", attack("pulse"), 0, 10),
    consumer_wide: tower("consumer_wide", attack("single"), 1),
    legacy: tower("legacy", singleAttack()),
    support_only: tower("support_only", { kind: "support", auraRadius: 0, unlocksTowerIds: [] })
  };

  return {
    balance: {
      defaultMissionId: "power",
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
          id: "ground", label: "Ground", maxHp: options.groundMaxHp ?? 10_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 1
        },
        flyer: {
          id: "flyer", label: "Flyer", maxHp: 10_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 2,
          targetClass: "flying", movementKind: "direct_flying"
        },
        saboteur: {
          id: "saboteur", label: "Saboteur", maxHp: 10_000, speed: 0.01,
          reward: { coins: 1 }, coinReward: 1, coreDamage: 1, color: 3,
          towerAttack: { interval: 0.01, damage: 100, range: 4 }
        }
      },
      towers: towers as GameContentInput["balance"]["towers"],
      waveSets: {
        one: [{
          id: "wave", label: "Wave",
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
        power: {
          id: "power", label: "Power", description: "",
          startingCoreHp: 100,
          startingResources: { coins: startingCoins },
          prepTimeUnits: 0,
          mapId: "grid",
          waveSetId: "one",
          buildTowerIds: Object.keys(towers),
          abilityIds: [],
          ...(mechanicsProfiles === undefined ? {} : { mechanics: { profiles: mechanicsProfiles } })
        }
      }
    },
    maps: {
      grid: {
        id: "grid",
        width,
        height,
        grid: options.grid ?? SQUARE,
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
        missionId: "power", regionId: "region", x: 5, y: 5,
        difficulty: 1, unlockRequiresMissionIds: []
      }]
    }
  };
}

function content(options: FixtureOptions = {}): GameContentRegistry {
  return createGameContentRegistry(input(options));
}

function game(options: FixtureOptions = {}): TowerDefenseGame {
  return new TowerDefenseGame({ content: content(options), missionId: "power", seed: "power-grid" });
}

function logistics(subject: TowerDefenseGame): LogisticsSnapshotV1 | undefined {
  return (subject.getSnapshot() as unknown as { logistics?: LogisticsSnapshotV1 }).logistics;
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

function binarySorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function gridCoords(count: number, width: number): GridCoord[] {
  return Array.from({ length: count }, (_, index) => ({
    q: index % width,
    r: Math.floor(index / width)
  }));
}

const DENSE_NODE_COORDS = Object.freeze([
  ...gridCoords(361, 19),
  Object.freeze({ q: 19, r: 0 })
]);
const DENSE_NODE_CANDIDATE = Object.freeze({ q: 19, r: 1 });
const ISOLATED_NODE_COORD = Object.freeze({ q: 100, r: 0 });

function placeAll(subject: TowerDefenseGame, typeId: string, coords: readonly GridCoord[]): string[] {
  return coords.map((coord) => place(subject, typeId, coord));
}

function resignCheckpoint(checkpoint: {
  contentDigest: string;
  identity: GameCheckpointV1["identity"];
  rng: GameCheckpointV1["rng"];
  state: GameCheckpointV1["state"];
  stateDigest: string;
}): void {
  checkpoint.stateDigest = computeCheckpointStateDigest(
    checkpoint.contentDigest,
    checkpoint.identity,
    checkpoint.rng,
    checkpoint.state
  );
}

function checkpointWithTowerHp(
  checkpoint: GameCheckpointV1,
  towerId: string,
  hp: number
): GameCheckpointV1 {
  const forged = structuredClone(checkpoint) as unknown as {
    contentDigest: string;
    identity: GameCheckpointV1["identity"];
    rng: GameCheckpointV1["rng"];
    state: GameCheckpointV1["state"] & { towers: TowerState[] };
    stateDigest: string;
  };
  const tower = forged.state.towers.find((candidate) => candidate.id === towerId);
  if (!tower || tower.hp === undefined) throw new Error(`Tower ${towerId} is not durable.`);
  tower.hp = hp;
  resignCheckpoint(forged);
  return forged as unknown as GameCheckpointV1;
}

function undirectedEdgeCount(snapshot: LogisticsSnapshotV1): number {
  return snapshot.power.nodes.reduce((sum, node) => sum + node.linkTowerIds.length, 0) / 2;
}

describe("R5.7A logistics power topology and allocation", () => {
  it.each([
    ["square", SQUARE],
    ["hex", HEX]
  ] as const)("uses %s topology footprint edge distance for links and coverage", (_label, grid) => {
    const subject = game({
      grid,
      power: {
        generators: { gen_wide: { output: 10, linkRadius: 3, coverageRadius: 2 } },
        relays: { relay_wide: { linkRadius: 3, coverageRadius: 2 } },
        consumers: { consumer_wide: { demand: 4, priority: 10 } }
      }
    });
    const generatorId = place(subject, "gen_wide", { q: 2, r: 3 });
    const relayId = place(subject, "relay_wide", { q: 7, r: 3 });
    const consumerId = place(subject, "consumer_wide", { q: 2, r: 7 });

    expect(subject.map.distance({ q: 2, r: 3 }, { q: 7, r: 3 })).toBe(5);
    expect(subject.map.distance({ q: 2, r: 3 }, { q: 2, r: 7 })).toBe(4);
    expect(logistics(subject)).toEqual({
      schemaVersion: 1,
      power: {
        components: [{
          id: generatorId, output: 10, demand: 4, allocated: 4,
          nodeIds: [generatorId, relayId], consumerIds: [consumerId]
        }],
        nodes: [
          {
            towerId: generatorId, towerTypeId: "gen_wide", role: "generator",
            componentId: generatorId, output: 10, linkTowerIds: [relayId],
            coveredConsumerIds: [consumerId]
          },
          {
            towerId: relayId, towerTypeId: "relay_wide", role: "relay",
            componentId: generatorId, output: 0, linkTowerIds: [generatorId],
            coveredConsumerIds: []
          }
        ],
        consumers: [{
          towerId: consumerId, towerTypeId: "consumer_wide", demand: 4, priority: 10,
          nodeId: generatorId, componentId: generatorId, powered: true
        }]
      }
    });
  });

  it("requires both authored link radii and never merges components wirelessly through consumers", () => {
    const subject = game({
      power: {
        generators: {
          gen: { output: 10, linkRadius: 4, coverageRadius: 4 },
          gen_big: { output: 20, linkRadius: 2, coverageRadius: 4 }
        },
        relays: {},
        consumers: { consumer_single: { demand: 6, priority: 10 } }
      }
    });
    const left = place(subject, "gen", { q: 2, r: 2 });
    const right = place(subject, "gen_big", { q: 6, r: 2 });
    const consumer = place(subject, "consumer_single", { q: 4, r: 3 });
    const snapshot = logistics(subject)!;

    expect(snapshot.power.components).toEqual([
      { id: left, output: 10, demand: 6, allocated: 6, nodeIds: [left], consumerIds: [consumer] },
      { id: right, output: 20, demand: 0, allocated: 0, nodeIds: [right], consumerIds: [] }
    ]);
    expect(snapshot.power.nodes.map((node) => node.linkTowerIds)).toEqual([[], []]);
    expect(snapshot.power.consumers[0]).toMatchObject({ nodeId: left, componentId: left, powered: true });
  });

  it("builds relay bridges, sums all generators, and uses the binary-lowest node as component id", () => {
    const subject = game({
      power: {
        generators: {
          gen: { output: 10, linkRadius: 3, coverageRadius: 1 },
          gen_big: { output: 20, linkRadius: 3, coverageRadius: 1 }
        },
        relays: { relay: { linkRadius: 3, coverageRadius: 4 } },
        consumers: { consumer_single: { demand: 6, priority: 10 } }
      }
    });
    const rightGenerator = place(subject, "gen_big", { q: 8, r: 2 });
    const relay = place(subject, "relay", { q: 5, r: 2 });
    const leftGenerator = place(subject, "gen", { q: 2, r: 2 });
    const consumer = place(subject, "consumer_single", { q: 5, r: 5 });
    const componentId = binarySorted([rightGenerator, relay, leftGenerator])[0]!;

    expect(logistics(subject)!.power.components).toEqual([{
      id: componentId,
      output: 30,
      demand: 6,
      allocated: 6,
      nodeIds: binarySorted([rightGenerator, relay, leftGenerator]),
      consumerIds: [consumer]
    }]);
  });

  it("attaches by nearest footprint edge distance and then binary node id", () => {
    const subject = game({
      power: {
        generators: {
          gen: { output: 10, linkRadius: 0, coverageRadius: 5 },
          gen_big: { output: 20, linkRadius: 0, coverageRadius: 5 }
        },
        relays: {},
        consumers: {
          consumer_single: { demand: 2, priority: 1 },
          consumer_single_b: { demand: 2, priority: 1 }
        }
      }
    });
    const left = place(subject, "gen", { q: 2, r: 2 });
    const right = place(subject, "gen_big", { q: 8, r: 2 });
    const tie = place(subject, "consumer_single", { q: 5, r: 2 });
    const nearest = place(subject, "consumer_single_b", { q: 7, r: 3 });
    const consumers = logistics(subject)!.power.consumers;

    expect(consumers.find((entry) => entry.towerId === tie)).toMatchObject({ nodeId: left, componentId: left });
    expect(consumers.find((entry) => entry.towerId === nearest)).toMatchObject({ nodeId: right, componentId: right });
  });

  it("publishes isolated nodes and unattached consumers without inventing supply", () => {
    const subject = game({
      power: {
        generators: { gen: { output: 10, linkRadius: 1, coverageRadius: 1 } },
        relays: { relay: { linkRadius: 1, coverageRadius: 1 } },
        consumers: { consumer_single: { demand: 4, priority: 10 } }
      }
    });
    const generator = place(subject, "gen", { q: 1, r: 1 });
    const relay = place(subject, "relay", { q: 10, r: 1 });
    const consumer = place(subject, "consumer_single", { q: 18, r: 1 });
    const snapshot = logistics(subject)!;

    expect(snapshot.power.components).toEqual([
      { id: generator, output: 10, demand: 0, allocated: 0, nodeIds: [generator], consumerIds: [] },
      { id: relay, output: 0, demand: 0, allocated: 0, nodeIds: [relay], consumerIds: [] }
    ]);
    expect(snapshot.power.consumers).toEqual([{
      towerId: consumer, towerTypeId: "consumer_single", demand: 4, priority: 10,
      nodeId: null, componentId: null, powered: false
    }]);
  });

  it("uses priority then binary tower id and stops the whole brownout suffix at the first miss", () => {
    const subject = game({
      power: {
        generators: { gen: { output: 14, linkRadius: 4, coverageRadius: 20 } },
        relays: {},
        consumers: {
          consumer_single: { demand: 6, priority: 10 },
          consumer_single_b: { demand: 9, priority: 10 },
          consumer_small: { demand: 1, priority: 10 },
          consumer_low_priority: { demand: 8, priority: 1 },
          consumer_high_priority: { demand: 8, priority: 20 }
        }
      }
    });
    const generator = place(subject, "gen", { q: 1, r: 1 });
    const firstSamePriority = place(subject, "consumer_single", { q: 2, r: 2 });
    const miss = place(subject, "consumer_single_b", { q: 3, r: 2 });
    const fitsButSuffix = place(subject, "consumer_small", { q: 4, r: 2 });
    const lowPriority = place(subject, "consumer_low_priority", { q: 5, r: 2 });
    const highPriority = place(subject, "consumer_high_priority", { q: 6, r: 2 });
    const snapshot = logistics(subject)!;
    const byId = new Map(snapshot.power.consumers.map((entry) => [entry.towerId, entry]));

    expect(byId.get(lowPriority)?.powered).toBe(true);
    expect(byId.get(firstSamePriority)?.powered).toBe(true);
    expect(byId.get(miss)?.powered).toBe(false);
    expect(byId.get(fitsButSuffix)?.powered).toBe(false);
    expect(byId.get(highPriority)?.powered).toBe(false);
    expect(snapshot.power.components).toEqual([{
      id: generator,
      output: 14,
      demand: 32,
      allocated: 14,
      nodeIds: [generator],
      consumerIds: binarySorted([firstSamePriority, miss, fitsButSuffix, lowPriority, highPriority])
    }]);
  });

  it("uses binary rather than numeric or locale order for tower-id allocation ties", () => {
    const subject = game({
      power: {
        generators: { gen: { output: 6, linkRadius: 1, coverageRadius: 20 } },
        relays: {},
        consumers: { consumer_single: { demand: 6, priority: 10 } }
      }
    });
    place(subject, "gen", { q: 1, r: 1 });
    for (let index = 0; index < 9; index += 1) {
      place(subject, "consumer_single", { q: index + 2, r: 3 });
    }
    const consumers = logistics(subject)!.power.consumers;

    expect(consumers.map((entry) => entry.towerId)).toEqual([
      "tower_10", "tower_2", "tower_3", "tower_4", "tower_5",
      "tower_6", "tower_7", "tower_8", "tower_9"
    ]);
    expect(consumers.filter((entry) => entry.powered).map((entry) => entry.towerId)).toEqual(["tower_10"]);
  });

  it("keeps the derived power snapshot independent of authored record and live tower array order", () => {
    const first = game();
    const second = game({ reversePowerRecords: true });
    const placements = [
      ["gen", { q: 1, r: 1 }],
      ["relay", { q: 4, r: 1 }],
      ["gen_big", { q: 7, r: 1 }],
      ["consumer_single", { q: 3, r: 4 }],
      ["consumer_small", { q: 6, r: 4 }]
    ] as const;
    for (const [typeId, coord] of placements) {
      place(first, typeId, coord);
      place(second, typeId, coord);
    }
    second.towers.reverse();

    expect(logistics(second)).toEqual(logistics(first));
  });
});

describe("R5.7A powered firing and cooldown contract", () => {
  it.each([
    ["single", "ground"],
    ["sniper", "ground"],
    ["antiair", "flyer"],
    ["splash", "ground"],
    ["pulse", "ground"],
    ["pipeline", "ground"]
  ] as const)("gates an unpowered %s consumer before target acquisition and attack", (kind, enemyId) => {
    const typeId = `consumer_${kind}`;
    const subject = game({
      groups: [{ enemyId }],
      power: {
        generators: {},
        relays: {},
        consumers: { [typeId]: { demand: 4, priority: 10 } }
      }
    });
    const towerId = place(subject, typeId, { q: 2, r: 9 });
    const selectTargets = vi.spyOn(subject as unknown as { selectTargets: (...args: unknown[]) => unknown }, "selectTargets");
    const coinsAfterPlacement = subject.resources.coins;
    spawn(subject);
    const enemy = subject.enemies[0]!;

    expect(logistics(subject)!.power.consumers).toEqual([{
      towerId, towerTypeId: typeId, demand: 4, priority: 10,
      nodeId: null, componentId: null, powered: false
    }]);
    expect(enemy.hp).toBe(enemy.maxHp);
    expect(enemy.statuses).toEqual({});
    expect(subject.resources.coins).toBe(coinsAfterPlacement);
    expect(subject.lastEvents.some((event) => event.type === "towerFired" || event.type === "areaPulse")).toBe(false);
    expect(selectTargets).not.toHaveBeenCalled();
  });

  it("suppresses and then restores the complete pulse field including its DoT", () => {
    const subject = game({
      power: {
        generators: { gen: { output: 10, linkRadius: 0, coverageRadius: 4 } },
        relays: {},
        consumers: { consumer_pulse: { demand: 4, priority: 10 } }
      }
    });
    const pulseId = place(subject, "consumer_pulse", { q: 2, r: 9 });
    spawn(subject);
    expect(subject.lastEvents.some((event) => event.type === "areaPulse")).toBe(false);
    expect(subject.enemies[0]!.dotRemaining).toBe(0);

    place(subject, "gen", { q: 1, r: 7 });
    subject.tick(0);

    expect(logistics(subject)!.power.consumers[0]).toMatchObject({ towerId: pulseId, powered: true });
    expect(subject.lastEvents).toContainEqual({ type: "areaPulse", towerId: pulseId, enemyIds: ["enemy_1"] });
    expect(subject.enemies[0]!.dotRemaining).toBe(2);
  });

  it("treats a brownout pulse field as inactive so its existing DoT resumes while cooldown stays frozen", () => {
    const subject = game({
      power: {
        generators: { gen: { output: 10, linkRadius: 0, coverageRadius: 4 } },
        relays: {},
        consumers: { consumer_pulse: { demand: 4, priority: 10 } }
      }
    });
    const pulseId = place(subject, "consumer_pulse", { q: 2, r: 9 });
    const generatorId = place(subject, "gen", { q: 1, r: 7 });
    spawn(subject);
    const enemy = subject.enemies[0]!;
    const pulse = subject.towers.find((tower) => tower.id === pulseId)!;
    const hpAfterPulse = enemy.hp;
    const cooldownAfterPulse = pulse.cooldown;

    expect(enemy.dotRemaining).toBe(2);
    expect(subject.sellTower(generatorId)).toEqual({ ok: true });
    expect(logistics(subject)!.power.consumers[0]).toMatchObject({ towerId: pulseId, powered: false });

    subject.tick(0.2);

    expect(enemy.dotRemaining).toBeCloseTo(1.8, 12);
    expect(enemy.hp).toBeCloseTo(hpAfterPulse - 0.4, 12);
    expect(pulse.cooldown).toBe(cooldownAfterPulse);
    expect(subject.lastEvents.some((event) => event.type === "areaPulse")).toBe(false);
  });

  it("prevents every pipeline side effect and does not spend or fabricate an attack event", () => {
    const subject = game({
      power: {
        generators: {},
        relays: {},
        consumers: { consumer_pipeline: { demand: 4, priority: 10 } }
      }
    });
    place(subject, "consumer_pipeline", { q: 2, r: 9 });
    const coins = subject.resources.coins;
    spawn(subject);
    const enemy = subject.enemies[0]!;
    const beforeCoord = { ...(enemy.navigation?.currentCoord ?? subject.map.spawnCoord) };

    expect(enemy.hp).toBe(enemy.maxHp);
    expect(enemy.statuses).toEqual({});
    expect(subject.resources.coins).toBe(coins);
    expect(enemy.navigation?.currentCoord ?? subject.map.spawnCoord).toEqual(beforeCoord);
    expect(subject.lastEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "towerFired" }),
      expect.objectContaining({ type: "towerResourcesGranted" }),
      expect.objectContaining({ type: "enemyDisplacementResolved" })
    ]));
  });

  it("freezes an exact positive cooldown while unpowered and resumes ordinary decrement after recovery", () => {
    const subject = game({
      power: {
        generators: { gen: { output: 10, linkRadius: 0, coverageRadius: 4 } },
        relays: {},
        consumers: { consumer_single: { demand: 4, priority: 10 } }
      }
    });
    place(subject, "consumer_single", { q: 3, r: 4 });
    subject.towers[0]!.cooldown = 0.75;

    subject.tick(0.2);
    expect(subject.towers[0]!.cooldown).toBe(0.75);

    place(subject, "gen", { q: 1, r: 4 });
    subject.tick(0.2);
    expect(subject.towers.find((tower) => tower.typeId === "consumer_single")!.cooldown).toBeCloseTo(0.55, 12);
  });

  it("preserves ready cooldown <= 0 and fires immediately, exactly once, when supply returns", () => {
    const subject = game({
      power: {
        generators: { gen: { output: 10, linkRadius: 0, coverageRadius: 4 } },
        relays: {},
        consumers: { consumer_single: { demand: 4, priority: 10 } }
      }
    });
    const consumer = place(subject, "consumer_single", { q: 2, r: 9 });
    subject.towers[0]!.cooldown = -0.125;
    spawn(subject);
    expect(subject.towers[0]!.cooldown).toBe(-0.125);

    place(subject, "gen", { q: 1, r: 7 });
    subject.tick(0);
    const fired = subject.lastEvents.filter((event) => event.type === "towerFired" && event.towerId === consumer);

    expect(fired).toHaveLength(1);
    expect(subject.towers.find((tower) => tower.id === consumer)!.cooldown).toBeGreaterThan(0);
  });

  it.each([false, true])("keeps disruption time separate while cooldown remains frozen (powered=%s)", (powered) => {
    const subject = game({
      power: {
        generators: { gen: { output: 10, linkRadius: 0, coverageRadius: 4 } },
        relays: {},
        consumers: { consumer_single: { demand: 4, priority: 10 } }
      }
    });
    const consumerId = place(subject, "consumer_single", { q: 3, r: 4 });
    if (powered) place(subject, "gen", { q: 1, r: 4 });
    const consumer = subject.towers.find((tower) => tower.id === consumerId)!;
    consumer.cooldown = 0.75;
    consumer.disabledFor = 0.5;

    subject.tick(0.2);

    expect(consumer.disabledFor).toBeCloseTo(0.3, 12);
    expect(consumer.cooldown).toBe(0.75);
  });

  it("keeps generator, relay, and non-consumer attacks on the legacy firing branch", () => {
    const subject = game({
      power: {
        generators: { gen_attack: { output: 1, linkRadius: 0, coverageRadius: 0 } },
        relays: { relay_attack: { linkRadius: 0, coverageRadius: 0 } },
        consumers: {}
      }
    });
    const generator = place(subject, "gen_attack", { q: 1, r: 9 });
    const relay = place(subject, "relay_attack", { q: 2, r: 8 });
    const legacy = place(subject, "legacy", { q: 3, r: 9 });
    spawn(subject);
    const firingIds = subject.lastEvents
      .filter((event): event is Extract<GameEvent, { type: "towerFired" }> => event.type === "towerFired")
      .map((event) => event.towerId)
      .sort();

    expect(firingIds).toEqual([generator, relay, legacy].sort());
  });
});

describe("R5.7A downed power participant contract", () => {
  const durablePower: PowerFixture = {
    generators: { gen_durable: { output: 10, linkRadius: 4, coverageRadius: 4 } },
    relays: { relay_durable: { linkRadius: 4, coverageRadius: 4 } },
    consumers: { consumer_durable: { demand: 4, priority: 10 } }
  };

  it("excludes hp <= 0 towers from the direct power graph builder", () => {
    const subject = game({ power: durablePower });
    place(subject, "gen_durable", { q: 1, r: 2 });
    place(subject, "relay_durable", { q: 4, r: 2 });
    place(subject, "consumer_durable", { q: 6, r: 2 });
    subject.towers[0]!.hp = 0;
    subject.towers[1]!.hp = -1;
    subject.towers[2]!.hp = 0;

    expect(buildLogisticsPowerSnapshotV1(
      durablePower,
      subject.towers,
      subject.content.towers,
      subject.map
    )).toEqual({
      schemaVersion: 1,
      power: { components: [], nodes: [], consumers: [] }
    });
  });

  it("excludes hp <= 0 towers from direct topology preflight counts", () => {
    const subject = game({ power: durablePower });
    place(subject, "gen_durable", { q: 1, r: 2 });
    place(subject, "relay_durable", { q: 4, r: 2 });
    place(subject, "consumer_durable", { q: 6, r: 2 });
    subject.towers[0]!.hp = 0;
    subject.towers[1]!.hp = -1;
    subject.towers[2]!.hp = 0;

    expect(preflightLogisticsPowerTopologyV1(
      durablePower,
      subject.towers,
      subject.content.towers,
      subject.map
    )).toEqual({ participants: 0, nodes: 0, undirectedEdges: 0 });
  });

  it("restores an hp=0 generator without its supply, links, or coverage", () => {
    const subjectContent = content({ power: durablePower });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "power", seed: "downed-generator" });
    const generatorId = place(subject, "gen_durable", { q: 1, r: 3 });
    const relayId = place(subject, "relay_durable", { q: 4, r: 3 });
    const consumerId = place(subject, "consumer_durable", { q: 6, r: 3 });
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: checkpointWithTowerHp(subject.createCheckpoint(), generatorId, 0)
    });

    expect(logistics(restored)).toEqual({
      schemaVersion: 1,
      power: {
        components: [{
          id: relayId, output: 0, demand: 4, allocated: 0,
          nodeIds: [relayId], consumerIds: [consumerId]
        }],
        nodes: [{
          towerId: relayId, towerTypeId: "relay_durable", role: "relay",
          componentId: relayId, output: 0, linkTowerIds: [], coveredConsumerIds: [consumerId]
        }],
        consumers: [{
          towerId: consumerId, towerTypeId: "consumer_durable", demand: 4, priority: 10,
          nodeId: relayId, componentId: relayId, powered: false
        }]
      }
    });
  });

  it("restores an hp=0 relay without bridging generators or providing coverage", () => {
    const bridgePower: PowerFixture = {
      generators: { gen_durable: { output: 5, linkRadius: 4, coverageRadius: 0 } },
      relays: { relay_durable: { linkRadius: 4, coverageRadius: 4 } },
      consumers: { consumer_durable: { demand: 4, priority: 10 } }
    };
    const subjectContent = content({ power: bridgePower });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "power", seed: "downed-relay" });
    const leftId = place(subject, "gen_durable", { q: 1, r: 3 });
    const relayId = place(subject, "relay_durable", { q: 5, r: 3 });
    const rightId = place(subject, "gen_durable", { q: 9, r: 3 });
    const consumerId = place(subject, "consumer_durable", { q: 5, r: 6 });
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: checkpointWithTowerHp(subject.createCheckpoint(), relayId, 0)
    });

    expect(logistics(restored)!.power.components).toEqual([
      { id: leftId, output: 5, demand: 0, allocated: 0, nodeIds: [leftId], consumerIds: [] },
      { id: rightId, output: 5, demand: 0, allocated: 0, nodeIds: [rightId], consumerIds: [] }
    ]);
    expect(logistics(restored)!.power.nodes.map((node) => ({
      towerId: node.towerId,
      linkTowerIds: node.linkTowerIds,
      coveredConsumerIds: node.coveredConsumerIds
    }))).toEqual([
      { towerId: leftId, linkTowerIds: [], coveredConsumerIds: [] },
      { towerId: rightId, linkTowerIds: [], coveredConsumerIds: [] }
    ]);
    expect(logistics(restored)!.power.consumers).toEqual([{
      towerId: consumerId, towerTypeId: "consumer_durable", demand: 4, priority: 10,
      nodeId: null, componentId: null, powered: false
    }]);
  });

  it("omits an hp=0 pulse consumer from demand, coverage, allocation, and snapshot", () => {
    const pulsePower: PowerFixture = {
      generators: { gen_durable: { output: 10, linkRadius: 0, coverageRadius: 4 } },
      relays: {},
      consumers: { consumer_pulse_durable: { demand: 4, priority: 10 } }
    };
    const subjectContent = content({ power: pulsePower });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "power", seed: "downed-consumer" });
    const generatorId = place(subject, "gen_durable", { q: 1, r: 7 });
    const pulseId = place(subject, "consumer_pulse_durable", { q: 2, r: 9 });
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: checkpointWithTowerHp(subject.createCheckpoint(), pulseId, 0)
    });

    expect(logistics(restored)).toEqual({
      schemaVersion: 1,
      power: {
        components: [{
          id: generatorId, output: 10, demand: 0, allocated: 0,
          nodeIds: [generatorId], consumerIds: []
        }],
        nodes: [{
          towerId: generatorId, towerTypeId: "gen_durable", role: "generator",
          componentId: generatorId, output: 10, linkTowerIds: [], coveredConsumerIds: []
        }],
        consumers: []
      }
    });
  });

  it("does not execute an hp=0 consumer missing from the powered set", () => {
    const pulsePower: PowerFixture = {
      generators: { gen_durable: { output: 10, linkRadius: 0, coverageRadius: 4 } },
      relays: {},
      consumers: { consumer_pulse_durable: { demand: 4, priority: 10 } }
    };
    const subjectContent = content({ power: pulsePower });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "power", seed: "downed-consumer-fire" });
    place(subject, "gen_durable", { q: 1, r: 7 });
    const pulseId = place(subject, "consumer_pulse_durable", { q: 2, r: 9 });
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: checkpointWithTowerHp(subject.createCheckpoint(), pulseId, 0)
    });
    const pulse = restored.towers.find((tower) => tower.id === pulseId)!;

    spawn(restored);
    const enemy = restored.enemies[0]!;

    expect(enemy.hp).toBe(enemy.maxHp);
    expect(enemy.dotRemaining).toBe(0);
    expect(pulse.cooldown).toBe(0);
    expect(restored.lastEvents.some((event) => (
      event.type === "areaPulse" || (event.type === "towerFired" && event.towerId === pulseId)
    ))).toBe(false);
  });

  it("allows a placement at the participant limit when one restored participant has hp=0", { timeout: 30_000 }, () => {
    const subjectContent = content({
      width: 66,
      height: 66,
      startingCoins: 5_000,
      power: {
        generators: {},
        relays: {},
        consumers: { consumer_durable: { demand: 1, priority: 1 } }
      }
    });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "power", seed: "downed-participant-limit" });
    placeAll(subject, "consumer_durable", gridCoords(4_096, 64));
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: checkpointWithTowerHp(subject.createCheckpoint(), "tower_1", 0)
    });

    expect(restored.placeTower("consumer_durable", { q: 64, r: 64 })).toEqual({ ok: true });
    expect(restored.towers).toHaveLength(4_097);
    const snapshot = logistics(restored)!;
    expect(snapshot.power.consumers).toHaveLength(4_096);
    expect(snapshot.power.consumers.some((consumer) => consumer.towerId === "tower_1")).toBe(false);
  });

  it("allows a placement at the node limit when one restored node has hp=0", { timeout: 30_000 }, () => {
    const coords = gridCoords(1_025, 40);
    const subjectContent = content({
      width: 42,
      height: 30,
      startingCoins: 2_000,
      power: {
        generators: { gen_durable: { output: 1, linkRadius: 0, coverageRadius: 0 } },
        relays: {},
        consumers: {}
      }
    });
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "power", seed: "downed-node-limit" });
    placeAll(subject, "gen_durable", coords.slice(0, 1_024));
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: checkpointWithTowerHp(subject.createCheckpoint(), "tower_1", 0)
    });

    expect(restored.placeTower("gen_durable", coords[1_024]!)).toEqual({ ok: true });
    expect(restored.towers).toHaveLength(1_025);
    const snapshot = logistics(restored)!;
    expect(snapshot.power.nodes).toHaveLength(1_024);
    expect(snapshot.power.nodes.some((node) => node.towerId === "tower_1")).toBe(false);
  });
});

describe("R5.7A dirty cache, lifecycle, bounds, and read safety", () => {
  it("rebuilds after successful place/move/sell, recovers deterministically, and not after a failed action", () => {
    const subject = game({
      power: {
        generators: {
          gen: { output: 10, linkRadius: 0, coverageRadius: 3 },
          gen_big: { output: 20, linkRadius: 0, coverageRadius: 3 }
        },
        relays: {},
        consumers: { consumer_single: { demand: 4, priority: 10 } }
      }
    });
    const generator = place(subject, "gen", { q: 1, r: 3 });
    const consumer = place(subject, "consumer_single", { q: 3, r: 3 });
    expect(logistics(subject)!.power.consumers[0]).toMatchObject({ towerId: consumer, powered: true });

    const distanceSpy = vi.spyOn(subject.map, "distance");
    distanceSpy.mockClear();
    const failed = subject.placeTower("consumer_single", { q: 3, r: 3 });
    expect(failed.ok).toBe(false);
    const callsAfterFailure = distanceSpy.mock.calls.length;
    logistics(subject);
    expect(distanceSpy).toHaveBeenCalledTimes(callsAfterFailure);

    expect(subject.moveTower(generator, { q: 12, r: 3 })).toEqual({ ok: true });
    const callsAfterMove = distanceSpy.mock.calls.length;
    expect(logistics(subject)!.power.consumers[0]).toMatchObject({ powered: false });
    expect(distanceSpy.mock.calls.length).toBeGreaterThan(callsAfterMove);

    const replacement = place(subject, "gen_big", { q: 4, r: 3 });
    expect(logistics(subject)!.power.consumers[0]).toMatchObject({ nodeId: replacement, powered: true });
    expect(subject.sellTower(replacement)).toEqual({ ok: true });
    expect(logistics(subject)!.power.consumers[0]).toMatchObject({ nodeId: null, powered: false });
  });

  it("rebuilds after batched destruction and publishes only the stable post-mutation network", () => {
    const subject = game({
      groups: [{ enemyId: "saboteur", count: 2 }],
      power: {
        generators: {
          gen: { output: 4, linkRadius: 2, coverageRadius: 4 },
          gen_big: { output: 4, linkRadius: 2, coverageRadius: 4 }
        },
        relays: {},
        consumers: { consumer_single: { demand: 6, priority: 10 } }
      }
    });
    const first = place(subject, "gen", { q: 0, r: 9 });
    const second = place(subject, "gen", { q: 1, r: 8 });
    place(subject, "consumer_single", { q: 3, r: 9 });
    expect(logistics(subject)!.power.components[0]?.output).toBe(8);

    spawn(subject);
    subject.tick(0.02);
    const destroyed = subject.lastEvents
      .filter((event): event is Extract<GameEvent, { type: "towerDestroyed" }> => event.type === "towerDestroyed")
      .map((event) => event.towerId)
      .sort();

    expect(destroyed).toEqual([first, second].sort());
    expect(logistics(subject)!.power).toEqual({
      components: [],
      nodes: [],
      consumers: [{
        towerId: "tower_3", towerTypeId: "consumer_single", demand: 6, priority: 10,
        nodeId: null, componentId: null, powered: false
      }]
    });
  });

  it("does not rebuild on normal ticks or repeated reads", () => {
    const subject = game({
      power: {
        generators: { gen: { output: 10, linkRadius: 0, coverageRadius: 4 } },
        relays: {},
        consumers: { consumer_single: { demand: 4, priority: 10 } }
      }
    });
    place(subject, "gen", { q: 1, r: 3 });
    place(subject, "consumer_single", { q: 3, r: 3 });
    logistics(subject);
    const distanceSpy = vi.spyOn(subject.map, "distance");

    logistics(subject);
    subject.getRenderSnapshot();
    subject.tick(0.2);
    logistics(subject);

    expect(distanceSpy).not.toHaveBeenCalled();
  });

  it("rejects the 4,097th live participant before resource spend, occupancy, or event mutation", { timeout: 30_000 }, () => {
    const subject = game({
      width: 66,
      height: 66,
      startingCoins: 5_000,
      power: {
        generators: {},
        relays: {},
        consumers: { consumer_single: { demand: 1, priority: 1 } }
      }
    });
    for (let r = 0; r < 64; r += 1) {
      for (let q = 0; q < 64; q += 1) {
        expect(subject.placeTower("consumer_single", { q, r }).ok).toBe(true);
      }
    }
    expect(subject.towers).toHaveLength(4_096);
    const resources = { ...subject.resources };
    const events = structuredClone(subject.lastEvents);
    const tileBefore = { ...subject.map.getTile({ q: 64, r: 64 })! };

    const rejected = subject.placeTower("consumer_single", { q: 64, r: 64 });

    expect(rejected.ok).toBe(false);
    expect(subject.towers).toHaveLength(4_096);
    expect(subject.resources).toEqual(resources);
    expect(subject.lastEvents).toEqual(events);
    expect(subject.map.getTile({ q: 64, r: 64 })).toEqual(tileBefore);
  });

  it("rejects a correctly signed checkpoint with a forged 4,097th participant before restore", { timeout: 30_000 }, () => {
    const subjectContent = content({
      width: 66,
      height: 66,
      startingCoins: 5_000,
      power: {
        generators: {},
        relays: {},
        consumers: { consumer_single: { demand: 1, priority: 1 } }
      }
    });
    const subject = new TowerDefenseGame({
      content: subjectContent,
      missionId: "power",
      seed: "checkpoint-power-limit"
    });
    for (let r = 0; r < 64; r += 1) {
      for (let q = 0; q < 64; q += 1) {
        expect(subject.placeTower("consumer_single", { q, r }).ok).toBe(true);
      }
    }
    const accepted = subject.createCheckpoint();
    expect(accepted.state.towers).toHaveLength(4_096);
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: accepted })).not.toThrow();

    const forged = structuredClone(accepted) as unknown as {
      schemaVersion: 1;
      engineVersion: "towerforge-sim-v2";
      contentDigest: string;
      identity: GameCheckpointV1["identity"];
      rng: GameCheckpointV1["rng"];
      state: GameCheckpointV1["state"] & {
        towers: TowerState[];
        towerCounter: number;
        resources: Record<string, number>;
      };
      stateDigest: string;
    };
    const template = forged.state.towers[0]!;
    forged.state.towers.push({
      ...template,
      id: "tower_4097",
      coord: { q: 64, r: 64 },
      footprint: [{ q: 64, r: 64 }],
      investedResources: { ...template.investedResources }
    });
    forged.state.towerCounter = 4_097;
    forged.state.resources = {
      ...forged.state.resources,
      coins: forged.state.resources.coins! - 1
    };
    resignCheckpoint(forged);

    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: forged as unknown as GameCheckpointV1
    })).toThrow(/logistics.*participant|participant.*limit|4.?096/i);
  });

  it("rejects the 1,025th live node before spend, occupancy, or event mutation", { timeout: 30_000 }, () => {
    const coords = gridCoords(1_025, 40);
    const subject = game({
      width: 42,
      height: 30,
      startingCoins: 2_000,
      power: {
        generators: { gen_big: { output: 1, linkRadius: 0, coverageRadius: 0 } },
        relays: {},
        consumers: {}
      }
    });
    placeAll(subject, "gen_big", coords.slice(0, 1_024));
    const resources = { ...subject.resources };
    const events = structuredClone(subject.lastEvents);
    const candidate = coords[1_024]!;
    const tile = { ...subject.map.getTile(candidate)! };

    const rejected = subject.placeTower("gen_big", candidate);

    expect(rejected.ok).toBe(false);
    expect(subject.towers).toHaveLength(1_024);
    expect(subject.resources).toEqual(resources);
    expect(subject.lastEvents).toEqual(events);
    expect(subject.map.getTile(candidate)).toEqual(tile);
  });

  it("rejects a correctly signed checkpoint with a forged 1,025th live node", { timeout: 30_000 }, () => {
    const coords = gridCoords(1_025, 40);
    const subjectContent = content({
      width: 42,
      height: 30,
      startingCoins: 2_000,
      power: {
        generators: { gen_big: { output: 1, linkRadius: 0, coverageRadius: 0 } },
        relays: {},
        consumers: {}
      }
    });
    const subject = new TowerDefenseGame({
      content: subjectContent,
      missionId: "power",
      seed: "checkpoint-node-limit"
    });
    placeAll(subject, "gen_big", coords.slice(0, 1_024));
    const accepted = subject.createCheckpoint();
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: accepted })).not.toThrow();
    const forged = structuredClone(accepted) as unknown as {
      contentDigest: string;
      identity: GameCheckpointV1["identity"];
      rng: GameCheckpointV1["rng"];
      state: GameCheckpointV1["state"] & {
        towers: TowerState[];
        towerCounter: number;
        resources: Record<string, number>;
      };
      stateDigest: string;
    };
    const template = forged.state.towers[0]!;
    const candidate = coords[1_024]!;
    forged.state.towers.push({
      ...template,
      id: "tower_1025",
      coord: { ...candidate },
      footprint: [{ ...candidate }],
      investedResources: { ...template.investedResources }
    });
    forged.state.towerCounter = 1_025;
    forged.state.resources = {
      ...forged.state.resources,
      coins: forged.state.resources.coins! - 1
    };
    resignCheckpoint(forged);

    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: forged as unknown as GameCheckpointV1
    })).toThrow(/logistics.*node|node.*limit|1.?024/i);
  });

  it("allows 65,341 undirected edges but rejects the placement that would create 65,703", { timeout: 30_000 }, () => {
    const subject = game({
      width: 40,
      height: 30,
      startingCoins: 1_000,
      power: {
        generators: { gen_big: { output: 1, linkRadius: 64, coverageRadius: 0 } },
        relays: {},
        consumers: {}
      }
    });
    placeAll(subject, "gen_big", DENSE_NODE_COORDS);
    expect(subject.towers).toHaveLength(362);
    expect(undirectedEdgeCount(logistics(subject)!)).toBe(65_341);
    const resources = { ...subject.resources };
    const events = structuredClone(subject.lastEvents);
    const tile = { ...subject.map.getTile(DENSE_NODE_CANDIDATE)! };

    const rejected = subject.placeTower("gen_big", DENSE_NODE_CANDIDATE);

    expect(rejected.ok).toBe(false);
    expect(subject.towers).toHaveLength(362);
    expect(subject.resources).toEqual(resources);
    expect(subject.lastEvents).toEqual(events);
    expect(subject.map.getTile(DENSE_NODE_CANDIDATE)).toEqual(tile);
  });

  it("rejects a move that would increase the graph from 65,341 to 65,703 edges before mutation", { timeout: 30_000 }, () => {
    const subject = game({
      width: 130,
      height: 30,
      startingCoins: 1_000,
      power: {
        generators: { gen_big: { output: 1, linkRadius: 64, coverageRadius: 0 } },
        relays: {},
        consumers: {}
      }
    });
    placeAll(subject, "gen_big", DENSE_NODE_COORDS);
    const movingId = place(subject, "gen_big", ISOLATED_NODE_COORD);
    expect(undirectedEdgeCount(logistics(subject)!)).toBe(65_341);
    const resources = { ...subject.resources };
    const events = structuredClone(subject.lastEvents);
    const sourceTile = { ...subject.map.getTile(ISOLATED_NODE_COORD)! };
    const targetTile = { ...subject.map.getTile(DENSE_NODE_CANDIDATE)! };

    const rejected = subject.moveTower(movingId, DENSE_NODE_CANDIDATE);

    expect(rejected.ok).toBe(false);
    expect(subject.towers.find((tower) => tower.id === movingId)?.coord).toEqual(ISOLATED_NODE_COORD);
    expect(subject.resources).toEqual(resources);
    expect(subject.lastEvents).toEqual(events);
    expect(subject.map.getTile(ISOLATED_NODE_COORD)).toEqual(sourceTile);
    expect(subject.map.getTile(DENSE_NODE_CANDIDATE)).toEqual(targetTile);
  });

  it("rejects a correctly signed checkpoint whose restored graph would have 65,703 edges", { timeout: 30_000 }, () => {
    const subjectContent = content({
      width: 130,
      height: 30,
      startingCoins: 1_000,
      power: {
        generators: { gen_big: { output: 1, linkRadius: 64, coverageRadius: 0 } },
        relays: {},
        consumers: {}
      }
    });
    const subject = new TowerDefenseGame({
      content: subjectContent,
      missionId: "power",
      seed: "checkpoint-edge-limit"
    });
    placeAll(subject, "gen_big", DENSE_NODE_COORDS);
    const movingId = place(subject, "gen_big", ISOLATED_NODE_COORD);
    const accepted = subject.createCheckpoint();
    expect(() => TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint: accepted })).not.toThrow();
    const forged = structuredClone(accepted) as unknown as {
      contentDigest: string;
      identity: GameCheckpointV1["identity"];
      rng: GameCheckpointV1["rng"];
      state: GameCheckpointV1["state"] & {
        towers: TowerState[];
        resources: Record<string, number>;
      };
      stateDigest: string;
    };
    const moving = forged.state.towers.find((tower) => tower.id === movingId)!;
    moving.coord = { ...DENSE_NODE_CANDIDATE };
    moving.footprint = [{ ...DENSE_NODE_CANDIDATE }];
    forged.state.resources = {
      ...forged.state.resources,
      coins: forged.state.resources.coins! - 1
    };
    resignCheckpoint(forged);

    expect(() => TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: forged as unknown as GameCheckpointV1
    })).toThrow(/logistics.*edge|edge.*limit|65.?536/i);
  });

  it("returns a bounded, deeply frozen, detached snapshot without RNG, event, state, or digest mutation", () => {
    const subject = game();
    place(subject, "gen", { q: 1, r: 1 });
    place(subject, "relay", { q: 4, r: 1 });
    place(subject, "consumer_single", { q: 3, r: 4 });
    const checkpointBefore = subject.createCheckpoint();
    const digestBefore = subject.getStateDigest();
    const eventsBefore = structuredClone(subject.lastEvents);

    const first = logistics(subject)!;
    const second = logistics(subject)!;

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.power).not.toBe(second.power);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.power)).toBe(true);
    expect(Object.isFrozen(first.power.components)).toBe(true);
    expect(Object.isFrozen(first.power.components[0])).toBe(true);
    expect(Object.isFrozen(first.power.nodes)).toBe(true);
    expect(Object.isFrozen(first.power.nodes[0]?.linkTowerIds)).toBe(true);
    expect(Object.isFrozen(first.power.consumers)).toBe(true);
    expect(first.power.nodes.length).toBeLessThanOrEqual(subject.towers.length);
    expect(first.power.consumers.length).toBeLessThanOrEqual(subject.towers.length);
    expect(() => (first.power.nodes as LogisticsNodeSnapshotV1[]).push(first.power.nodes[0]!)).toThrow();
    expect(subject.createCheckpoint()).toEqual(checkpointBefore);
    expect(subject.getStateDigest()).toBe(digestBefore);
    expect(subject.lastEvents).toEqual(eventsBefore);
  });

  it("uses no RNG and emits no synthetic logistics event while deriving or allocating", () => {
    const subject = game();
    const rngBefore = structuredClone(subject.createCheckpoint().rng);
    place(subject, "gen", { q: 1, r: 1 });
    place(subject, "consumer_single", { q: 3, r: 1 });
    const authoredEvents = structuredClone(subject.lastEvents);

    logistics(subject);
    logistics(subject);

    expect(subject.createCheckpoint().rng).toEqual(rngBefore);
    expect(subject.lastEvents).toEqual(authoredEvents);
    expect(subject.lastEvents.every((event) => !/power|logistics/i.test(event.type))).toBe(true);
  });
});

describe("R5.7A literal compatibility, checkpoint, and replay", () => {
  it.each(["absent", "disabled", "unselected", "null", "future"] as const)(
    "keeps %s Logistics on the literal legacy branch",
    (mode) => {
      const subject = game({ mode });
      const consumer = place(subject, "consumer_single", { q: 2, r: 9 });
      spawn(subject);

      expect(logistics(subject)).toBeUndefined();
      expect(subject.lastEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "towerFired", towerId: consumer })
      ]));
      expect(subject.enemies[0]!.hp).toBeLessThan(subject.enemies[0]!.maxHp);
      expect(subject.createCheckpoint().state).not.toHaveProperty("logistics");
    }
  );

  it("derives no checkpoint field and restores the same power snapshot and digest", () => {
    const subjectContent = content();
    const subject = new TowerDefenseGame({ content: subjectContent, missionId: "power", seed: "restore" });
    place(subject, "gen", { q: 1, r: 7 });
    place(subject, "consumer_single", { q: 2, r: 9 });
    spawn(subject);
    subject.tick(0.2);
    const checkpoint = subject.createCheckpoint();
    const snapshot = logistics(subject);

    expect(checkpoint.schemaVersion).toBe(1);
    expect(checkpoint.engineVersion).toBe("towerforge-sim-v2");
    expect(checkpoint.state).not.toHaveProperty("logistics");
    const restored = TowerDefenseGame.fromCheckpoint({ content: subjectContent, checkpoint });
    expect(logistics(restored)).toEqual(snapshot);
    expect(restored.getStateDigest()).toBe(subject.getStateDigest());
  });

  it("matches continuous and checkpointed suffixes without duplicate firing", () => {
    const subjectContent = content();
    const continuous = new TowerDefenseGame({ content: subjectContent, missionId: "power", seed: "suffix" });
    place(continuous, "gen", { q: 1, r: 7 });
    place(continuous, "consumer_single", { q: 2, r: 9 });
    spawn(continuous);
    continuous.tick(0.1);
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: structuredClone(continuous.createCheckpoint())
    });

    continuous.tick(0.1);
    restored.tick(0.1);

    expect(restored.getStateDigest()).toBe(continuous.getStateDigest());
    expect(logistics(restored)).toEqual(logistics(continuous));
    expect(restored.lastEvents.filter((event) => event.type === "towerFired"))
      .toEqual(continuous.lastEvents.filter((event) => event.type === "towerFired"));
  });

  it("preserves numeric placement order across checkpoint restore for ten powered consumers", () => {
    const subjectContent = content({
      groundMaxHp: 6,
      power: {
        generators: { gen: { output: 10, linkRadius: 0, coverageRadius: 30 } },
        relays: {},
        consumers: { consumer_small: { demand: 1, priority: 10 } }
      }
    });
    const continuous = new TowerDefenseGame({
      content: subjectContent,
      missionId: "power",
      seed: "numeric-placement-order"
    });
    const generatorId = place(continuous, "gen", { q: 0, r: 0 });
    const consumerIds = Array.from({ length: 10 }, (_, index) => (
      place(continuous, "consumer_small", { q: index + 1, r: 10 })
    ));
    const restored = TowerDefenseGame.fromCheckpoint({
      content: subjectContent,
      checkpoint: structuredClone(continuous.createCheckpoint())
    });

    expect(generatorId).toBe("tower_1");
    expect(consumerIds).toEqual([
      "tower_2", "tower_3", "tower_4", "tower_5", "tower_6",
      "tower_7", "tower_8", "tower_9", "tower_10", "tower_11"
    ]);
    expect(continuous.startNextWave()).toEqual({ ok: true });
    expect(restored.startNextWave()).toEqual({ ok: true });
    continuous.tick(0);
    restored.tick(0);

    const continuousFiredIds = continuous.lastEvents
      .filter((event): event is Extract<GameEvent, { type: "towerFired" }> => event.type === "towerFired")
      .map((event) => event.towerId);
    const restoredFiredIds = restored.lastEvents
      .filter((event): event is Extract<GameEvent, { type: "towerFired" }> => event.type === "towerFired")
      .map((event) => event.towerId);

    expect(continuousFiredIds).toEqual(["tower_1", "tower_2", "tower_3"]);
    expect({
      firedIds: restoredFiredIds,
      digest: restored.getStateDigest()
    }).toEqual({
      firedIds: continuousFiredIds,
      digest: continuous.getStateDigest()
    });
  });

  it("replays the same checkpoint, network, results, and final digest through journal v1", () => {
    const subjectContent = content();
    const session = new JournaledGameSession(new TowerDefenseGame({
      content: subjectContent,
      missionId: "power",
      seed: "journal-power"
    }));
    const commands = [
      { schemaVersion: 1 as const, type: "placeTower" as const, towerTypeId: "gen", coord: { q: 1, r: 7 } },
      { schemaVersion: 1 as const, type: "placeTower" as const, towerTypeId: "consumer_single", coord: { q: 2, r: 9 } },
      { schemaVersion: 1 as const, type: "startWave" as const },
      { schemaVersion: 1 as const, type: "tick" as const, units: 0.2 }
    ];
    for (const command of commands) expect(session.dispatch(command)).toEqual({ ok: true });
    const journal = session.exportJournal();
    const replay = replayGameCommandJournal({ content: subjectContent, journal });

    expect(journal.schemaVersion).toBe(1);
    expect(journal.initialCheckpoint.state).not.toHaveProperty("logistics");
    expect(replay.entriesReplayed).toBe(commands.length);
    expect(replay.stateDigest).toBe(session.game.getStateDigest());
    expect(logistics(replay.game)).toEqual(logistics(session.game as TowerDefenseGame));
  });
});
