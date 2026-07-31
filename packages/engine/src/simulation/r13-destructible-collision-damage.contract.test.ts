import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { DamageResolver, type DamagePacket, type DamageTargetRef } from "./damage.js";
import { GridMap, type GridMapDefinition } from "./map.js";
import type { ModifierSpec } from "./modifiers.js";

type Trajectory = "direct" | "arc";
type Coord = { readonly q: number; readonly r: number };

interface CollisionBodyV1 {
  readonly objectId: string;
  readonly definitionId: string;
  readonly coord: Coord;
  readonly blockerHeight: number;
}

interface TerrainCollisionV1 {
  readonly blockerCoord: Coord;
  readonly terrainId: string;
  readonly blockerTag: string;
  readonly blockerElevation: number;
  readonly elapsedUnits: number;
}

interface CollisionRequestV1 {
  readonly sourceCoord: Coord;
  readonly targetCoord: Coord;
  readonly sourceElevation: number;
  readonly targetElevation: number;
  readonly trajectory: Trajectory;
  readonly travelTimeUnits: number;
  readonly maxAltitude?: number;
  readonly terrainCollision?: TerrainCollisionV1;
}

interface MapObjectCollisionV1 {
  readonly kind: "map_object";
  readonly objectId: string;
  readonly definitionId: string;
  readonly collisionCoord: Coord;
  readonly blockerElevation: number;
  readonly blockerHeight: number;
  readonly elapsedUnits: number;
}

interface TerrainTerminalCollisionV1 extends TerrainCollisionV1 {
  readonly kind: "terrain";
}

type CollisionTraceV1 =
  | {
      readonly ok: true;
      readonly cellInspections: number;
      readonly collision?: MapObjectCollisionV1 | TerrainTerminalCollisionV1;
    }
  | {
      readonly ok: false;
      readonly cellInspections: number;
      readonly reason: "ray_budget_exceeded" | "operation_budget_exceeded";
    };

interface CollisionIndexV1 {
  readonly schemaVersion: 1;
}

interface MapObjectStateV1 {
  readonly objectId: string;
  readonly definitionId: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly armorTypeId?: string;
}

interface DamagePlanV1 {
  readonly outcome: "no_effect" | "nonlethal" | "requires_atomic_destruction";
  readonly objectId: string;
  readonly definitionId: string;
  readonly previousHp: number;
  readonly nextHp: number;
  readonly damagePacket: DamagePacket;
  readonly resolution: ReturnType<typeof DamageResolver.resolve>;
}

function map(
  grid: GridMapDefinition["grid"] = { kind: "square", adjacency: "cardinal" },
  width = 9,
  height = 5,
  elevationOverrides: readonly { q: number; r: number; elevation: number }[] = []
): GridMap {
  return GridMap.fromDefinition({
    id: "destructible_collision", width, height, grid,
    defaultTerrain: "buildable", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: width - 1, r: 0 },
    pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: 0 })),
    pathRoutes: [], terrainOverrides: [], elevationOverrides: [...elevationOverrides]
  });
}

function body(
  objectId: string,
  coord: Coord,
  blockerHeight = 2,
  definitionId = "gate"
): CollisionBodyV1 {
  return { objectId, definitionId, coord, blockerHeight };
}

function request(overrides: Partial<CollisionRequestV1> = {}): CollisionRequestV1 {
  return {
    sourceCoord: { q: 0, r: 2 }, targetCoord: { q: 8, r: 2 },
    sourceElevation: 0, targetElevation: 0,
    trajectory: "direct", travelTimeUnits: 8,
    ...overrides
  };
}

function indexer(): (map: GridMap, bodies: readonly CollisionBodyV1[]) => CollisionIndexV1 {
  const create = (Engine as unknown as {
    createDestructibleCollisionIndexV1?: (
      map: GridMap,
      bodies: readonly CollisionBodyV1[]
    ) => CollisionIndexV1;
  }).createDestructibleCollisionIndexV1;
  expect(create, "R13.4b1 must export the pure destructible body index").toBeTypeOf("function");
  return create!;
}

function tracer(): (
  map: GridMap,
  index: CollisionIndexV1,
  request: CollisionRequestV1,
  remainingCellInspections?: number
) => CollisionTraceV1 {
  const trace = (Engine as unknown as {
    traceProjectileDestructibleCollisionV1?: (
      map: GridMap,
      index: CollisionIndexV1,
      request: CollisionRequestV1,
      remainingCellInspections?: number
    ) => CollisionTraceV1;
  }).traceProjectileDestructibleCollisionV1;
  expect(trace, "R13.4b1 must export the pure fixed-collision tracer").toBeTypeOf("function");
  return trace!;
}

function damagePlanner(): (
  packet: DamagePacket,
  object: MapObjectStateV1,
  context?: Parameters<typeof DamageResolver.resolve>[1]
) => DamagePlanV1 {
  const plan = (Engine as unknown as {
    planDestructibleObjectDamageV1?: (
      packet: DamagePacket,
      object: MapObjectStateV1,
      context?: Parameters<typeof DamageResolver.resolve>[1]
    ) => DamagePlanV1;
  }).planDestructibleObjectDamageV1;
  expect(plan, "R13.4b1 must export the pure non-mutating map-object damage planner")
    .toBeTypeOf("function");
  return plan!;
}

function mapObjectTarget(objectId = "gate_1", definitionId = "gate"): DamageTargetRef {
  return { kind: "map_object", objectId, definitionId } as unknown as DamageTargetRef;
}

function packet(overrides: Partial<DamagePacket> = {}): DamagePacket {
  return {
    amount: 20,
    damageType: "physical",
    source: { kind: "tower", towerId: "cannon_1", towerTypeId: "cannon" },
    target: { kind: "enemy", enemyId: "enemy_1", enemyTypeId: "grunt" },
    ...overrides
  };
}

const unsafeObjectIdentifiers = [
  ["leading whitespace in objectId", " gate_1", "gate"],
  ["trailing whitespace in objectId", "gate_1 ", "gate"],
  ["NUL in objectId", "gate\u0000_1", "gate"],
  ["DEL in objectId", "gate\u007f_1", "gate"],
  ["leading whitespace in definitionId", "gate_1", " gate"],
  ["trailing whitespace in definitionId", "gate_1", "gate "],
  ["newline in definitionId", "gate_1", "ga\nte"],
  ["DEL in definitionId", "gate_1", "ga\u007fte"]
] as const;

describe("R13.4b1 pure destructible collision and damage planning (RED)", () => {
  it("publishes independent fixed-collision budgets", () => {
    expect((Engine as unknown as Record<string, unknown>).DESTRUCTIBLE_COLLISION_LIMITS).toEqual({
      maximumRayDistance: 256,
      cellInspectionsPerTick: 1_048_576
    });
  });

  it("uses the topology line on square and hex maps, excludes the source, includes the target, and selects the earliest body", () => {
    for (const grid of [
      { kind: "square", adjacency: "cardinal" } as const,
      { kind: "hex", layout: "odd-r" } as const
    ]) {
      const subject = map(grid);
      const launch = request();
      const line = subject.line(launch.sourceCoord, launch.targetCoord);
      const authored = [
        body("target", line.at(-1)!),
        body("source", line[0]!),
        body("later", line[3]!),
        body("earliest", line[1]!)
      ];
      const trace = tracer()(subject, indexer()(subject, authored), launch);
      expect(trace).toMatchObject({
        ok: true,
        collision: {
          kind: "map_object", objectId: "earliest", definitionId: "gate",
          collisionCoord: line[1]
        }
      });

      const targetOnly = tracer()(
        subject,
        indexer()(subject, [body("source", line[0]!), body("target", line.at(-1)!)]),
        launch
      );
      expect(targetOnly).toMatchObject({
        ok: true,
        collision: { kind: "map_object", objectId: "target", collisionCoord: line.at(-1) }
      });
    }
  });

  it("blocks direct and arc projectiles below or exactly at object height and clears only strictly above", () => {
    const subject = map();
    const object = body("gate_1", { q: 4, r: 2 }, 2);
    const index = indexer()(subject, [object]);
    const cases = [
      ["direct", undefined, true],
      ["arc", 1.99, true],
      ["arc", 2, true],
      ["arc", 2.01, false]
    ] as const;
    for (const [trajectory, maxAltitude, blocked] of cases) {
      const trace = tracer()(subject, index, request({
        trajectory,
        ...(maxAltitude === undefined ? {} : { maxAltitude })
      }));
      expect(trace.ok).toBe(true);
      if (trace.ok) expect(trace.collision?.kind === "map_object").toBe(blocked);
    }
  });

  it("is permutation-invariant and gives a same-cell map object priority over supplied terrain collision", () => {
    const subject = map();
    const launch = request({
      terrainCollision: {
        blockerCoord: { q: 4, r: 2 }, terrainId: "cliff", blockerTag: "rock",
        blockerElevation: 0, elapsedUnits: 4
      }
    });
    const bodies = [body("z_late", { q: 6, r: 2 }), body("a_gate", { q: 4, r: 2 })];
    const forward = tracer()(subject, indexer()(subject, bodies), launch);
    const reverse = tracer()(subject, indexer()(subject, [...bodies].reverse()), launch);
    expect(reverse).toEqual(forward);
    expect(forward).toMatchObject({
      ok: true,
      collision: { kind: "map_object", objectId: "a_gate", collisionCoord: { q: 4, r: 2 }, elapsedUnits: 4 }
    });
  });

  it.each([
    ["an off-ray coordinate", { q: 4, r: 1 }, 4],
    ["the excluded source coordinate", { q: 0, r: 2 }, 0],
    ["elapsed time inconsistent with the topology line index", { q: 4, r: 2 }, 3.5]
  ] as const)("rejects forged terrain collision provenance with %s", (_label, blockerCoord, elapsedUnits) => {
    const subject = map();
    const index = indexer()(subject, [body("gate", { q: 6, r: 2 })]);
    expect(() => tracer()(subject, index, request({
      terrainCollision: {
        blockerCoord, terrainId: "cliff", blockerTag: "rock",
        blockerElevation: 0, elapsedUnits
      }
    }))).toThrow(/terrain|collision|ray|elapsed|provenance|source/i);
  });

  it("enforces the 256-cell ray ceiling and remaining operation budget before returning a collision", () => {
    const exact = map({ kind: "square", adjacency: "cardinal" }, 257, 1);
    const exactRequest = request({
      sourceCoord: { q: 0, r: 0 }, targetCoord: { q: 256, r: 0 }, travelTimeUnits: 256
    });
    expect(tracer()(exact, indexer()(exact, [body("edge", { q: 256, r: 0 })]), exactRequest))
      .toMatchObject({ ok: true, cellInspections: 256, collision: { objectId: "edge" } });

    const over = map({ kind: "square", adjacency: "cardinal" }, 258, 1);
    const overRequest = request({
      sourceCoord: { q: 0, r: 0 }, targetCoord: { q: 257, r: 0 }, travelTimeUnits: 257
    });
    expect(tracer()(over, indexer()(over, [body("edge", { q: 257, r: 0 })]), overRequest))
      .toEqual({ ok: false, reason: "ray_budget_exceeded", cellInspections: 0 });
    expect(tracer()(exact, indexer()(exact, [body("edge", { q: 256, r: 0 })]), exactRequest, 0))
      .toEqual({ ok: false, reason: "operation_budget_exceeded", cellInspections: 0 });
  });

  it("rejects hostile, sparse, cyclic, and duplicate body indexes without executing accessors", () => {
    const subject = map();
    const createIndex = indexer();
    let reads = 0;
    const accessor = body("gate", { q: 2, r: 2 }) as any;
    Object.defineProperty(accessor, "objectId", {
      enumerable: true, get() { reads += 1; return "gate"; }
    });
    expect(() => createIndex(subject, [accessor])).toThrow(/accessor|own data|inspect|body/i);
    expect(reads).toBe(0);

    const sparse = Object.assign(new Array(2), { 1: body("gate", { q: 2, r: 2 }) });
    const cyclic = body("cycle", { q: 2, r: 2 }) as any;
    cyclic.coord = cyclic;
    const duplicateId = [body("same", { q: 2, r: 2 }), body("same", { q: 3, r: 2 })];
    const duplicateCell = [body("a", { q: 2, r: 2 }), body("b", { q: 2, r: 2 })];
    const proxy = new Proxy([], { ownKeys() { throw new Error("hostile list"); } });
    for (const malformed of [sparse, [cyclic], duplicateId, duplicateCell, proxy]) {
      expect(() => createIndex(subject, malformed as readonly CollisionBodyV1[]))
        .toThrow(/inspect|dense|cycle|duplicate|body|placement|coordinate/i);
    }
  });

  it.each(unsafeObjectIdentifiers)(
    "rejects %s in collision bodies",
    (_label, objectId, definitionId) => {
      expect(() => indexer()(map(), [body(objectId, { q: 2, r: 2 }, 1, definitionId)]))
        .toThrow(/id|identifier|whitespace|control|ascii|bounded/i);
    }
  );

  it("returns detached frozen indexes and collision provenance", () => {
    const subject = map();
    const authored = body("gate_1", { q: 4, r: 2 });
    const index = indexer()(subject, [authored]);
    const trace = tracer()(subject, index, request());
    (authored.coord as { q: number; r: number }).q = 7;
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(trace)).toBe(true);
    expect(trace).toMatchObject({ collision: { objectId: "gate_1", collisionCoord: { q: 4, r: 2 } } });
    if (trace.ok && trace.collision) {
      expect(Object.isFrozen(trace.collision)).toBe(true);
      expect(Object.isFrozen(
        trace.collision.kind === "map_object" ? trace.collision.collisionCoord : trace.collision.blockerCoord
      )).toBe(true);
    }
  });

  it("extends DamageTargetRef with a validated map_object target", () => {
    expect(DamageResolver.resolve(packet({ target: mapObjectTarget() })).finalAmount).toBe(20);
    for (const target of [
      { kind: "map_object", objectId: "", definitionId: "gate" },
      { kind: "map_object", objectId: "gate_1", definitionId: " " },
      { kind: "map_object", objectId: "gate_1" }
    ]) {
      expect(() => DamageResolver.resolve(packet({ target: target as unknown as DamageTargetRef })))
        .toThrow(/map|object|target|definition|id/i);
    }
  });

  it("plans armor-equivalent nonlethal damage without mutation and preserves detached packet fields", () => {
    const modifiers = Object.freeze([Object.freeze({
      id: "run_bonus", target: "damage", stage: "run", operation: "flat", value: 20
    } satisfies ModifierSpec)]);
    const authoredPacket = Object.freeze(packet({
      amount: 80,
      tags: Object.freeze(["area"] as const),
      modifiers
    }));
    const object = Object.freeze({
      objectId: "gate_1", definitionId: "gate", hp: 100, maxHp: 200, armorTypeId: "stone"
    });
    const context = Object.freeze({
      armorMatrix: Object.freeze({
        armorTypeId: "stone", defaultMultiplier: 1,
        multipliers: Object.freeze({ physical: 0.5 })
      })
    });
    const expectedPacket = Object.freeze({
      ...authoredPacket,
      target: mapObjectTarget("gate_1", "gate")
    });
    const expectedResolution = DamageResolver.resolve(expectedPacket, context);
    const before = JSON.stringify({ authoredPacket, object, context });
    const plan = damagePlanner()(authoredPacket, object, context);
    expect(plan).toMatchObject({
      outcome: "nonlethal", objectId: "gate_1", definitionId: "gate",
      previousHp: 100, nextHp: 50, resolution: expectedResolution,
      damagePacket: expectedPacket
    });
    expect(JSON.stringify({ authoredPacket, object, context })).toBe(before);
    expect(plan.damagePacket).not.toBe(authoredPacket);
    expect(plan.damagePacket.source).toEqual(authoredPacket.source);
    expect(plan.damagePacket.target).toEqual(mapObjectTarget("gate_1", "gate"));
    expect(plan.damagePacket.tags).toEqual(authoredPacket.tags);
    expect(plan.damagePacket.modifiers).toEqual(authoredPacket.modifiers);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.damagePacket)).toBe(true);
  });

  it.each([
    ["resistances", { resistances: { physical: 0.5 } }],
    ["legacyArmor", { legacyArmor: { kind: "pierce_only", bypassed: false, chipDamage: 0 } }],
    ["marks", {
      marks: [{ markId: "vulnerable", stacks: 1, multiplier: 2, consumePolicy: "retain" }]
    }]
  ] as const)("rejects unsupported object-damage context field %s", (_label, context) => {
    const state = { objectId: "gate_1", definitionId: "gate", hp: 50, maxHp: 50 };
    expect(() => damagePlanner()(
      packet(),
      state,
      context as Parameters<ReturnType<typeof damagePlanner>>[2]
    )).toThrow(/context|unsupported|armorMatrix|resistance|legacy|mark/i);
  });

  it.each(unsafeObjectIdentifiers)(
    "rejects %s in map-object damage state",
    (_label, objectId, definitionId) => {
      expect(() => damagePlanner()(
        packet(),
        { objectId, definitionId, hp: 50, maxHp: 50 }
      )).toThrow(/id|identifier|whitespace|control|ascii|bounded|state/i);
    }
  );

  it("distinguishes no_effect, nonlethal, and requires_atomic_destruction and rejects malformed object state", () => {
    const state = Object.freeze({ objectId: "gate_1", definitionId: "gate", hp: 50, maxHp: 50 });
    expect(damagePlanner()(packet({ amount: 0 }), state)).toMatchObject({
      outcome: "no_effect", previousHp: 50, nextHp: 50
    });
    expect(damagePlanner()(packet({ amount: 10 }), state)).toMatchObject({
      outcome: "nonlethal", previousHp: 50, nextHp: 40
    });
    expect(damagePlanner()(packet({ amount: 50 }), state)).toMatchObject({
      outcome: "requires_atomic_destruction", previousHp: 50, nextHp: 0
    });
    for (const malformed of [
      { objectId: "", definitionId: "gate", hp: 50, maxHp: 50 },
      { objectId: "gate_1", definitionId: " ", hp: 50, maxHp: 50 },
      { objectId: "gate_1", definitionId: "gate", hp: -1, maxHp: 50 },
      { objectId: "gate_1", definitionId: "gate", hp: 51, maxHp: 50 },
      { objectId: "gate_1", definitionId: "gate", hp: 0, maxHp: 0 }
    ]) {
      expect(() => damagePlanner()(packet(), malformed)).toThrow(/object|definition|hp|health|max|state/i);
    }
    expect(() => damagePlanner()(
      packet(),
      { objectId: "gate_1", definitionId: "gate", hp: 50, maxHp: 50, armorTypeId: "stone" },
      { armorMatrix: { armorTypeId: "metal", defaultMultiplier: 1, multipliers: {} } }
    )).toThrow(/armor|matrix|stone|metal|mismatch/i);
  });
});
