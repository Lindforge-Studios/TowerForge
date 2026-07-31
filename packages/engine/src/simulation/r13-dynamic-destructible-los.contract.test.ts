import { describe, expect, it } from "vitest";
import * as Engine from "../index.js";
import { coordKey } from "./hex.js";
import * as LineOfSight from "./line-of-sight.js";
import { GridMap, type GridMapDefinition } from "./map.js";
import type { GridCoord, TerrainTypeDefinition } from "./types.js";

interface DynamicBlockerV1 {
  readonly objectId: string;
  readonly definitionId: string;
  readonly coord: GridCoord;
  readonly blockerHeight: number;
}

interface DynamicLineOfSightIndexV1 {
  readonly schemaVersion: 1;
}

interface LegacyLineOfSightPolicyV1 {
  readonly terrainTypes: Readonly<Record<string, TerrainTypeDefinition>>;
  readonly terrainBlockerTags: readonly string[];
}

interface TraceResultV2 {
  readonly row: {
    readonly target: GridCoord;
    readonly visible: boolean;
    readonly reason:
      | "clear"
      | "terrain_tag"
      | "destructible"
      | "elevation"
      | "ray_budget_exceeded"
      | "operation_budget_exceeded";
    readonly blocker?: {
      readonly coord: GridCoord;
      readonly terrainId: string;
      readonly elevation: number;
      readonly tag?: string;
      readonly objectId?: string;
      readonly definitionId?: string;
      readonly blockerHeight?: number;
    };
  };
  readonly cellInspections: number;
  readonly budgetExceeded: boolean;
}

const TERRAIN_TYPES: Readonly<Record<string, TerrainTypeDefinition>> = Object.freeze({
  floor: Object.freeze({
    id: "floor", label: "Floor", buildable: true, walkable: true,
    groundSpeedMultiplier: 1, tags: Object.freeze([]) as unknown as string[]
  }),
  cliff: Object.freeze({
    id: "cliff", label: "Cliff", buildable: false, walkable: true,
    groundSpeedMultiplier: 1, tags: Object.freeze(["wall", "opaque"]) as unknown as string[]
  })
});

const LEGACY_POLICY: LegacyLineOfSightPolicyV1 = Object.freeze({
  terrainTypes: TERRAIN_TYPES,
  terrainBlockerTags: Object.freeze(["wall"])
});

function map(options: {
  grid?: GridMapDefinition["grid"];
  width?: number;
  height?: number;
  terrainOverrides?: Array<{ q: number; r: number; terrain: string }>;
  elevationOverrides?: Array<{ q: number; r: number; elevation: number }>;
} = {}): GridMap {
  const width = options.width ?? 9;
  const height = options.height ?? 5;
  return GridMap.fromDefinition({
    id: "dynamic_los", width, height,
    grid: options.grid ?? { kind: "square", adjacency: "cardinal" },
    defaultTerrain: "floor", spawnCoord: { q: 0, r: 0 }, coreCoord: { q: width - 1, r: 0 },
    pathCenterline: Array.from({ length: width }, (_, q) => ({ q, r: 0 })),
    pathRoutes: [], terrainOverrides: options.terrainOverrides ?? [],
    elevationOverrides: options.elevationOverrides ?? []
  });
}

function blocker(
  objectId: string,
  coord: GridCoord,
  blockerHeight = 1,
  definitionId = "gate"
): DynamicBlockerV1 {
  return { objectId, definitionId, coord, blockerHeight };
}

function buildIndex(): (
  map: GridMap,
  blockers: readonly DynamicBlockerV1[]
) => DynamicLineOfSightIndexV1 {
  const build = (Engine as unknown as {
    buildDynamicAuthoredLineOfSightIndexV1?: (
      map: GridMap,
      blockers: readonly DynamicBlockerV1[]
    ) => DynamicLineOfSightIndexV1;
  }).buildDynamicAuthoredLineOfSightIndexV1;
  expect(build, "R13.4b2 must export the pure dynamic authored LoS index builder")
    .toBeTypeOf("function");
  return build!;
}

function traceV2(): (
  map: GridMap,
  legacyPolicy: LegacyLineOfSightPolicyV1 | undefined,
  dynamicIndex: DynamicLineOfSightIndexV1 | undefined,
  source: GridCoord,
  target: GridCoord,
  remainingCellInspections?: number
) => TraceResultV2 {
  const trace = (Engine as unknown as {
    traceLineOfSightV2?: (
      map: GridMap,
      legacyPolicy: LegacyLineOfSightPolicyV1 | undefined,
      dynamicIndex: DynamicLineOfSightIndexV1 | undefined,
      source: GridCoord,
      target: GridCoord,
      remainingCellInspections?: number
    ) => TraceResultV2;
  }).traceLineOfSightV2;
  expect(trace, "R13.4b2 must export the generalized pure LoS tracer").toBeTypeOf("function");
  return trace!;
}

function row2Line(subject: GridMap): { source: GridCoord; target: GridCoord; line: GridCoord[] } {
  const source = { q: 0, r: 2 };
  const target = { q: subject.width - 1, r: 2 };
  return { source, target, line: subject.line(source, target) };
}

describe("R13.4b2 pure dynamic destructible line of sight (RED)", () => {
  it("uses square and hex topology lines, ignores endpoint blockers, and selects the closest interior cell", () => {
    for (const grid of [
      { kind: "square", adjacency: "cardinal" } as const,
      { kind: "hex", layout: "odd-r" } as const
    ]) {
      const subject = map({ grid });
      const { source, target, line } = row2Line(subject);
      const index = buildIndex()(subject, [
        blocker("target", line.at(-1)!),
        blocker("source", line[0]!),
        blocker("later", line[3]!),
        blocker("closest", line[1]!)
      ]);
      expect(traceV2()(subject, undefined, index, source, target)).toMatchObject({
        row: {
          target, visible: false, reason: "destructible",
          blocker: { coord: line[1], objectId: "closest", definitionId: "gate" }
        }
      });
      const endpointsOnly = buildIndex()(subject, [
        blocker("source", line[0]!), blocker("target", line.at(-1)!)
      ]);
      expect(traceV2()(subject, undefined, endpointsOnly, source, target)).toMatchObject({
        row: { target, visible: true, reason: "clear" }
      });
    }
  });

  it("blocks a dynamic object at equality or above and clears it only below the sight ray", () => {
    const subject = map();
    const { source, target } = row2Line(subject);
    for (const [height, blocked] of [[0.99, false], [1, true], [1.01, true]] as const) {
      const index = buildIndex()(subject, [blocker(`gate_${height}`, { q: 4, r: 2 }, height)]);
      const trace = traceV2()(subject, undefined, index, source, target);
      expect(trace.row.reason === "destructible").toBe(blocked);
      expect(trace.row.visible).toBe(!blocked);
    }
  });

  it("reads current Terraforming elevation on every trace without rebuilding the dynamic index", () => {
    const subject = map();
    const { source, target } = row2Line(subject);
    const index = buildIndex()(subject, [blocker("gate", { q: 4, r: 2 }, 0.5)]);
    expect(traceV2()(subject, undefined, index, source, target).row.reason).toBe("clear");

    subject.useRuntimeElevationOverrides(new Map([[
      coordKey({ q: 4, r: 2 }), { q: 4, r: 2, elevation: 1 }
    ]]));
    expect(traceV2()(subject, undefined, index, source, target)).toMatchObject({
      row: {
        visible: false, reason: "destructible",
        blocker: { objectId: "gate", elevation: 1, blockerHeight: 0.5 }
      }
    });

    subject.useRuntimeElevationOverrides(new Map([[
      coordKey({ q: 4, r: 2 }), { q: 4, r: 2, elevation: -1 }
    ]]));
    expect(traceV2()(subject, undefined, index, source, target).row.reason).toBe("clear");
  });

  it.each([
    ["no legacy policy and no dynamic blocker", undefined, false, "clear"],
    ["no legacy policy and a zero-height dynamic blocker", undefined, true, "destructible"],
    [
      "an empty-tag legacy terrain/elevation policy and no dynamic blocker",
      { terrainTypes: TERRAIN_TYPES, terrainBlockerTags: [] },
      false,
      "elevation"
    ]
  ] as const)(
    "keeps terrain elevation policy independent for %s",
    (_label, legacyPolicy, withBlocker, expectedReason) => {
      const subject = map({ elevationOverrides: [{ q: 4, r: 2, elevation: 5 }] });
      const { source, target } = row2Line(subject);
      const index = buildIndex()(
        subject,
        withBlocker ? [blocker("zero_height", { q: 4, r: 2 }, 0)] : []
      );
      expect(traceV2()(subject, legacyPolicy, index, source, target).row.reason).toBe(expectedReason);
    }
  );

  it("uses closest-cell ordering and same-cell priority terrain tag, then destructible, then elevation", () => {
    const subject = map({
      terrainOverrides: [{ q: 4, r: 2, terrain: "cliff" }],
      elevationOverrides: [{ q: 4, r: 2, elevation: 2 }]
    });
    const { source, target } = row2Line(subject);
    const sameCell = buildIndex()(subject, [blocker("same_cell", { q: 4, r: 2 }, 1)]);
    expect(traceV2()(subject, LEGACY_POLICY, sameCell, source, target)).toMatchObject({
      row: { reason: "terrain_tag", blocker: { coord: { q: 4, r: 2 }, tag: "wall" } }
    });
    expect(traceV2()(
      subject,
      { terrainTypes: TERRAIN_TYPES, terrainBlockerTags: [] },
      sameCell,
      source,
      target
    )).toMatchObject({
      row: { reason: "destructible", blocker: { objectId: "same_cell" } }
    });
    expect(traceV2()(
      subject,
      { terrainTypes: TERRAIN_TYPES, terrainBlockerTags: [] },
      undefined,
      source,
      target
    )).toMatchObject({ row: { reason: "elevation" } });

    const closerObject = buildIndex()(subject, [blocker("closer", { q: 2, r: 2 }, 1)]);
    expect(traceV2()(subject, LEGACY_POLICY, closerObject, source, target)).toMatchObject({
      row: { reason: "destructible", blocker: { coord: { q: 2, r: 2 }, objectId: "closer" } }
    });
  });

  it("is permutation-invariant and returns detached frozen destructible provenance", () => {
    const subject = map();
    const { source, target } = row2Line(subject);
    const authored = [
      blocker("z_later", { q: 6, r: 2 }, 1),
      blocker("a_first", { q: 2, r: 2 }, 1)
    ];
    const forward = traceV2()(subject, undefined, buildIndex()(subject, authored), source, target);
    const reverse = traceV2()(subject, undefined, buildIndex()(subject, [...authored].reverse()), source, target);
    expect(reverse).toEqual(forward);
    (authored[1]!.coord as { q: number; r: number }).q = 7;
    expect(forward).toMatchObject({
      row: {
        reason: "destructible",
        blocker: { coord: { q: 2, r: 2 }, objectId: "a_first", definitionId: "gate", blockerHeight: 1 }
      }
    });
    expect(Object.isFrozen(forward.row)).toBe(true);
    expect(Object.isFrozen(forward.row.blocker)).toBe(true);
    expect(Object.isFrozen(forward.row.blocker?.coord)).toBe(true);
  });

  it("accepts 4096 blockers, rejects 4097, and enforces ray and operation budgets", () => {
    const large = map({ width: 65, height: 64 });
    const exact = Array.from({ length: 4_096 }, (_, index) => blocker(
      `object_${index}`,
      { q: index % 64, r: Math.floor(index / 64) },
      1
    ));
    expect(buildIndex()(large, exact)).toMatchObject({ schemaVersion: 1 });
    expect(() => buildIndex()(large, [
      ...exact,
      blocker("object_4096", { q: 64, r: 63 }, 1)
    ])).toThrow(/4096|limit|blocker|index/i);

    const exactRay = map({ width: 257, height: 1 });
    const exactIndex = buildIndex()(exactRay, [blocker("edge", { q: 255, r: 0 }, 1)]);
    expect(traceV2()(
      exactRay, undefined, exactIndex, { q: 0, r: 0 }, { q: 256, r: 0 }
    )).toMatchObject({ row: { reason: "destructible" }, cellInspections: 255 });
    expect(traceV2()(
      exactRay, undefined, exactIndex, { q: 0, r: 0 }, { q: 256, r: 0 }, 0
    )).toMatchObject({ row: { reason: "operation_budget_exceeded" }, cellInspections: 0, budgetExceeded: true });

    const overRay = map({ width: 258, height: 1 });
    expect(traceV2()(
      overRay,
      undefined,
      buildIndex()(overRay, [blocker("edge", { q: 256, r: 0 }, 1)]),
      { q: 0, r: 0 },
      { q: 257, r: 0 }
    )).toMatchObject({ row: { reason: "ray_budget_exceeded" }, cellInspections: 0, budgetExceeded: true });
  });

  it("rejects hostile, sparse, cyclic, and duplicate dynamic blockers without invoking accessors", () => {
    const subject = map();
    const build = buildIndex();
    let reads = 0;
    const accessor = blocker("gate", { q: 2, r: 2 }) as any;
    Object.defineProperty(accessor, "definitionId", {
      enumerable: true, get() { reads += 1; return "gate"; }
    });
    expect(() => build(subject, [accessor])).toThrow(/accessor|own data|inspect|blocker/i);
    expect(reads).toBe(0);

    const sparse = Object.assign(new Array(2), { 1: blocker("gate", { q: 2, r: 2 }) });
    const cyclic = blocker("cycle", { q: 2, r: 2 }) as any;
    cyclic.coord = cyclic;
    const duplicateId = [blocker("same", { q: 2, r: 2 }), blocker("same", { q: 3, r: 2 })];
    const duplicateCell = [blocker("a", { q: 2, r: 2 }), blocker("b", { q: 2, r: 2 })];
    const proxy = new Proxy([], { ownKeys() { throw new Error("hostile list"); } });
    for (const malformed of [sparse, [cyclic], duplicateId, duplicateCell, proxy]) {
      expect(() => build(subject, malformed as readonly DynamicBlockerV1[]))
        .toThrow(/inspect|dense|cycle|duplicate|blocker|coordinate/i);
    }
  });

  it("keeps the legacy trace wrapper and exact result unchanged when no dynamic source is supplied", () => {
    const subject = map({ terrainOverrides: [{ q: 4, r: 2, terrain: "cliff" }] });
    const { source, target } = row2Line(subject);
    const legacy = LineOfSight.traceLineOfSight(
      subject, TERRAIN_TYPES, LEGACY_POLICY.terrainBlockerTags, source, target, 32
    );
    expect(traceV2()(subject, LEGACY_POLICY, undefined, source, target, 32)).toEqual(legacy);
    expect(legacy).toEqual({
      row: {
        target, visible: false, reason: "terrain_tag",
        blocker: { coord: { q: 4, r: 2 }, terrainId: "cliff", elevation: 0, tag: "wall" }
      },
      cellInspections: 4,
      budgetExceeded: false
    });
  });
});
